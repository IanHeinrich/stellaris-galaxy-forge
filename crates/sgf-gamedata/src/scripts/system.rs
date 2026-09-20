//! One system's Scripts section: what generated it, what it calls, and
//! everything in loaded game data that names it back.

use std::cmp::Reverse;
use std::collections::{BTreeSet, HashMap, HashSet};

use crate::GameData;
use crate::scripts::chain::{self, Chain};
use crate::scripts::identity;
use crate::scripts::index::{RefSite, SiteKind};
use crate::scripts::scan::EVENT_TARGET;
use crate::scripts::view::{
    OwnerTier, ROW_KIND_ORDER, ROW_LIMIT, ReferenceVia, SITE_LIMIT, ScriptRef, ScriptRow,
    ScriptRowKind, ScriptSite, ScriptTiming, SystemOwnerView, SystemScripts,
};

/// On_actions that run while the galaxy is being generated.
fn at_generation(on_action: &str) -> bool {
    on_action.contains("galaxy_generation")
}

/// On_actions that fire once the galaxy stands, before the player's first
/// frame: what they fire is day one, not generation.
fn at_day_one(on_action: &str) -> bool {
    on_action.starts_with("on_game_start")
}

/// One line of one script, before the lines of the same script are merged.
struct Found {
    kind: ScriptRowKind,
    name: String,
    title: Option<String>,
    timing: ScriptTiming,
    fired_by: Option<String>,
    pinned: bool,
    site: ScriptSite,
    /// The line the script itself is written on, which leads its sites.
    definition: bool,
}

/// The rows for `system`. `scenario_effect` is the scenario statement's own
/// `effect = { … }` text and the line it starts on.
pub fn system_scripts(
    gd: &GameData,
    system: u32,
    initializer: Option<&str>,
    scenario_effect: Option<(String, u32)>,
) -> SystemScripts {
    let chain = initializer.map(|key| gd.scripts.chain(&gd.initializers, key));
    let effect_chain = scenario_effect
        .as_ref()
        .map(|(text, _)| chain::walk_effect(&gd.scripts, text));
    let star_flags: BTreeSet<String> = chain
        .as_deref()
        .into_iter()
        .chain(effect_chain.as_ref())
        .flat_map(|c| c.star_flags.iter().cloned())
        .collect();
    let own = initializer.and_then(|key| definition(gd, key));
    let mut found = Vec::new();

    if let (Some(key), Some(location)) = (initializer, own.clone()) {
        found.push(Found {
            kind: ScriptRowKind::Initializer,
            name: key.to_owned(),
            title: gd.loc.get(key),
            timing: ScriptTiming::Generation,
            fired_by: None,
            pinned: true,
            site: site(location, None, None),
            definition: true,
        });
    }
    if let Some(chain) = &chain {
        found.extend(chain.spawned.iter().filter_map(|key| {
            Some(Found {
                kind: ScriptRowKind::SpawnedInitializer,
                name: key.clone(),
                title: gd.loc.get(key),
                timing: ScriptTiming::Generation,
                fired_by: None,
                pinned: false,
                site: site(definition(gd, key)?, Some(ReferenceVia::Initializer), None),
                definition: true,
            })
        }));
        found.extend(chain.called_effects.iter().filter_map(|key| {
            let def = gd.scripts.effect(key)?;
            Some(Found {
                kind: ScriptRowKind::ScriptedEffect,
                name: key.clone(),
                title: gd.loc.get(key),
                timing: ScriptTiming::Generation,
                fired_by: None,
                pinned: false,
                site: site(
                    gd.scripts.node_ref(&def.file, &def.src, &def.node),
                    Some(ReferenceVia::Call),
                    None,
                ),
                definition: true,
            })
        }));
    }
    if let Some((text, line)) = scenario_effect {
        found.push(Found {
            kind: ScriptRowKind::ScenarioEffect,
            name: "effect".to_owned(),
            title: Some(summarise(&text)),
            timing: ScriptTiming::Generation,
            fired_by: None,
            pinned: true,
            site: site(
                ScriptRef {
                    file: None,
                    display: format!("scenario:{line}"),
                    line,
                    layer: "scenario".to_owned(),
                },
                None,
                None,
            ),
            definition: true,
        });
    }
    if let Some(chain) = &chain {
        found.extend(references(gd, initializer, chain, &claimed_events(gd)));
    }
    found.extend(claims_on(gd, &star_flags));

    let mut rows = merge(found);
    rows.sort_by_key(|row| {
        (
            Reverse(row.pinned),
            kind_rank(row.kind),
            Reverse(row.site_count),
            row.name.clone(),
        )
    });
    let truncated = rows.len() > ROW_LIMIT;
    rows.truncate(ROW_LIMIT);

    SystemScripts {
        system,
        initializer: own,
        owner: chain.as_ref().and_then(|c| owner_view(gd, c, initializer)),
        rows,
        truncated,
    }
}

fn site(location: ScriptRef, via: Option<ReferenceVia>, token: Option<String>) -> ScriptSite {
    ScriptSite {
        location,
        via,
        token,
    }
}

/// One row per script: lines of the same script join it, and two tokens
/// naming the same line are one site.
fn merge(found: Vec<Found>) -> Vec<ScriptRow> {
    struct Building {
        row: ScriptRow,
        sites: Vec<(ScriptSite, bool)>,
        lines: HashSet<(Option<String>, u32)>,
    }

    let mut order: Vec<Building> = Vec::new();
    let mut index: HashMap<(ScriptRowKind, String, Option<String>), usize> = HashMap::new();

    for one in found {
        let key = (one.kind, one.name.clone(), one.site.location.file.clone());
        let at = *index.entry(key).or_insert_with(|| {
            order.push(Building {
                row: ScriptRow {
                    kind: one.kind,
                    name: one.name.clone(),
                    title: one.title.clone(),
                    timing: one.timing,
                    fired_by: one.fired_by.clone(),
                    sites: Vec::new(),
                    site_count: 0,
                    vias: Vec::new(),
                    pinned: one.pinned,
                },
                sites: Vec::new(),
                lines: HashSet::new(),
            });
            order.len() - 1
        });
        let building = &mut order[at];
        building.row.pinned |= one.pinned;
        if timing_rank(one.timing) < timing_rank(building.row.timing) {
            building.row.timing = one.timing;
        }
        if building.row.title.is_none() {
            building.row.title = one.title;
        }
        if building.row.fired_by.is_none() {
            building.row.fired_by = one.fired_by;
        }
        if building
            .lines
            .insert((one.site.location.file.clone(), one.site.location.line))
        {
            building.row.site_count += 1;
            building.sites.push((one.site, one.definition));
        }
    }

    order
        .into_iter()
        .map(|mut building| {
            building
                .sites
                .sort_by_key(|(site, definition)| (!definition, site.location.line));
            for (site, _) in &building.sites {
                if let Some(via) = site.via
                    && !building.row.vias.contains(&via)
                {
                    building.row.vias.push(via);
                }
            }
            building.row.sites = building
                .sites
                .into_iter()
                .take(SITE_LIMIT)
                .map(|(site, _)| site)
                .collect();
            building.row
        })
        .collect()
}

fn definition(gd: &GameData, key: &str) -> Option<ScriptRef> {
    let def = gd.initializers.def(key)?;
    Some(gd.scripts.node_ref(&def.file, &def.src, &def.node))
}

fn owner_view(gd: &GameData, chain: &Chain, initializer: Option<&str>) -> Option<SystemOwnerView> {
    let token = chain.owner_tokens.first()?;
    let capital = chain.saved_targets.iter().any(|(t, _)| t == token);
    let identity = identity::resolve(
        gd,
        token,
        capital.then_some(chain),
        capital.then_some(initializer).flatten(),
    );
    Some(SystemOwnerView {
        token: token.clone(),
        territory: None,
        label: identity.label(gd),
        capital,
        tier: OwnerTier::Generation,
        claimed_by: None,
        assumed: false,
    })
}

/// The events the game-start walk reached and found a claim in, which is
/// how a day-one event chained out of `on_game_start` is known to be one.
fn claimed_events(gd: &GameData) -> HashSet<&str> {
    gd.scripts
        .claims()
        .all()
        .iter()
        .map(|claim| claim.event.as_str())
        .collect()
}

/// The day-one events that claim this system: a game-start sweep insists on
/// star flags, and the system carries every one of them.
fn claims_on(gd: &GameData, star_flags: &BTreeSet<String>) -> Vec<Found> {
    let mut found = Vec::new();
    for claim in gd.scripts.claims().for_flags(star_flags) {
        let Some(matched) = claim.required_flags.first() else {
            continue;
        };
        if !claim
            .required_flags
            .iter()
            .all(|flag| star_flags.contains(flag))
        {
            continue;
        }
        let Some(location) = gd.scripts.event(&claim.event) else {
            continue;
        };
        found.push(Found {
            kind: ScriptRowKind::Event,
            name: claim.event.clone(),
            title: gd.loc.get(&claim.event),
            timing: ScriptTiming::DayOne,
            fired_by: fired_by(gd.scripts.callers_of(&claim.event)),
            pinned: false,
            site: site(
                gd.scripts.script_ref(&location.file, location.line),
                Some(ReferenceVia::StarFlag),
                Some(matched.clone()),
            ),
            definition: true,
        });
    }
    found
}

/// Every script in loaded game data that names this system's initializer,
/// one of its star or global flags, or one of its event targets.
fn references(
    gd: &GameData,
    initializer: Option<&str>,
    chain: &Chain,
    claimed: &HashSet<&str>,
) -> Vec<Found> {
    let mut wanted: Vec<(&str, ReferenceVia)> = Vec::new();
    wanted.extend(initializer.map(|key| (key, ReferenceVia::Initializer)));
    wanted.extend(
        chain
            .star_flags
            .iter()
            .map(|f| (f.as_str(), ReferenceVia::StarFlag)),
    );
    wanted.extend(
        chain
            .global_flags
            .iter()
            .map(|f| (f.as_str(), ReferenceVia::GlobalFlag)),
    );
    wanted.extend(
        chain
            .planet_flags
            .iter()
            .map(|f| (f.as_str(), ReferenceVia::PlanetFlag)),
    );
    wanted.extend(
        chain
            .system_targets
            .iter()
            .map(|t| (t.as_str(), ReferenceVia::EventTarget)),
    );

    let mut found = Vec::new();
    for (token, via) in wanted {
        for site in gd.scripts.references(token) {
            if site.kind == SiteKind::Initializer && Some(site.owner.as_str()) == initializer {
                continue;
            }
            found.push(found_for(gd, site, token, via, chain, claimed));
        }
    }
    found
}

fn found_for(
    gd: &GameData,
    site: &RefSite,
    token: &str,
    via: ReferenceVia,
    chain: &Chain,
    claimed: &HashSet<&str>,
) -> Found {
    let callers = gd.scripts.callers_of(&site.owner);
    Found {
        kind: match site.kind {
            SiteKind::Initializer => ScriptRowKind::Initializer,
            SiteKind::ScriptedEffect => ScriptRowKind::ScriptedEffect,
            SiteKind::Event => ScriptRowKind::Event,
            SiteKind::OnAction => ScriptRowKind::OnAction,
        },
        name: site.owner.clone(),
        title: gd.loc.get(&site.owner),
        timing: match site.kind {
            SiteKind::Initializer => ScriptTiming::Generation,
            SiteKind::OnAction => on_action_timing(&site.owner),
            SiteKind::Event => event_timing(callers, claimed.contains(site.owner.as_str())),
            SiteKind::ScriptedEffect if chain.called_effects.contains(&site.owner) => {
                ScriptTiming::Generation
            }
            SiteKind::ScriptedEffect => ScriptTiming::Unknown,
        },
        fired_by: fired_by(callers),
        pinned: false,
        site: self::site(
            site.location.clone(),
            Some(via_of(site.verb, via)),
            Some(token.to_owned()),
        ),
        definition: false,
    }
}

fn on_action_timing(on_action: &str) -> ScriptTiming {
    if at_generation(on_action) {
        ScriptTiming::Generation
    } else if at_day_one(on_action) {
        ScriptTiming::DayOne
    } else {
        ScriptTiming::Later
    }
}

/// An event is as early as the earliest thing that fires it. `claimed` says
/// the game-start walk reached it inside day one, which an event chained out
/// of `on_game_start` is not otherwise known by.
fn event_timing(callers: &[String], claimed: bool) -> ScriptTiming {
    if callers.iter().any(|c| at_generation(c)) {
        ScriptTiming::Generation
    } else if claimed || callers.iter().any(|c| at_day_one(c)) {
        ScriptTiming::DayOne
    } else {
        ScriptTiming::Later
    }
}

/// Strongest first: a row is as early as its earliest site.
fn timing_rank(timing: ScriptTiming) -> usize {
    match timing {
        ScriptTiming::Generation => 0,
        ScriptTiming::DayOne => 1,
        ScriptTiming::Later => 2,
        ScriptTiming::Unknown => 3,
    }
}

fn via_of(verb: &str, fallback: ReferenceVia) -> ReferenceVia {
    match verb {
        "has_star_flag" | "remove_star_flag" => ReferenceVia::StarFlag,
        "has_global_flag" => ReferenceVia::GlobalFlag,
        EVENT_TARGET => ReferenceVia::EventTarget,
        _ => fallback,
    }
}

fn fired_by(callers: &[String]) -> Option<String> {
    let mut distinct: Vec<&str> = Vec::new();
    for caller in callers {
        if !distinct.contains(&caller.as_str()) {
            distinct.push(caller);
        }
    }
    (!distinct.is_empty()).then(|| distinct.join(", "))
}

fn kind_rank(kind: ScriptRowKind) -> usize {
    ROW_KIND_ORDER
        .iter()
        .position(|k| *k == kind)
        .unwrap_or(ROW_KIND_ORDER.len())
}

/// The first meaningful line of a scenario `effect` block, for the row title.
fn summarise(text: &str) -> String {
    let first = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#'))
        .unwrap_or_default();
    first.chars().take(80).collect()
}
