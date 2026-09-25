//! Which id a new save entity takes, and where its statement goes.
//!
//! Systems are numbered densely from 0: a new one takes `last_created_system + 1`, and
//! a gap crashes the game. Planets and deposits live in slot tables: an id is
//! `slot | generation << 24`, the table is sorted by slot, and a dead slot keeps its last
//! id as a tombstone, `<id>=none`. A new entity takes the lowest dead slot one generation
//! on, written in place of its tombstone, and once none is left the slot past the highest
//! at generation 0, at the end of the table. Construction queues need no allocator: the
//! game builds them on load.
//!
//! Every rule reads the table as it stands now, so a second add takes nothing the first
//! one took, and a tombstone a removal wrote, into an appended slot or one the file held,
//! is a dead slot like any other.
//!
//! Freeing reverses it: a slot the file held gets back the tombstone it held when loaded,
//! or one for the id the slot held before the add took it. The game leaves no slot missing
//! below the highest, so only the end of a table shrinks: from the last appended entry
//! back, each freed entry, and each tombstone an earlier removal left, is deleted until a
//! live one stands, and every other freed entry becomes a tombstone. The ambient table
//! has no generations, so there a tombstone keeps the id its entry had.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use crate::Span;
use crate::cst;
use crate::document::Document;
use crate::format::save::added::Table;
use crate::keys;
use crate::ops::{OpError, Plan, Subject};
use crate::overlay::Anchor;
use crate::projections::galaxy::GalaxyGraph;
use crate::scan::{self, Entity, Value};

const GENERATION_SHIFT: u32 = 24;
const SLOT_MASK: u32 = (1 << GENERATION_SHIFT) - 1;
const LAST_GENERATION: u32 = u32::MAX >> GENERATION_SHIFT;
const TOMBSTONE: &[u8] = b"none";

/// A top-level `last_created_*` statement and the id it now holds.
pub(crate) struct Counter {
    key: &'static str,
    anchor: Anchor,
    pub last: u32,
}

impl Counter {
    /// The id the counter held when the file was opened.
    pub fn loaded(&self, doc: &Document) -> u32 {
        let Anchor::Original(span) = self.anchor else {
            return self.last;
        };
        scalar_id(span.slice(doc.original())).unwrap_or(self.last)
    }

    /// Write `last` into the counter.
    pub fn set(&self, plan: &mut Plan, doc: &Document, last: u32) -> Result<(), OpError> {
        let edit = plan.edit_record(doc, self.anchor)?;
        let span = edit
            .entity()?
            .scalar_span()
            .ok_or_else(|| edit.parse_error(0, format!("{} is not a scalar", self.key)))?;
        edit.replace_span(span, last.to_string());
        Ok(())
    }
}

/// The number the one statement `bytes` hold has as its value.
fn scalar_id(bytes: &[u8]) -> Option<u32> {
    let root = cst::parse(bytes, 0).ok()?;
    root.children().first()?.scalar_str(bytes)?.parse().ok()
}

pub(crate) fn system_counter(doc: &Document) -> Result<Counter, OpError> {
    counter(doc, keys::LAST_CREATED_SYSTEM)
}

/// The top-level counter `key` and the id it now holds.
pub(crate) fn counter(doc: &Document, key: &'static str) -> Result<Counter, OpError> {
    let missing = OpError::MissingSaveKey(key);
    let section = doc.index().section(key).ok_or(missing)?;
    let anchor = Anchor::Original(section.stmt);
    let last = scalar_id(doc.current(anchor)?).ok_or(OpError::MissingSaveKey(key))?;
    Ok(Counter { key, anchor, last })
}

/// The id a new system takes, refused unless the systems the save holds are exactly the
/// ids below it.
pub(crate) fn next_system(doc: &Document, graph: &GalaxyGraph) -> Result<u32, OpError> {
    let last = system_counter(doc)?.last;
    let count = graph.systems.len();
    let next = last.checked_add(1).filter(|&next| {
        usize::try_from(next).is_ok_and(|n| n == count) && graph.systems.keys().all(|&id| id < next)
    });
    next.ok_or(OpError::SystemIdsNotDense { last, count })
}

/// The slot a new entity takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Slot {
    /// A dead slot, whose tombstone the entity is written in place of.
    Reused { id: u32, tombstone: Anchor },
    /// Past the end of the table.
    Appended { id: u32 },
}

impl Slot {
    pub fn id(self) -> u32 {
        match self {
            Self::Reused { id, .. } | Self::Appended { id } => id,
        }
    }
}

/// Where a table's new entries go: before its closing brace, on a line of their own.
pub(crate) struct TableEnd {
    at: usize,
    indent: Vec<u8>,
    /// Set when the closing brace shares its line with other text (`deposit={ }`): the
    /// indentation the brace takes on the line the entries leave it on, and whether an
    /// entry already stands before it, so that the next one starts its own line.
    inline: Option<(Vec<u8>, bool)>,
}

impl TableEnd {
    /// The end of `table`, whose block closes at `close` and holds `entities`.
    pub fn read(doc: &Document, table: Table, close: usize, entities: &[Entity]) -> Self {
        let src = doc.original();
        let close_indent = cst::indent_of(src, close).to_vec();
        let indent = match entities.last() {
            Some(last) => cst::indent_of(src, last.stmt.start).to_vec(),
            None => [&close_indent[..], b"\t"].concat(),
        };
        let line = cst::line_start(src, close);
        if src[line..close].iter().all(|&b| b == b' ' || b == b'\t') {
            return Self {
                at: line,
                indent,
                inline: None,
            };
        }
        let opened = doc
            .added()
            .entries(table)
            .any(|(_, anchor)| matches!(anchor, Anchor::Inserted { at, .. } if at == close));
        Self {
            at: close,
            indent,
            inline: Some((close_indent, opened)),
        }
    }

    /// The original offset new entries are inserted at.
    pub fn at(&self) -> usize {
        self.at
    }

    /// What the table's entries are indented with.
    pub fn indent(&self) -> &[u8] {
        &self.indent
    }

    /// `entry`, indented with [`Self::indent`] and ending its line, as it is written at
    /// [`Self::at`]: unchanged before a brace alone on its line, else on a line of its own
    /// with the brace moved to the next.
    pub fn shape(&mut self, entry: Vec<u8>) -> Vec<u8> {
        let Some((close_indent, opened)) = &mut self.inline else {
            return entry;
        };
        let mut text = if *opened {
            entry
                .strip_prefix(close_indent.as_slice())
                .unwrap_or(&entry)
                .to_vec()
        } else {
            [b"\n", &entry[..]].concat()
        };
        *opened = true;
        text.extend_from_slice(close_indent);
        text
    }
}

/// One slot table as it stands, handing out and taking back slots by the rules above, for
/// the plan of one op.
pub(crate) struct SlotTable {
    table: Table,
    /// Where an appended entity goes.
    pub end: TableEnd,
    /// Dead slots nothing has taken, lowest slot first, each with its tombstone's id.
    dead: VecDeque<(u32, Anchor)>,
    next: u32,
    /// The ids the plan appends.
    appended: Vec<u32>,
    /// Tombstones in appended slots the plan writes an entry into.
    revived: BTreeSet<Anchor>,
    /// Appended entries the plan frees, which [`Self::settle`] erases or leaves as
    /// tombstones.
    freed: BTreeMap<Anchor, Subject>,
}

impl SlotTable {
    /// `planets.planet`.
    pub fn planets(doc: &Document) -> Result<Self, OpError> {
        let missing = || OpError::MissingSaveKey(keys::PLANETS);
        let inner = doc.inner_index(keys::PLANETS)?.ok_or_else(missing)?;
        let section = inner.section(keys::PLANET).ok_or_else(missing)?;
        Self::read(
            doc,
            Table::Planet,
            section.value,
            inner.entities(keys::PLANET),
        )
        .ok_or_else(missing)
    }

    /// The top-level `deposit` table.
    pub fn deposits(doc: &Document) -> Result<Self, OpError> {
        let missing = || OpError::MissingSaveKey(keys::DEPOSIT);
        let section = doc.index().section(keys::DEPOSIT).ok_or_else(missing)?;
        let entities = doc.index().entities(keys::DEPOSIT);
        Self::read(doc, Table::Deposit, section.value, entities).ok_or_else(missing)
    }

    /// The top-level `ambient_object` table.
    pub fn ambient_objects(doc: &Document) -> Result<Self, OpError> {
        let missing = || OpError::MissingSaveKey(keys::AMBIENT_OBJECT);
        let section = doc
            .index()
            .section(keys::AMBIENT_OBJECT)
            .ok_or_else(missing)?;
        let entities = doc.index().entities(keys::AMBIENT_OBJECT);
        Self::read(doc, Table::AmbientObject, section.value, entities).ok_or_else(missing)
    }

    fn read(doc: &Document, table: Table, value: Value, entities: &[Entity]) -> Option<Self> {
        let Value::Block { close, .. } = value else {
            return None;
        };
        let src = doc.original();
        let added = doc.added();
        let end = TableEnd::read(doc, table, close, entities);
        let mut dead = Vec::new();
        let mut highest = None;
        for entry in appended(doc, end.at()) {
            highest = highest.max(Some(entry.id & SLOT_MASK));
            if entry.dead && entry.id >> GENERATION_SHIFT < LAST_GENERATION {
                dead.push((entry.id, entry.anchor));
            }
        }
        for entity in entities {
            let id = u32::try_from(entity.id).ok()?;
            highest = highest.max(Some(id & SLOT_MASK));
            let anchor = Anchor::Original(entity.stmt);
            let tombstone = if doc.overlay().has_original_at(anchor.start()) {
                doc.current(anchor).ok().and_then(tombstone_of)
            } else {
                match entity.value {
                    Value::Scalar(span) => is_tombstone(span.slice(src)).then_some(id),
                    Value::Block { .. } => None,
                }
            };
            if let Some(id) = tombstone
                && id >> GENERATION_SHIFT < LAST_GENERATION
            {
                dead.push((id, anchor));
            }
        }
        for (id, _) in added.entries(table) {
            highest = highest.max(Some(id & SLOT_MASK));
        }
        dead.sort_by_key(|&(id, _)| id & SLOT_MASK);
        Some(Self {
            table,
            end,
            dead: dead.into(),
            next: highest.map_or(0, |slot| slot + 1),
            appended: Vec::new(),
            revived: BTreeSet::new(),
            freed: BTreeMap::new(),
        })
    }

    /// The slot past the highest at generation 0, whatever dead slots there are.
    pub fn append(&mut self) -> Slot {
        let id = self.next;
        self.next += 1;
        self.appended.push(id);
        Slot::Appended { id }
    }

    /// The dead slot `tombstone` stands in, taken for entity `id`.
    pub fn reuse(&mut self, id: u32, tombstone: Anchor) -> Slot {
        if tombstone.is_inserted() {
            self.revived.insert(tombstone);
        }
        Slot::Reused { id, tombstone }
    }

    /// The id [`Self::append`] hands out next.
    pub fn next_appended(&self) -> u32 {
        self.next
    }

    /// The next slot: the lowest dead one, else one past the highest.
    pub fn take(&mut self) -> Slot {
        match self.dead.pop_front() {
            Some((old, tombstone)) => self.reuse(
                (old & SLOT_MASK) | (((old >> GENERATION_SHIFT) + 1) << GENERATION_SHIFT),
                tombstone,
            ),
            None => self.append(),
        }
    }

    /// Take back what an add wrote as entity `id` at `slot`, which then stands for
    /// `subject`: the tombstone a slot the file held had, or one for the id it held before
    /// the add. An appended entry is left for [`Self::settle`].
    pub fn free(
        &mut self,
        plan: &mut Plan,
        doc: &Document,
        subject: Subject,
        id: u32,
        slot: Anchor,
    ) -> Result<(), OpError> {
        let Anchor::Original(span) = slot else {
            self.freed.insert(slot, subject);
            return Ok(());
        };
        let loaded = span.slice(doc.original());
        let bytes = match tombstone_of(loaded) {
            Some(_) => loaded.to_vec(),
            None => tombstone(self.tombstone_id(id)).into_bytes(),
        };
        plan.replace(doc, subject, slot, bytes)
    }

    /// Whether the plan has appended, revived or freed an entry past the loaded table.
    pub fn touched(&self) -> bool {
        !(self.appended.is_empty() && self.revived.is_empty() && self.freed.is_empty())
    }

    /// Settle the appended entries once the plan has freed and written all it will: from
    /// the end back, each freed entry and each earlier tombstone goes until a live one
    /// stands, and every other freed entry becomes a tombstone. Returns the highest id of
    /// an appended entry that stays.
    pub fn settle(&self, plan: &mut Plan, doc: &Document) -> Result<Option<u32>, OpError> {
        let mut live = self.appended.clone();
        let mut at_end = live.is_empty();
        for entry in appended(doc, self.end.at()).into_iter().rev() {
            if self.revived.contains(&entry.anchor) {
                at_end = false;
                live.push(entry.id);
                continue;
            }
            let freed = self.freed.get(&entry.anchor).copied();
            if at_end && (freed.is_some() || entry.dead) {
                let subject = freed.unwrap_or(Subject::Record(entry.anchor));
                plan.erase(doc, subject, entry.anchor)?;
                continue;
            }
            at_end = false;
            let Some(subject) = freed else {
                if !entry.dead {
                    live.push(entry.id);
                }
                continue;
            };
            let current = doc.current(entry.anchor)?;
            let span = statement_span(current)
                .ok_or_else(|| subject.parse_error(0, "the entry holds no statement"))?;
            let tombstone = tombstone(self.tombstone_id(entry.id));
            let bytes = [
                &current[..span.start],
                tombstone.as_bytes(),
                &current[span.end..],
            ]
            .concat();
            plan.replace(doc, subject, entry.anchor, bytes)?;
        }
        Ok(live.into_iter().max())
    }

    fn tombstone_id(&self, id: u32) -> u32 {
        match self.table {
            Table::AmbientObject => id,
            Table::System | Table::Planet | Table::Deposit => tombstone_id(id),
        }
    }
}

/// An entry an op appended to a slot table: a live entity, or the tombstone a removal
/// left in its place.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Appended {
    pub anchor: Anchor,
    pub id: u32,
    pub dead: bool,
}

/// The entries ops appended to the table whose new entries go at `at`, in file order; a
/// slot an erasure emptied is left out.
pub(crate) fn appended(doc: &Document, at: usize) -> Vec<Appended> {
    doc.overlay()
        .slots()
        .filter(|(anchor, _)| matches!(anchor, Anchor::Inserted { at: here, .. } if *here == at))
        .filter_map(|(anchor, bytes)| {
            let root = cst::parse(bytes, 0).ok()?;
            let node = root.children().first()?;
            Some(Appended {
                anchor,
                id: node.key_str(bytes)?.parse().ok()?,
                dead: node
                    .scalar_span()
                    .is_some_and(|value| is_tombstone(value.slice(bytes))),
            })
        })
        .collect()
}

/// The id the tombstone of entity `id`'s slot holds once it dies there: the one the slot
/// held before an add took it one generation on, or `id` itself in a slot an add appended.
fn tombstone_id(id: u32) -> u32 {
    match id >> GENERATION_SHIFT {
        0 => id,
        _ => id - (1 << GENERATION_SHIFT),
    }
}

/// Whether a scalar value, as written, is a tombstone's `none`.
fn is_tombstone(value: &[u8]) -> bool {
    scan::unquote(value) == TOMBSTONE
}

/// `id`'s tombstone statement.
pub(crate) fn tombstone(id: u32) -> String {
    format!("{id}=none")
}

/// The id of the tombstone `bytes` hold; `None` for a live entry or anything else.
pub(crate) fn tombstone_of(bytes: &[u8]) -> Option<u32> {
    let root = cst::parse(bytes, 0).ok()?;
    let node = root.children().first()?;
    is_tombstone(node.scalar_span()?.slice(bytes)).then_some(())?;
    node.key_str(bytes)?.parse().ok()
}

/// The span of the one statement `bytes` hold, which may stand after a line break and
/// before the indentation of a closing brace.
pub(crate) fn statement_span(bytes: &[u8]) -> Option<Span> {
    let root = cst::parse(bytes, 0).ok()?;
    Some(root.children().first()?.span())
}
