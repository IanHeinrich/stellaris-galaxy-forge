//! What the save's tables say about one system, extracted from the bytes.
//!
//! Save keys are kept as written (`d_energy_5`, `pc_continental`); turning them into what
//! the UI shows is [`super::resolve`]'s job.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cst::Node;
use crate::document::Document;
use crate::emit::system::RING_FLAG;
use crate::entity::facts;
use crate::entity::facts::planet::{BodyRole, PlanetFacts};
use crate::entity::views::EntityKind;
use crate::format::save::galaxy::bodies::planet_ids;
use crate::format::save::galaxy::bypasses::{NATURAL, natural_wormholes, row};
use crate::format::save::galaxy::starbases::fleet_owners;
use crate::format::save::system_spec::BeltSpec;
use crate::format::save::{dig_sites, read_spec};
use crate::format::save::{entity_at, planet_statement, planet_statements, system_statement};
use crate::overlay::Anchor;
use crate::projections::galaxy::{GalaxyGraph, ProjectionError};
use crate::projections::name::NameTemplate;
use crate::projections::read::{self, PERMANENT, RawCountry};
use crate::scan::Index;
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
    /// The system's `asteroid_belts`, in order.
    pub belts: Vec<BeltSpec>,
    pub inner_radius: Option<f64>,
    /// The system's `natural_wormholes` entries, in file order.
    pub wormholes: Vec<WormholeSummary>,
    /// The first body the system lists, which it is centred on.
    pub primary: Option<u32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawPlanet {
    pub id: u32,
    pub class: String,
    pub name: NameTemplate,
    pub name_key: String,
    pub colonised: bool,
    pub capital: bool,
    pub owner: Option<u32>,
    /// The role is [`BodyRole::Moon`].
    pub moon: bool,
    pub role: BodyRole,
    pub pre_ftl: bool,
    pub size: Option<u32>,
    /// `orbit`: the radius around the star, or around the planet a moon orbits.
    pub orbit: Option<f64>,
    /// `moon_of`, kept even when the save no longer holds that planet.
    pub parent: Option<u32>,
    /// `coordinate` x/y, relative to the system's centre.
    pub at: Option<(f64, f64)>,
    /// The ring bit of `binary_flags`.
    pub ring: bool,
    /// Deposit key → count, in order of first appearance. A colony's deposits are
    /// planetary features and blockers; the resolver decides what each key yields.
    pub deposits: Vec<(String, u32)>,
    /// `colony.<id>.num_sapient_pops`, zero on an uncolonised planet.
    pub pops: u32,
    /// The modifier names of the planet's permanent `timed_modifier` items (`days = -1`):
    /// the shape a terraforming candidate modifier is written in, whatever the planet's
    /// class now says.
    pub permanent_modifiers: Vec<String>,
    /// `anomaly`: the category of the anomaly the planet holds.
    pub anomaly: Option<String>,
    /// `entity_name`: the model the planet is drawn as, in place of its class's.
    pub entity_name: Option<String>,
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

/// One `natural_wormholes` entry standing in the system: a wormhole, or a shroud tunnel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WormholeSummary {
    /// The `natural_wormholes` id.
    pub id: u32,
    /// The `bypasses` entry it stands for.
    pub bypass: u32,
    /// That bypass's `type`, such as `wormhole` or `shroud_tunnel`; empty when the save holds no
    /// such bypass. Only a `wormhole` can be moved.
    pub kind: String,
    /// The system its bypass's `linked_to` stands in.
    pub partner: Option<u32>,
    /// `coordinate` x/y, relative to the system's centre. A wormhole has no orbit.
    pub x: f64,
    pub y: f64,
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

/// Deposit id → `type` key, from the top-level `deposit` table as loaded and the
/// deposits an op added to it.
pub(super) fn deposit_kinds(doc: &Document) -> Result<HashMap<u32, String>, ProjectionError> {
    let (index, src) = (doc.index(), doc.original());
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
    for (id, anchor) in doc.added().entries(EntityKind::Deposit) {
        let Some((node, bytes)) = current_entity(doc, keys::DEPOSIT, u64::from(id), anchor)? else {
            continue;
        };
        if let Some(kind) = read::scalar(&node, keys::TYPE, bytes) {
            kinds.insert(id, kind.to_owned());
        }
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

/// Every entity of `planets.planet` as it now stands, the ones an op added included,
/// filed under its `coordinate.origin`; returns planet id → system id.
pub(super) fn planets(
    doc: &Document,
    countries: &Countries,
    deposit_kind: &HashMap<u32, String>,
    colony_pops: &HashMap<u32, u32>,
    by_system: &mut HashMap<u32, RawSystemDetails>,
) -> Result<HashMap<u32, u32>, ProjectionError> {
    let mut planet_system = HashMap::new();
    for (id, anchor) in planet_statements(doc)? {
        let Some((node, src)) = current_entity(doc, keys::PLANETS, u64::from(id), anchor)? else {
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
        let mut raw = raw_planet(id, &planet, &node, src, details.primary == Some(id));
        raw.capital = planet
            .colony
            .is_some_and(|c| countries.capitals.contains(&c));
        raw.pre_ftl = planet
            .owner
            .is_some_and(|o| countries.primitives.contains(&o));
        for kind in planet.deposits.iter().filter_map(|d| deposit_kind.get(d)) {
            match raw.deposits.iter_mut().find(|(k, _)| k == kind) {
                Some((_, count)) => *count += 1,
                None => raw.deposits.push((kind.clone(), 1)),
            }
        }
        raw.pops = planet
            .colony
            .and_then(|c| colony_pops.get(&c).copied())
            .unwrap_or(0);
        details.planets.push(raw);
    }
    Ok(planet_system)
}

/// The modifier names of `node`'s permanent `timed_modifier.items` (`days = -1`).
fn permanent_modifiers(node: &Node, src: &[u8]) -> Vec<String> {
    let Some(items) = node
        .find(keys::TIMED_MODIFIER, src)
        .and_then(|block| block.find(keys::ITEMS, src))
    else {
        return Vec::new();
    };
    items
        .children()
        .iter()
        .filter(|item| read::text(item, keys::DAYS, src) == PERMANENT)
        .filter_map(|item| {
            Some(
                read::scalar(item, keys::MODIFIER, src)?
                    .trim_matches('"')
                    .to_owned(),
            )
        })
        .collect()
}

/// Planet `id` as its entity `node` reads, `planet` being its facts and `primary` whether
/// its system lists it first. What other tables say of it, its capital, pre-FTL owner,
/// deposits and pops, is left empty.
fn raw_planet(id: u32, planet: &PlanetFacts, node: &Node, src: &[u8], primary: bool) -> RawPlanet {
    let role = planet.role(primary);
    RawPlanet {
        id,
        class: planet.class.clone(),
        name: planet.name.clone(),
        name_key: planet.name_key.clone(),
        colonised: planet.colonised(),
        capital: false,
        owner: planet.owner,
        moon: role == BodyRole::Moon,
        role,
        pre_ftl: false,
        size: planet.size,
        orbit: read::scalar_f64(node, keys::ORBIT, src),
        parent: planet.moon_of,
        at: read::coordinate(node, src).ok(),
        ring: planet.binary_flags & RING_FLAG != 0,
        deposits: Vec::new(),
        pops: 0,
        permanent_modifiers: permanent_modifiers(node, src),
        anomaly: planet.anomaly.clone(),
        entity_name: planet.entity_name.clone(),
    }
}

/// Planet `id` as its entity now reads, `primary` saying whether its system lists it first,
/// with what other tables say of it left empty; `None` when the save holds no such planet.
pub(super) fn planet(
    doc: &Document,
    id: u32,
    primary: bool,
) -> Result<Option<RawPlanet>, ProjectionError> {
    let Some(anchor) = planet_statement(doc, id)? else {
        return Ok(None);
    };
    Ok(current_entity(doc, keys::PLANETS, u64::from(id), anchor)?
        .map(|(node, src)| raw_planet(id, &facts::planet::read(&node, src), &node, src, primary)))
}

/// An entity's `<id>=` node parsed from the bytes now standing for it, which an op may
/// have rewritten or written, with those bytes; `None` for a tombstone.
fn current_entity<'d>(
    doc: &'d Document,
    section: &'static str,
    id: u64,
    anchor: Anchor,
) -> Result<Option<(Node, &'d [u8])>, ProjectionError> {
    entity_at(doc, anchor).map_err(|source| ProjectionError::Entity {
        section,
        id,
        source,
    })
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

/// Every site of `archaeological_sites.sites` the save now holds on a planet, the ones an op
/// added included, filed under the planet's system.
pub(super) fn sites(
    doc: &Document,
    planet_system: &HashMap<u32, u32>,
    by_system: &mut HashMap<u32, RawSystemDetails>,
) -> Result<(), ProjectionError> {
    for (_, site) in dig_sites::sites(doc)? {
        let Some(planet) = site.planet else {
            continue;
        };
        let Some(details) = planet_system
            .get(&planet)
            .and_then(|s| by_system.get_mut(s))
        else {
            continue;
        };
        details.sites.push(ArchaeologySite {
            id: site.id,
            kind: site.kind,
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

/// Each system's starbases, fleets, belts and `inner_radius`, in one pass over the bytes
/// now standing for its `galactic_object` entry: an added or rerolled system's facts are
/// only in the bytes the op wrote. Starbases and fleets are read through the
/// `starbase_mgr`, `ships` and `fleet` tables.
pub(super) fn present(
    doc: &Document,
    graph: &GalaxyGraph,
    countries: &Countries,
    ship_sizes: &HashMap<u32, String>,
    by_system: &mut HashMap<u32, RawSystemDetails>,
) -> Result<(), ProjectionError> {
    // Ops write only fleet and ship positions, never the fields read here, so these tables
    // are read from the original bytes even when a system's own entry has moved to the overlay.
    let src = doc.original();
    let index = doc.index();
    let stations = read::stations(doc)?;
    for (&id, details) in by_system.iter_mut() {
        let Some(anchor) = system_statement(doc, id) else {
            continue;
        };
        let Some((node, entity_src)) =
            current_entity(doc, keys::GALACTIC_OBJECT, u64::from(id), anchor)?
        else {
            continue;
        };
        let system = facts::system::read(&node, entity_src);
        read_geometry(details, &node, entity_src);
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

/// Read again system `id`'s belts and `inner_radius` from the bytes now standing for its
/// entry.
pub(super) fn refresh_geometry(
    doc: &Document,
    id: u32,
    details: &mut RawSystemDetails,
) -> Result<(), ProjectionError> {
    let Some(anchor) = system_statement(doc, id) else {
        return Ok(());
    };
    if let Some((node, src)) = current_entity(doc, keys::GALACTIC_OBJECT, u64::from(id), anchor)? {
        read_geometry(details, &node, src);
    }
    for wormhole in &mut details.wormholes {
        let Some(row) = row(doc, NATURAL, wormhole.id)? else {
            continue;
        };
        if let Ok((x, y)) = read::coordinate(&row.node, row.src) {
            wormhole.x = x;
            wormhole.y = y;
        }
    }
    Ok(())
}

/// Every natural wormhole the save holds, filed under the system it stands in.
pub(super) fn wormholes(
    doc: &Document,
    graph: &GalaxyGraph,
    by_system: &mut HashMap<u32, RawSystemDetails>,
) -> Result<(), ProjectionError> {
    for wormhole in natural_wormholes(doc, &graph.systems)? {
        if let Some(details) = by_system.get_mut(&wormhole.system) {
            details.wormholes.push(WormholeSummary {
                id: wormhole.id,
                bypass: wormhole.bypass,
                kind: wormhole.kind,
                partner: wormhole.partner,
                x: wormhole.at.0,
                y: wormhole.at.1,
            });
        }
    }
    Ok(())
}

/// The belts and `inner_radius` the system's entry `node` lists. A belt list with a radius
/// that cannot be read leaves the system without belts.
fn read_geometry(details: &mut RawSystemDetails, node: &Node, src: &[u8]) {
    details.inner_radius = read::scalar_f64(node, keys::INNER_RADIUS, src);
    details.belts = read_spec::belts_in(node, src).unwrap_or_default();
    details.primary = planet_ids(node, src).first().copied();
}
