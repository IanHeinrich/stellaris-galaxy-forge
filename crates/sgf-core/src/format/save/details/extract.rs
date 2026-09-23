//! What the save's tables say about one system, extracted from the bytes.
//!
//! Save keys are kept as written (`d_energy_5`, `pc_continental`); turning them into what
//! the UI shows is [`super::resolve`]'s job.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cst::{self, Node};
use crate::document::Document;
use crate::entity::facts;
use crate::format::save::galaxy::starbases::fleet_owners;
use crate::overlay::Anchor;
use crate::projections::galaxy::{GalaxyGraph, ProjectionError};
use crate::projections::name::NameTemplate;
use crate::projections::read::{self, RawCountry};
use crate::scan::{Entity, Index, Value};
use crate::{as_u32, keys};

#[derive(Debug, Clone, Default, PartialEq)]
pub struct RawSystemDetails {
    /// In file order.
    pub planets: Vec<RawPlanet>,
    /// Every starbase the system lists, in file order; the first is the primary one
    /// (a citadel ahead of its deep-space citadels).
    pub starbases: Vec<RawStarbase>,
    /// The system's `fleet_presence`, in file order.
    pub fleets: Vec<FleetSummary>,
    pub megastructures: Vec<MegastructureSummary>,
    pub sites: Vec<ArchaeologySite>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawPlanet {
    pub id: u32,
    pub class: String,
    pub name: NameTemplate,
    pub name_key: String,
    pub colonised: bool,
    pub capital: bool,
    pub owner: Option<u32>,
    pub moon: bool,
    pub pre_ftl: bool,
    pub size: Option<u32>,
    /// Deposit key → count, in order of first appearance. A colony's deposits are
    /// planetary features and blockers; the resolver decides what each key yields.
    pub deposits: Vec<(String, u32)>,
    /// `colony.<id>.num_sapient_pops`, zero on an uncolonised planet.
    pub pops: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawStarbase {
    pub id: u32,
    pub level: String,
    /// The entry's `type` key; empty when it names none.
    pub kind: String,
    /// The `station` ship's name: `$PLANET$ Station`, not the fleet's `Starbase`.
    pub name: NameTemplate,
    pub name_key: String,
    /// Through `station` → ship → fleet → `country.fleets_manager.owned_fleets`, falling
    /// back to the system's owner.
    pub owner: Option<u32>,
    /// Module and building keys in save order.
    pub modules: Vec<String>,
    pub buildings: Vec<String>,
    /// The `station` ship's hull, which the starbase shows as its own; both are zero
    /// when the entry names no station.
    pub hull: f64,
    pub max_hull: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FleetSummary {
    pub id: u32,
    pub name: NameTemplate,
    pub name_key: String,
    /// From `country.fleets_manager.owned_fleets`.
    pub owner: Option<u32>,
    /// `ship_class` is `shipclass_military` or `shipclass_military_special`.
    pub military: bool,
    pub military_power: f64,
    pub ships: u32,
    /// A ship carries a weapon in a `PLANET_KILLER` slot: a colossus, whose power the game
    /// shows as a skull. Only looked up when the fleet's power is zero.
    pub planet_killer: bool,
    /// `cached_disabled_ships`: ships knocked out (by an event or in battle).
    pub disabled_ships: u32,
    /// The fleet's ships counted by `ship_size`, in order of first appearance; each hull
    /// is reached through `ship_design_implementation`.
    pub ship_sizes: Vec<ShipSizeCount>,
    /// What the fleet is doing: the one child key of `current_order`
    /// (`survey_planet_order`, `orbit_planet_order`), absent when it is idle.
    pub order: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ShipSizeCount {
    pub key: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MegastructureSummary {
    pub id: u32,
    /// The `type`, e.g. `ring_world_ruined`.
    pub kind: String,
    pub owner: Option<u32>,
    /// The planet it orbits, when it orbits one.
    pub planet: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ArchaeologySite {
    pub id: u32,
    /// The `type`, e.g. `site_tiyanki_graveyard`.
    pub kind: String,
    pub planet: u32,
}

pub(super) struct Countries {
    /// Colony ids named by a `country.capital`.
    capitals: HashSet<u32>,
    /// Fleet id → country id, from `fleets_manager.owned_fleets`.
    fleet_owner: HashMap<u32, u32>,
    /// Countries whose `type` is `primitive`.
    primitives: HashSet<u32>,
}

pub(super) fn countries(raw: &[RawCountry]) -> Countries {
    Countries {
        capitals: raw.iter().filter_map(|c| c.capital).collect(),
        fleet_owner: fleet_owners(raw),
        primitives: raw
            .iter()
            .filter(|c| c.country_type == "primitive")
            .map(|c| c.id)
            .collect(),
    }
}

/// Deposit id → `type` key, from the top-level `deposit` table.
pub(super) fn deposit_kinds(
    index: &Index,
    src: &[u8],
) -> Result<HashMap<u32, String>, ProjectionError> {
    let mut kinds = HashMap::new();
    for entity in index.entities(keys::DEPOSIT) {
        let Some(node) = read::entity_node(entity, src, keys::DEPOSIT)? else {
            continue;
        };
        let (Ok(id), Some(kind)) = (
            u32::try_from(entity.id),
            read::scalar(&node, keys::TYPE, src),
        ) else {
            continue;
        };
        kinds.insert(id, kind.to_owned());
    }
    Ok(kinds)
}

/// Colony id → `num_sapient_pops`. 4.x keeps pops in `colony`, not on the planet.
pub(super) fn colony_pops(index: &Index, src: &[u8]) -> Result<HashMap<u32, u32>, ProjectionError> {
    let mut pops = HashMap::new();
    for entity in index.entities(keys::COLONY) {
        let Some(node) = read::entity_node(entity, src, keys::COLONY)? else {
            continue;
        };
        let (Ok(id), Some(count)) = (
            u32::try_from(entity.id),
            read::scalar_u32(&node, keys::NUM_SAPIENT_POPS, src),
        ) else {
            continue;
        };
        pops.insert(id, count);
    }
    Ok(pops)
}

/// Ship id → the `ship_size` of its design, through
/// `ships.<id>.ship_design_implementation` → `ship_design.<id>.growth_stages`.
pub(super) fn ship_sizes(
    index: &Index,
    src: &[u8],
) -> Result<HashMap<u32, String>, ProjectionError> {
    let mut stages: HashMap<u32, Vec<String>> = HashMap::new();
    for entity in index.entities(keys::SHIP_DESIGN) {
        let Some(node) = read::entity_node(entity, src, keys::SHIP_DESIGN)? else {
            continue;
        };
        let Ok(id) = u32::try_from(entity.id) else {
            continue;
        };
        let sizes = node
            .find(keys::GROWTH_STAGES, src)
            .map(|g| {
                g.children()
                    .iter()
                    .filter_map(|stage| Some(read::scalar(stage, keys::SHIP_SIZE, src)?.to_owned()))
                    .collect()
            })
            .unwrap_or_default();
        stages.insert(id, sizes);
    }
    let mut sizes = HashMap::new();
    for entity in index.entities(keys::SHIPS) {
        let Some(node) = read::entity_node(entity, src, keys::SHIPS)? else {
            continue;
        };
        let Ok(id) = u32::try_from(entity.id) else {
            continue;
        };
        let Some(implementation) = node.find(keys::SHIP_DESIGN_IMPLEMENTATION, src) else {
            continue;
        };
        let Some(design) =
            read::scalar_u32(implementation, keys::DESIGN, src).and_then(|d| stages.get(&d))
        else {
            continue;
        };
        let stage = read::scalar_u32(implementation, keys::GROWTH_STAGE, src).unwrap_or(0);
        let stage = usize::try_from(stage).unwrap_or(0);
        if let Some(size) = design.get(stage).or_else(|| design.first()) {
            sizes.insert(id, size.clone());
        }
    }
    Ok(sizes)
}

/// Every entity of `planets.planet` as it now stands, filed under its
/// `coordinate.origin`; returns planet id → system id.
pub(super) fn planets(
    doc: &Document,
    countries: &Countries,
    deposit_kind: &HashMap<u32, String>,
    colony_pops: &HashMap<u32, u32>,
    by_system: &mut HashMap<u32, RawSystemDetails>,
) -> Result<HashMap<u32, u32>, ProjectionError> {
    let mut planet_system = HashMap::new();
    let Some(inner) = doc.inner_index(keys::PLANETS)? else {
        return Ok(planet_system);
    };
    for entity in inner.entities(keys::PLANET) {
        let Some((node, src)) = current_planet(doc, entity)? else {
            continue;
        };
        let Ok(id) = u32::try_from(entity.id) else {
            continue;
        };
        let planet = facts::planet::read(&node, src);
        let Some((origin, details)) = planet
            .origin
            .and_then(|o| Some((o, by_system.get_mut(&o)?)))
        else {
            continue;
        };
        planet_system.insert(id, origin);
        let capital = planet
            .colony
            .is_some_and(|c| countries.capitals.contains(&c));
        let mut deposits: Vec<(String, u32)> = Vec::new();
        for kind in planet.deposits.iter().filter_map(|d| deposit_kind.get(d)) {
            match deposits.iter_mut().find(|(k, _)| k == kind) {
                Some((_, count)) => *count += 1,
                None => deposits.push((kind.clone(), 1)),
            }
        }
        details.planets.push(RawPlanet {
            id,
            class: planet.class,
            name: planet.name,
            name_key: planet.name_key,
            colonised: planet.owner.is_some(),
            capital,
            owner: planet.owner,
            moon: planet.moon_of.is_some(),
            pre_ftl: planet
                .owner
                .is_some_and(|o| countries.primitives.contains(&o)),
            size: planet.size,
            deposits,
            pops: planet
                .colony
                .and_then(|c| colony_pops.get(&c).copied())
                .unwrap_or(0),
        });
    }
    Ok(planet_system)
}

/// The `planet_class` now standing for planet `id`; `None` when the save holds no such
/// planet.
pub(super) fn planet_class(doc: &Document, id: u32) -> Result<Option<String>, ProjectionError> {
    let Some(entity) = doc
        .inner_index(keys::PLANETS)?
        .and_then(|index| index.entity(keys::PLANET, u64::from(id)))
    else {
        return Ok(None);
    };
    Ok(current_planet(doc, entity)?.map(|(node, src)| read::text(&node, keys::PLANET_CLASS, src)))
}

/// A planet's `<id>=` node parsed from the bytes now standing for it, which an op may
/// have rewritten, with those bytes; `None` for a tombstone.
fn current_planet<'d>(
    doc: &'d Document,
    entity: &Entity,
) -> Result<Option<(Node, &'d [u8])>, ProjectionError> {
    if !matches!(entity.value, Value::Block { .. }) {
        return Ok(None);
    }
    let field = |reason: String| ProjectionError::EntityField {
        section: keys::PLANETS,
        id: entity.id,
        reason,
    };
    let src = doc
        .current(Anchor::Original(entity.stmt))
        .map_err(|e| field(e.to_string()))?;
    let root = cst::parse(src, 0).map_err(|source| ProjectionError::Entity {
        section: keys::PLANETS,
        id: entity.id,
        source,
    })?;
    let node = root
        .children()
        .first()
        .cloned()
        .ok_or_else(|| field("empty entity".to_owned()))?;
    Ok(Some((node, src)))
}

/// Every entity of the top-level `megastructures`, filed under its `coordinate.origin`.
pub(super) fn megastructures(
    index: &Index,
    src: &[u8],
    by_system: &mut HashMap<u32, RawSystemDetails>,
) -> Result<(), ProjectionError> {
    for entity in index.entities(keys::MEGASTRUCTURES) {
        let Some(node) = read::entity_node(entity, src, keys::MEGASTRUCTURES)? else {
            continue;
        };
        let Ok(id) = u32::try_from(entity.id) else {
            continue;
        };
        let mega = facts::megastructure::read(&node, src);
        let Some(details) = mega.origin.and_then(|o| by_system.get_mut(&o)) else {
            continue;
        };
        details.megastructures.push(MegastructureSummary {
            id,
            kind: mega.kind,
            owner: mega.owner,
            planet: mega.planet,
        });
    }
    Ok(())
}

/// Every entity of `archaeological_sites.sites` located on a planet (`location.type=2`),
/// filed under the planet's system.
pub(super) fn sites(
    doc: &Document,
    planet_system: &HashMap<u32, u32>,
    by_system: &mut HashMap<u32, RawSystemDetails>,
) -> Result<(), ProjectionError> {
    let src = doc.original();
    let Some(inner) = doc.inner_index(keys::ARCHAEOLOGICAL_SITES)? else {
        return Ok(());
    };
    for entity in inner.entities(keys::SITES) {
        let Some(node) = read::entity_node(entity, src, keys::ARCHAEOLOGICAL_SITES)? else {
            continue;
        };
        let Ok(id) = u32::try_from(entity.id) else {
            continue;
        };
        let location = node.find(keys::LOCATION, src);
        if location.and_then(|l| read::scalar(l, keys::TYPE, src)) != Some("2") {
            continue;
        }
        let Some(planet) = location.and_then(|l| read::scalar_u32(l, keys::ID, src)) else {
            continue;
        };
        let Some(details) = planet_system
            .get(&planet)
            .and_then(|s| by_system.get_mut(s))
        else {
            continue;
        };
        details.sites.push(ArchaeologySite {
            id,
            kind: read::text(&node, keys::TYPE, src),
            planet,
        });
    }
    Ok(())
}

/// A fleet the system lists but the `fleet` table lacks is still present, as an empty one.
fn fleet_summary(
    index: &Index,
    src: &[u8],
    fleet: u32,
    owner: Option<u32>,
    ship_sizes: &HashMap<u32, String>,
) -> Result<FleetSummary, ProjectionError> {
    let mut summary = FleetSummary {
        id: fleet,
        name: NameTemplate::default(),
        name_key: String::new(),
        owner,
        military: false,
        military_power: 0.0,
        ships: 0,
        planet_killer: false,
        disabled_ships: 0,
        ship_sizes: Vec::new(),
        order: None,
    };
    let Some(entity) = index.entity(keys::FLEET, u64::from(fleet)) else {
        return Ok(summary);
    };
    let Some(node) = read::entity_node(entity, src, keys::FLEET)? else {
        return Ok(summary);
    };
    let facts = facts::fleet::read(&node, src);
    summary.name = facts.name;
    summary.name_key = facts.name_key;
    summary.military = facts.military;
    summary.military_power = facts.military_power;
    summary.disabled_ships = facts.disabled_ships;
    summary.order = facts.order.map(|o| o.key);
    let ships = facts.ships;
    summary.ships = as_u32(ships.len());
    for key in ships.iter().filter_map(|s| ship_sizes.get(s)) {
        match summary.ship_sizes.iter_mut().find(|s| &s.key == key) {
            Some(size) => size.count += 1,
            None => summary.ship_sizes.push(ShipSizeCount {
                key: key.clone(),
                count: 1,
            }),
        }
    }
    if summary.military_power == 0.0 {
        summary.planet_killer = ships
            .iter()
            .any(|&ship| carries_planet_killer(index, src, ship));
    }
    Ok(summary)
}

/// Whether the ship entity's text names a `PLANET_KILLER` component slot.
fn carries_planet_killer(index: &Index, src: &[u8], ship: u32) -> bool {
    index
        .entity(keys::SHIPS, u64::from(ship))
        .map(|entity| entity.stmt.slice(src))
        .is_some_and(|text| memchr::memmem::find(text, b"PLANET_KILLER").is_some())
}

/// The starbases and fleets each `galactic_object` lists, read through the
/// `starbase_mgr`, `ships` and `fleet` tables.
pub(super) fn present(
    doc: &Document,
    graph: &GalaxyGraph,
    countries: &Countries,
    ship_sizes: &HashMap<u32, String>,
    by_system: &mut HashMap<u32, RawSystemDetails>,
) -> Result<(), ProjectionError> {
    let src = doc.original();
    let index = doc.index();
    let stations = read::stations(doc)?;
    for entity in index.entities(keys::GALACTIC_OBJECT) {
        let Some(node) = read::entity_node(entity, src, keys::GALACTIC_OBJECT)? else {
            continue;
        };
        let Ok(id) = u32::try_from(entity.id) else {
            continue;
        };
        let Some(details) = by_system.get_mut(&id) else {
            continue;
        };
        let system = facts::system::read(&node, src);
        let system_owner = graph.systems.get(&id).and_then(|s| s.owner);
        for starbase in system.starbases {
            let Some(station) = stations.get(&starbase) else {
                continue;
            };
            let ship = station
                .ship
                .and_then(|ship| index.entity(keys::SHIPS, u64::from(ship)))
                .map(|entity| read::entity_node(entity, src, keys::SHIPS))
                .transpose()?
                .flatten();
            let owner = ship
                .as_ref()
                .and_then(|s| read::scalar_u32(s, keys::FLEET, src))
                .and_then(|fleet| countries.fleet_owner.get(&fleet).copied())
                .or(system_owner);
            let hull = ship
                .as_ref()
                .and_then(|s| facts::starbase::hull(s, src))
                .unwrap_or_default();
            details.starbases.push(RawStarbase {
                id: starbase,
                level: station.level.clone(),
                kind: station.kind.clone(),
                name: ship
                    .as_ref()
                    .map(|s| read::name(s, src))
                    .unwrap_or_default(),
                name_key: ship
                    .as_ref()
                    .map(|s| read::name_key(s, src))
                    .unwrap_or_default(),
                owner,
                modules: station.modules.clone(),
                buildings: station.buildings.clone(),
                hull: hull.hitpoints,
                max_hull: hull.max_hitpoints,
            });
        }
        for fleet in system.fleet_presence {
            let owner = countries.fleet_owner.get(&fleet).copied();
            details
                .fleets
                .push(fleet_summary(index, src, fleet, owner, ship_sizes)?);
        }
    }
    Ok(())
}
