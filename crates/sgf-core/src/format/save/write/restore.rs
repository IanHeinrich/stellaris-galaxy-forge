//! `RestoreEntities`, the inverse of an op that rewrites whole save entities, and what
//! such an op uses to find an entity, keep it for the inverse and leave its tombstone.

use std::collections::BTreeMap;
use std::collections::btree_map::Entry;

use crate::cst::Node;
use crate::document::Document;
use crate::entity::views::EntityKind;
use crate::format::save::added::Table;
use crate::format::save::alloc::{self, SlotTable};
use crate::format::save::galaxy::bypasses::NATURAL;
use crate::format::save::write::megastructure_links::MEGASTRUCTURES;
use crate::format::save::{
    entity_at, entity_in, planet_statement, planet_system, system_statement,
};
use crate::keys;
use crate::ops::{
    Edit, Op, OpError, Plan, Planned, SavedEntity, SavedTable, Subject, restored_inverse,
};
use crate::overlay::Anchor;
use crate::scan::{self, Index, Value};
use crate::session::Session;

pub(crate) fn plan_restore(
    plan: &mut Plan,
    s: &Session,
    description: &str,
    entities: &[SavedEntity],
) -> Result<Planned, OpError> {
    let mut saved = Saved::default();
    for entity in entities {
        let SavedEntity { table, id, text } = entity;
        let (table, id) = (*table, *id);
        if !holds(table, id, text) {
            return Err(OpError::EntityMismatch { table, id });
        }
        let anchor = locate(&s.doc, table, id)?.ok_or(OpError::UnknownEntity { table, id })?;
        let subject = match table {
            SavedTable::System => Subject::System(id),
            SavedTable::Country => Subject::Country(id),
            // A planet written back, or deleted again, re-reads the bodies of the system the
            // entity it becomes names, or else of the one it replaces.
            SavedTable::Planet => match planet_origin(text.as_bytes(), id)
                .or_else(|| planet_origin(s.doc.current(anchor).ok()?, id))
            {
                Some(system) => Subject::Planet { id, system },
                None => Subject::Record(anchor),
            },
            _ => Subject::Record(anchor),
        };
        saved.keep(&s.doc, table, id, anchor)?;
        plan.replace(&s.doc, subject, anchor, text.clone().into_bytes())?;
    }
    Ok(Planned {
        description: description.to_owned(),
        inverse: saved.undoing(description),
    })
}

/// Whether `text` is one statement standing for entity `id` of `table`: the entity or its
/// tombstone, the dead megastructure table or the clusters whole, or nothing for a bypass or
/// natural wormhole row a deletion emptied.
fn holds(table: SavedTable, id: u32, text: &str) -> bool {
    match table {
        SavedTable::DeadMegastructures => {
            id == 0 && statement_key(text, false).as_deref() == Some(keys::DEAD_MEGA_STRUCTURE)
        }
        SavedTable::Clusters => {
            id == 0 && statement_key(text, false).as_deref() == Some(keys::CLUSTERS)
        }
        SavedTable::Bypass | SavedTable::NaturalWormhole if text.is_empty() => true,
        _ => statement_key(text, true).and_then(|key| key.parse().ok()) == Some(id),
    }
}

/// The key of the one statement `text` holds, when it holds exactly one block, or with
/// `tombstone` the scalar `none`.
fn statement_key(text: &str, tombstone: bool) -> Option<String> {
    let bytes = text.as_bytes();
    let root = crate::cst::parse(bytes, 0).ok()?;
    let [node] = root.children() else {
        return None;
    };
    let dead = tombstone && node.scalar_str(bytes) == Some("none");
    if node.scalar_span().is_some() && !dead {
        return None;
    }
    node.key_str(bytes).map(str::to_owned)
}

/// The system of the planet entity `bytes` hold; `None` for a tombstone.
fn planet_origin(bytes: &[u8], id: u32) -> Option<u32> {
    let node = entity_in(bytes).ok()??;
    planet_system(&node, bytes, id).ok()
}

/// What a system's deletion takes whole, which the shared writers leave alone rather than
/// edit before it becomes a tombstone: the system, its planets and the bypasses and ships it
/// takes. A country that goes with it is written last, over whatever the writers edited.
#[derive(Clone, Copy, Default)]
pub(crate) struct Gone<'a> {
    pub(crate) system: Option<u32>,
    pub(crate) planets: &'a [u32],
    pub(crate) bypasses: &'a [u32],
    pub(crate) ships: &'a [u32],
}

/// The whole statement of each entity an op rewrites, as it stood before, keyed by table
/// and id: what its inverse writes back.
#[derive(Default)]
pub(crate) struct Saved(BTreeMap<(SavedTable, u32), String>);

impl Saved {
    pub(crate) fn keep(
        &mut self,
        doc: &Document,
        table: SavedTable,
        id: u32,
        anchor: Anchor,
    ) -> Result<(), OpError> {
        if let Entry::Vacant(vacant) = self.0.entry((table, id)) {
            vacant.insert(String::from_utf8_lossy(doc.current(anchor)?).into_owned());
        }
        Ok(())
    }

    /// The inverse that undoes the edit described as `description`.
    pub(crate) fn undoing(self, description: &str) -> Op {
        restored_inverse(description, self.entities())
    }

    fn entities(self) -> Vec<SavedEntity> {
        self.0
            .into_iter()
            .map(|((table, id), text)| SavedEntity { table, id, text })
            .collect()
    }

    pub(crate) fn inverse(self, description: String) -> Op {
        Op::RestoreEntities {
            description,
            entities: self.entities(),
        }
    }
}

/// Where entity `id` of `table` stands now, a tombstone included.
pub(crate) fn locate(
    doc: &Document,
    table: SavedTable,
    id: u32,
) -> Result<Option<Anchor>, OpError> {
    let section = match table {
        SavedTable::System => return Ok(system_statement(doc, id)),
        SavedTable::Planet => {
            if let Some(anchor) = planet_statement(doc, id)? {
                return Ok(Some(anchor));
            }
            return Ok(SlotTable::planets(doc)?.dead_slot(id));
        }
        SavedTable::Starbase => {
            let inner = doc.inner_index(keys::STARBASE_MGR)?;
            return Ok(inner.and_then(|i| entry(i, keys::STARBASES, id)));
        }
        SavedTable::ConstructionQueue => {
            return Ok(queue_index(doc).and_then(|i| entry(&i, keys::QUEUES, id)));
        }
        SavedTable::ConstructionItem => {
            return Ok(item_index(doc).and_then(|i| entry(&i, keys::ITEMS, id)));
        }
        SavedTable::Megastructure => {
            return Ok(doc
                .added()
                .get(MEGASTRUCTURES, id)
                .or_else(|| entry(doc.index(), keys::MEGASTRUCTURES, id)));
        }
        SavedTable::Bypass => {
            return Ok(doc
                .added()
                .get(Table::Bypass, id)
                .or_else(|| entry(doc.index(), keys::BYPASSES, id)));
        }
        SavedTable::Deposit => {
            return Ok(doc
                .added()
                .get(EntityKind::Deposit, id)
                .or_else(|| entry(doc.index(), keys::DEPOSIT, id)));
        }
        SavedTable::NaturalWormhole => {
            return Ok(doc
                .added()
                .get(NATURAL, id)
                .or_else(|| entry(doc.index(), keys::NATURAL_WORMHOLES, id)));
        }
        SavedTable::DigSite => {
            if let Some(anchor) = doc.added().get(Table::DigSite, id) {
                return Ok(Some(anchor));
            }
            let inner = doc.inner_index(keys::ARCHAEOLOGICAL_SITES)?;
            return Ok(inner.and_then(|i| entry(i, keys::SITES, id)));
        }
        SavedTable::CouncilPosition => {
            return inner_entry(doc, keys::COUNCIL_POSITIONS, keys::COUNCIL_POSITIONS, id);
        }
        SavedTable::Situation => return inner_entry(doc, keys::SITUATIONS, keys::SITUATIONS, id),
        SavedTable::Storm => return inner_entry(doc, keys::STORMS, keys::STORMS, id),
        SavedTable::PsionicAura => {
            return inner_entry(doc, keys::PSIONIC_AURAS, keys::PSIONIC_AURAS, id);
        }
        SavedTable::AstralRift => return inner_entry(doc, keys::ASTRAL_RIFTS, keys::RIFTS, id),
        SavedTable::DeadMegastructures => return Ok(whole(doc, keys::DEAD_MEGA_STRUCTURE)),
        SavedTable::Clusters => return Ok(whole(doc, keys::CLUSTERS)),
        SavedTable::Country => keys::COUNTRY,
        SavedTable::Colony => keys::COLONY,
        SavedTable::PopGroup => keys::POP_GROUPS,
        SavedTable::PopJob => keys::POP_JOBS,
        SavedTable::District => keys::DISTRICTS,
        SavedTable::Zone => keys::ZONES,
        SavedTable::Building => keys::BUILDINGS,
        SavedTable::Army => keys::ARMY,
        SavedTable::Fleet => keys::FLEET,
        SavedTable::Ship => keys::SHIPS,
        SavedTable::Leader => keys::LEADERS,
        SavedTable::Sector => keys::SECTORS,
        SavedTable::SpyNetwork => keys::SPY_NETWORKS,
        SavedTable::WaystationNetwork => keys::WAYSTATION_NETWORKS,
    };
    Ok(entry(doc.index(), section, id))
}

/// The statement of row `id` under `key` in the top-level section `section`.
fn inner_entry(
    doc: &Document,
    section: &str,
    key: &str,
    id: u32,
) -> Result<Option<Anchor>, OpError> {
    Ok(doc.inner_index(section)?.and_then(|i| entry(i, key, id)))
}

/// The live rows of `table`, one the file held and no op wrote, standing under `key` in
/// `index`, whose original bytes `bytes` accepts and whose current entity `keep` accepts.
pub(crate) fn live_where<'d>(
    doc: &'d Document,
    table: SavedTable,
    index: Option<&Index>,
    key: &str,
    bytes: impl Fn(&[u8]) -> bool,
    keep: impl Fn(&Node, &[u8]) -> bool,
) -> Result<Vec<(u32, Found<'d>)>, OpError> {
    let Some(index) = index else {
        return Ok(Vec::new());
    };
    let src = doc.original();
    let mut found = Vec::new();
    for entity in index.entities(key) {
        let Ok(id) = u32::try_from(entity.id) else {
            continue;
        };
        if !bytes(entity.stmt.slice(src)) {
            continue;
        }
        if let Some(row) = live(doc, table, id)?
            && keep(&row.node, row.src)
        {
            found.push((id, row));
        }
    }
    Ok(found)
}

/// The top-level statement `key`.
fn whole(doc: &Document, key: &str) -> Option<Anchor> {
    let section = doc.index().section(key)?;
    Some(Anchor::Original(section.stmt))
}

/// The statement of entity `id` in `index`'s section `section`.
pub(crate) fn entry(index: &Index, section: &str, id: u32) -> Option<Anchor> {
    index
        .entity(section, u64::from(id))
        .map(|e| Anchor::Original(e.stmt))
}

/// The live entity entity `id` of `table` stands for now, with its statement.
pub(crate) fn live(
    doc: &Document,
    table: SavedTable,
    id: u32,
) -> Result<Option<Found<'_>>, OpError> {
    let Some(anchor) = locate(doc, table, id)? else {
        return Ok(None);
    };
    let found = entity_at(doc, anchor)
        .map_err(|e| Subject::Record(anchor).parse_error(e.offset, e.reason))?;
    Ok(found.map(|(node, src)| Found { anchor, node, src }))
}

pub(crate) struct Found<'a> {
    pub(crate) anchor: Anchor,
    pub(crate) node: Node,
    pub(crate) src: &'a [u8],
}

/// The bytes at `anchor` with the statement they hold made entity `id`'s tombstone, the
/// whitespace around it kept.
pub(crate) fn tombstoned(doc: &Document, anchor: Anchor, id: u32) -> Result<Vec<u8>, OpError> {
    let current = doc.current(anchor)?;
    let span = alloc::statement_span(current)
        .ok_or_else(|| Subject::Record(anchor).parse_error(0, "no statement stands there"))?;
    Ok([
        &current[..span.start],
        alloc::tombstone(id).as_bytes(),
        &current[span.end..],
    ]
    .concat())
}

/// `construction.queue_mgr`, scanned so that its `queues` expose their entities.
pub(crate) fn queue_index(doc: &Document) -> Option<Index> {
    construction_part(doc, keys::QUEUE_MGR)
}

/// `construction.item_mgr`, scanned so that its `items` expose their entities.
fn item_index(doc: &Document) -> Option<Index> {
    construction_part(doc, keys::ITEM_MGR)
}

fn construction_part(doc: &Document, key: &str) -> Option<Index> {
    let src = doc.original();
    let Value::Block { open, close } = doc.index().section(keys::CONSTRUCTION)?.value else {
        return None;
    };
    let inner = scan::scan_range(src, open + 1..close).ok()?;
    let Value::Block { open, close } = inner.section(key)?.value else {
        return None;
    };
    scan::scan_range(src, open + 1..close).ok()
}

/// The edit for country `country`, its statement kept for the inverse.
pub(crate) fn country_edit<'p>(
    plan: &'p mut Plan,
    doc: &Document,
    saved: &mut Saved,
    country: u32,
) -> Result<&'p mut Edit, OpError> {
    let anchor =
        locate(doc, SavedTable::Country, country)?.ok_or(OpError::UnknownCountry(country))?;
    saved.keep(doc, SavedTable::Country, country, anchor)?;
    plan.edit_country(doc, country)
}

/// Write each of `bodies`, planets of `system`, as its tombstone, keeping what stood there for
/// the inverse.
pub(crate) fn tombstone_planets(
    plan: &mut Plan,
    doc: &Document,
    saved: &mut Saved,
    system: u32,
    bodies: &[u32],
) -> Result<(), OpError> {
    for &id in bodies {
        let anchor = planet_statement(doc, id)?.ok_or(OpError::UnknownPlanet(id))?;
        saved.keep(doc, SavedTable::Planet, id, anchor)?;
        let bytes = tombstoned(doc, anchor, id)?;
        plan.replace(doc, Subject::Planet { id, system }, anchor, bytes)?;
    }
    Ok(())
}

/// Write each of `dead` as its tombstone, keeping what stood there for the inverse.
pub(crate) fn tombstone_all(
    plan: &mut Plan,
    doc: &Document,
    saved: &mut Saved,
    dead: &[(SavedTable, u32, Anchor)],
) -> Result<(), OpError> {
    for &(table, id, anchor) in dead {
        saved.keep(doc, table, id, anchor)?;
        let bytes = tombstoned(doc, anchor, id)?;
        plan.replace(doc, Subject::Record(anchor), anchor, bytes)?;
    }
    Ok(())
}
