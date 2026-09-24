//! The systems, planets and deposits a save gained after it was opened.
//!
//! The index is scanned once, from the bytes as loaded, so an entity an op wrote is found
//! here instead: an inserted statement, or a tombstone (`<id>=none`) rewritten as a new
//! entity in its slot. Like a scenario's id map, it is read again from the bytes each slot
//! holds after every edit, undo and redo, never kept as a running tally.

use std::collections::{BTreeMap, HashMap};

use crate::cst::{self, Node};
use crate::keys;
use crate::overlay::{Anchor, Overlay};
use crate::scan::{self, Index};

/// The id-keyed tables an op adds entities to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) enum Table {
    System,
    Planet,
    Deposit,
}

impl Table {
    /// The table a top-level section holds, if it is one of these.
    fn of_section(key: &str) -> Option<Self> {
        match key {
            keys::GALACTIC_OBJECT => Some(Self::System),
            keys::PLANETS => Some(Self::Planet),
            keys::DEPOSIT => Some(Self::Deposit),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct Added {
    by_slot: BTreeMap<Anchor, (Table, u32)>,
    by_id: HashMap<(Table, u32), Anchor>,
}

impl Added {
    /// The slot standing for entity `id` of `table`, when an op wrote it.
    pub fn get(&self, table: Table, id: u32) -> Option<Anchor> {
        self.by_id.get(&(table, id)).copied()
    }

    /// Every entity of `table` an op wrote, with its slot, in emission order.
    pub fn entries(&self, table: Table) -> impl Iterator<Item = (u32, Anchor)> + '_ {
        self.by_slot
            .iter()
            .filter(move |(_, (t, _))| *t == table)
            .map(|(&anchor, &(_, id))| (id, anchor))
    }

    /// Read `slots` again from the bytes they hold now: a slot emptied or put back as it
    /// was loaded names nothing, and one holding a new entity names it.
    pub fn refresh(&mut self, original: &[u8], index: &Index, overlay: &Overlay, slots: &[Anchor]) {
        for &slot in slots {
            // A renumbering moves an id from one slot to another, so the id may already
            // stand for a slot read earlier in this pass.
            if let Some(old) = self.by_slot.remove(&slot)
                && self.by_id.get(&old) == Some(&slot)
            {
                self.by_id.remove(&old);
            }
            let Some(table) = table_at(original, index, slot.start()) else {
                continue;
            };
            // A system is only ever inserted: none is written over another's slot.
            if table == Table::System && !slot.is_inserted() {
                continue;
            }
            let Ok(bytes) = overlay.current(slot, original) else {
                continue;
            };
            let Some(id) = entity_id(bytes) else {
                continue;
            };
            if let Anchor::Original(span) = slot
                && entity_id(span.slice(original)) == Some(id)
            {
                continue;
            }
            self.by_slot.insert(slot, (table, id));
            self.by_id.insert((table, id), slot);
        }
    }
}

/// The table whose top-level section holds offset `at`.
fn table_at(original: &[u8], index: &Index, at: usize) -> Option<Table> {
    let sections = index.sections();
    let i = sections.partition_point(|s| s.stmt.end <= at);
    let section = sections.get(i).filter(|s| s.stmt.start <= at)?;
    Table::of_section(&scan::key_name(original, section))
}

/// The id of the `<id>={ … }` entity `bytes` hold; `None` for a tombstone or anything else.
fn entity_id(bytes: &[u8]) -> Option<u32> {
    let root = cst::parse(bytes, 0).ok()?;
    let node: &Node = root.children().first()?;
    node.scalar_span().is_none().then_some(())?;
    node.key_str(bytes)?.parse().ok()
}
