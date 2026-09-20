//! What a `megastructures` entity says about itself.
//!
//! The state (ruined, restored, stage n) is encoded in the `type` name, which this reader
//! keeps as written: the number of stages lives in the install's definitions, so naming
//! the state is the app's job and it reads the same raw key.

use crate::cst::Node;
use crate::entity::facts::{Sheet, count, reference};
use crate::entity::views::EntityKind;
use crate::keys;
use crate::projections::read;

#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct MegastructureFacts {
    /// The `type`, e.g. `ring_world_ruined`.
    pub kind: String,
    pub owner: Option<u32>,
    /// The planet it orbits, when it orbits one.
    pub planet: Option<u32>,
    /// `coordinate.origin`: the system it sits in.
    pub origin: Option<u32>,
    pub bypass: Option<u32>,
    pub orbitals: u32,
    pub dismantle_progress: f64,
}

pub(crate) fn read(node: &Node, src: &[u8]) -> MegastructureFacts {
    MegastructureFacts {
        kind: read::text(node, keys::TYPE, src),
        owner: reference(node, keys::OWNER, src),
        planet: reference(node, keys::PLANET, src),
        origin: read::origin(node, src).filter(|&id| id != crate::NULL_ID),
        bypass: reference(node, keys::BYPASS, src),
        orbitals: count(node, keys::ORBITALS, src),
        dismantle_progress: read::scalar(node, keys::DISMANTLE_PROGRESS, src)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0),
    }
}

pub(crate) fn sheet(facts: &MegastructureFacts) -> Sheet {
    let mut sheet = Sheet::default();
    sheet.fact("Type", &facts.kind, &[keys::TYPE]);
    if let Some(owner) = facts.owner {
        sheet.reference("Owner", EntityKind::Country, owner, &[keys::OWNER]);
    }
    if let Some(planet) = facts.planet {
        sheet.reference("Orbits", EntityKind::Planet, planet, &[keys::PLANET]);
    }
    if let Some(origin) = facts.origin {
        sheet.reference(
            "System",
            EntityKind::System,
            origin,
            &[keys::COORDINATE, keys::ORIGIN],
        );
    }
    if let Some(bypass) = facts.bypass {
        sheet.fact("Bypass", &bypass.to_string(), &[keys::BYPASS]);
    }
    if facts.dismantle_progress > 0.0 {
        sheet.fact(
            "Dismantle progress",
            &facts.dismantle_progress.to_string(),
            &[keys::DISMANTLE_PROGRESS],
        );
    }
    sheet.rows("Orbitals", facts.orbitals, &[keys::ORBITALS], None);
    sheet
}
