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
//! one took, and a tombstone a removal wrote into an appended slot is a dead slot like any
//! other.

use std::collections::VecDeque;

use crate::Span;
use crate::cst;
use crate::document::Document;
use crate::format::save::added::Table;
use crate::keys;
use crate::ops::OpError;
use crate::overlay::Anchor;
use crate::projections::galaxy::GalaxyGraph;
use crate::scan::{self, Entity, Value};

const GENERATION_SHIFT: u32 = 24;
const SLOT_MASK: u32 = (1 << GENERATION_SHIFT) - 1;
const LAST_GENERATION: u32 = u32::MAX >> GENERATION_SHIFT;
const TOMBSTONE: &[u8] = b"none";

/// The save's `last_created_system` statement and the id it now holds.
pub(crate) struct Counter {
    pub anchor: Anchor,
    pub last: u32,
}

pub(crate) fn system_counter(doc: &Document) -> Result<Counter, OpError> {
    let missing = OpError::MissingSaveKey(keys::LAST_CREATED_SYSTEM);
    let section = doc
        .index()
        .section(keys::LAST_CREATED_SYSTEM)
        .ok_or(missing)?;
    let anchor = Anchor::Original(section.stmt);
    let bytes = doc.current(anchor)?;
    let last = cst::parse(bytes, 0)
        .ok()
        .and_then(|root| root.children().first()?.scalar_str(bytes)?.parse().ok())
        .ok_or(OpError::MissingSaveKey(keys::LAST_CREATED_SYSTEM))?;
    Ok(Counter { anchor, last })
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

/// One slot table as it stands, handing out slots in the order the rules above give.
pub(crate) struct SlotTable {
    /// Where an appended entity goes.
    pub end: TableEnd,
    /// Dead slots nothing has taken, lowest slot first, each with its tombstone's id.
    free: VecDeque<(u32, Anchor)>,
    next: u32,
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

    fn read(doc: &Document, table: Table, value: Value, entities: &[Entity]) -> Option<Self> {
        let Value::Block { close, .. } = value else {
            return None;
        };
        let src = doc.original();
        let added = doc.added();
        let end = TableEnd::read(doc, table, close, entities);
        let mut free = Vec::new();
        let mut highest = None;
        for entry in appended(doc, end.at()) {
            highest = highest.max(Some(entry.id & SLOT_MASK));
            if entry.dead && entry.id >> GENERATION_SHIFT < LAST_GENERATION {
                free.push((entry.id, entry.anchor));
            }
        }
        for entity in entities {
            let id = u32::try_from(entity.id).ok()?;
            highest = highest.max(Some(id & SLOT_MASK));
            let anchor = Anchor::Original(entity.stmt);
            let dead = match entity.value {
                Value::Scalar(span) => scan::unquote(span.slice(src)) == TOMBSTONE,
                Value::Block { .. } => false,
            };
            if dead && !added.replaces(anchor) && id >> GENERATION_SHIFT < LAST_GENERATION {
                free.push((id, anchor));
            }
        }
        for (id, _) in added.entries(table) {
            highest = highest.max(Some(id & SLOT_MASK));
        }
        free.sort_by_key(|&(id, _)| id & SLOT_MASK);
        Some(Self {
            end,
            free: free.into(),
            next: highest.map_or(0, |slot| slot + 1),
        })
    }

    /// The next slot: the lowest dead one, else one past the highest.
    pub fn take(&mut self) -> Slot {
        match self.free.pop_front() {
            Some((old, tombstone)) => Slot::Reused {
                id: (old & SLOT_MASK) | (((old >> GENERATION_SHIFT) + 1) << GENERATION_SHIFT),
                tombstone,
            },
            None => {
                let id = self.next;
                self.next += 1;
                Slot::Appended { id }
            }
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
                    .scalar_str(bytes)
                    .is_some_and(|v| v.as_bytes() == TOMBSTONE),
            })
        })
        .collect()
}

/// The id the tombstone of entity `id`'s slot holds once it dies there: the one the slot
/// held before an add took it one generation on, or `id` itself in a slot an add appended.
pub(crate) fn tombstone_id(id: u32) -> u32 {
    match id >> GENERATION_SHIFT {
        0 => id,
        _ => id - (1 << GENERATION_SHIFT),
    }
}

/// `id`'s tombstone statement.
pub(crate) fn tombstone(id: u32) -> String {
    format!("{id}=none")
}

/// The span of the one statement `bytes` hold, which may stand after a line break and
/// before the indentation of a closing brace.
pub(crate) fn statement_span(bytes: &[u8]) -> Option<Span> {
    let root = cst::parse(bytes, 0).ok()?;
    Some(root.children().first()?.span())
}
