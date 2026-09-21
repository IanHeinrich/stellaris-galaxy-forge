//! The Paint a Galaxy profile, laid over a plain draft: the header its companion mod
//! sizes its fixes by, its spawn idiom on every spawn system, its random-list
//! initializer on the empty systems around them, its flags on wormhole pairs, and the
//! fallen empire zones the mod itself would place. Everything written here is what
//! `generate_galaxy_txt.ts` in the app writes for the same map, so the mod treats the
//! file as one it painted.

use std::collections::{BTreeSet, HashMap, HashSet};

use crate::as_u32;
use crate::emit::coord;
use crate::export::{Draft, SpawnDraft, SystemDraft, report};
use crate::format::scenario::emit::ScenarioOptions;
use crate::format::scenario::fe_zone::{self, Site};
use crate::format::scenario::header_counts::{empire_counts, is_reserved};
use crate::format::scenario::paint::{
    AUTOMATIC_INITIALIZER_FLAG, EMPIRE_CLUSTER, HEADER_NOTE, RL_BASIC, WORMHOLE_FLAG_PREFIX,
    basic_initializer,
};
use crate::projections::galaxy::{BypassLink, Galaxy, GalaxyGraph, PaintSpawnKind, SpawnScript};

const SET_STAR_FLAG: &str = "set_star_flag";
/// How many lane jumps from a spawn an empty system is given [`RL_BASIC`].
const NEIGHBOURHOOD: usize = 2;
/// The `RANDOM_VALUE` a spawn system's weight is varied by cycles through this many.
const RANDOM_VALUES: usize = 10;

/// Rewrite `draft` in Paint a Galaxy's shape: the spawn systems are the capitals of
/// the playable countries and every system already marked as a spawn; a seat the plain
/// profile wrote anywhere else is cleared. Returns how many automatic fallen empire
/// zones were written.
pub(super) fn decorate(draft: &mut Draft, options: &ScenarioOptions, graph: &GalaxyGraph) -> u32 {
    let spawns = spawn_systems(graph);
    let reserved = spawns
        .iter()
        .filter(|id| graph.systems.get(id).is_some_and(is_reserved))
        .count();
    draft.header = header(options, draft.systems.len(), spawns.len(), reserved);
    for system in &mut draft.systems {
        system.spawn = SpawnDraft::None;
    }
    mark_spawns(draft, graph, &spawns);
    fill_neighbours(draft, &spawns);
    flag_wormholes(draft, &graph.bypasses);
    place_fe_zones(draft, graph)
}

/// The header for `systems` systems of which `spawns` are seats and `reserved` of those
/// are held for one empire, on Forge's own `core_radius`.
pub(super) fn header(
    options: &ScenarioOptions,
    systems: usize,
    spawns: usize,
    reserved: usize,
) -> Vec<u8> {
    let counts: String = empire_counts(as_u32(spawns), as_u32(reserved))
        .iter()
        .map(|(key, value)| format!("\t{key} = {value}\n"))
        .collect();
    let (fallen, marauders, crisis) = size_band(systems);
    let shapes: String = [
        "elliptical",
        "spiral_2",
        "spiral_3",
        "spiral_4",
        "spiral_6",
        "ring",
        "bar",
        "cartwheel",
        "cluster",
        "starburst",
    ]
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
         \tnum_wormhole_pairs = {{ min = 0 max = 5 }}\n\
         \tnum_wormhole_pairs_default = 1\n\
         \tnum_gateways = {{ min = 0 max = 5 }}\n\
         \tnum_gateways_default = 1\n\
         \tnum_hyperlanes = {{ min = 0.5 max = 3 }}\n\
         \tnum_hyperlanes_default = 1\n\
         \tcolonizable_planet_odds = 1.0\n\
         \tprimitive_odds = 1.0\n\
         \tfallen_empire_max = 6\n\
         \tmarauder_empire_max = 3\n\
         \textra_crisis_strength = {{ 10 25 }}\n\
         {counts}\
         \tfallen_empire_default = {fallen}\n\
         \tmarauder_empire_default = {marauders}\n\
         \tcrisis_strength = {crisis}\n\
         \tcore_radius = {}\n\
         \n",
        options.name,
        coord(options.core_radius)
    )
    .into_bytes()
}

/// Fallen empires, marauder empires and crisis strength by galaxy size.
fn size_band(systems: usize) -> (u32, u32, &'static str) {
    match systems {
        1000.. => (4, 3, "1.5"),
        800.. => (3, 2, "1.25"),
        600.. => (2, 2, "1.0"),
        400.. => (1, 1, "0.75"),
        _ => (0, 1, "0.5"),
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

/// Each spawn system gets the enabled seat with the next random value, or keeps the
/// script it already carries, and a starting initializer when it names none.
fn mark_spawns(draft: &mut Draft, galaxy: &Galaxy, spawns: &BTreeSet<u32>) {
    let seat: HashMap<u32, usize> = spawns.iter().enumerate().map(|(i, &id)| (id, i)).collect();
    for system in &mut draft.systems {
        let Some(&i) = seat.get(&system.id) else {
            continue;
        };
        let script = galaxy
            .systems
            .get(&system.id)
            .and_then(|s| s.spawn_script.clone())
            .unwrap_or(SpawnScript::PaintAGalaxy {
                kind: PaintSpawnKind::Enabled,
                random_value: (i % RANDOM_VALUES) as u8,
            });
        system.spawn = SpawnDraft::Script(script);
        if system.initializer.is_none() {
            system.initializer = Some(basic_initializer(system.id).to_owned());
        }
    }
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
/// of empires; a pair with an end the draft does not write is not a pair.
fn flag_wormholes(draft: &mut Draft, bypasses: &[BypassLink]) {
    let index: HashMap<u32, usize> = draft
        .systems
        .iter()
        .enumerate()
        .map(|(i, system)| (system.id, i))
        .collect();
    let pairs = bypasses.iter().filter_map(|link| match link {
        BypassLink::Wormhole { a, b } => Some((*index.get(a)?, *index.get(b)?)),
        _ => None,
    });
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
}

/// The zones the mod would place by itself, on the systems it would anchor them to. A
/// system the galaxy already gives a zone keeps it and anchors no other.
fn place_fe_zones(draft: &mut Draft, galaxy: &Galaxy) -> u32 {
    let sites: Vec<Site<'_>> = draft
        .systems
        .iter()
        .map(|system| Site {
            id: system.id,
            x: system.x,
            y: system.y,
            zone: galaxy
                .systems
                .get(&system.id)
                .and_then(|s| s.fe_zone.as_ref()),
        })
        .collect();
    let candidates = fe_zone::candidates(&sites);
    let index: HashMap<u32, usize> = draft
        .systems
        .iter()
        .enumerate()
        .map(|(i, system)| (system.id, i))
        .collect();
    for (id, zone) in &candidates {
        add_flags(&mut draft.systems[index[id]], fe_zone::flags(zone));
    }
    as_u32(candidates.len())
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

    fn header_text(systems: usize, spawns: usize) -> String {
        let options = ScenarioOptions {
            name: "sgf_paint".into(),
            core_radius: 30.0,
            num_empires: (0, 1),
            exported_from: None,
        };
        String::from_utf8(header(&options, systems, spawns, 0)).unwrap()
    }

    #[test]
    fn the_header_counts_empires_from_the_spawns_and_sizes_the_rest_by_systems() {
        let text = header_text(791, 12);
        assert!(text.starts_with("# Written by Stellaris Galaxy Forge"));
        assert!(text.contains("\tnum_empires = { min = 0 max = 11 }\n\tnum_empire_default = 6\n\tadvanced_empire_default = 1\n\tnomad_empire_default = 1\n\tnomad_empire_max = 11\n\tfallen_empire_default = 2\n\tmarauder_empire_default = 2\n\tcrisis_strength = 1.0\n\tcore_radius = 30\n"), "{text}");
        assert_eq!(text.matches("\tsupports_shape = ").count(), 10);

        let none = header_text(0, 0);
        assert!(
            none.contains("\tnum_empires = { min = 0 max = 0 }\n"),
            "{none}"
        );
        assert!(none.contains("\tnomad_empire_max = 0\n"), "{none}");
        assert!(none.contains("\tcrisis_strength = 0.5\n"), "{none}");

        for (systems, band) in [
            (
                399,
                "fallen_empire_default = 0\n\tmarauder_empire_default = 1\n\tcrisis_strength = 0.5",
            ),
            (
                400,
                "fallen_empire_default = 1\n\tmarauder_empire_default = 1\n\tcrisis_strength = 0.75",
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
                "fallen_empire_default = 4\n\tmarauder_empire_default = 3\n\tcrisis_strength = 1.5",
            ),
        ] {
            assert!(header_text(systems, 4).contains(band), "{systems}");
        }
    }
}
