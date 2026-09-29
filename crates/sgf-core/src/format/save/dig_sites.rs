//! The dig sites of `archaeological_sites.sites`: which the save now holds, what each says,
//! the id a new one takes and where it goes. Besides its entry, a site is named only by the
//! order of a fleet excavating it.

use crate::cst::Node;
use crate::document::Document;
use crate::format::save::added::Table;
use crate::format::save::alloc::TableEnd;
use crate::format::save::entity_at;
use crate::keys;
use crate::ops::OpError;
use crate::overlay::Anchor;
use crate::projections::galaxy::ProjectionError;
use crate::projections::read;
use crate::scan::Value;

/// `location.type` of a site on a planet.
pub(crate) const PLANET_LOCATION: &str = "2";

/// The null id, which `excavator_fleet` holds while nobody digs.
const NULL_ID: &str = "4294967295";

/// What one site's entry says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DigSite {
    pub id: u32,
    /// The `type`, e.g. `site_lost_moments`.
    pub kind: String,
    /// `location.id` when `location.type` is a planet.
    pub planet: Option<u32>,
    /// `index`: the stages finished.
    pub index: u32,
    pub clues: u32,
    /// The current stage's `difficulty`.
    pub difficulty: i32,
    /// An `excavator_fleet` other than the null id.
    pub excavating: bool,
}

fn read_site(id: u32, node: &Node, src: &[u8]) -> DigSite {
    let location = node.find(keys::LOCATION, src);
    let planet = location
        .filter(|l| read::scalar(l, keys::TYPE, src) == Some(PLANET_LOCATION))
        .and_then(|l| read::scalar_u32(l, keys::ID, src));
    DigSite {
        id,
        kind: read::text(node, keys::TYPE, src),
        planet,
        index: read::scalar_u32(node, keys::INDEX, src).unwrap_or(0),
        clues: read::scalar_u32(node, keys::CLUES, src).unwrap_or(0),
        difficulty: read::scalar(node, keys::DIFFICULTY, src)
            .and_then(|d| d.parse().ok())
            .unwrap_or(0),
        excavating: read::scalar(node, keys::EXCAVATOR_FLEET, src)
            .is_some_and(|fleet| fleet != NULL_ID),
    }
}

/// Every site the save now holds, loaded or added, with its statement, in file order; one an
/// op removed is left out.
fn statements(doc: &Document) -> Result<Vec<(u32, Anchor)>, ProjectionError> {
    let mut sites: Vec<(u32, Anchor)> = doc.added().entries(Table::DigSite).collect();
    if let Some(index) = doc.inner_index(keys::ARCHAEOLOGICAL_SITES)? {
        sites.extend(
            index
                .entities(keys::SITES)
                .iter()
                .filter(|e| matches!(e.value, Value::Block { .. }))
                .filter(|e| {
                    !doc.overlay()
                        .removed(Anchor::Original(e.stmt), doc.original())
                })
                .filter_map(|e| Some((u32::try_from(e.id).ok()?, Anchor::Original(e.stmt)))),
        );
    }
    sites.sort_by_key(|&(_, anchor)| anchor);
    Ok(sites)
}

/// Every site as its entry now stands, with its statement, in file order.
pub(crate) fn sites(doc: &Document) -> Result<Vec<(Anchor, DigSite)>, ProjectionError> {
    let mut out = Vec::new();
    for (id, anchor) in statements(doc)? {
        let found = entity_at(doc, anchor).map_err(|source| ProjectionError::Entity {
            section: keys::ARCHAEOLOGICAL_SITES,
            id: u64::from(id),
            source,
        })?;
        if let Some((node, src)) = found {
            out.push((anchor, read_site(id, &node, src)));
        }
    }
    Ok(out)
}

/// The site on planet `planet`, when it has one.
pub(crate) fn on_planet(doc: &Document, planet: u32) -> Result<Option<DigSite>, ProjectionError> {
    Ok(sites(doc)?
        .into_iter()
        .map(|(_, site)| site)
        .find(|site| site.planet == Some(planet)))
}

/// The id a new site takes: one past the highest the save has held since it was opened, so a
/// removed site's id, which a fleet's excavation order may still name, is never taken again.
pub(crate) fn next_id(doc: &Document) -> Result<u32, ProjectionError> {
    let loaded = doc
        .inner_index(keys::ARCHAEOLOGICAL_SITES)?
        .into_iter()
        .flat_map(|index| index.entities(keys::SITES))
        .filter_map(|e| u32::try_from(e.id).ok());
    let added = doc.added().entries(Table::DigSite).map(|(id, _)| id);
    Ok(loaded.chain(added).max().map_or(0, |highest| highest + 1))
}

/// Where a new site's entry goes: last in `sites`, before its closing brace.
pub(crate) fn table_end(doc: &Document) -> Result<TableEnd, OpError> {
    let missing = || OpError::MissingSaveKey(keys::SITES);
    let inner = doc
        .inner_index(keys::ARCHAEOLOGICAL_SITES)?
        .ok_or(OpError::MissingSaveKey(keys::ARCHAEOLOGICAL_SITES))?;
    let section = inner.section(keys::SITES).ok_or_else(missing)?;
    let Value::Block { close, .. } = section.value else {
        return Err(missing());
    };
    Ok(TableEnd::read(
        doc,
        Table::DigSite,
        close,
        inner.entities(keys::SITES),
    ))
}
