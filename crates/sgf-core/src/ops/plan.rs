//! Planning an op: the edits it makes, keyed by the entity each rewrites, and the
//! statements it emits whole, committed to the document at once or not at all.

use std::collections::BTreeMap;
use std::collections::btree_map::Entry;

use super::edit::{Edit, load, owns_line, splice};
use super::{Applied, Op, OpError, Subject, refresh, rollback};
use crate::Span;
use crate::cst;
use crate::document::Document;
use crate::format;
use crate::overlay::Anchor;
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
    Lane(u32, u32),
    /// A whole `nebula` statement, which lands last and so knows its own index.
    Nebula(usize),
    /// A header statement a key the file lacked was written as.
    Header,
}

impl Emitted {
    fn subject(self, anchor: Anchor) -> Subject {
        match self {
            Self::System(id) => Subject::System(id),
            Self::Nebula(index) => Subject::Nebula(index),
            Self::Lane(a, b) => Subject::Statement {
                anchor,
                ends: (a, b),
            },
            Self::Header => Subject::Header(anchor),
        }
    }
}

/// A planned op: one edit per entity it rewrites, keyed by what that entity stands for,
/// plus the statements it emits whole.
pub(crate) struct Plan {
    edits: BTreeMap<Subject, Edit>,
    emits: Vec<(Emitted, usize, Vec<u8>)>,
}

impl Plan {
    pub(super) fn new() -> Self {
        Self {
            edits: BTreeMap::new(),
            emits: Vec::new(),
        }
    }

    /// The edit for system `id`, loading and parsing its entity on first use.
    pub fn edit(&mut self, doc: &Document, id: u32) -> Result<&mut Edit, OpError> {
        self.subject(doc, Subject::System(id))
    }

    /// The edit for the `index`th `nebula` section, loading and parsing it on first use.
    pub fn edit_nebula(&mut self, doc: &Document, index: usize) -> Result<&mut Edit, OpError> {
        self.subject(doc, Subject::Nebula(index))
    }

    /// The edit for one header statement, loading and parsing it on first use.
    pub fn edit_header(&mut self, doc: &Document, anchor: Anchor) -> Result<&mut Edit, OpError> {
        self.subject(doc, Subject::Header(anchor))
    }

    /// Emit `bytes` as a new statement at original offset `at`.
    pub fn emit(&mut self, what: Emitted, at: usize, bytes: Vec<u8>) {
        self.emits.push((what, at, bytes));
    }

    /// Leave nothing where the statement at `anchor` stands. An original statement alone
    /// on its line takes the line with it, so the slot is the line rather than the
    /// statement; an inserted one empties its own slot.
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
        let edit = vacant.insert(load(doc, subject, slot)?);
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
            match session.doc.replace(stmt, new_buf.clone()) {
                Ok(prev) => {
                    before.push((stmt, prev));
                    after.push((stmt, new_buf));
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
                    after.push((anchor, bytes));
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
/// A trailing comment belongs to the line, and so goes with it. A statement an earlier op
/// rewrote already owns a slot, which nothing may overlap, so it keeps its span and leaves
/// its line blank.
fn erasure_slot(doc: &Document, anchor: Anchor) -> Anchor {
    let Anchor::Original(span) = anchor else {
        return anchor;
    };
    if doc.overlay().has_original_at(span.start) {
        return anchor;
    }
    let src = doc.original();
    if !owns_line(src, span) {
        return anchor;
    }
    Anchor::Original(Span::new(
        cst::line_start(src, span.start),
        cst::line_end(src, span.end),
    ))
}
