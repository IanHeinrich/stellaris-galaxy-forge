//! The systems, planets, deposits, dig sites and wormholes a save gained after it was
//! opened.
//!
//! The index is scanned once, from the bytes as loaded, so an entity an op wrote is found
//! here instead: an inserted statement, or a tombstone (`<id>=none`) rewritten as a new
//! entity in its slot. Like a scenario's id map, it is read again from the bytes each slot
//! holds after every edit, undo and redo, never kept as a running tally.

use std::collections::BTreeMap;

use crate::cst::Node;
use crate::document::Document;
use crate::entity::address;
use crate::entity::views::EntityKind;
use crate::format::save::{entity_at, entity_in};
use crate::keys;
use crate::overlay::{Anchor, Overlay};
use crate::projections::galaxy::ProjectionError;
use crate::scan::{self, Index};

/// The id-keyed tables an op adds entities to: an entity kind's, or the ambient objects,
/// the dig sites of `archaeological_sites.sites` and the bypasses, which the inspector does
/// not address.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Table {
    Entity(EntityKind),
    AmbientObject,
    DigSite,
    Bypass,
}

impl Table {
    const ALL: [Self; 7] = [
        Self::Entity(EntityKind::System),
        Self::Entity(EntityKind::Planet),
        Self::Entity(EntityKind::Deposit),
        Self::Entity(EntityKind::Wormhole),
        Self::AmbientObject,
        Self::DigSite,
        Self::Bypass,
    ];

    /// The top-level section the table's entities stand in.
    pub(crate) fn section(self) -> &'static str {
        match self {
            Self::Entity(kind) => address(kind).section,
            Self::AmbientObject => keys::AMBIENT_OBJECT,
            Self::DigSite => keys::ARCHAEOLOGICAL_SITES,
            Self::Bypass => keys::BYPASSES,
        }
    }

    /// The top-level section, and the key the rows stand under inside it when the section
    /// is only their container.
    fn path(self) -> (&'static str, Option<&'static str>) {
        match self {
            Self::Entity(kind) => {
                let address = address(kind);
                (address.section, address.inner)
            }
            Self::DigSite => (keys::ARCHAEOLOGICAL_SITES, Some(keys::SITES)),
            Self::AmbientObject | Self::Bypass => (self.section(), None),
        }
    }

    /// The index the rows the file was opened with stand in, and the key they stand under;
    /// `None` when the save has no such section.
    pub(crate) fn loaded(
        self,
        doc: &Document,
    ) -> Result<Option<(&Index, &'static str)>, ProjectionError> {
        Ok(match self.path() {
            (section, None) => Some((doc.index(), section)),
            (section, Some(key)) => doc.inner_index(section)?.map(|index| (index, key)),
        })
    }

    /// The table a top-level section holds, if it is one of these.
    fn of_section(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|table| table.section() == key)
    }
}

impl From<EntityKind> for Table {
    fn from(kind: EntityKind) -> Self {
        Self::Entity(kind)
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct Added {
    by_slot: BTreeMap<Anchor, (Table, u32)>,
    by_id: BTreeMap<(Table, u32), Anchor>,
}

impl Added {
    pub const fn new() -> Self {
        Self {
            by_slot: BTreeMap::new(),
            by_id: BTreeMap::new(),
        }
    }

    /// The slot standing for entity `id` of `table`, when an op wrote it.
    pub fn get(&self, table: impl Into<Table>, id: u32) -> Option<Anchor> {
        self.by_id.get(&(table.into(), id)).copied()
    }

    /// Every entity of `table` an op wrote, with its slot, in emission order.
    pub fn entries(&self, table: impl Into<Table>) -> impl Iterator<Item = (u32, Anchor)> + '_ {
        let table = table.into();
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
            if table == Table::Entity(EntityKind::System) && !slot.is_inserted() {
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
    entity_in(bytes).ok()??.key_str(bytes)?.parse().ok()
}

/// One row of a keyed table as the bytes now standing for it hold it.
pub(crate) struct Row<'d> {
    pub(crate) id: u32,
    pub(crate) anchor: Anchor,
    pub(crate) node: Node,
    pub(crate) src: &'d [u8],
}

/// Every live row of `table` in file order: each one loaded that no op took out, and each
/// one an op wrote.
pub(crate) fn rows(doc: &Document, table: Table) -> Result<Vec<Row<'_>>, ProjectionError> {
    let mut anchors: Vec<(u32, Anchor)> = doc.added().entries(table).collect();
    if let Some((index, key)) = table.loaded(doc)? {
        for entity in index.entities(key) {
            let anchor = Anchor::Original(entity.stmt);
            if let Ok(id) = u32::try_from(entity.id)
                && !doc.overlay().removed(anchor, doc.original())
            {
                anchors.push((id, anchor));
            }
        }
    }
    anchors.sort_by_key(|&(_, anchor)| anchor);
    let mut rows = Vec::new();
    for (id, anchor) in anchors {
        rows.extend(row_at(doc, table, id, anchor)?);
    }
    Ok(rows)
}

/// Row `id` of `table` as it stands now; `None` when the save holds no such row, holds its
/// tombstone, or an op took it out.
pub(crate) fn row(
    doc: &Document,
    table: Table,
    id: u32,
) -> Result<Option<Row<'_>>, ProjectionError> {
    let anchor = match doc.added().get(table, id) {
        Some(anchor) => Some(anchor),
        None => table
            .loaded(doc)?
            .and_then(|(index, key)| index.entity(key, u64::from(id)))
            .map(|entity| Anchor::Original(entity.stmt))
            .filter(|&anchor| !doc.overlay().removed(anchor, doc.original())),
    };
    match anchor {
        Some(anchor) => row_at(doc, table, id, anchor),
        None => Ok(None),
    }
}

/// The entity `anchor` holds, when it is row `id` of `table`.
fn row_at(
    doc: &Document,
    table: Table,
    id: u32,
    anchor: Anchor,
) -> Result<Option<Row<'_>>, ProjectionError> {
    let found = entity_at(doc, anchor).map_err(|source| ProjectionError::Entity {
        section: table.section(),
        id: u64::from(id),
        source,
    })?;
    Ok(found
        .filter(|(node, src)| node.key_str(src) == Some(id.to_string().as_str()))
        .map(|(node, src)| Row {
            id,
            anchor,
            node,
            src,
        }))
}
