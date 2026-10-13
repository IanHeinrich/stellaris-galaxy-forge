//! What the UI shows: the raw details with deposits summed per resource and planet
//! classes judged habitable by a [`DetailsResolver`].

use std::collections::HashMap;

use crate::as_u32;
use crate::format::save::details::{RawPlanet, RawSystemDetails};
use crate::projections::geometry;
use crate::views::details::{
    BodyLayout, Bounds, DepositCount, FleetPresence, FleetSummary, PlanetSummary, ResourceAmount,
    StarbaseSummary, SystemDetails,
};

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

/// What `fleets` amount to as the system view counts them.
fn presence(fleets: &[FleetSummary]) -> FleetPresence {
    let mut presence = FleetPresence {
        fleet_count: as_u32(fleets.len()),
        ..FleetPresence::default()
    };
    for fleet in fleets.iter().filter(|f| f.military) {
        presence.military_count += 1;
        presence.ship_count += fleet.ships;
        presence.military_power += fleet.military_power;
    }
    presence
}

/// The ship sizes of the stations that gather what a planet's deposits produce.
const GATHERING_STATIONS: [&str; 2] = ["mining_station", "research_station"];

/// Whether `fleet` is a mining or research station. A planet's `shipclass_orbital_station`
/// can outlive its station and name a fleet that has since taken the id.
fn gathers(fleet: &FleetSummary) -> bool {
    fleet
        .ship_sizes
        .first()
        .is_some_and(|size| GATHERING_STATIONS.contains(&size.key.as_str()))
}

/// One system's raw details with each planet's deposits summed into resources by
/// `resolver`, the system's resources the sum of those rows, and each station fleet's
/// `works` the resources of the planet it works.
pub(super) fn resolve(
    id: u32,
    raw: &RawSystemDetails,
    resolver: &dyn DetailsResolver,
    with_game_data: bool,
) -> SystemDetails {
    let mut resources: Vec<ResourceAmount> = Vec::new();
    let mut planets = Vec::with_capacity(raw.planets.len());
    let mut works: HashMap<u32, Vec<String>> = HashMap::new();
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
        if let Some(station) = p.station {
            works.insert(
                station,
                deposits.iter().map(|r| r.resource.clone()).collect(),
            );
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
            role: p.role,
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
            star_class: None,
            drawn: false,
            permanent_modifiers: Some(p.permanent_modifiers.clone()),
            anomaly: p.anomaly.clone(),
            entity_name: p.entity_name.clone(),
            culture: p.culture.clone(),
            spawn: None,
        });
    }
    let mut starbases = raw.starbases.iter().map(|s| StarbaseSummary {
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
        at: s.at,
        planet: s.planet,
        culture: s.culture.clone(),
        spawn: None,
    });
    let starbase = starbases.next();
    let other_starbases = starbases.collect();
    SystemDetails {
        id,
        resources,
        planets,
        starbase,
        other_starbases,
        fleets: presence(&raw.fleets),
        fleets_present: raw
            .fleets
            .iter()
            .map(|f| FleetSummary {
                works: if gathers(f) {
                    works.remove(&f.id).unwrap_or_default()
                } else {
                    Vec::new()
                },
                ..f.clone()
            })
            .collect(),
        megastructures: raw.megastructures.clone(),
        sites: raw.sites.clone(),
        with_game_data,
        belts: raw.belts.clone(),
        inner_radius: raw.inner_radius,
        wormholes: raw.wormholes.clone(),
        spawn: None,
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
        at: planet.at,
        size: planet.size.map(|size| Bounds::fixed(f64::from(size))),
        orbit_step: None,
        angle_step: None,
        turns_from: None,
    }
}

/// The radius the body is drawn at about its parent's point, or about the centre without
/// a parent (see [`geometry::drawn_radius`]). The stored `orbit` stands in when the body or
/// its parent has no point.
fn drawn_radius(planet: &RawPlanet, points: &HashMap<u32, (f64, f64)>) -> Option<f64> {
    let centre = match planet.parent {
        None => Some((0.0, 0.0)),
        Some(parent) => points.get(&parent).copied(),
    };
    let (Some(at), Some(centre)) = (planet.at, centre) else {
        return planet.orbit;
    };
    Some(geometry::drawn_radius(at, centre, planet.orbit))
}

/// Adds `amount` to the row for `resource`, appending one in first-seen order.
fn add_amount(rows: &mut Vec<ResourceAmount>, resource: String, amount: f64) {
    match rows.iter_mut().find(|r| r.resource == resource) {
        Some(row) => row.amount += amount,
        None => rows.push(ResourceAmount { resource, amount }),
    }
}
