//! What a `fleet` entity says about itself.
//!
//! The fleet's activity is the single child key of `current_order`
//! (`survey_planet_order`, `orbit_planet_order`, ...); the target it names differs per
//! order, so only the shapes every order writes the same way resolve to a link.

use crate::cst::Node;
use crate::entity::facts::{Sheet, count, reference};
use crate::entity::views::{EntityAddr, EntityKind};
use crate::keys;
use crate::projections::name::NameTemplate;
use crate::projections::read;

#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct FleetFacts {
    pub name: NameTemplate,
    pub name_key: String,
    pub ship_class: String,
    /// `ship_class` is `shipclass_military` or `shipclass_military_special`.
    pub military: bool,
    pub military_power: f64,
    pub hit_points: f64,
    /// The fleet's own ship ids, in save order.
    pub ships: Vec<u32>,
    /// `cached_disabled_ships`: ships knocked out by an event or in battle.
    pub disabled_ships: u32,
    pub stance: String,
    pub order: Option<FleetOrder>,
    /// `mia_from.origin`: the system the fleet is missing from.
    pub mia_from: Option<u32>,
    pub flags: u32,
}

/// The fleet's current order: the order's own key and, where the shape is common to
/// every order that writes it, what it is aimed at.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct FleetOrder {
    pub key: String,
    pub target: Option<EntityAddr>,
}

pub(crate) fn read(node: &Node, src: &[u8]) -> FleetFacts {
    FleetFacts {
        name: read::name(node, src),
        name_key: read::name_key(node, src),
        ship_class: read::text(node, keys::SHIP_CLASS, src),
        military: matches!(
            read::scalar(node, keys::SHIP_CLASS, src),
            Some("shipclass_military" | "shipclass_military_special")
        ),
        military_power: number(node, keys::MILITARY_POWER, src),
        hit_points: number(node, keys::HIT_POINTS, src),
        ships: read::ids(node, keys::SHIPS, src),
        disabled_ships: read::scalar_u32(node, keys::CACHED_DISABLED_SHIPS, src).unwrap_or(0),
        stance: read::text(node, keys::FLEET_STANCE, src),
        order: order(node, src),
        mia_from: node
            .find(keys::MIA_FROM, src)
            .and_then(|mia| reference(mia, keys::ORIGIN, src)),
        flags: count(node, keys::FLAGS, src),
    }
}

pub(crate) fn sheet(facts: &FleetFacts) -> Sheet {
    let mut sheet = Sheet::default();
    sheet.fact("Ship class", &facts.ship_class, &[keys::SHIP_CLASS]);
    if facts.military_power > 0.0 {
        sheet.fact(
            "Military power",
            &facts.military_power.to_string(),
            &[keys::MILITARY_POWER],
        );
    }
    if facts.hit_points > 0.0 {
        sheet.fact(
            "Hit points",
            &facts.hit_points.to_string(),
            &[keys::HIT_POINTS],
        );
    }
    if let Some(order) = &facts.order {
        // The order's own block is a level down, which `nodes` does not hold, so the row
        // badges `current_order` itself.
        sheet.aimed("Order", &order.key, order.target, &[keys::CURRENT_ORDER]);
    }
    sheet.fact("Stance", &facts.stance, &[keys::FLEET_STANCE]);
    if let Some(mia) = facts.mia_from {
        sheet.reference(
            "Missing from",
            EntityKind::System,
            mia,
            &[keys::MIA_FROM, keys::ORIGIN],
        );
    }
    if facts.disabled_ships > 0 {
        sheet.fact(
            "Disabled ships",
            &facts.disabled_ships.to_string(),
            &[keys::CACHED_DISABLED_SHIPS],
        );
    }
    // The ships are a row, not rows: a 29 KB fleet lists tens of them and each is its own
    // entity, so the list is read only when it is opened.
    sheet.rows(
        "Ships",
        crate::as_u32(facts.ships.len()),
        &[keys::SHIPS],
        Some(EntityKind::Ship),
    );
    sheet.rows("Flags", facts.flags, &[keys::FLAGS], None);
    sheet
}

fn number(node: &Node, key: &str, src: &[u8]) -> f64 {
    read::scalar(node, key, src)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0)
}

/// `current_order` holds exactly one child, whose key is the order.
fn order(node: &Node, src: &[u8]) -> Option<FleetOrder> {
    let block = node.find(keys::CURRENT_ORDER, src)?;
    let child = block.children().first()?;
    Some(FleetOrder {
        key: child.key_str(src)?.to_owned(),
        target: target(child, src),
    })
}

/// The entity an order names, for the three shapes orders share: a planet, a fleet, or
/// the system of a coordinate. An order that hides its target elsewhere resolves to none.
fn target(order: &Node, src: &[u8]) -> Option<EntityAddr> {
    if let Some(planet) = reference(order, keys::PLANET, src) {
        return Some(EntityAddr::new(EntityKind::Planet, planet));
    }
    if let Some(fleet) = reference(order, keys::FLEET, src) {
        return Some(EntityAddr::new(EntityKind::Fleet, fleet));
    }
    let origin = read::origin(order, src).filter(|&id| id != crate::NULL_ID)?;
    Some(EntityAddr::new(EntityKind::System, origin))
}
