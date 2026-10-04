//! The dig sites of `archaeological_sites.sites`: which the save now holds and what each
//! says. Besides its entry, a site is named only by the order of a fleet excavating it.

use crate::NULL_ID;
use crate::cst::Node;
use crate::document::Document;
use crate::format::save::added::{Table, rows};
use crate::keys;
use crate::overlay::Anchor;
use crate::projections::galaxy::ProjectionError;
use crate::projections::read;

/// `location.type` of a site on a planet.
pub(crate) const PLANET_LOCATION: &str = "2";

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
            .is_some_and(|fleet| fleet != NULL_ID.to_string()),
    }
}

/// Every site as its entry now stands, with its statement, in file order.
pub(crate) fn sites(doc: &Document) -> Result<Vec<(Anchor, DigSite)>, ProjectionError> {
    Ok(rows(doc, Table::DigSite)?
        .into_iter()
        .map(|row| (row.anchor, read_site(row.id, &row.node, row.src)))
        .collect())
}

/// The site on planet `planet`, when it has one.
pub(crate) fn on_planet(doc: &Document, planet: u32) -> Result<Option<DigSite>, ProjectionError> {
    Ok(sites(doc)?
        .into_iter()
        .map(|(_, site)| site)
        .find(|site| site.planet == Some(planet)))
}
