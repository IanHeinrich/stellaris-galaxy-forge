//! The Paint a Galaxy profile, laid over a plain draft: the header its companion mod
//! sizes its fixes by, its spawn idiom on every spawn system, its random-list
//! initializer on the empty systems around them and its flags on wormhole pairs.
//! Everything written here is what
//! `generate_galaxy_txt.ts` in the app writes for the same map, so the mod treats the
//! file as one it painted.

mod fallen;
mod header;

use std::collections::{BTreeSet, HashMap, HashSet};

pub(super) use header::{HeaderCounts, header};

use crate::as_u32;
use crate::export::{Draft, ExportReport, SpawnDraft, SystemDraft, report};
use crate::format::scenario::emit::ScenarioOptions;
use crate::format::scenario::fe_zone::SET_STAR_FLAG;
use crate::format::scenario::header_counts::SeatCounts;
use crate::format::scenario::marauder::{self, MarauderRole};
use crate::format::scenario::paint::{
    AUTOMATIC_INITIALIZER_FLAG, EMPIRE_CLUSTER, RL_BASIC, SEAT_MODULO, UNE_FLAG,
    WORMHOLE_FLAG_PREFIX, basic_initializer,
};
use crate::projections::galaxy::{BypassLink, Galaxy, GalaxyGraph, PaintSpawnKind, SpawnScript};
use crate::search::NameResolver;

/// How many lane jumps from a spawn an empty system is given [`RL_BASIC`].
const NEIGHBOURHOOD: usize = 2;

/// Rewrite `draft` in Paint a Galaxy's shape: each fallen empire's cluster is left out
/// for a typed zone at its old capital; the spawn systems are the capitals of the
/// playable countries and every system already marked as a spawn, the player's capital
/// as the player's seat; a seat the plain profile wrote anywhere else is cleared. `report`
/// gains what the profile did, and drops only the wormhole pairs it could not flag.
pub(super) fn decorate(
    draft: &mut Draft,
    report: &mut ExportReport,
    options: &ScenarioOptions,
    graph: &GalaxyGraph,
    resolve: NameResolver<'_>,
) {
    let spawns = spawn_systems(graph);
    let typed = fallen::place_fallen_empires(draft, report, graph, &spawns, resolve);
    for system in &mut draft.systems {
        system.spawn = SpawnDraft::None;
    }
    mark_spawns(draft, report, graph, &spawns, player_seat(graph));
    fill_neighbours(draft, &spawns);
    report.dropped.wormhole_pairs = flag_wormholes(draft, &graph.bypasses);
    // Only the zones the save's own fallen empires ask for: the map is not filled with
    // the mod's candidates, which "Fit fallen empire zones" places on request.
    report.fallen_empire_zones = 0;

    let scripts = draft
        .systems
        .iter()
        .filter_map(|system| match &system.spawn {
            SpawnDraft::Script(script) => Some(script),
            _ => None,
        });
    let seats = SeatCounts::from_scripts(as_u32(spawns.len()), scripts);
    let all_zones = as_u32(typed.len());
    let clans = clan_count(draft);
    let counts = match &graph.setup {
        Some(setup) => HeaderCounts::from_setup(
            setup,
            draft.systems.len(),
            seats,
            as_u32(typed.len()),
            all_zones,
            clans,
        ),
        None => HeaderCounts::sized(draft.systems.len(), seats, all_zones, clans),
    };
    report.setup_from_save = graph.setup.is_some();
    draft.header = header(options, &counts);
}

/// The capitals of the playable countries and every system marked as a spawn already,
/// ascending.
fn spawn_systems(graph: &GalaxyGraph) -> BTreeSet<u32> {
    let mut spawns = report::capitals(graph);
    spawns.extend(
        graph
            .systems
            .values()
            .filter(|system| {
                system.spawn_script.is_some() || system.spawn_weight.is_some_and(|w| w > 0.0)
            })
            .map(|system| system.id),
    );
    spawns
}

/// The capital of the player's country, when the save names one, and the seat it
/// takes: the Sol seat when the country carries the United Nations of Earth's flag,
/// which only that empire weighs above zero, else a preferred seat.
fn player_seat(graph: &GalaxyGraph) -> Option<(u32, PaintSpawnKind)> {
    let player = graph.player_country?;
    let country = graph
        .countries
        .iter()
        .find(|country| country.id == player)?;
    let kind = if country.flags.iter().any(|flag| flag == UNE_FLAG) {
        PaintSpawnKind::Sol
    } else {
        PaintSpawnKind::Preferred
    };
    Some((country.capital_system?, kind))
}

/// The marauder clans whose home systems the draft holds: the most the game can spawn.
fn clan_count(draft: &Draft) -> u32 {
    let clans: BTreeSet<u8> = draft
        .systems
        .iter()
        .filter_map(|system| system.initializer.as_deref())
        .filter_map(|initializer| match marauder::role(initializer) {
            Some(MarauderRole::Home(clan)) => Some(clan),
            _ => None,
        })
        .collect();
    as_u32(clans.len())
}

/// Each spawn system gets the enabled seat with the next random value, the player's
/// capital the player's seat of `player`'s kind, or keeps the script it already
/// carries. The Sol seat is certain for the United Nations of Earth, since every other
/// empire weighs it at zero; a preferred seat is only the likeliest start, since an
/// empire whose origin needs special placement is seated before the player. A seat
/// with no initializer, or one the report says to review, gets a generic start.
fn mark_spawns(
    draft: &mut Draft,
    report: &mut ExportReport,
    galaxy: &Galaxy,
    spawns: &BTreeSet<u32>,
    player: Option<(u32, PaintSpawnKind)>,
) {
    let seat: HashMap<u32, usize> = spawns.iter().enumerate().map(|(i, &id)| (id, i)).collect();
    let review: HashSet<u32> = report
        .home_initializers
        .iter()
        .map(|home| home.system)
        .collect();
    for system in &mut draft.systems {
        let Some(&i) = seat.get(&system.id) else {
            continue;
        };
        let script = galaxy
            .systems
            .get(&system.id)
            .and_then(|s| s.spawn_script.clone())
            .unwrap_or_else(|| {
                let players = player.as_ref().filter(|(id, _)| *id == system.id);
                SpawnScript::PaintAGalaxy {
                    kind: players.map_or(PaintSpawnKind::Enabled, |(_, kind)| kind.clone()),
                    random_value: (i % usize::from(SEAT_MODULO)) as u8,
                    player: players.is_some(),
                }
            });
        system.spawn = SpawnDraft::Script(script);
        // The game seats no empire on a seat naming that empire's own initializer,
        // so the player's seat, whose empire brings its home, gets a generic one.
        let players = player.as_ref().is_some_and(|(id, _)| *id == system.id);
        if system.initializer.is_none() || review.contains(&system.id) || players {
            system.initializer = Some(basic_initializer(system.id).to_owned());
        }
    }
    for home in &mut report.home_initializers {
        home.replaced = seat.contains_key(&home.system);
    }
    let player = player.filter(|(id, _)| seat.contains_key(id));
    report.player_seat = player.as_ref().map(|(id, _)| *id);
    report.player_seat_kind = player.map(|(_, kind)| kind);
}

/// Every empty system within [`NEIGHBOURHOOD`] jumps of a spawn gets the mod's
/// random-list initializer and the flag that says the mod chose it.
fn fill_neighbours(draft: &mut Draft, spawns: &BTreeSet<u32>) {
    let mut adjacent: HashMap<u32, Vec<u32>> = HashMap::new();
    for &(a, b) in &draft.lanes {
        adjacent.entry(a).or_default().push(b);
        adjacent.entry(b).or_default().push(a);
    }
    let mut reached: HashSet<u32> = spawns.iter().copied().collect();
    let mut frontier: Vec<u32> = spawns.iter().copied().collect();
    for _ in 0..NEIGHBOURHOOD {
        let mut next = Vec::new();
        for id in frontier {
            for &to in adjacent.get(&id).map(Vec::as_slice).unwrap_or(&[]) {
                if reached.insert(to) {
                    next.push(to);
                }
            }
        }
        frontier = next;
    }
    for system in &mut draft.systems {
        if system.initializer.is_none()
            && reached.contains(&system.id)
            && !spawns.contains(&system.id)
        {
            system.initializer = Some(RL_BASIC.to_owned());
            add_flags(system, [AUTOMATIC_INITIALIZER_FLAG.to_owned()]);
        }
    }
}

/// Both ends of each wormhole pair are flagged with the pair's number and kept clear
/// of empires; a pair with an end the draft does not write is not a pair. Returns how
/// many pairs were left unflagged for that reason.
fn flag_wormholes(draft: &mut Draft, bypasses: &[BypassLink]) -> u32 {
    let index: HashMap<u32, usize> = draft
        .systems
        .iter()
        .enumerate()
        .map(|(i, system)| (system.id, i))
        .collect();
    let mut dropped = 0;
    let mut pairs = Vec::new();
    for link in bypasses {
        let BypassLink::Wormhole { a, b } = link else {
            continue;
        };
        match (index.get(a), index.get(b)) {
            (Some(&a), Some(&b)) => pairs.push((a, b)),
            _ => dropped += 1,
        }
    }
    for (n, (a, b)) in (1..).zip(pairs) {
        for end in [a, b] {
            add_flags(
                &mut draft.systems[end],
                [
                    format!("{WORMHOLE_FLAG_PREFIX}{n}"),
                    EMPIRE_CLUSTER.to_owned(),
                ],
            );
        }
    }
    dropped
}

pub(super) fn add_flags(system: &mut SystemDraft, flags: impl IntoIterator<Item = String>) {
    let effect = system.effect.get_or_insert_with(String::new);
    for flag in flags {
        if !effect.is_empty() {
            effect.push(' ');
        }
        effect.push_str(&format!("{SET_STAR_FLAG} = {flag}"));
    }
}
