//! What a `starbase_mgr.starbases` entry says about itself, and the hull its station ship
//! keeps for it.
//!
//! A starbase entry holds no hit points of its own: the `station` ship carries them, which
//! is why [`hull`] reads a ship rather than a starbase. The details projection already has
//! that ship node in hand and calls the same reader.

use crate::cst::Node;
use crate::document::Document;
use crate::entity::facts::{Sheet, count, other, reference};
use crate::entity::views::{EntityAddr, EntityKind};
use crate::keys;
use crate::projections::read;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct StarbaseFacts {
    pub level: String,
    /// The `type`, e.g. `sshipyard`.
    pub kind: String,
    pub station: Option<u32>,
    /// Module and building keys in save order.
    pub modules: Vec<String>,
    pub buildings: Vec<String>,
    pub orbitals: u32,
    pub construction_type: String,
    pub build_queue: Option<u32>,
    pub shipyard_build_queue: Option<u32>,
}

impl StarbaseFacts {
    /// A `shipyard` module: the starbase can build ships.
    pub fn shipyard(&self) -> bool {
        self.modules.iter().any(|m| m == "shipyard")
    }
}

/// A ship's hull, which a starbase shows as its own.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct Hull {
    pub hitpoints: f64,
    pub max_hitpoints: f64,
}

pub(crate) fn read(node: &Node, src: &[u8]) -> StarbaseFacts {
    StarbaseFacts {
        level: read::text(node, keys::LEVEL, src),
        kind: read::text(node, keys::TYPE, src),
        station: reference(node, keys::STATION, src),
        modules: read::slot_values(node, keys::MODULES, src),
        buildings: read::slot_values(node, keys::BUILDINGS, src),
        orbitals: count(node, keys::ORBITALS, src),
        construction_type: read::text(node, keys::CONSTRUCTION_TYPE, src),
        build_queue: reference(node, keys::BUILD_QUEUE, src),
        shipyard_build_queue: reference(node, keys::SHIPYARD_BUILD_QUEUE, src),
    }
}

/// `hitpoints` and `max_hitpoints` of a **ship** entity; `None` unless it writes both,
/// because half a hull would read as a ship at full or at zero health.
pub(crate) fn hull(ship: &Node, src: &[u8]) -> Option<Hull> {
    let number = |key: &str| read::scalar(ship, key, src).and_then(|s| s.parse::<f64>().ok());
    Some(Hull {
        hitpoints: number(keys::HITPOINTS)?,
        max_hitpoints: number(keys::MAX_HITPOINTS)?,
    })
}

pub(crate) fn sheet(facts: &StarbaseFacts, doc: &Document) -> Sheet {
    let mut sheet = Sheet::default();
    sheet.fact("Level", &facts.level, &[keys::LEVEL]);
    sheet.fact("Type", &facts.kind, &[keys::TYPE]);
    if let Some(station) = facts.station {
        // The name and the hull are the station ship's; the starbase entry holds neither.
        if let Some((ship, src)) = other(doc, EntityAddr::new(EntityKind::Ship, station)) {
            let name = read::name(&ship, src).stand_in();
            if !name.is_empty() {
                sheet.borrowed("Name", name);
            }
            if let Some(hull) = hull(&ship, src) {
                sheet.borrowed(
                    "Hull",
                    format!("{} / {}", hull.hitpoints, hull.max_hitpoints),
                );
            }
        }
        sheet.reference("Station", EntityKind::Ship, station, &[keys::STATION]);
    }
    if facts.shipyard() {
        sheet.fact("Shipyard", "yes", &[keys::MODULES]);
    }
    sheet.fact(
        "Construction",
        &facts.construction_type,
        &[keys::CONSTRUCTION_TYPE],
    );
    if let Some(queue) = facts.build_queue {
        sheet.fact("Build queue", &queue.to_string(), &[keys::BUILD_QUEUE]);
    }
    if let Some(queue) = facts.shipyard_build_queue {
        sheet.fact(
            "Shipyard queue",
            &queue.to_string(),
            &[keys::SHIPYARD_BUILD_QUEUE],
        );
    }
    sheet.rows(
        "Modules",
        crate::as_u32(facts.modules.len()),
        &[keys::MODULES],
        None,
    );
    sheet.rows(
        "Buildings",
        crate::as_u32(facts.buildings.len()),
        &[keys::BUILDINGS],
        None,
    );
    sheet.rows("Orbitals", facts.orbitals, &[keys::ORBITALS], None);
    sheet
}
