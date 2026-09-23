//! Find the save's named things for the search palette: systems, countries, planets,
//! fleets and nebulae, by id or name, and systems by what they hold.
//!
//! Names are compared the way the UI displays them: case-insensitive, without the
//! `NAME_` / `STAR_NAME_` / `SPEC_` prefix, underscores read as spaces. A localised
//! name, when the resolver knows one, is matched as well; a name built from a template
//! matches on any key in it. Hits come back grouped by kind, systems first, at most
//! `limit` of each.

use std::collections::{BTreeSet, HashMap};

use crate::as_u32;
use crate::format::save::details::{DetailsProjection, FleetSummary, RawPlanet};
use crate::projections::galaxy::{BypassLink, GalaxyGraph, Nebula, SystemNode, display_name};
use crate::projections::name::NameTemplate;
use crate::views::{SearchHit, SearchKind, SearchResult};

/// The localised text of a name key, `None` when unknown.
pub type NameResolver<'a> = &'a dyn Fn(&str) -> Option<String>;

/// The labels of the special kinds a system is (`Enclave`, `Leviathan` …), empty when it
/// is none or no game data is loaded to say.
pub type SpecialLabels<'a> = &'a dyn Fn(u32) -> Vec<&'static str>;

/// Words a content key carries that say nothing about what the system holds.
const FILLER: [&str; 4] = ["system", "init", "planet", "star"];

/// Content ranks sit below every name rank (0 to 3).
const CONTENT_RANK: u8 = 4;

/// Shorter content queries ("g", "bl") would ring every G star or black hole.
const MIN_CONTENT_NEEDLE: usize = 3;

/// Everything matching `query`, grouped by kind and best first within each group, and
/// every system a system, planet or fleet match locates, however many hits `limit` keeps.
///
/// A query that is a system id puts that system first. Name matches rank exact, then
/// prefix, then a match at a word start, then any substring, on the better of the
/// display key and the resolved name; ties go to the lower id. A system whose name does
/// not match is matched on what it holds (initializer, flags, special kinds, bypasses,
/// planet classes), exact, prefix or word start only, below every name match. Planets,
/// fleets and planet classes are only searched when `details` is built.
pub fn search(
    g: &GalaxyGraph,
    details: Option<&DetailsProjection>,
    query: &str,
    limit: usize,
    resolve: NameResolver<'_>,
    special: SpecialLabels<'_>,
) -> SearchResult {
    let query = query.trim();
    if query.is_empty() || limit == 0 {
        return SearchResult::default();
    }
    let needle = normalise(query);
    let content = Content {
        details,
        needle: strip_filler(&needle),
        bypasses: bypass_labels(g),
        resolve,
        special,
    };
    let systems = systems(g, query, &needle, &content, resolve);
    let planets = details.map_or_else(Vec::new, |d| planets(g, d, &needle, resolve));
    let fleets = details.map_or_else(Vec::new, |d| fleets(g, d, &needle, resolve));

    let located: BTreeSet<u32> = systems
        .iter()
        .map(|m| m.id)
        .chain(planets.iter().map(|&(_, _, _, system)| system))
        .chain(fleets.iter().map(|&(_, _, _, system)| system))
        .collect();

    let mut hits: Vec<SearchHit> = systems
        .into_iter()
        .take(limit)
        .map(|m| system_hit(g, &g.systems[&m.id], m.matched_on))
        .collect();
    hits.extend(countries(g, details, &needle, limit, resolve));
    hits.extend(
        planets
            .iter()
            .take(limit)
            .map(|&(_, _, planet, system)| planet_hit(g, planet, system)),
    );
    hits.extend(
        fleets
            .iter()
            .take(limit)
            .map(|&(_, _, fleet, system)| fleet_hit(g, fleet, system)),
    );
    hits.extend(nebulae(g, &needle, limit, resolve));
    SearchResult {
        hits,
        systems: located.into_iter().collect(),
    }
}

/// A system the query matched, and what it matched on when that was not its name.
struct SystemMatch {
    rank: u8,
    id: u32,
    matched_on: Option<String>,
}

/// Every matching system, best first: the one the query names by id, then by rank and id.
fn systems(
    g: &GalaxyGraph,
    query: &str,
    needle: &str,
    content: &Content<'_>,
    resolve: NameResolver<'_>,
) -> Vec<SystemMatch> {
    let by_id = query
        .parse::<u32>()
        .ok()
        .filter(|id| g.systems.contains_key(id));
    let mut ranked: Vec<SystemMatch> = g
        .systems
        .values()
        .filter(|s| Some(s.id) != by_id)
        .filter_map(|s| match rank_template(&s.name, needle, resolve) {
            Some(rank) => Some(SystemMatch {
                rank,
                id: s.id,
                matched_on: None,
            }),
            None => content.best(s).map(|(rank, matched_on)| SystemMatch {
                rank,
                id: s.id,
                matched_on: Some(matched_on),
            }),
        })
        .collect();
    ranked.sort_unstable_by_key(|m| (m.rank, m.id));
    if let Some(id) = by_id {
        let named = SystemMatch {
            rank: 0,
            id,
            matched_on: None,
        };
        ranked.insert(0, named);
    }
    ranked
}

/// What a system holds, matched against the query with its filler words dropped.
struct Content<'a> {
    details: Option<&'a DetailsProjection>,
    needle: String,
    bypasses: HashMap<u32, Vec<(&'a str, &'a str)>>,
    resolve: NameResolver<'a>,
    special: SpecialLabels<'a>,
}

impl Content<'_> {
    /// The best content rank of `s` and what it matched on, the first found on a tie.
    fn best(&self, s: &SystemNode) -> Option<(u8, String)> {
        if self.needle.chars().count() < MIN_CONTENT_NEEDLE {
            return None;
        }
        let mut best: Option<(u8, String)> = None;
        let mut offer = |rank: Option<u8>, matched_on: &dyn Fn() -> String| {
            if let Some(rank) = rank.filter(|&r| r <= 2)
                && best.as_ref().is_none_or(|&(b, _)| rank < b)
            {
                best = Some((rank, matched_on()));
            }
        };
        if !s.initializer.is_empty() {
            offer(self.rank_key(&s.initializer), &|| s.initializer.clone());
        }
        for flag in &s.flags {
            offer(self.rank_key(flag), &|| flag.clone());
        }
        for label in (self.special)(s.id) {
            offer(self.rank_text(label), &|| label.to_owned());
        }
        for &(key, label) in self.bypasses.get(&s.id).into_iter().flatten() {
            let rank = self
                .rank_key(key)
                .into_iter()
                .chain(self.rank_text(label))
                .min();
            offer(rank, &|| label.to_owned());
        }
        for planet in self
            .details
            .and_then(|d| d.raw(s.id))
            .into_iter()
            .flat_map(|raw| &raw.planets)
        {
            let class = &planet.class;
            let resolved = (self.resolve)(class);
            let by_name = resolved.as_deref().and_then(|name| self.rank_text(name));
            let by_key = self.rank_key(class.strip_prefix("pc_").unwrap_or(class));
            let rank = by_key.into_iter().chain(by_name).min();
            offer(rank, &|| resolved.clone().unwrap_or_else(|| class.clone()));
        }
        best.map(|(rank, matched_on)| (CONTENT_RANK + rank, matched_on))
    }

    fn rank_key(&self, key: &str) -> Option<u8> {
        rank(&strip_filler(&normalise(key)), &self.needle)
    }

    fn rank_text(&self, text: &str) -> Option<u8> {
        rank(&strip_filler(&text.trim().to_lowercase()), &self.needle)
    }
}

/// Each system's bypasses as (key, label); a wormhole counts on both of its ends.
fn bypass_labels(g: &GalaxyGraph) -> HashMap<u32, Vec<(&str, &str)>> {
    let mut by_system: HashMap<u32, Vec<(&str, &str)>> = HashMap::new();
    for link in &g.bypasses {
        let (ends, key, label): ([Option<u32>; 2], &str, &str) = match link {
            BypassLink::Wormhole { a, b } => ([Some(*a), Some(*b)], "wormhole", "Wormhole"),
            BypassLink::Gateway { system, .. } => ([Some(*system), None], "gateway", "Gateway"),
            BypassLink::LGate { system } => ([Some(*system), None], "l_gate", "L-Gate"),
            BypassLink::Other { system, kind } => ([Some(*system), None], kind, kind),
        };
        for system in ends.into_iter().flatten() {
            by_system.entry(system).or_default().push((key, label));
        }
    }
    by_system
}

/// `text` without its filler and purely numeric words.
fn strip_filler(text: &str) -> String {
    text.split_whitespace()
        .filter(|w| !FILLER.contains(w) && !w.chars().all(|c| c.is_ascii_digit()))
        .collect::<Vec<&str>>()
        .join(" ")
}

fn countries(
    g: &GalaxyGraph,
    details: Option<&DetailsProjection>,
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
            let home = country
                .capital_system
                .or_else(|| details.and_then(|d| fleet_system(g, d, country.id)));
            SearchHit {
                kind: SearchKind::Country,
                id: country.id,
                name: country.name.clone(),
                name_key: country.name_key.clone(),
                system_id: home,
                owner: None,
                country_type: Some(country.country_type.clone()),
                system_count: Some(country.system_count),
                planet_class: None,
                position: position(g, home),
                matched_on: None,
            }
        })
        .collect()
}

/// Where a country without a capital, such as a guardian, has its first fleet.
fn fleet_system(g: &GalaxyGraph, details: &DetailsProjection, country: u32) -> Option<u32> {
    g.order.iter().copied().find(|&system| {
        details
            .raw(system)
            .is_some_and(|raw| raw.fleets.iter().any(|f| f.owner == Some(country)))
    })
}

/// Every matching planet with its system, best first.
fn planets<'a>(
    g: &GalaxyGraph,
    details: &'a DetailsProjection,
    needle: &str,
    resolve: NameResolver<'_>,
) -> Vec<(u8, u32, &'a RawPlanet, u32)> {
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
}

fn planet_hit(g: &GalaxyGraph, planet: &RawPlanet, system: u32) -> SearchHit {
    SearchHit {
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
        matched_on: None,
    }
}

/// Every matching fleet with its system, best first.
fn fleets<'a>(
    g: &GalaxyGraph,
    details: &'a DetailsProjection,
    needle: &str,
    resolve: NameResolver<'_>,
) -> Vec<(u8, u32, &'a FleetSummary, u32)> {
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
}

fn fleet_hit(g: &GalaxyGraph, fleet: &FleetSummary, system: u32) -> SearchHit {
    SearchHit {
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
        matched_on: None,
    }
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

fn system_hit(g: &GalaxyGraph, s: &SystemNode, matched_on: Option<String>) -> SearchHit {
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
        matched_on,
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
        matched_on: None,
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
