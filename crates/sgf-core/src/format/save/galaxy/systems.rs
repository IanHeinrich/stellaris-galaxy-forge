//! Reading one `galactic_object` entity of a save, and the sectors that own them.

use std::collections::HashMap;

use crate::cst::Node;
use crate::format::scenario::FeLinkFlags;
use crate::format::scenario::marauder;
use crate::projections::galaxy::{Lane, ProjectionError, SystemNode};
use crate::projections::read;
use crate::scan::Index;

/// The modifier a turbulent nebula member carries.
pub(crate) const TURBULENT_NEBULA: &str = "turbulent_nebula";
use crate::{as_u32, keys};

/// The one extraction path for a system, used by `build` and `refresh_system`.
pub(super) fn extract(
    id: u32,
    node: &Node,
    src: &[u8],
    sector_owner: &HashMap<u32, u32>,
    starbase_owner: &HashMap<u32, u32>,
) -> Result<SystemNode, ProjectionError> {
    let field = |reason: String| ProjectionError::EntityField {
        section: keys::GALACTIC_OBJECT,
        id: u64::from(id),
        reason,
    };
    let (x, y) = read::coordinate(node, src).map_err(field)?;
    let flags = node
        .find(keys::FLAGS, src)
        .map(|flags| {
            flags
                .children()
                .iter()
                .filter_map(|c| c.key_str(src))
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let owner = read::scalar_u32(node, keys::SECTOR, src)
        .and_then(|s| sector_owner.get(&s).copied())
        .or_else(|| {
            read::ids(node, keys::STARBASES, src)
                .first()
                .and_then(|first| starbase_owner.get(first).copied())
        });
    let mut lanes = Vec::new();
    if let Some(hyperlane) = node.find(keys::HYPERLANE, src) {
        for entry in hyperlane.children() {
            let to = read::required(entry, keys::TO, src).map_err(&field)?;
            let length = read::required(entry, keys::LENGTH, src).map_err(&field)?;
            let bridge = read::scalar(entry, keys::BRIDGE, src) == Some("yes");
            lanes.push(Lane {
                to,
                length,
                bridge,
                stale: false,
            });
        }
    }
    let initializer = read::text(node, keys::INITIALIZER, src);
    Ok(SystemNode {
        id,
        name: read::name(node, src),
        x,
        y,
        star_class: read::text(node, keys::STAR_CLASS, src),
        lanes,
        nebula: None,
        bypass_ids: read::ids(node, keys::BYPASSES, src),
        planet_count: as_u32(node.find_all(keys::PLANET, src).count()),
        bodies: None,
        marauder: marauder::role(&initializer),
        initializer,
        spawn_weight: None,
        spawn_modifiers: Vec::new(),
        spawn_script: None,
        spawn_design: None,
        fe_zone: None,
        wormhole_pair: None,
        fe_link: FeLinkFlags::default(),
        prevented: Vec::new(),
        position_range: false,
        flags,
        owner,
        added: false,
        turbulent: timed_modifiers(node, src).any(|m| m == TURBULENT_NEBULA),
    })
}

/// The modifier every entry of the node's `timed_modifier.items` names, in file order.
pub(crate) fn timed_modifiers<'a>(node: &'a Node, src: &'a [u8]) -> impl Iterator<Item = &'a str> {
    node.find(keys::TIMED_MODIFIER, src)
        .and_then(|block| block.find(keys::ITEMS, src))
        .into_iter()
        .flat_map(|items| items.children())
        .filter_map(|item| read::scalar(item, keys::MODIFIER, src))
        .map(|m| m.trim_matches('"'))
}

/// Sector id → owning country id, from the top-level `sectors` section.
pub(super) fn sector_owners(
    index: &Index,
    src: &[u8],
) -> Result<HashMap<u32, u32>, ProjectionError> {
    let mut sector_owner = HashMap::new();
    for entity in index.entities(keys::SECTORS) {
        let Some(node) = read::entity_node(entity, src, keys::SECTORS)? else {
            continue;
        };
        let Ok(id) = u32::try_from(entity.id) else {
            continue;
        };
        if let Some(owner) = read::scalar_u32(&node, keys::OWNER, src) {
            sector_owner.insert(id, owner);
        }
    }
    Ok(sector_owner)
}
