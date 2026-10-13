//! What the save's tables say about one system, extracted from the bytes.
//!
//! Save keys are kept as written (`d_energy_5`, `pc_continental`); turning them into what
//! the UI shows is [`super::resolve`]'s job.

use std::collections::{HashMap, HashSet};

use crate::cst::Node;
use crate::document::Document;
use crate::emit::system::RING_FLAG;
use crate::entity::facts;
use crate::entity::facts::planet::{BodyRole, PlanetFacts};
use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, row, rows};
use crate::format::save::galaxy::bodies::planet_ids;
use crate::format::save::galaxy::bypasses::{NATURAL, natural_wormholes};
use crate::format::save::galaxy::fleets;
use crate::format::save::galaxy::starbases::fleet_owners;
use crate::format::save::system_spec::BeltSpec;
use crate::format::save::{dig_sites, read_spec};
use crate::format::save::{entity_at, planet_statement, planet_statements, system_statement};
use crate::overlay::Anchor;
use crate::projections::galaxy::{GalaxyGraph, ProjectionError, StarClasses};
use crate::projections::name::NameTemplate;
use crate::projections::read::{self, PERMANENT, RawCountry};
use crate::scan::Index;
use crate::views::details::{
    ArchaeologySite, FleetSummary, MegastructureSummary, ShipSizeCount, WormholeSummary,
};
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
    /// Its owner's `graphical_culture`.
    pub culture: Option<String>,
    /// `shipclass_orbital_station`: the mining or research station's fleet.
    pub station: Option<u32>,
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
    /// Where the station stands, relative to the system's centre: the station fleet's
    /// `movement_manager.coordinate`, reached as `station` → ship → `fleet`. `None` when
    /// that fleet is gone or stands in another system.
    pub at: Option<(f64, f64)>,
    /// The planet the station fleet orbits: its `movement_manager.orbit.orbitable.planet`.
    /// An orbital ring's is the planet it rings.
    pub planet: Option<u32>,
    /// The `station` ship's `graphical_culture`.
    pub culture: Option<String>,
}

pub(super) struct Countries {
    /// Colony ids named by a `country.capital`.
    capitals: HashSet<u32>,
    /// Fleet id → country id, from `fleets_manager.owned_fleets`.
    fleet_owner: HashMap<u32, u32>,
    /// Countries whose `type` is `primitive`.
    primitives: HashSet<u32>,
    /// Country id → its `graphical_culture`.
    cultures: HashMap<u32, String>,
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
        cultures: raw
            .iter()
            .filter_map(|c| Some((c.id, c.graphical_culture.clone()?)))
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

/// What the other tables say of the planets, and which of them are stars.
pub(super) struct PlanetTables<'a> {
    pub countries: &'a Countries,
    pub deposit_kind: &'a HashMap<u32, String>,
    pub colony_pops: &'a HashMap<u32, u32>,
    pub stars: &'a StarClasses,
}

/// Every entity of `planets.planet` as it now stands, the ones an op added included,
/// filed under its `coordinate.origin`; returns planet id → system id.
pub(super) fn planets(
    doc: &Document,
    tables: &PlanetTables,
    by_system: &mut HashMap<u32, RawSystemDetails>,
) -> Result<HashMap<u32, u32>, ProjectionError> {
    let PlanetTables {
        countries,
        deposit_kind,
        colony_pops,
        stars,
    } = tables;
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
        let primary = details.primary == Some(id);
        let mut raw = raw_planet(id, &planet, &node, src, planet.role(primary, stars));
        raw.capital = planet
            .colony
            .is_some_and(|c| countries.capitals.contains(&c));
        raw.pre_ftl = planet
            .owner
            .is_some_and(|o| countries.primitives.contains(&o));
        raw.culture = planet
            .owner
            .and_then(|o| countries.cultures.get(&o).cloned());
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
    read::timed_items(node, src)
        .filter(|item| read::text(item, keys::DAYS, src) == PERMANENT)
        .filter_map(|item| read::scalar(item, keys::MODIFIER, src))
        .map(|modifier| modifier.trim_matches('"').to_owned())
        .collect()
}

/// Planet `id` as its entity `node` reads, `planet` being its facts and `role` what it is
/// in its system. What other tables say of it, its capital, pre-FTL owner, deposits and
/// pops, is left empty.
fn raw_planet(id: u32, planet: &PlanetFacts, node: &Node, src: &[u8], role: BodyRole) -> RawPlanet {
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
        culture: None,
        station: planet.station,
    }
}

/// Planet `id` as its entity now reads, `primary` saying whether its system lists it first
/// and `stars` which bodies are stars, with what other tables say of it left empty; `None`
/// when the save holds no such planet.
pub(super) fn planet(
    doc: &Document,
    id: u32,
    primary: bool,
    stars: &StarClasses,
) -> Result<Option<RawPlanet>, ProjectionError> {
    let Some(anchor) = planet_statement(doc, id)? else {
        return Ok(None);
    };
    Ok(
        current_entity(doc, keys::PLANETS, u64::from(id), anchor)?.map(|(node, src)| {
            let facts = facts::planet::read(&node, src);
            raw_planet(id, &facts, &node, src, facts.role(primary, stars))
        }),
    )
}

/// A planet and its moons read without their system's tables.
pub(super) struct PlanetAlone {
    /// The system its `coordinate.origin` names.
    pub origin: Option<u32>,
    /// The planet, then the moons its entity lists.
    pub planets: Vec<RawPlanet>,
}

/// Planet `id` and the moons its entity lists, as their entities now read, with what other
/// tables say of them left empty; `None` when the save holds no such planet.
pub(super) fn planet_alone(
    doc: &Document,
    id: u32,
    stars: &StarClasses,
) -> Result<Option<PlanetAlone>, ProjectionError> {
    let Some(anchor) = planet_statement(doc, id)? else {
        return Ok(None);
    };
    let Some((node, src)) = current_entity(doc, keys::PLANETS, u64::from(id), anchor)? else {
        return Ok(None);
    };
    let facts = facts::planet::read(&node, src);
    let primary = match facts.origin {
        Some(system) => primary_of(doc, system)?,
        None => None,
    };
    let role = facts.role(primary == Some(id), stars);
    let mut planets = vec![raw_planet(id, &facts, &node, src, role)];
    for moon in read::ids(&node, keys::MOONS, src) {
        planets.extend(planet(doc, moon, primary == Some(moon), stars)?);
    }
    Ok(Some(PlanetAlone {
        origin: facts.origin,
        planets,
    }))
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

/// Every live row of the top-level `megastructures`, the ones an op added included, filed
/// under its `coordinate.origin`.
pub(super) fn megastructures(
    doc: &Document,
    countries: &Countries,
    by_system: &mut HashMap<u32, RawSystemDetails>,
) -> Result<(), ProjectionError> {
    for row in rows(doc, Table::Entity(EntityKind::Megastructure))? {
        let mega = facts::megastructure::read(&row.node, row.src);
        let Some(details) = mega.origin.and_then(|o| by_system.get_mut(&o)) else {
            continue;
        };
        let culture = mega.graphical_culture.or_else(|| {
            mega.owner
                .and_then(|owner| countries.cultures.get(&owner).cloned())
        });
        details.megastructures.push(MegastructureSummary {
            id: row.id,
            kind: mega.kind,
            owner: mega.owner,
            planet: mega.planet,
            at: mega.at,
            culture,
            made_body: match mega.planet {
                Some(planet) => made_by_megastructure(doc, planet)?,
                None => false,
            },
            spawn: None,
        });
    }
    Ok(())
}

/// Whether planet `id` has the planet flag `megastructure`, which a body a megastructure made
/// has.
fn made_by_megastructure(doc: &Document, id: u32) -> Result<bool, ProjectionError> {
    let Some(anchor) = planet_statement(doc, id)? else {
        return Ok(false);
    };
    Ok(current_entity(doc, keys::PLANETS, u64::from(id), anchor)?
        .is_some_and(|(node, src)| read::has_flag(&node, src, keys::MEGASTRUCTURE)))
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
        works: Vec::new(),
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
            let fleet = ship
                .as_ref()
                .and_then(|s| read::scalar_u32(s, keys::FLEET, src));
            let owner = fleet
                .and_then(|fleet| countries.fleet_owner.get(&fleet).copied())
                .or(system_owner);
            let at = fleet.and_then(|fleet| standing(doc, fleet, id));
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
                at,
                planet: fleet.and_then(|fleet| fleets::orbited_planet(doc, fleet)),
                culture: ship
                    .as_ref()
                    .and_then(|s| read::scalar(s, keys::GRAPHICAL_CULTURE, src))
                    .map(str::to_owned),
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

/// The first body system `id`'s entry now lists, which it is centred on.
fn primary_of(doc: &Document, id: u32) -> Result<Option<u32>, ProjectionError> {
    let Some(anchor) = system_statement(doc, id) else {
        return Ok(None);
    };
    Ok(
        current_entity(doc, keys::GALACTIC_OBJECT, u64::from(id), anchor)?
            .and_then(|(node, src)| planet_ids(&node, src).first().copied()),
    )
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

/// Where fleet `fleet` stands in system `system`: `None` when it is gone or stands elsewhere.
fn standing(doc: &Document, fleet: u32, system: u32) -> Option<(f64, f64)> {
    fleets::position(doc, fleet)
        .filter(|&(origin, _)| origin == system)
        .and_then(|(_, at)| at)
}

/// Read again where each of system `id`'s starbases stands, from the bytes now standing for
/// its station fleet.
pub(super) fn refresh_starbases(
    doc: &Document,
    id: u32,
    details: &mut RawSystemDetails,
) -> Result<(), ProjectionError> {
    let src = doc.original();
    let index = doc.index();
    let Some(inner) = doc.inner_index(keys::STARBASE_MGR)? else {
        return Ok(());
    };
    for starbase in &mut details.starbases {
        let Some(entity) = inner.entity(keys::STARBASES, u64::from(starbase.id)) else {
            continue;
        };
        let Some(node) = read::entity_node(entity, src, keys::STARBASE_MGR)? else {
            continue;
        };
        let ship = read::scalar_u32(&node, keys::STATION, src)
            .and_then(|ship| index.entity(keys::SHIPS, u64::from(ship)))
            .map(|entity| read::entity_node(entity, src, keys::SHIPS))
            .transpose()?
            .flatten();
        let fleet = ship.and_then(|s| read::scalar_u32(&s, keys::FLEET, src));
        starbase.at = fleet.and_then(|fleet| standing(doc, fleet, id));
    }
    Ok(())
}

/// Read again the point of each of the system's megastructures tied to a body of `bodies`,
/// from the bytes now standing for its row.
pub(super) fn refresh_megastructures(
    doc: &Document,
    bodies: &[u32],
    details: &mut RawSystemDetails,
) -> Result<(), ProjectionError> {
    let tied = details
        .megastructures
        .iter_mut()
        .filter(|m| m.planet.is_some_and(|p| bodies.contains(&p)));
    for mega in tied {
        if let Some(row) = row(doc, Table::Entity(EntityKind::Megastructure), mega.id)? {
            mega.at = read::coordinate(&row.node, row.src).ok();
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
