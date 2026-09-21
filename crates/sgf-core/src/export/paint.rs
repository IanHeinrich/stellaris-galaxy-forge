//! The Paint a Galaxy profile, laid over a plain draft: the header its companion mod
//! sizes its fixes by, its spawn idiom on every spawn system, its random-list
//! initializer on the empty systems around them and its flags on wormhole pairs.
//! Everything written here is what
//! `generate_galaxy_txt.ts` in the app writes for the same map, so the mod treats the
//! file as one it painted.
//!
//! A save's fallen empires are not copied: the mod rebuilds each one at game start in a
//! typed zone, so their clusters are left out and a zone of the right kind is centred
//! on each old capital, anchored to a system created for it. The kept systems that had
//! a lane into the cluster are linked to the zone by a custom connection, so the mod
//! lays the fallen empire's hyperlanes where the save had them.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use crate::as_u32;
use crate::emit::{coord, rounded};
use crate::export::policy::Category;
use crate::export::{Draft, ExportReport, FallenEmpireReport, SpawnDraft, SystemDraft, report};
use crate::format::scenario::emit::{ScenarioOptions, VANILLA_SHAPES};
use crate::format::scenario::fe_link::{self, FeLinkFlags, LINK_REACH, MOST_IDS, TO_PREFIX};
use crate::format::scenario::fe_zone::{self, FeDirection, FeKind, FeZone, Site};
use crate::format::scenario::header_counts::{SeatCounts, fallen_count, seat_entries};
use crate::format::scenario::marauder::{self, MarauderRole};
use crate::format::scenario::paint::{
    AUTOMATIC_INITIALIZER_FLAG, EMPIRE_CLUSTER, HEADER_NOTE, RL_BASIC, UNE_FLAG,
    WORMHOLE_FLAG_PREFIX, basic_initializer,
};
use crate::keys::scenario as keys;
use crate::projections::galaxy::{
    BypassLink, Galaxy, GalaxyGraph, GameSetup, PaintSpawnKind, SpawnScript,
};
use crate::search::NameResolver;

const SET_STAR_FLAG: &str = "set_star_flag";
/// How many lane jumps from a spawn an empty system is given [`RL_BASIC`].
const NEIGHBOURHOOD: usize = 2;
/// The `RANDOM_VALUE` a spawn system's weight is varied by cycles through this many.
const RANDOM_VALUES: usize = 10;
/// The most wormhole pairs and gateways the header allows unless the save asked for more.
const BYPASS_MAX: u32 = 5;
const FALLEN_EMPIRE: &str = "fallen_empire";
const AWAKENED_FALLEN_EMPIRE: &str = "awakened_fallen_empire";
/// How far from a fallen empire's capital its unowned systems (the holy worlds) reach.
const CLUSTER_REACH: f64 = 120.0;
/// How far a created anchor keeps from every system the draft holds.
const ANCHOR_CLEARANCE: f64 = 20.0;
/// The distances an anchor is tried at, nearest first with the mod's default ahead.
const ANCHOR_DISTANCES: [u16; 18] = [
    40, 50, 30, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200,
];
/// How far from the capital the fallback looks for an existing anchor.
const FALLBACK_REACH: f64 = 200.0;
/// The mod's own table (`events/painted_galaxy_fe.txt`): a capital's initializer prefix
/// names the fallen empire's kind.
const FE_KINDS: [(&str, FeKind); 6] = [
    ("fallen_machine", FeKind::Machine),
    ("fallen_hive", FeKind::Hive),
    ("fallen_1", FeKind::Materialist),
    ("fallen_2", FeKind::Spiritualist),
    ("fallen_3", FeKind::Xenophile),
    ("fallen_4", FeKind::Xenophobe),
];

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
    let typed = place_fallen_empires(draft, report, graph, &spawns, resolve);
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

/// What the header's counts are sized from: the seats, the zones, and either the save's
/// setup screen or the band on the system count.
pub(super) struct HeaderCounts {
    seats: SeatCounts,
    /// `num_empire_default`, `advanced_empire_default` and `nomad_empire_default` as
    /// the setup asked, or `None` for the seats' shares.
    empires: Option<[u32; 3]>,
    fallen_max: u32,
    fallen_default: u32,
    marauders: u32,
    crisis: &'static str,
    wormhole_pairs: u32,
    gateways: u32,
    hyperlanes: f64,
    colonizable_planet_odds: f64,
    primitive_odds: f64,
    /// The shape listed first.
    shape: Option<String>,
}

impl HeaderCounts {
    /// Sized by the map alone: `seats`, `zones` fallen empire zones, and the band on
    /// `systems` for the rest.
    pub(super) fn sized(systems: usize, seats: SeatCounts, zones: u32, clans: u32) -> Self {
        let (fallen, crisis) = size_band(systems);
        let fallen_max = fallen_count(zones);
        Self {
            seats,
            empires: None,
            fallen_max,
            fallen_default: fallen.min(fallen_max),
            marauders: clans,
            crisis,
            wormhole_pairs: 1,
            gateways: 1,
            hyperlanes: 1.0,
            colonizable_planet_odds: 1.0,
            primitive_odds: 1.0,
            shape: None,
        }
    }

    /// Sized by the save's setup screen: its counts and odds as set, `typed` fallen
    /// empires as the default, and the marauder `clans` whose homes the map holds.
    fn from_setup(
        setup: &GameSetup,
        systems: usize,
        seats: SeatCounts,
        typed: u32,
        zones: u32,
        clans: u32,
    ) -> Self {
        let sized = Self::sized(systems, seats, zones, clans);
        Self {
            empires: Some([
                setup.num_empires,
                setup.num_advanced_empires,
                setup.num_nomad_empires,
            ]),
            fallen_default: typed.min(sized.fallen_max),
            wormhole_pairs: setup.num_wormhole_pairs,
            gateways: setup.num_gateways,
            hyperlanes: setup.num_hyperlanes,
            colonizable_planet_odds: setup.habitability,
            primitive_odds: setup.primitive,
            shape: Some(setup.shape.clone()),
            ..sized
        }
    }
}

/// The header for `counts`, on Forge's own `core_radius`.
pub(super) fn header(options: &ScenarioOptions, counts: &HeaderCounts) -> Vec<u8> {
    let mut entries = seat_entries(counts.seats);
    if let Some([empires, advanced, nomads]) = counts.empires {
        let most = counts.seats.most();
        let safe = counts.seats.safe();
        for (key, value) in &mut entries {
            let count = match *key {
                keys::NUM_EMPIRE_DEFAULT => empires.min(safe),
                keys::ADVANCED_EMPIRE_DEFAULT => advanced.min(most),
                keys::NOMAD_EMPIRE_DEFAULT => nomads.min(most),
                _ => continue,
            };
            *value = count.to_string();
        }
    }
    let seats: String = entries
        .iter()
        .map(|(key, value)| format!("\t{key} = {value}\n"))
        .collect();
    let shapes: String = shapes(counts.shape.as_deref())
        .iter()
        .map(|shape| format!("\tsupports_shape = {shape}\n"))
        .collect();
    format!(
        "# Written by Stellaris Galaxy Forge {HEADER_NOTE} (Steam Workshop 3532904115), which this map requires.\n\
         static_galaxy_scenario = {{\n\
         \tname = \"{}\"\n\
         \tpriority = 10\n\
         {shapes}\
         \trandom_hyperlanes = no\n\
         \tnum_wormhole_pairs = {{ min = 0 max = {} }}\n\
         \tnum_wormhole_pairs_default = {}\n\
         \tnum_gateways = {{ min = 0 max = {} }}\n\
         \tnum_gateways_default = {}\n\
         \tnum_hyperlanes = {{ min = 0.5 max = 3 }}\n\
         \tnum_hyperlanes_default = {}\n\
         \tcolonizable_planet_odds = {}\n\
         \tprimitive_odds = {}\n\
         \tfallen_empire_max = {}\n\
         \tmarauder_empire_max = {}\n\
         \textra_crisis_strength = {{ 10 25 }}\n\
         {seats}\
         \tfallen_empire_default = {}\n\
         \tmarauder_empire_default = {}\n\
         \tcrisis_strength = {}\n\
         \tcore_radius = {}\n\
         \n",
        options.name,
        BYPASS_MAX.max(counts.wormhole_pairs),
        counts.wormhole_pairs,
        BYPASS_MAX.max(counts.gateways),
        counts.gateways,
        coord(counts.hyperlanes),
        odds(counts.colonizable_planet_odds),
        odds(counts.primitive_odds),
        counts.fallen_max,
        counts.marauders,
        counts.fallen_default,
        counts.marauders,
        counts.crisis,
        coord(options.core_radius)
    )
    .into_bytes()
}

/// The vanilla shapes in the game's order, `first` ahead of the rest when it is one.
pub(super) fn shapes(first: Option<&str>) -> Vec<&'static str> {
    let mut shapes: Vec<&'static str> = VANILLA_SHAPES.to_vec();
    if let Some(i) = first.and_then(|first| shapes.iter().position(|shape| *shape == first)) {
        let shape = shapes.remove(i);
        shapes.insert(0, shape);
    }
    shapes
}

/// An odds value as the header writes it: `1.0`, `0.25`.
fn odds(value: f64) -> String {
    if value == value.trunc() {
        format!("{value:.1}")
    } else {
        coord(value)
    }
}

/// Fallen empires and crisis strength by galaxy size.
fn size_band(systems: usize) -> (u32, &'static str) {
    match systems {
        1000.. => (4, "1.5"),
        800.. => (3, "1.25"),
        600.. => (2, "1.0"),
        400.. => (1, "0.75"),
        _ => (0, "0.5"),
    }
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

/// A fallen empire as the save holds it: where its capital stands in the draft, which
/// kind the mod should rebuild there, and the systems to leave out for it.
struct FallenEmpire {
    name: String,
    capital: (f64, f64),
    kind: FeKind,
    cluster: BTreeSet<u32>,
}

/// Every fallen empire with a capital the draft holds, ascending by country id. A
/// cluster is the capital, every system the country owns, every fallen empire system
/// within [`CLUSTER_REACH`] of the capital, and every generic system inside the ring
/// the mod fills at the capital; a playable capital or a system in an earlier cluster
/// is never taken.
fn fallen_empires(
    draft: &Draft,
    graph: &GalaxyGraph,
    spawns: &BTreeSet<u32>,
    resolve: NameResolver<'_>,
) -> Vec<FallenEmpire> {
    let categories = report::categories(graph);
    let positions: HashMap<u32, (f64, f64)> = draft
        .systems
        .iter()
        .map(|system| (system.id, (system.x, system.y)))
        .collect();
    let mut countries: Vec<_> = graph
        .countries
        .iter()
        .filter(|country| {
            matches!(
                country.country_type.as_str(),
                FALLEN_EMPIRE | AWAKENED_FALLEN_EMPIRE
            )
        })
        .collect();
    countries.sort_by_key(|country| country.id);
    let mut claimed: HashSet<u32> = HashSet::new();
    let mut empires = Vec::new();
    for country in countries {
        let Some(capital) = country
            .capital_system
            .and_then(|id| positions.get(&id).map(|at| (id, *at)))
        else {
            continue;
        };
        let (capital_id, at) = capital;
        let seat = &graph.systems[&capital_id];
        let cluster: BTreeSet<u32> = draft
            .systems
            .iter()
            .filter(|system| {
                let node = &graph.systems[&system.id];
                let position = (system.x, system.y);
                let near = fe_zone::distance(position, at) <= CLUSTER_REACH;
                system.id == capital_id
                    || node.owner == Some(country.id)
                    || match categories.get(&system.id) {
                        Some(Category::FallenEmpire) => near,
                        Some(Category::Generic) => fe_zone::inside(at, position),
                        _ => false,
                    }
            })
            .map(|system| system.id)
            .filter(|id| !spawns.contains(id) && !claimed.contains(id))
            .collect();
        claimed.extend(cluster.iter().copied());
        empires.push(FallenEmpire {
            name: super::name_of(&country.name, resolve),
            capital: at,
            kind: fallen_kind(&seat.initializer),
            cluster,
        });
    }
    empires
}

/// The kind the mod's own table gives a capital's initializer, `Random` for one it does
/// not list.
fn fallen_kind(initializer: &str) -> FeKind {
    FE_KINDS
        .iter()
        .find(|(prefix, _)| initializer.starts_with(prefix))
        .map_or(FeKind::Random, |(_, kind)| *kind)
}

/// Leave out each fallen empire's cluster and centre a typed, preferred zone on its old
/// capital: on an anchor created for it where the old spot is clear, else on the
/// existing system whose nearest clear grid position lies closest. The kept systems
/// with a lane into the cluster are linked to the zone, under the ids 0, 1, 2… in
/// fallen empire order. Returns the zones placed, keyed by anchor.
fn place_fallen_empires(
    draft: &mut Draft,
    report: &mut ExportReport,
    graph: &GalaxyGraph,
    spawns: &BTreeSet<u32>,
    resolve: NameResolver<'_>,
) -> BTreeMap<u32, FeZone> {
    let mut typed: BTreeMap<u32, FeZone> = BTreeMap::new();
    let mut centres: Vec<(f64, f64)> = Vec::new();
    let mut next_id = draft
        .systems
        .iter()
        .map(|system| system.id)
        .max()
        .map_or(0, |id| id + 1);
    let empires = fallen_empires(draft, graph, spawns, resolve);
    let clustered: HashSet<u32> = empires
        .iter()
        .flat_map(|empire| empire.cluster.iter().copied())
        .collect();
    let mut next_link: u8 = 0;
    for empire in empires {
        draft
            .systems
            .retain(|system| !empire.cluster.contains(&system.id));
        let neighbours = cluster_neighbours(draft, &empire.cluster, &clustered);
        leave_out_lanes(draft, &empire.cluster);
        let placed = match anchor_position(draft, empire.capital, &centres) {
            Some((at, direction, distance)) => {
                let id = next_id;
                next_id += 1;
                let zone = typed_zone(direction, distance, empire.kind);
                let mut anchor = SystemDraft {
                    id,
                    name: String::new(),
                    x: at.0,
                    y: at.1,
                    initializer: Some(RL_BASIC.to_owned()),
                    spawn: SpawnDraft::None,
                    effect: None,
                };
                add_flags(&mut anchor, [AUTOMATIC_INITIALIZER_FLAG.to_owned()]);
                add_flags(&mut anchor, fe_zone::flags(&zone));
                if let Some(nearest) = nearest_system(draft, at) {
                    draft.lanes.push((nearest.min(id), nearest.max(id)));
                }
                draft.systems.push(anchor);
                centres.push(empire.capital);
                typed.insert(id, zone);
                Some((id, true))
            }
            None => fallback_zone(draft, &empire, &typed, &centres).map(|(id, zone)| {
                let index = draft
                    .systems
                    .iter()
                    .position(|system| system.id == id)
                    .expect("the fallback anchor is in the draft");
                let anchor = &mut draft.systems[index];
                centres.push(fe_zone::centre((anchor.x, anchor.y), &zone));
                add_flags(anchor, fe_zone::flags(&zone));
                typed.insert(id, zone);
                (id, false)
            }),
        };
        let links = match placed {
            Some((anchor, _)) if !neighbours.is_empty() && next_link < MOST_IDS => {
                let centre = *centres.last().expect("the placed zone's centre");
                let near = within_reach(draft, &neighbours, centre);
                link_neighbours(draft, anchor, &near, next_link);
                next_link += 1;
                as_u32(near.len())
            }
            _ => 0,
        };
        report.fallen_empires.push(FallenEmpireReport {
            name: empire.name,
            kind: empire.kind,
            systems_left_out: as_u32(empire.cluster.len()),
            anchor: placed.map(|(id, _)| id),
            exact: placed.is_some_and(|(_, exact)| exact),
            links,
        });
    }
    draft.lanes.sort_unstable();
    draft.lanes.dedup();
    typed
}

/// The kept systems with a lane into `cluster`, ascending: in no cluster at all, so
/// the flag written on one stays in the file.
fn cluster_neighbours(
    draft: &Draft,
    cluster: &BTreeSet<u32>,
    clustered: &HashSet<u32>,
) -> BTreeSet<u32> {
    draft
        .lanes
        .iter()
        .filter_map(
            |&(a, b)| match (cluster.contains(&a), cluster.contains(&b)) {
                (true, false) => Some(b),
                (false, true) => Some(a),
                _ => None,
            },
        )
        .filter(|id| !clustered.contains(id))
        .collect()
}

/// The neighbours worth linking: those within the mod's own reach of the zone's centre
/// whose lane to the ring would cross no kept lane, or the nearest one when none is. The
/// old cluster reached up to [`CLUSTER_REACH`] out and the new one stays inside its ring,
/// so a lane to the far side of the old cluster would cross empty space and other lanes,
/// which the game's own generator never lays.
fn within_reach(draft: &Draft, neighbours: &BTreeSet<u32>, centre: (f64, f64)) -> BTreeSet<u32> {
    let at = |id: u32| {
        draft
            .systems
            .iter()
            .find(|system| system.id == id)
            .map(|system| (system.x, system.y))
    };
    let mut by_distance: Vec<(f64, u32, (f64, f64))> = neighbours
        .iter()
        .filter_map(|&id| at(id).map(|point| (fe_zone::distance(point, centre), id, point)))
        .collect();
    by_distance.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    let crosses_a_lane = |id: u32, from: (f64, f64)| {
        let reach = fe_zone::distance(from, centre);
        let t = (reach - fe_zone::FE_ZONE_RADIUS).max(0.0) / reach;
        let to = (
            from.0 + (centre.0 - from.0) * t,
            from.1 + (centre.1 - from.1) * t,
        );
        draft.lanes.iter().any(|&(a, b)| {
            a != id
                && b != id
                && at(a)
                    .zip(at(b))
                    .is_some_and(|(p, q)| segments_cross(from, to, p, q))
        })
    };
    let near: BTreeSet<u32> = by_distance
        .iter()
        .filter(|(distance, id, from)| *distance <= LINK_REACH && !crosses_a_lane(*id, *from))
        .map(|(_, id, _)| *id)
        .collect();
    if near.is_empty() {
        by_distance
            .first()
            .map(|(_, id, _)| *id)
            .into_iter()
            .collect()
    } else {
        near
    }
}

/// Whether the open segments `a`–`b` and `c`–`d` cross.
fn segments_cross(a: (f64, f64), b: (f64, f64), c: (f64, f64), d: (f64, f64)) -> bool {
    let side = |p: (f64, f64), q: (f64, f64), r: (f64, f64)| {
        (q.0 - p.0) * (r.1 - p.1) - (q.1 - p.1) * (r.0 - p.0)
    };
    let (s1, s2) = (side(c, d, a), side(c, d, b));
    let (s3, s4) = (side(a, b, c), side(a, b, d));
    (s1 > 0.0) != (s2 > 0.0) && (s3 > 0.0) != (s4 > 0.0)
}

/// The anchor takes custom connections under `id` and each of `neighbours` links to it.
fn link_neighbours(draft: &mut Draft, anchor: u32, neighbours: &BTreeSet<u32>, id: u8) {
    let link = FeLinkFlags {
        custom: true,
        id: Some(id),
        to: Vec::new(),
    };
    for system in &mut draft.systems {
        if system.id == anchor {
            add_flags(system, fe_link::flags(&link));
        } else if neighbours.contains(&system.id) {
            add_flags(system, [format!("{TO_PREFIX}{id}")]);
        }
    }
}

/// Drop every lane into `cluster`; a kept system that loses its last lane gets one to
/// its nearest kept system, so leaving a cluster out strands nothing.
fn leave_out_lanes(draft: &mut Draft, cluster: &BTreeSet<u32>) {
    let mut touched: BTreeSet<u32> = BTreeSet::new();
    draft.lanes.retain(|&(a, b)| {
        let dropped = cluster.contains(&a) || cluster.contains(&b);
        if dropped {
            touched.extend([a, b].into_iter().filter(|id| !cluster.contains(id)));
        }
        !dropped
    });
    let linked: HashSet<u32> = draft.lanes.iter().flat_map(|&(a, b)| [a, b]).collect();
    for id in touched.into_iter().filter(|id| !linked.contains(id)) {
        let Some(at) = draft
            .systems
            .iter()
            .find(|system| system.id == id)
            .map(|system| (system.x, system.y))
        else {
            continue;
        };
        let nearest = draft
            .systems
            .iter()
            .filter(|system| system.id != id)
            .map(|system| (fe_zone::distance((system.x, system.y), at), system.id))
            .min_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        if let Some((_, to)) = nearest {
            draft.lanes.push((id.min(to), id.max(to)));
        }
    }
}

/// Where to create the anchor whose zone is centred on `capital`: the first distance
/// of [`ANCHOR_DISTANCES`] with a direction whose anchor lies on the map, clear of every
/// system by [`ANCHOR_CLEARANCE`] and outside every ring, and among those directions the
/// one farthest from its nearest system. `None` when the ring at `capital` is not clear.
fn anchor_position(
    draft: &Draft,
    capital: (f64, f64),
    placed: &[(f64, f64)],
) -> Option<((f64, f64), FeDirection, u16)> {
    let systems: Vec<(f64, f64)> = draft
        .systems
        .iter()
        .map(|system| (system.x, system.y))
        .collect();
    let ring_clear = !fe_zone::is_off_map(capital)
        && !systems.iter().any(|&at| fe_zone::inside(capital, at))
        && !placed
            .iter()
            .any(|&other| fe_zone::overlaps(capital, other));
    if !ring_clear {
        return None;
    }
    let rings = || placed.iter().copied().chain(std::iter::once(capital));
    ANCHOR_DISTANCES.into_iter().find_map(|distance| {
        let mut best: Option<((f64, f64), FeDirection, f64)> = None;
        for direction in FeDirection::ALL {
            let zone = typed_zone(direction, distance, FeKind::Random);
            let (dx, dy) = fe_zone::centre((0.0, 0.0), &zone);
            let anchor = (rounded(capital.0 - dx), rounded(capital.1 - dy));
            let nearest = systems
                .iter()
                .map(|&at| fe_zone::distance(anchor, at))
                .fold(f64::INFINITY, f64::min);
            let clear = !fe_zone::is_off_map(anchor)
                && nearest >= ANCHOR_CLEARANCE
                && !rings().any(|centre| fe_zone::inside(centre, anchor));
            if clear && best.is_none_or(|(_, _, farthest)| nearest > farthest) {
                best = Some((anchor, direction, nearest));
            }
        }
        best.map(|(anchor, direction, _)| (anchor, direction, distance))
    })
}

/// The zone nearest the old capital over the existing systems within
/// [`FALLBACK_REACH`] of it, when its own spot is not clear.
fn fallback_zone(
    draft: &Draft,
    empire: &FallenEmpire,
    typed: &BTreeMap<u32, FeZone>,
    placed: &[(f64, f64)],
) -> Option<(u32, FeZone)> {
    let sites: Vec<Site<'_>> = draft
        .systems
        .iter()
        .map(|system| Site {
            id: system.id,
            x: system.x,
            y: system.y,
            zone: typed.get(&system.id),
            linked: false,
        })
        .collect();
    let anchors: Vec<Site<'_>> = sites
        .iter()
        .filter(|site| fe_zone::distance((site.x, site.y), empire.capital) <= FALLBACK_REACH)
        .copied()
        .collect();
    fe_zone::nearest_zone(empire.capital, empire.kind, &anchors, &sites, placed)
}

fn typed_zone(direction: FeDirection, distance: u16, kind: FeKind) -> FeZone {
    FeZone {
        direction,
        kind,
        distance,
        preferred: true,
        fallback: false,
    }
}

/// The system of the draft closest to `at`, the lower id on a tie.
fn nearest_system(draft: &Draft, at: (f64, f64)) -> Option<u32> {
    draft
        .systems
        .iter()
        .map(|system| (fe_zone::distance((system.x, system.y), at), system.id))
        .min_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)))
        .map(|(_, id)| id)
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
                    random_value: (i % RANDOM_VALUES) as u8,
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

fn add_flags(system: &mut SystemDraft, flags: impl IntoIterator<Item = String>) {
    let effect = system.effect.get_or_insert_with(String::new);
    for flag in flags {
        if !effect.is_empty() {
            effect.push(' ');
        }
        effect.push_str(&format!("{SET_STAR_FLAG} = {flag}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> ScenarioOptions {
        ScenarioOptions {
            name: "sgf_paint".into(),
            core_radius: 30.0,
            num_empires: (0, 1),
            exported_from: None,
        }
    }

    fn seats(seats: u32, reserved: u32, player_on_reserved: bool) -> SeatCounts {
        SeatCounts {
            seats,
            reserved,
            player_on_reserved,
        }
    }

    fn header_text(systems: usize, spawns: u32, zones: u32) -> String {
        let counts = HeaderCounts::sized(systems, seats(spawns, 0, false), zones, 2);
        String::from_utf8(header(&options(), &counts)).unwrap()
    }

    #[test]
    fn the_header_counts_empires_from_the_spawns_and_sizes_the_rest_by_systems() {
        let text = header_text(791, 12, 4);
        assert!(text.starts_with("# Written by Stellaris Galaxy Forge"));
        assert!(text.contains("\tfallen_empire_max = 4\n"), "{text}");
        assert!(text.contains("\tnum_empires = { min = 0 max = 11 }\n\tnum_empire_default = 6\n\tadvanced_empire_default = 1\n\tnomad_empire_default = 1\n\tnomad_empire_max = 11\n\tfallen_empire_default = 2\n\tmarauder_empire_default = 2\n\tcrisis_strength = 1.0\n\tcore_radius = 30\n"), "{text}");
        assert_eq!(text.matches("\tsupports_shape = ").count(), 10);
        assert!(
            text.contains("\tnum_wormhole_pairs = { min = 0 max = 5 }\n\tnum_wormhole_pairs_default = 1\n\tnum_gateways = { min = 0 max = 5 }\n\tnum_gateways_default = 1\n\tnum_hyperlanes = { min = 0.5 max = 3 }\n\tnum_hyperlanes_default = 1\n\tcolonizable_planet_odds = 1.0\n\tprimitive_odds = 1.0\n"),
            "{text}"
        );

        let none = header_text(0, 0, 0);
        assert!(
            none.contains("\tnum_empires = { min = 0 max = 0 }\n"),
            "{none}"
        );
        assert!(none.contains("\tnomad_empire_max = 0\n"), "{none}");
        assert!(none.contains("\tfallen_empire_max = 0\n"), "{none}");
        assert!(none.contains("\tcrisis_strength = 0.5\n"), "{none}");

        let one = header_text(1000, 4, 1);
        assert!(one.contains("\tfallen_empire_max = 1\n"), "{one}");
        assert!(one.contains("\tfallen_empire_default = 1\n"), "{one}");
        let many = header_text(1000, 4, 9);
        assert!(many.contains("\tfallen_empire_max = 6\n"), "{many}");
        assert!(many.contains("\tfallen_empire_default = 4\n"), "{many}");

        for (systems, band) in [
            (
                399,
                "fallen_empire_default = 0\n\tmarauder_empire_default = 2\n\tcrisis_strength = 0.5",
            ),
            (
                400,
                "fallen_empire_default = 1\n\tmarauder_empire_default = 2\n\tcrisis_strength = 0.75",
            ),
            (
                600,
                "fallen_empire_default = 2\n\tmarauder_empire_default = 2\n\tcrisis_strength = 1.0",
            ),
            (
                800,
                "fallen_empire_default = 3\n\tmarauder_empire_default = 2\n\tcrisis_strength = 1.25",
            ),
            (
                1000,
                "fallen_empire_default = 4\n\tmarauder_empire_default = 2\n\tcrisis_strength = 1.5",
            ),
        ] {
            assert!(header_text(systems, 4, 6).contains(band), "{systems}");
        }
    }

    #[test]
    fn a_setup_sets_the_defaults_and_odds_clamped_to_what_the_seats_allow() {
        let setup = GameSetup {
            template: "large".into(),
            shape: "spiral_4".into(),
            num_empires: 13,
            num_advanced_empires: 20,
            num_fallen_empires: 3,
            num_marauder_empires: 2,
            num_nomad_empires: 2,
            num_gateways: 7,
            num_wormhole_pairs: 1,
            num_hyperlanes: 0.75,
            primitive: 0.25,
            habitability: 0.5,
        };
        let counts = HeaderCounts::from_setup(&setup, 791, seats(17, 1, false), 3, 9, 2);
        let text = String::from_utf8(header(&options(), &counts)).unwrap();
        assert!(
            text.contains("\tpriority = 10\n\tsupports_shape = spiral_4\n\tsupports_shape = elliptical\n\tsupports_shape = ring\n\tsupports_shape = spiral_2\n\tsupports_shape = spiral_3\n\tsupports_shape = spiral_6\n"),
            "{text}"
        );
        assert_eq!(text.matches("\tsupports_shape = ").count(), 10);
        assert!(
            text.contains("\tnum_wormhole_pairs = { min = 0 max = 5 }\n\tnum_wormhole_pairs_default = 1\n\tnum_gateways = { min = 0 max = 7 }\n\tnum_gateways_default = 7\n\tnum_hyperlanes = { min = 0.5 max = 3 }\n\tnum_hyperlanes_default = 0.75\n\tcolonizable_planet_odds = 0.5\n\tprimitive_odds = 0.25\n\tfallen_empire_max = 6\n"),
            "{text}"
        );
        assert!(
            text.contains("\tnum_empires = { min = 0 max = 16 }\n\tnum_empire_default = 13\n\tadvanced_empire_default = 16\n\tnomad_empire_default = 2\n\tnomad_empire_max = 16\n\tfallen_empire_default = 3\n\tmarauder_empire_default = 2\n\tcrisis_strength = 1.0\n"),
            "{text}"
        );

        let crowded = HeaderCounts::from_setup(&setup, 300, seats(4, 3, false), 0, 0, 0);
        let text = String::from_utf8(header(&options(), &crowded)).unwrap();
        assert!(
            text.contains("\tnum_empires = { min = 0 max = 3 }\n\tnum_empire_default = 0\n\tadvanced_empire_default = 3\n\tnomad_empire_default = 2\n\tnomad_empire_max = 3\n\tfallen_empire_default = 0\n\tmarauder_empire_default = 0\n\tcrisis_strength = 0.5\n"),
            "{text}"
        );
        assert!(text.contains("\tfallen_empire_max = 0\n"), "{text}");
    }

    #[test]
    fn a_capitals_initializer_names_the_fallen_empires_kind() {
        assert_eq!(fallen_kind("fallen_1"), FeKind::Materialist);
        assert_eq!(fallen_kind("fallen_1_2"), FeKind::Materialist);
        assert_eq!(fallen_kind("fallen_2"), FeKind::Spiritualist);
        assert_eq!(fallen_kind("fallen_3"), FeKind::Xenophile);
        assert_eq!(fallen_kind("fallen_4"), FeKind::Xenophobe);
        assert_eq!(fallen_kind("fallen_machine"), FeKind::Machine);
        assert_eq!(fallen_kind("fallen_hive"), FeKind::Hive);
        assert_eq!(fallen_kind("fallen_col_1"), FeKind::Random);
        assert_eq!(fallen_kind(""), FeKind::Random);
    }
}
