//! What the UI shows: the raw details with deposits summed per resource and planet
//! classes judged habitable by a [`DetailsResolver`].

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::as_u32;
use crate::format::save::details::{
    ArchaeologySite, FleetSummary, MegastructureSummary, RawPlanet, RawSystemDetails,
};
use crate::format::save::system_spec::BeltSpec;
use crate::projections::name::NameTemplate;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FleetPresence {
    /// Every fleet in the system's `fleet_presence`, stations included.
    pub fleet_count: u32,
    /// Fleets whose `ship_class` is `shipclass_military` or `shipclass_military_special`.
    pub military_count: u32,
    /// Ships in those fleets.
    pub ship_count: u32,
    /// Summed `military_power` of those fleets.
    pub military_power: f64,
}

impl FleetPresence {
    fn of(fleets: &[FleetSummary]) -> Self {
        let mut presence = Self {
            fleet_count: as_u32(fleets.len()),
            ..Self::default()
        };
        for fleet in fleets.iter().filter(|f| f.military) {
            presence.military_count += 1;
            presence.ship_count += fleet.ships;
            presence.military_power += fleet.military_power;
        }
        presence
    }
}

/// Turns save keys into what the UI shows. The heuristic implementation reads the key
/// itself; a game-data implementation reads the install's definitions.
pub trait DetailsResolver {
    /// What one deposit of this kind yields, as `(resource, amount)` pairs. `None` means
    /// the key is not an orbital deposit (a planetary feature or blocker) and is skipped.
    fn deposit_produces(&self, key: &str) -> Option<Vec<(String, f64)>>;
    /// Whether a planet class is habitable; `None` when unknown.
    fn planet_habitable(&self, class: &str) -> Option<bool>;
}

/// `d_<resource>_<n>` yields `n` of `<resource>`; keys without a numeric suffix are the
/// game's planetary features and blockers, never orbital deposits, and are skipped.
pub struct HeuristicResolver;

impl DetailsResolver for HeuristicResolver {
    fn deposit_produces(&self, key: &str) -> Option<Vec<(String, f64)>> {
        let resource = key.strip_prefix("d_").unwrap_or(key);
        let (resource, amount) = resource.rsplit_once('_')?;
        if amount.is_empty() || !amount.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        Some(vec![(resource.to_owned(), amount.parse().unwrap_or(0.0))])
    }

    fn planet_habitable(&self, _class: &str) -> Option<bool> {
        None
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemDetails {
    pub id: u32,
    pub resources: Vec<ResourceAmount>,
    pub planets: Vec<PlanetSummary>,
    pub starbase: Option<StarbaseSummary>,
    pub fleets: FleetPresence,
    /// In file order.
    pub fleets_present: Vec<FleetSummary>,
    pub megastructures: Vec<MegastructureSummary>,
    pub sites: Vec<ArchaeologySite>,
    pub with_game_data: bool,
    /// The system's `asteroid_belts`, in order.
    pub belts: Vec<BeltSpec>,
    /// A save's `inner_radius`; `None` in a scenario.
    pub inner_radius: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResourceAmount {
    pub resource: String,
    pub amount: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetSummary {
    pub id: u32,
    pub class: String,
    pub name: NameTemplate,
    pub name_key: String,
    pub colonised: bool,
    pub capital: bool,
    pub habitable: Option<bool>,
    pub owner: Option<u32>,
    pub moon: bool,
    /// Owned by a `primitive` country.
    pub pre_ftl: bool,
    /// `planet_size`, the game's tile count.
    pub size: Option<u32>,
    /// `orbit`: the radius around the star, or around the planet a moon orbits. `None`
    /// for a scenario's bodies, which the game places at generation.
    pub orbit: Option<f64>,
    /// The planet's own deposits summed per resource; the system's `resources` are the
    /// sum of these rows.
    pub deposits: Vec<ResourceAmount>,
    /// The same deposits as the save's own `deposit` keys with counts, beside the summed
    /// amounts: a feature or a blocker yields no resource but is still on the planet.
    pub deposit_keys: Vec<DepositCount>,
    pub pops: u32,
    /// The save's `moon_of`, kept even when that body is missing; in a scenario, the
    /// synthetic id of the body the moon was expanded under. A body with no parent orbits
    /// the system's centre.
    pub parent: Option<u32>,
    pub layout: Option<BodyLayout>,
    /// A save's ring bit in `binary_flags`; a scenario's `has_ring`, `None` when the
    /// initializer leaves it to the class's `chance_of_ring`.
    pub ring: Option<bool>,
}

/// A number an initializer may leave to a draw: `min == max` when it is fixed,
/// and always in a save.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Bounds {
    pub min: f64,
    pub max: f64,
}

impl Bounds {
    /// A number with no range to draw from.
    pub fn fixed(value: f64) -> Self {
        Self {
            min: value,
            max: value,
        }
    }
}

/// Where the scene draws a body. Not `BodySpec`, which is what the add-system
/// writer emits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BodyLayout {
    /// The drawn radius about the parent, or about the system's centre without
    /// one. `None` for a save body with neither an orbit nor a point. A scenario
    /// body with no distance stands on the running orbit.
    pub orbit: Option<Bounds>,
    /// Degrees about the parent. `None` in a save, which has `at`, and when an
    /// initializer names no angle.
    pub angle: Option<Bounds>,
    /// A save's `coordinate` x/y, system-relative. `None` in a scenario.
    pub at: Option<(f64, f64)>,
    /// `planet_size`: fixed in a save, the initializer's `size` in a scenario.
    pub size: Option<Bounds>,
}

/// One `deposit` key and how many of it the planet holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DepositCount {
    pub key: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StarbaseSummary {
    pub id: u32,
    pub level: String,
    /// The entry's `type` key: `starbase_outpost`, `swaystation_research` …; empty when
    /// the entry names none, as a scenario's synthesised starbase does.
    pub kind: String,
    pub name: NameTemplate,
    pub name_key: String,
    pub owner: Option<u32>,
    /// Module and building keys in save order.
    pub modules: Vec<String>,
    pub buildings: Vec<String>,
    /// A `shipyard` module: the starbase can build ships.
    pub shipyard: bool,
    /// The `station` ship's hull; both are zero when the entry names no station.
    pub hull: f64,
    pub max_hull: f64,
}

/// One system's raw details with each planet's deposits summed into resources by
/// `resolver`, and the system's resources the sum of those rows.
pub(super) fn resolve(
    id: u32,
    raw: &RawSystemDetails,
    resolver: &dyn DetailsResolver,
    with_game_data: bool,
) -> SystemDetails {
    let mut resources: Vec<ResourceAmount> = Vec::new();
    let mut planets = Vec::with_capacity(raw.planets.len());
    let points = points(&raw.planets);
    for p in &raw.planets {
        let mut deposits: Vec<ResourceAmount> = Vec::new();
        for (key, count) in &p.deposits {
            let Some(produces) = resolver.deposit_produces(key) else {
                continue;
            };
            for (resource, amount) in produces {
                add_amount(&mut deposits, resource, amount * f64::from(*count));
            }
        }
        for row in &deposits {
            add_amount(&mut resources, row.resource.clone(), row.amount);
        }
        planets.push(PlanetSummary {
            id: p.id,
            class: p.class.clone(),
            name: p.name.clone(),
            name_key: p.name_key.clone(),
            colonised: p.colonised,
            capital: p.capital,
            habitable: resolver.planet_habitable(&p.class),
            owner: p.owner,
            moon: p.moon,
            pre_ftl: p.pre_ftl,
            size: p.size,
            orbit: p.orbit,
            deposits,
            deposit_keys: p
                .deposits
                .iter()
                .map(|(key, count)| DepositCount {
                    key: key.clone(),
                    count: *count,
                })
                .collect(),
            pops: p.pops,
            parent: p.parent,
            layout: Some(layout(p, &points)),
            ring: Some(p.ring),
        });
    }
    let starbase = raw.starbases.first().map(|s| StarbaseSummary {
        id: s.id,
        level: s.level.clone(),
        kind: s.kind.clone(),
        name: s.name.clone(),
        name_key: s.name_key.clone(),
        owner: s.owner,
        shipyard: s.modules.iter().any(|m| m == "shipyard"),
        modules: s.modules.clone(),
        buildings: s.buildings.clone(),
        hull: s.hull,
        max_hull: s.max_hull,
    });
    SystemDetails {
        id,
        resources,
        planets,
        starbase,
        fleets: FleetPresence::of(&raw.fleets),
        fleets_present: raw.fleets.clone(),
        megastructures: raw.megastructures.clone(),
        sites: raw.sites.clone(),
        with_game_data,
        belts: raw.belts.clone(),
        inner_radius: raw.inner_radius,
    }
}

/// Where each of a system's bodies stands, by id.
fn points(planets: &[RawPlanet]) -> HashMap<u32, (f64, f64)> {
    planets.iter().filter_map(|p| Some((p.id, p.at?))).collect()
}

/// A save body's exact point, its size and the radius it is drawn at.
fn layout(planet: &RawPlanet, points: &HashMap<u32, (f64, f64)>) -> BodyLayout {
    BodyLayout {
        orbit: drawn_radius(planet, points).map(Bounds::fixed),
        angle: None,
        at: planet.at,
        size: planet.size.map(|size| Bounds::fixed(f64::from(size))),
    }
}

/// The body's distance from its parent's point, or from the centre without a parent:
/// some bodies store an `orbit` of 0 or less while they sit out from their parent. The
/// stored `orbit` stands in when the body or its parent has no point.
fn drawn_radius(planet: &RawPlanet, points: &HashMap<u32, (f64, f64)>) -> Option<f64> {
    let centre = match planet.parent {
        None => Some((0.0, 0.0)),
        Some(parent) => points.get(&parent).copied(),
    };
    let (Some((x, y)), Some((cx, cy))) = (planet.at, centre) else {
        return planet.orbit;
    };
    let distance = (x - cx).hypot(y - cy);
    match planet.orbit {
        Some(stored) if (distance - stored).abs() <= STORED_ORBIT_SLACK => Some(stored),
        _ => Some(distance),
    }
}

/// How far a body's point may stray from its stored `orbit` for the stored value to be
/// drawn: the rounding of a point written to five decimals, not a body placed elsewhere.
const STORED_ORBIT_SLACK: f64 = 0.01;

/// Adds `amount` to the row for `resource`, appending one in first-seen order.
fn add_amount(rows: &mut Vec<ResourceAmount>, resource: String, amount: f64) {
    match rows.iter_mut().find(|r| r.resource == resource) {
        Some(row) => row.amount += amount,
        None => rows.push(ResourceAmount { resource, amount }),
    }
}
