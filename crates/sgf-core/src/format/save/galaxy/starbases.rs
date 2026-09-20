//! Who runs each starbase: `starbase_mgr.starbases.<id>.station` → `ships.<id>.fleet` →
//! `country.fleets_manager.owned_fleets`. Shared by the save's galaxy reader (a system
//! with no sector is still owned by whoever holds its starbase) and its details
//! projection.

use std::collections::HashMap;

use crate::document::Document;
use crate::keys;
use crate::projections::galaxy::ProjectionError;
use crate::projections::read::{self, RawCountry};
use crate::scan::Index;

/// Fleet id → country id, from every country's `fleets_manager.owned_fleets`.
pub(crate) fn fleet_owners(countries: &[RawCountry]) -> HashMap<u32, u32> {
    countries
        .iter()
        .flat_map(|c| c.owned_fleets.iter().map(move |&fleet| (fleet, c.id)))
        .collect()
}

/// The fleet a station ship belongs to.
pub(crate) fn station_fleet(
    index: &Index,
    src: &[u8],
    ship: u32,
) -> Result<Option<u32>, ProjectionError> {
    let Some(entity) = index.entity(keys::SHIPS, u64::from(ship)) else {
        return Ok(None);
    };
    let Some(node) = read::entity_node(entity, src, keys::SHIPS)? else {
        return Ok(None);
    };
    Ok(read::scalar_u32(&node, keys::FLEET, src))
}

/// Starbase id → the country running it; starbases with no station, fleet or owner are
/// left out.
pub(crate) fn starbase_owners(
    doc: &Document,
    fleet_owner: &HashMap<u32, u32>,
) -> Result<HashMap<u32, u32>, ProjectionError> {
    let src = doc.original();
    let index = doc.index();
    let mut owners = HashMap::new();
    for (starbase, station) in read::stations(doc)? {
        let Some(ship) = station.ship else {
            continue;
        };
        let Some(fleet) = station_fleet(index, src, ship)? else {
            continue;
        };
        if let Some(&country) = fleet_owner.get(&fleet) {
            owners.insert(starbase, country);
        }
    }
    Ok(owners)
}
