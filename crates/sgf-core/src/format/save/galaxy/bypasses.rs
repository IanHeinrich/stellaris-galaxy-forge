//! Reading a save's `bypasses` table through the systems that own each bypass.

use std::collections::{HashMap, HashSet};

use crate::document::Document;
use crate::format::save::entity_at;
use crate::keys;
use crate::overlay::Anchor;
use crate::projections::galaxy::{BypassLink, ProjectionError, SystemNode};
use crate::projections::read;
use crate::scan::Index;

pub(super) fn extract(
    index: &Index,
    src: &[u8],
    systems: &HashMap<u32, SystemNode>,
) -> Result<Vec<BypassLink>, ProjectionError> {
    let owner = owners(index, src, systems)?;
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

/// Bypass id → owning system: the systems' own `bypasses` lists first, then the wormhole
/// endpoints' `coordinate.origin`.
fn owners(
    index: &Index,
    src: &[u8],
    systems: &HashMap<u32, SystemNode>,
) -> Result<HashMap<u32, u32>, ProjectionError> {
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
    Ok(owner)
}

/// One `natural_wormholes` entry as the bytes now standing for it hold it.
#[derive(Debug, Clone)]
pub(crate) struct NaturalWormhole {
    pub(crate) id: u32,
    pub(crate) anchor: Anchor,
    pub(crate) bypass: u32,
    /// Its bypass's `type`: `wormhole`, `shroud_tunnel`, or empty when the save holds no
    /// such bypass.
    pub(crate) kind: String,
    /// `coordinate.origin`.
    pub(crate) system: u32,
    /// The system its bypass's `linked_to` stands in: the other end of a wormhole.
    pub(crate) partner: Option<u32>,
    /// `coordinate` x/y, relative to the system's centre.
    pub(crate) at: (f64, f64),
}

/// Every entry of `natural_wormholes` that names its bypass, its system and its point, in
/// file order.
pub(crate) fn natural_wormholes(
    doc: &Document,
    systems: &HashMap<u32, SystemNode>,
) -> Result<Vec<NaturalWormhole>, ProjectionError> {
    let index = doc.index();
    let src = doc.original();
    let owner = owners(index, src, systems)?;
    let mut rows = Vec::new();
    for entity in index.entities(keys::NATURAL_WORMHOLES) {
        let anchor = Anchor::Original(entity.stmt);
        let found = entity_at(doc, anchor).map_err(|source| ProjectionError::Entity {
            section: keys::NATURAL_WORMHOLES,
            id: entity.id,
            source,
        })?;
        let Some((node, buf)) = found else {
            continue;
        };
        let bypass = read::scalar_u32(&node, keys::BYPASS, buf);
        let system = read::origin(&node, buf);
        let (Ok(id), Some(bypass), Some(system), Ok(at)) = (
            u32::try_from(entity.id),
            bypass,
            system,
            read::coordinate(&node, buf),
        ) else {
            continue;
        };
        let table = match index.entity(keys::BYPASSES, u64::from(bypass)) {
            Some(entry) => read::entity_node(entry, src, keys::BYPASSES)?,
            None => None,
        };
        let kind = table
            .as_ref()
            .and_then(|node| read::scalar(node, keys::TYPE, src))
            .unwrap_or_default();
        let linked_to = table
            .as_ref()
            .and_then(|node| read::scalar_u32(node, keys::LINKED_TO, src));
        rows.push(NaturalWormhole {
            id,
            anchor,
            bypass,
            kind: kind.to_owned(),
            system,
            partner: linked_to.and_then(|linked| owner.get(&linked).copied()),
            at,
        });
    }
    Ok(rows)
}
