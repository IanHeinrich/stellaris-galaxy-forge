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
use crate::format::save::details::{DetailsProjection, RawSystemDetails};
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

/// How closely a text matched the query, best first.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Rank {
    Exact,
    Prefix,
    WordStart,
    Substring,
}

/// How a system matched: every name match ranks before every match on what it holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum SystemRank {
    Name(Rank),
    Content(Rank),
}

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
    let held_in = |of: fn(&RawSystemDetails) -> Vec<Named<'_>>| {
        details.map_or_else(Vec::new, |d| in_details(g, d, of, &needle, resolve))
    };
    let planets = held_in(|raw| {
        raw.planets
            .iter()
            .map(|p| Named {
                id: p.id,
                name: &p.name,
                owner: None,
                planet_class: Some(&p.class),
            })
            .collect()
    });
    let fleets = held_in(|raw| {
        raw.fleets
            .iter()
            .map(|f| Named {
                id: f.id,
                name: &f.name,
                owner: f.owner,
                planet_class: None,
            })
            .collect()
    });

    let located: BTreeSet<u32> = systems
        .iter()
        .map(|m| m.id)
        .chain(planets.iter().map(|&(_, system, _)| system))
        .chain(fleets.iter().map(|&(_, system, _)| system))
        .collect();

    let mut hits: Vec<SearchHit> = systems
        .into_iter()
        .take(limit)
        .map(|m| system_hit(g, &g.systems[&m.id], m.matched))
        .collect();
    hits.extend(countries(g, details, &needle, limit, resolve));
    let held = |kind: SearchKind, (_, system, named): &(Rank, u32, Named<'_>)| SearchHit {
        system_id: Some(*system),
        owner: owner_name(g, named.owner),
        planet_class: named.planet_class.cloned(),
        ..SearchHit::new(
            kind,
            named.id,
            named.name.clone(),
            position(g, Some(*system)),
        )
    };
    hits.extend(
        planets
            .iter()
            .take(limit)
            .map(|p| held(SearchKind::Planet, p)),
    );
    hits.extend(
        fleets
            .iter()
            .take(limit)
            .map(|f| held(SearchKind::Fleet, f)),
    );
    hits.extend(nebulae(g, &needle, limit, resolve));
    SearchResult {
        hits,
        systems: located.into_iter().collect(),
    }
}

/// A system the query matched, and what it matched on when that was not its name.
struct SystemMatch {
    rank: SystemRank,
    id: u32,
    matched: Option<Matched>,
}

/// What a system matched on besides its name: the text shown, and the bypass key when
/// it was a bypass.
struct Matched {
    text: String,
    bypass: Option<String>,
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
                rank: SystemRank::Name(rank),
                id: s.id,
                matched: None,
            }),
            None => content.best(s).map(|(rank, matched)| SystemMatch {
                rank: SystemRank::Content(rank),
                id: s.id,
                matched: Some(matched),
            }),
        })
        .collect();
    ranked.sort_unstable_by_key(|m| (m.rank, m.id));
    if let Some(id) = by_id {
        let named = SystemMatch {
            rank: SystemRank::Name(Rank::Exact),
            id,
            matched: None,
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
    /// The best content rank of `s` and what it matched on, the first found on a tie. A
    /// substring inside a word is too loose to count.
    fn best(&self, s: &SystemNode) -> Option<(Rank, Matched)> {
        if self.needle.chars().count() < MIN_CONTENT_NEEDLE {
            return None;
        }
        let mut best: Option<(Rank, Matched)> = None;
        let mut offer = |rank: Option<Rank>, matched: &dyn Fn() -> Matched| {
            if let Some(rank) = rank.filter(|&r| r <= Rank::WordStart)
                && best.as_ref().is_none_or(|(b, _)| rank < *b)
            {
                best = Some((rank, matched()));
            }
        };
        let text = |text: String| Matched { text, bypass: None };
        if !s.initializer.is_empty() {
            offer(self.rank_key(&s.initializer), &|| {
                text(s.initializer.clone())
            });
        }
        for flag in &s.flags {
            offer(self.rank_key(flag), &|| text(flag.clone()));
        }
        for label in (self.special)(s.id) {
            offer(self.rank_text(label), &|| text(label.to_owned()));
        }
        for &(key, label) in self.bypasses.get(&s.id).into_iter().flatten() {
            let rank = self
                .rank_key(key)
                .into_iter()
                .chain(self.rank_text(label))
                .min();
            offer(rank, &|| Matched {
                text: label.to_owned(),
                bypass: Some(key.to_owned()),
            });
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
            offer(rank, &|| {
                text(resolved.clone().unwrap_or_else(|| class.clone()))
            });
        }
        best
    }

    fn rank_key(&self, key: &str) -> Option<Rank> {
        rank(&strip_filler(&normalise(key)), &self.needle)
    }

    fn rank_text(&self, text: &str) -> Option<Rank> {
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
    let mut ranked: Vec<(Rank, u32, usize)> = g
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
                system_id: home,
                country_type: Some(country.country_type.clone()),
                system_count: Some(country.system_count),
                ..SearchHit::new(
                    SearchKind::Country,
                    country.id,
                    country.name.clone(),
                    position(g, home),
                )
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

/// One named thing a system's details hold: a planet or a fleet.
struct Named<'a> {
    id: u32,
    name: &'a NameTemplate,
    owner: Option<u32>,
    planet_class: Option<&'a String>,
}

/// Every matching thing `of` lists in a system's details, with its rank and system, best
/// first and then by id.
fn in_details<'a>(
    g: &GalaxyGraph,
    details: &'a DetailsProjection,
    of: fn(&'a RawSystemDetails) -> Vec<Named<'a>>,
    needle: &str,
    resolve: NameResolver<'_>,
) -> Vec<(Rank, u32, Named<'a>)> {
    let mut ranked = Vec::new();
    for &system in &g.order {
        let Some(raw) = details.raw(system) else {
            continue;
        };
        for named in of(raw) {
            if let Some(rank) = rank_template(named.name, needle, resolve) {
                ranked.push((rank, system, named));
            }
        }
    }
    ranked.sort_unstable_by_key(|(rank, _, named)| (*rank, named.id));
    ranked
}

fn nebulae(
    g: &GalaxyGraph,
    needle: &str,
    limit: usize,
    resolve: NameResolver<'_>,
) -> Vec<SearchHit> {
    let mut ranked: Vec<(Rank, usize)> = g
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

fn system_hit(g: &GalaxyGraph, s: &SystemNode, matched: Option<Matched>) -> SearchHit {
    let (matched_on, matched_bypass) = match matched {
        Some(Matched { text, bypass }) => (Some(text), bypass),
        None => (None, None),
    };
    SearchHit {
        system_id: Some(s.id),
        owner: owner_name(g, s.owner),
        matched_on,
        matched_bypass,
        ..SearchHit::new(SearchKind::System, s.id, s.name.clone(), Some([s.x, s.y]))
    }
}

fn nebula_hit(index: usize, n: &Nebula) -> SearchHit {
    SearchHit {
        system_count: Some(as_u32(n.systems.len())),
        ..SearchHit::new(
            SearchKind::Nebula,
            as_u32(index),
            n.name.clone(),
            Some([n.x, n.y]),
        )
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
fn rank_template(name: &NameTemplate, needle: &str, resolve: NameResolver<'_>) -> Option<Rank> {
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
fn rank_key(key: &str, needle: &str, resolve: NameResolver<'_>) -> Option<Rank> {
    let by_key = rank(&normalise(key), needle);
    let by_name = resolve(key).and_then(|name| rank(&name.trim().to_lowercase(), needle));
    by_key.into_iter().chain(by_name).min()
}

/// The display form of a name key, lower-cased (mirrors `app/src/lib/names.ts`).
fn normalise(key: &str) -> String {
    display_name(key).to_lowercase()
}

/// How `needle` occurs in `name`; `None` when it does not.
fn rank(name: &str, needle: &str) -> Option<Rank> {
    if needle.is_empty() {
        return None;
    }
    if name == needle {
        return Some(Rank::Exact);
    }
    if name.starts_with(needle) {
        return Some(Rank::Prefix);
    }
    if !name.contains(needle) {
        return None;
    }
    let word_start = name
        .match_indices(needle)
        .any(|(i, _)| name[..i].ends_with(' '));
    Some(if word_start {
        Rank::WordStart
    } else {
        Rank::Substring
    })
}
