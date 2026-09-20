//! Find the save's named things for the search palette: systems, countries, planets,
//! fleets and nebulae, by id or name.
//!
//! Names are compared the way the UI displays them: case-insensitive, without the
//! `NAME_` / `STAR_NAME_` / `SPEC_` prefix, underscores read as spaces. A localised
//! name, when the resolver knows one, is matched as well; a name built from a template
//! matches on any key in it. Hits come back grouped by kind, systems first, at most
//! `limit` of each.

use crate::as_u32;
use crate::format::save::details::{DetailsProjection, FleetSummary, RawPlanet};
use crate::projections::galaxy::{GalaxyGraph, Nebula, SystemNode, display_name};
use crate::projections::name::NameTemplate;
use crate::views::{SearchHit, SearchKind};

/// The localised text of a name key, `None` when unknown.
pub type NameResolver<'a> = &'a dyn Fn(&str) -> Option<String>;

/// Everything matching `query`, grouped by kind and best first within each group.
///
/// A query that is a system id puts that system first. Name matches rank exact, then
/// prefix, then a match at a word start, then any substring, on the better of the
/// display key and the resolved name; ties go to the lower id. Planets and fleets are
/// only searched when `details` is built.
pub fn search(
    g: &GalaxyGraph,
    details: Option<&DetailsProjection>,
    query: &str,
    limit: usize,
    resolve: NameResolver<'_>,
) -> Vec<SearchHit> {
    let query = query.trim();
    if query.is_empty() || limit == 0 {
        return Vec::new();
    }
    let needle = normalise(query);
    let mut hits = systems(g, query, &needle, limit, resolve);
    hits.extend(countries(g, &needle, limit, resolve));
    if let Some(details) = details {
        hits.extend(planets(g, details, &needle, limit, resolve));
        hits.extend(fleets(g, details, &needle, limit, resolve));
    }
    hits.extend(nebulae(g, &needle, limit, resolve));
    hits
}

fn systems(
    g: &GalaxyGraph,
    query: &str,
    needle: &str,
    limit: usize,
    resolve: NameResolver<'_>,
) -> Vec<SearchHit> {
    let mut hits = Vec::new();
    let by_id = query
        .parse::<u32>()
        .ok()
        .filter(|id| g.systems.contains_key(id));
    if let Some(id) = by_id {
        hits.push(system_hit(g, &g.systems[&id]));
    }
    let mut ranked: Vec<(u8, u32)> = g
        .systems
        .values()
        .filter(|s| Some(s.id) != by_id)
        .filter_map(|s| rank_template(&s.name, needle, resolve).map(|r| (r, s.id)))
        .collect();
    ranked.sort_unstable();
    hits.extend(
        ranked
            .iter()
            .take(limit.saturating_sub(hits.len()))
            .map(|&(_, id)| system_hit(g, &g.systems[&id])),
    );
    hits
}

fn countries(
    g: &GalaxyGraph,
    needle: &str,
    limit: usize,
    resolve: NameResolver<'_>,
) -> Vec<SearchHit> {
    let mut ranked: Vec<(u8, u32, usize)> = g
        .countries
        .iter()
        .enumerate()
        .filter_map(|(i, c)| rank_template(&c.name, needle, resolve).map(|r| (r, c.id, i)))
        .collect();
    ranked.sort_unstable();
    ranked
        .iter()
        .take(limit)
        .map(|&(_, _, i)| {
            let country = &g.countries[i];
            SearchHit {
                kind: SearchKind::Country,
                id: country.id,
                name: country.name.clone(),
                name_key: country.name_key.clone(),
                system_id: country.capital_system,
                owner: None,
                country_type: Some(country.country_type.clone()),
                system_count: Some(country.system_count),
                planet_class: None,
                position: position(g, country.capital_system),
            }
        })
        .collect()
}

fn planets(
    g: &GalaxyGraph,
    details: &DetailsProjection,
    needle: &str,
    limit: usize,
    resolve: NameResolver<'_>,
) -> Vec<SearchHit> {
    let mut ranked: Vec<(u8, u32, &RawPlanet, u32)> = Vec::new();
    for &system in &g.order {
        let Some(raw) = details.raw(system) else {
            continue;
        };
        for planet in &raw.planets {
            if let Some(rank) = rank_template(&planet.name, needle, resolve) {
                ranked.push((rank, planet.id, planet, system));
            }
        }
    }
    ranked.sort_unstable_by_key(|&(rank, id, _, _)| (rank, id));
    ranked
        .iter()
        .take(limit)
        .map(|&(_, _, planet, system)| SearchHit {
            kind: SearchKind::Planet,
            id: planet.id,
            name: planet.name.clone(),
            name_key: planet.name.stand_in(),
            system_id: Some(system),
            owner: None,
            country_type: None,
            system_count: None,
            planet_class: Some(planet.class.clone()),
            position: position(g, Some(system)),
        })
        .collect()
}

fn fleets(
    g: &GalaxyGraph,
    details: &DetailsProjection,
    needle: &str,
    limit: usize,
    resolve: NameResolver<'_>,
) -> Vec<SearchHit> {
    let mut ranked: Vec<(u8, u32, &FleetSummary, u32)> = Vec::new();
    for &system in &g.order {
        let Some(raw) = details.raw(system) else {
            continue;
        };
        for fleet in &raw.fleets {
            if let Some(rank) = rank_template(&fleet.name, needle, resolve) {
                ranked.push((rank, fleet.id, fleet, system));
            }
        }
    }
    ranked.sort_unstable_by_key(|&(rank, id, _, _)| (rank, id));
    ranked
        .iter()
        .take(limit)
        .map(|&(_, _, fleet, system)| SearchHit {
            kind: SearchKind::Fleet,
            id: fleet.id,
            name: fleet.name.clone(),
            name_key: fleet.name.stand_in(),
            system_id: Some(system),
            owner: owner_name(g, fleet.owner),
            country_type: None,
            system_count: None,
            planet_class: None,
            position: position(g, Some(system)),
        })
        .collect()
}

fn nebulae(
    g: &GalaxyGraph,
    needle: &str,
    limit: usize,
    resolve: NameResolver<'_>,
) -> Vec<SearchHit> {
    let mut ranked: Vec<(u8, usize)> = g
        .nebulae
        .iter()
        .enumerate()
        .filter_map(|(i, n)| rank_template(&n.name, needle, resolve).map(|r| (r, i)))
        .collect();
    ranked.sort_unstable();
    ranked
        .iter()
        .take(limit)
        .map(|&(_, i)| nebula_hit(i, &g.nebulae[i]))
        .collect()
}

fn system_hit(g: &GalaxyGraph, s: &SystemNode) -> SearchHit {
    SearchHit {
        kind: SearchKind::System,
        id: s.id,
        name: s.name.clone(),
        name_key: s.name.stand_in(),
        system_id: Some(s.id),
        owner: owner_name(g, s.owner),
        country_type: None,
        system_count: None,
        planet_class: None,
        position: Some([s.x, s.y]),
    }
}

fn nebula_hit(index: usize, n: &Nebula) -> SearchHit {
    SearchHit {
        kind: SearchKind::Nebula,
        id: as_u32(index),
        name: n.name.clone(),
        name_key: n.name.stand_in(),
        system_id: None,
        owner: None,
        country_type: None,
        system_count: Some(as_u32(n.systems.len())),
        planet_class: None,
        position: Some([n.x, n.y]),
    }
}

/// The focused system's position, `None` when no system locates the hit.
fn position(g: &GalaxyGraph, system: Option<u32>) -> Option<[f64; 2]> {
    let system = g.systems.get(&system?)?;
    Some([system.x, system.y])
}

fn owner_name(g: &GalaxyGraph, owner: Option<u32>) -> Option<NameTemplate> {
    let owner = owner?;
    Some(g.countries.iter().find(|c| c.id == owner)?.name.clone())
}

/// The best rank of any key in the template; a literal key matches as written.
fn rank_template(name: &NameTemplate, needle: &str, resolve: NameResolver<'_>) -> Option<u8> {
    let own = if name.literal {
        rank(&name.key.trim().to_lowercase(), needle)
    } else {
        rank_key(&name.key, needle, resolve)
    };
    name.variables
        .iter()
        .filter_map(|v| rank_template(&v.value, needle, resolve))
        .chain(own)
        .min()
}

/// The better of the display key and the resolved name.
fn rank_key(key: &str, needle: &str, resolve: NameResolver<'_>) -> Option<u8> {
    let by_key = rank(&normalise(key), needle);
    let by_name = resolve(key).and_then(|name| rank(&name.trim().to_lowercase(), needle));
    by_key.into_iter().chain(by_name).min()
}

/// The display form of a name key, lower-cased (mirrors `app/src/lib/names.ts`).
fn normalise(key: &str) -> String {
    display_name(key).to_lowercase()
}

/// 0 exact, 1 prefix, 2 word start, 3 substring; `None` when `needle` does not occur.
fn rank(name: &str, needle: &str) -> Option<u8> {
    if needle.is_empty() {
        return None;
    }
    if name == needle {
        return Some(0);
    }
    if name.starts_with(needle) {
        return Some(1);
    }
    if !name.contains(needle) {
        return None;
    }
    let word_start = name
        .match_indices(needle)
        .any(|(i, _)| name[..i].ends_with(' '));
    Some(if word_start { 2 } else { 3 })
}
