//! What a `galactic_object` entity says about itself.
//!
//! The system's name and position belong to the galaxy projection, which the map reads at
//! load; this reader covers what the inspector shows beside them.

use crate::cst::Node;
use crate::entity::facts::{Sheet, count, reference};
use crate::entity::views::EntityKind;
use crate::keys;
use crate::projections::read;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct SystemFacts {
    pub star_class: String,
    pub initializer: String,
    /// Every body the system holds: `planet=` is written once per planet, not as a list.
    pub planets: Vec<u32>,
    pub init_parent: Option<u32>,
    pub sector: Option<u32>,
    pub inner_radius: Option<u32>,
    pub outer_radius: Option<u32>,
    /// The ids each list holds, in save order.
    pub starbases: Vec<u32>,
    pub megastructures: Vec<u32>,
    pub fleet_presence: Vec<u32>,
    pub hyperlanes: u32,
    pub ambient_objects: u32,
    pub flags: u32,
}

pub(crate) fn read(node: &Node, src: &[u8]) -> SystemFacts {
    SystemFacts {
        star_class: read::text(node, keys::STAR_CLASS, src),
        initializer: read::text(node, keys::INITIALIZER, src),
        planets: node
            .find_all(keys::PLANET, src)
            .filter_map(|p| p.scalar_str(src)?.parse().ok())
            .filter(|&id| id != crate::NULL_ID)
            .collect(),
        init_parent: reference(node, keys::INIT_PARENT, src),
        sector: reference(node, keys::SECTOR, src),
        inner_radius: read::scalar_u32(node, keys::INNER_RADIUS, src),
        outer_radius: read::scalar_u32(node, keys::OUTER_RADIUS, src),
        starbases: read::ids(node, keys::STARBASES, src),
        megastructures: read::ids(node, keys::MEGASTRUCTURES, src),
        fleet_presence: read::ids(node, keys::FLEET_PRESENCE, src),
        hyperlanes: count(node, keys::HYPERLANE, src),
        ambient_objects: count(node, keys::AMBIENT_OBJECT, src),
        flags: count(node, keys::FLAGS, src),
    }
}

pub(crate) fn sheet(facts: &SystemFacts) -> Sheet {
    let mut sheet = Sheet::default();
    sheet.fact("Star class", &facts.star_class, &[keys::STAR_CLASS]);
    sheet.fact("Initializer", &facts.initializer, &[keys::INITIALIZER]);
    if let Some(parent) = facts.init_parent {
        sheet.reference(
            "Initialised from",
            EntityKind::System,
            parent,
            &[keys::INIT_PARENT],
        );
    }
    if let Some(sector) = facts.sector {
        sheet.reference("Sector", EntityKind::Sector, sector, &[keys::SECTOR]);
    }
    if let Some(radius) = facts.inner_radius {
        sheet.fact("Inner radius", &radius.to_string(), &[keys::INNER_RADIUS]);
    }
    if let Some(radius) = facts.outer_radius {
        sheet.fact("Outer radius", &radius.to_string(), &[keys::OUTER_RADIUS]);
    }
    sheet.entities(
        "Planets",
        crate::as_u32(facts.planets.len()),
        EntityKind::Planet,
    );
    sheet.rows("Hyperlanes", facts.hyperlanes, &[keys::HYPERLANE], None);
    sheet.rows(
        "Starbases",
        crate::as_u32(facts.starbases.len()),
        &[keys::STARBASES],
        Some(EntityKind::Starbase),
    );
    sheet.rows(
        "Megastructures",
        crate::as_u32(facts.megastructures.len()),
        &[keys::MEGASTRUCTURES],
        Some(EntityKind::Megastructure),
    );
    sheet.rows(
        "Fleets present",
        crate::as_u32(facts.fleet_presence.len()),
        &[keys::FLEET_PRESENCE],
        Some(EntityKind::Fleet),
    );
    sheet.rows(
        "Ambient objects",
        facts.ambient_objects,
        &[keys::AMBIENT_OBJECT],
        None,
    );
    sheet.rows("Flags", facts.flags, &[keys::FLAGS], None);
    sheet
}
