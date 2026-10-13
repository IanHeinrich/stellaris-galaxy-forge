//! Where a fleet stands and what it orbits, read from the bytes now standing for it.

use crate::document::Document;
use crate::format::save::entity_at;
use crate::keys;
use crate::overlay::Anchor;
use crate::projections::read;
use crate::scan::Value;

/// Where fleet `fleet` stands, from the bytes now standing for it: the system its
/// `movement_manager.coordinate` names, and the point when it writes one. `None` for a fleet
/// the save does not hold, or one whose coordinate names no system.
pub(crate) fn position(doc: &Document, fleet: u32) -> Option<(u32, Option<(f64, f64)>)> {
    let anchor = record(doc, keys::FLEET, fleet)?;
    let (node, src) = entity_at(doc, anchor).ok()??;
    let movement = node.find(keys::MOVEMENT_MANAGER, src)?;
    Some((
        read::origin(movement, src)?,
        read::coordinate(movement, src).ok(),
    ))
}

/// The planet fleet `fleet` orbits, from the bytes now standing for it: its
/// `movement_manager.orbit.orbitable.planet`. `None` for a fleet that orbits no planet.
pub(crate) fn orbited_planet(doc: &Document, fleet: u32) -> Option<u32> {
    let anchor = record(doc, keys::FLEET, fleet)?;
    let (node, src) = entity_at(doc, anchor).ok()??;
    let orbitable = node
        .find(keys::MOVEMENT_MANAGER, src)?
        .find(keys::ORBIT, src)?
        .find(keys::ORBITABLE, src)?;
    read::scalar_u32(orbitable, keys::PLANET, src).filter(|&id| id != crate::NULL_ID)
}

/// The statement of entity `id` of the top-level table `section`; `None` for one the save
/// does not hold or holds as a tombstone.
pub(crate) fn record(doc: &Document, section: &str, id: u32) -> Option<Anchor> {
    doc.index()
        .entity(section, u64::from(id))
        .filter(|e| matches!(e.value, Value::Block { .. }))
        .map(|e| Anchor::Original(e.stmt))
}
