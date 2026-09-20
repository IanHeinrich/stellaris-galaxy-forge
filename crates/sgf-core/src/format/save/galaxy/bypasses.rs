//! Reading a save's `bypasses` table through the systems that own each bypass.

use std::collections::{HashMap, HashSet};

use crate::keys;
use crate::projections::galaxy::{BypassLink, ProjectionError, SystemNode};
use crate::projections::read;
use crate::scan::Index;

pub(super) fn extract(
    index: &Index,
    src: &[u8],
    systems: &HashMap<u32, SystemNode>,
) -> Result<Vec<BypassLink>, ProjectionError> {
    // Bypass id → owning system: the systems' own `bypasses` lists first, then the
    // wormhole endpoints' `coordinate.origin`.
    let mut owner: HashMap<u32, u32> = HashMap::new();
    for system in systems.values() {
        for &bypass in &system.bypass_ids {
            owner.entry(bypass).or_insert(system.id);
        }
    }
    for entity in index.entities(keys::NATURAL_WORMHOLES) {
        let Some(node) = read::entity_node(entity, src, keys::NATURAL_WORMHOLES)? else {
            continue;
        };
        let bypass = read::scalar_u32(&node, keys::BYPASS, src);
        let origin = read::origin(&node, src);
        if let (Some(bypass), Some(origin)) = (bypass, origin) {
            owner.entry(bypass).or_insert(origin);
        }
    }

    let mut links = Vec::new();
    let mut paired: HashSet<(u32, u32)> = HashSet::new();
    for entity in index.entities(keys::BYPASSES) {
        let Some(node) = read::entity_node(entity, src, keys::BYPASSES)? else {
            continue;
        };
        let Ok(id) = u32::try_from(entity.id) else {
            continue;
        };
        let Some(&system) = owner.get(&id) else {
            continue;
        };
        let kind = read::scalar(&node, keys::TYPE, src).unwrap_or_default();
        let active = read::scalar(&node, keys::ACTIVE, src) == Some("yes");
        let link = match kind {
            "wormhole" => {
                let Some(linked_to) = read::scalar_u32(&node, keys::LINKED_TO, src) else {
                    continue;
                };
                if !paired.insert((id.min(linked_to), id.max(linked_to))) {
                    continue;
                }
                let Some(&other) = owner.get(&linked_to) else {
                    continue;
                };
                BypassLink::Wormhole {
                    a: system,
                    b: other,
                }
            }
            "gateway" => BypassLink::Gateway { system, active },
            "lgate" => BypassLink::LGate { system },
            _ => BypassLink::Other {
                system,
                kind: kind.to_owned(),
            },
        };
        links.push(link);
    }
    Ok(links)
}
