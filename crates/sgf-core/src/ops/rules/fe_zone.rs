//! What the graph says about a fallen empire zone: that its ring holds no other system
//! and that its centre is on the map, since Paint a Galaxy builds the fallen empire's
//! systems in that ring at game start. Taking a zone away is always allowed.

use crate::format::scenario::fe_zone::{self, FeZone};
use crate::ops::OpError;
use crate::projections::galaxy::{GalaxyGraph, SystemNode};

/// Whether `zone` may be written on `id`: `Some` is refused when the ring around its
/// centre holds another system or the centre lies off the map.
pub(crate) fn decide_set(
    graph: &GalaxyGraph,
    id: u32,
    zone: Option<&FeZone>,
) -> Result<(), OpError> {
    let anchor = graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
    let Some(zone) = zone else {
        return Ok(());
    };
    let centre = fe_zone::centre((anchor.x, anchor.y), zone);
    if fe_zone::is_off_map(centre) {
        return Err(OpError::FeZoneOffMap {
            anchor: label(anchor),
        });
    }
    let mut blockers: Vec<&SystemNode> = graph
        .systems
        .values()
        .filter(|other| other.id != id && fe_zone::inside(centre, (other.x, other.y)))
        .collect();
    blockers.sort_unstable_by_key(|other| other.id);
    match blockers.first() {
        Some(blocker) => Err(OpError::FeZoneBlocked {
            anchor: label(anchor),
            blocker: label(blocker),
        }),
        None => Ok(()),
    }
}

/// What a message calls a system: its name, or `system N` when it has none.
pub(crate) fn label(system: &SystemNode) -> String {
    let name = system.display_name();
    if name.is_empty() {
        format!("system {}", system.id)
    } else {
        name
    }
}
