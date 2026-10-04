//! `RestoreSaveEntities`, the inverse of an op that rewrites whole save entities, and what
//! such an op uses to find an entity, keep it for the inverse and leave its tombstone.

use std::collections::BTreeMap;
use std::collections::btree_map::Entry;

use crate::cst::Node;
use crate::document::Document;
use crate::format::save::alloc::{self, SlotTable};
use crate::format::save::{
    entity_at, entity_in, planet_statement, planet_system, system_statement,
};
use crate::keys;
use crate::ops::{Edit, Op, OpError, Plan, Planned, SavedEntity, SavedTable, Subject};
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
        if statement_id(text) != Some(id) {
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
        inverse: saved.inverse(format!("Undid: {description}")),
    })
}

/// The id of the one statement `text` holds, when it holds exactly one, keyed by a number:
/// an entity or a tombstone.
fn statement_id(text: &str) -> Option<u32> {
    let bytes = text.as_bytes();
    let root = crate::cst::parse(bytes, 0).ok()?;
    let [node] = root.children() else {
        return None;
    };
    let dead = node.scalar_str(bytes) == Some("none");
    if node.scalar_span().is_some() && !dead {
        return None;
    }
    node.key_str(bytes)?.parse().ok()
}

/// The system of the planet entity `bytes` hold; `None` for a tombstone.
fn planet_origin(bytes: &[u8], id: u32) -> Option<u32> {
    let node = entity_in(bytes).ok()??;
    planet_system(&node, bytes, id).ok()
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

    pub(crate) fn inverse(self, description: String) -> Op {
        Op::RestoreSaveEntities {
            description,
            entities: self
                .0
                .into_iter()
                .map(|((table, id), text)| SavedEntity { table, id, text })
                .collect(),
        }
    }
}

/// Where entity `id` of `table` stands now, a tombstone included.
fn locate(doc: &Document, table: SavedTable, id: u32) -> Result<Option<Anchor>, OpError> {
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
    };
    Ok(entry(doc.index(), section, id))
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
