//! Planning an op: the edits it makes, keyed by the entity each rewrites, and the
//! statements it emits whole, committed to the document at once or not at all.

use std::collections::BTreeMap;
use std::collections::btree_map::Entry;

use super::edit::{Edit, load, owns_line, parsed, splice};
use super::{Applied, Op, OpError, Subject, refresh, rollback};
use crate::Span;
use crate::cst;
use crate::document::Document;
use crate::format;
use crate::overlay::{Anchor, OverlayError};
use crate::session::Session;

/// What a planner returns once it has planned its edits: an inverse cannot be forgotten.
pub(crate) struct Planned {
    pub description: String,
    pub inverse: Op,
}

/// What a statement an op emits will stand for; its [`Subject`] needs the anchor the
/// overlay only hands out once the text is in.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Emitted {
    System(u32),
    /// A save planet and the system it is a body of.
    Planet {
        id: u32,
        system: u32,
    },
    Lane(u32, u32),
    /// A whole `nebula` statement, which lands last and so knows its own index.
    Nebula(usize),
    /// A header statement a key the file lacked was written as.
    Header,
    /// A save statement no projection reads, such as a deposit.
    Record,
}

impl Emitted {
    pub(crate) fn subject(self, anchor: Anchor) -> Subject {
        match self {
            Self::System(id) => Subject::System(id),
            Self::Planet { id, system } => Subject::Planet { id, system },
            Self::Nebula(index) => Subject::Nebula(index),
            Self::Lane(a, b) => Subject::Statement {
                anchor,
                ends: (a, b),
            },
            Self::Header => Subject::Header(anchor),
            Self::Record => Subject::Record(anchor),
        }
    }
}

/// A planned op: one edit per entity it rewrites, keyed by what that entity stands for,
/// plus the statements it emits whole.
pub(crate) struct Plan {
    edits: BTreeMap<Subject, Edit>,
    emits: Vec<(Emitted, usize, Vec<u8>)>,
    /// The slot of a statement an earlier op rewrote, which its erasure's line replaces.
    absorbed: BTreeMap<Subject, Anchor>,
}

impl Plan {
    pub(super) fn new() -> Self {
        Self {
            edits: BTreeMap::new(),
            emits: Vec::new(),
            absorbed: BTreeMap::new(),
        }
    }

    /// The edit for system `id`, loading and parsing its entity on first use.
    pub fn edit(&mut self, doc: &Document, id: u32) -> Result<&mut Edit, OpError> {
        self.subject(doc, Subject::System(id))
    }

    /// The edit for a save's planet `id`, a body of `system`, loading and parsing its
    /// entity on first use.
    pub fn edit_planet(
        &mut self,
        doc: &Document,
        id: u32,
        system: u32,
    ) -> Result<&mut Edit, OpError> {
        self.subject(doc, Subject::Planet { id, system })
    }

    /// The edit for the `index`th `nebula` section, loading and parsing it on first use.
    pub fn edit_nebula(&mut self, doc: &Document, index: usize) -> Result<&mut Edit, OpError> {
        self.subject(doc, Subject::Nebula(index))
    }

    /// The edit for one header statement, loading and parsing it on first use.
    pub fn edit_header(&mut self, doc: &Document, anchor: Anchor) -> Result<&mut Edit, OpError> {
        self.subject(doc, Subject::Header(anchor))
    }

    /// The edit for a save's top-level `flags` section, loading and parsing it on first use.
    pub fn edit_flags(&mut self, doc: &Document) -> Result<&mut Edit, OpError> {
        self.subject(doc, Subject::Flags)
    }

    /// The edit for a save's `country` entity `id`, loading and parsing it on first use.
    pub fn edit_country(&mut self, doc: &Document, id: u32) -> Result<&mut Edit, OpError> {
        self.subject(doc, Subject::Country(id))
    }

    /// The edit for a save statement no projection reads, at `anchor`, loading and parsing
    /// it on first use.
    pub fn edit_record(&mut self, doc: &Document, anchor: Anchor) -> Result<&mut Edit, OpError> {
        self.subject(doc, Subject::Record(anchor))
    }

    /// Write `bytes` in place of the statement at `anchor`, which then stands for `subject`:
    /// a new entity taking the slot of a tombstone.
    pub fn replace(
        &mut self,
        doc: &Document,
        subject: Subject,
        anchor: Anchor,
        bytes: Vec<u8>,
    ) -> Result<(), OpError> {
        let edit = match self.edits.entry(subject) {
            Entry::Occupied(e) => e.into_mut(),
            Entry::Vacant(e) => e.insert(load(doc, subject, anchor)?),
        };
        let end = edit.buf.len();
        edit.splices.push((0..end, bytes));
        Ok(())
    }

    /// Emit `bytes` as a new statement at original offset `at`.
    pub fn emit(&mut self, what: Emitted, at: usize, bytes: Vec<u8>) {
        self.emits.push((what, at, bytes));
    }

    /// Leave nothing where the statement at `anchor` stands. An original statement alone
    /// on its line takes the line with it, so the slot is the line rather than the
    /// statement, and a slot an earlier op gave the statement goes into the line's; an
    /// inserted one empties its own slot.
    pub fn erase(
        &mut self,
        doc: &Document,
        subject: Subject,
        anchor: Anchor,
    ) -> Result<(), OpError> {
        let slot = erasure_slot(doc, anchor);
        let Entry::Vacant(vacant) = self.edits.entry(subject) else {
            return Ok(());
        };
        let rewritten = slot != anchor && doc.overlay().has_original_at(anchor.start());
        let edit = if rewritten {
            let src = doc.original();
            let buf = [
                &src[slot.start()..anchor.start()],
                doc.current(anchor)?,
                &src[anchor.end()..slot.end()],
            ]
            .concat();
            let edit = parsed(doc, subject, slot, buf)?;
            self.absorbed.insert(subject, anchor);
            vacant.insert(edit)
        } else {
            vacant.insert(load(doc, subject, slot)?)
        };
        let end = edit.buf.len();
        edit.splices.push((0..end, Vec::new()));
        Ok(())
    }

    fn subject(&mut self, doc: &Document, subject: Subject) -> Result<&mut Edit, OpError> {
        match self.edits.entry(subject) {
            Entry::Occupied(e) => Ok(e.into_mut()),
            Entry::Vacant(e) => Ok(e.insert(load(doc, subject, statement(doc, subject)?)?)),
        }
    }

    pub(super) fn commit(
        self,
        session: &mut Session,
        op: Op,
        planned: Planned,
    ) -> Result<Applied, OpError> {
        let mut before = Vec::new();
        let mut after = Vec::new();
        let mut touched = Vec::new();
        let mut replacements = Vec::new();
        for (subject, edit) in self.edits {
            if edit.splices.is_empty() {
                continue;
            }
            let new_buf = splice(subject, &edit.buf, edit.splices)?;
            replacements.push((subject, edit.stmt, new_buf));
        }
        for (subject, stmt, new_buf) in replacements {
            let replaced = match self.absorbed.get(&subject) {
                Some(&inner) => absorb(&mut session.doc, inner).map(|prev| {
                    before.push((inner, Some(prev)));
                    after.push((inner, None));
                }),
                None => Ok(()),
            }
            .and_then(|()| session.doc.replace(stmt, new_buf.clone()));
            match replaced {
                Ok(prev) => {
                    before.push((stmt, prev));
                    after.push((stmt, Some(new_buf)));
                    touched.push(subject);
                }
                Err(e) => {
                    rollback(session, &before, &touched);
                    return Err(e.into());
                }
            }
        }
        for (what, at, bytes) in self.emits {
            match session.doc.insert(at, bytes.clone()) {
                Ok(anchor) => {
                    before.push((anchor, None));
                    after.push((anchor, Some(bytes)));
                    touched.push(what.subject(anchor));
                }
                Err(e) => {
                    rollback(session, &before, &touched);
                    return Err(e.into());
                }
            }
        }
        match refresh(
            &mut session.doc,
            &mut session.graph,
            &touched,
            &slots(&before),
        ) {
            Ok(reassigned) => {
                touched.extend(reassigned);
                touched.sort_unstable();
                touched.dedup();
            }
            Err(e) => {
                rollback(session, &before, &touched);
                return Err(e);
            }
        }
        Ok(Applied {
            op,
            description: planned.description,
            inverse: planned.inverse,
            before,
            after,
            touched,
        })
    }
}

/// Take away the slot `inner`, returning its bytes, so the line enclosing it can have one.
fn absorb(doc: &mut Document, inner: Anchor) -> Result<Vec<u8>, OverlayError> {
    let prev = doc.current(inner)?.to_vec();
    doc.restore(inner, None);
    Ok(prev)
}

/// The slots a record of displaced bytes names.
pub(crate) fn slots(before: &[(Anchor, Option<Vec<u8>>)]) -> Vec<Anchor> {
    before.iter().map(|(anchor, _)| *anchor).collect()
}

/// The statement holding the subject's bytes.
fn statement(doc: &Document, subject: Subject) -> Result<Anchor, OpError> {
    format::of(doc.kind()).statement(doc, subject)
}

/// The slot an erasure replaces: the whole line for an original statement that has it to
/// itself, so that no blank line is left behind, and the statement's own span otherwise.
/// A trailing comment belongs to the line, and so goes with it. The line is read from the
/// original bytes, so a statement an earlier op rewrote takes the same line. A line an
/// insert stands in cannot be a slot, so there the statement keeps its span.
fn erasure_slot(doc: &Document, anchor: Anchor) -> Anchor {
    let Anchor::Original(span) = anchor else {
        return anchor;
    };
    let src = doc.original();
    if !owns_line(src, span) {
        return anchor;
    }
    let line = Span::new(
        cst::line_start(src, span.start),
        cst::line_end(src, span.end),
    );
    if doc.overlay().has_insert_within(line) {
        return anchor;
    }
    Anchor::Original(line)
}
