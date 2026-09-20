//! Reading a save's `waystation_networks` table through the starbases the systems own.

use std::collections::HashMap;

use crate::keys;
use crate::projections::galaxy::{ProjectionError, Waystation};
use crate::projections::read;
use crate::scan::Index;

/// Every network's waystations, sorted by network then system. A starbase no system
/// lists is skipped: nothing locates it on the map.
pub(super) fn extract(
    index: &Index,
    src: &[u8],
    starbase_system: &HashMap<u32, u32>,
) -> Result<Vec<Waystation>, ProjectionError> {
    let mut waystations = Vec::new();
    for entity in index.entities(keys::WAYSTATION_NETWORKS) {
        let Some(node) = read::entity_node(entity, src, keys::WAYSTATION_NETWORKS)? else {
            continue;
        };
        let Ok(network) = u32::try_from(entity.id) else {
            continue;
        };
        for starbase in read::ids(&node, keys::WAYSTATIONS, src) {
            let Some(&system) = starbase_system.get(&starbase) else {
                continue;
            };
            waystations.push(Waystation {
                system,
                starbase,
                network,
            });
        }
    }
    waystations.sort_by_key(|w| (w.network, w.system, w.starbase));
    Ok(waystations)
}
