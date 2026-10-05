//! Adding a star system to a save, on the 4.5 and the 4.4 sample: the new system, its
//! bodies and their deposits stand as first-class entities for the projection, the
//! details, search and later ops; a saved file reopens with the same findings; and belts
//! and asteroids are written as the game writes them.

use std::collections::BTreeSet;

use sgf_core::format::save::details::{Bounds, HeuristicResolver};
use sgf_core::ops::{Op, SystemSpec};
use sgf_core::session::Session;

use crate::common;
use common::diff::{report, round_trip_step};
use common::spec::{SAMPLE_4_5, SAMPLES, belted, body, mura, star};
use common::{findings, open_4_5, text};

pub(crate) fn add(spec: SystemSpec) -> Op {
    Op::AddSystemFromSpec { spec }
}

/// The planets the details list for system `id`, as (planet, class, deposit keys).
pub(crate) fn bodies(session: &Session, id: u32) -> Vec<(u32, String, Vec<String>)> {
    common::planets(session, id)
        .into_iter()
        .map(|p| {
            let deposits = p
                .deposits
                .iter()
                .map(|(k, n)| format!("{k} x{n}"))
                .collect();
            (p.id, p.class, deposits)
        })
        .collect()
}

/// `spec` renamed and moved to `at`, linked to `lanes`.
fn another(spec: &SystemSpec, name: &str, at: (f64, f64), lanes: Vec<u32>) -> SystemSpec {
    let mut other = spec.clone();
    other.name = name.to_owned();
    (other.x, other.y) = at;
    other.lanes = lanes;
    other
}

/// `spec` as a second system 20 up and right of it, linked to the first at `id`.
pub(crate) fn beside(spec: &SystemSpec, id: u32) -> SystemSpec {
    another(spec, "Sgf_Second", (spec.x + 20.0, spec.y + 20.0), vec![id])
}

#[test]
fn the_spike_system_is_written_as_the_game_spawns_one() {
    for sample in &SAMPLES {
        let mut session = (sample.open)();
        let spec = (sample.spike)();
        let name = spec.name.to_lowercase();
        let result = session.apply(add(spec)).expect("add the system");
        common::snapshot(&format!("add_{name}"), &report(&session, &result));
    }
}

#[test]
fn a_saved_system_reopens_with_its_lanes_bodies_and_the_saves_findings() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for sample in &SAMPLES {
        let (mut session, id, home) = ((sample.open)(), sample.id, sample.home());
        let before = findings(&session);
        session
            .apply(add((sample.spike)()))
            .expect("add the system");
        let path = dir.path().join(format!("{id}.sav"));
        session.save_as(&path).expect("save");

        let reopened = Session::open(&path).expect("reopen");
        let system = reopened.system(id).expect("the system");
        assert_eq!(system.star_class, "sc_g");
        assert_eq!(system.initializer, "basic_init_01");
        assert_eq!(system.planet_count, 9);
        assert_eq!(system.lanes.len(), 1);
        assert_eq!(system.lanes[0].to, home);
        assert!(
            !system.lanes[0].stale,
            "the length is the floor of the distance"
        );
        let back = reopened
            .graph()
            .lane(home, id)
            .expect("the lane's other end");
        assert_eq!(back.length, system.lanes[0].length);
        let classes: Vec<String> = system
            .bodies
            .as_ref()
            .expect("a save system lists its bodies")
            .iter()
            .map(|b| b.class.clone())
            .collect();
        assert_eq!(classes[0], "pc_g_star");
        assert_eq!(classes[4], "pc_gas_giant");
        assert_eq!(findings(&reopened), before, "{id}: the save's own findings");

        let listed = bodies(&reopened, id);
        assert_eq!(
            listed,
            bodies(&session, id),
            "{id}: details before the save"
        );
        assert_eq!(listed.len(), 9);
        assert_eq!(listed[0].2, ["d_energy_5 x1"]);
        let held: u32 = listed
            .iter()
            .flat_map(|(.., deposits)| deposits)
            .map(|d| d.rsplit_once(" x").unwrap().1.parse::<u32>().unwrap())
            .sum();
        assert_eq!(held, 5, "{listed:?}");
        let moons = common::planets(&reopened, id);
        assert_eq!(moons.iter().filter(|p| p.moon).count(), 2);
    }
}

#[test]
fn a_belted_system_is_written_as_the_game_spawns_one() {
    for sample in &SAMPLES {
        let mut session = (sample.open)();
        let spec = (sample.spike)();
        let name = spec.name.to_lowercase();
        let result = session.apply(add(belted(spec))).expect("add the system");
        common::snapshot(&format!("add_{name}_belted"), &report(&session, &result));
    }
}

/// The belts live only in the added entry's bytes, which the details read.
#[test]
fn an_added_systems_details_report_its_belts_and_where_its_bodies_stand() {
    let mut session = open_4_5();
    session.apply(add(belted(mura()))).expect("add the system");
    let details = session
        .details()
        .expect("details")
        .resolve(SAMPLE_4_5.id, &HeuristicResolver, false)
        .expect("the added system's details");
    let belts: Vec<(&str, f64)> = details
        .belts
        .iter()
        .map(|b| (b.kind.as_str(), b.inner_radius))
        .collect();
    assert_eq!(
        belts,
        [("rocky_asteroid_belt", 95.0), ("icy_asteroid_belt", 240.0)]
    );
    assert_eq!(details.inner_radius, Some(270.0));
    assert_eq!(details.planets.len(), 13);
    for planet in &details.planets {
        let layout = planet.layout.as_ref().expect("a save body's layout");
        assert!(layout.at.is_some(), "planet {}", planet.id);
        assert_eq!(
            layout.orbit,
            planet.orbit.map(Bounds::fixed),
            "planet {} stands on its stored orbit",
            planet.id
        );
    }
}

/// A body the spec marks a star gets a star's `carrier_binary_flags`, whatever its class is
/// called, as a mod's star class may be named.
#[test]
fn a_body_the_spec_marks_a_star_is_written_as_one() {
    let mut session = open_4_5();
    let mut spec = mura();
    spec.planets
        .push(star(body("pc_modded_sun", 20, 240.0, 90.0, 0)));
    session.apply(add(spec)).expect("add the system");
    let text = text(&session);
    let class = text
        .find("\tplanet_class=\"pc_modded_sun\"\n")
        .expect("the body's entry");
    let entry = &text[class..class + text[class..].find("\tname=").expect("its name")];
    assert!(entry.contains("\tcarrier_binary_flags=3\n"), "{entry}");
}

/// Each body the details list for system `id`, as its name's key and what it shows: a
/// planet's numeral, an asteroid's prefix and suffix joined.
pub(crate) fn body_names(session: &Session, id: u32) -> Vec<(String, String)> {
    common::planets(session, id)
        .into_iter()
        .map(|p| {
            let variables = p.name.variables.iter();
            let shown = match p.name.key.as_str() {
                "ASTEROID_NAME_FORMAT" => variables.map(|v| v.value.key.as_str()).collect(),
                _ => variables
                    .filter(|v| v.name == "NUMERAL")
                    .map(|v| v.value.key.clone())
                    .collect(),
            };
            (p.name.key, shown)
        })
        .collect()
}

/// The pool block of suffixes still free for `prefix`, as the text holds it.
fn suffixes(text: &str, prefix: &str) -> Vec<String> {
    let names = |block: &str| -> Vec<String> {
        block[..block.find("\n\t}").expect("the block's end")]
            .lines()
            .filter(|line| line.starts_with("\t\t"))
            .map(|line| line.trim().trim_matches('"').to_owned())
            .collect()
    };
    let pool = &text[text.find("\nrandom_name_database=").expect("the pool")..];
    let prefixes = names(&pool[pool.find("\tasteroid_prefix=").expect("the prefixes")..]);
    let at = prefixes
        .iter()
        .position(|held| held == prefix)
        .expect("the prefix");
    names(
        pool.split("\tasteroid_postfix=")
            .nth(at + 1)
            .expect("its block"),
    )
}

#[test]
fn a_saved_belted_system_reopens_with_its_belts_and_named_asteroids() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for sample in &SAMPLES {
        let (mut session, id) = ((sample.open)(), sample.id);
        let before = findings(&session);
        session
            .apply(add(belted((sample.spike)())))
            .expect("add the system");
        let path = dir.path().join(format!("{id}.sav"));
        session.save_as(&path).expect("save");

        let reopened = Session::open(&path).expect("reopen");
        let saved = text(&reopened);
        let systems = &saved[saved.find("\ngalactic_object=").expect("the systems")..];
        let entry = &systems[systems
            .find(&format!("\n\t{id}=\n\t{{\n"))
            .expect("the entry")..];
        let entry = &entry[..entry.find("\n\t}\n").expect("its end")];
        assert!(entry.contains("\t\tasteroid_belts=\n\t\t{\n\t\t\t\n\t\t\t{\n\t\t\t\ttype=\"rocky_asteroid_belt\"\n\t\t\t\tinner_radius=95\n\t\t\t}\n \n\t\t\t{\n\t\t\t\ttype=\"icy_asteroid_belt\"\n\t\t\t\tinner_radius=240\n\t\t\t}\n \n\t\t}\n\t\tinitializer=\"basic_init_05\"\n\t\tinner_radius=270\n\t\touter_radius=370\n"), "{entry}");
        assert_eq!(reopened.system(id).expect("the system").planet_count, 13);

        let names = body_names(&reopened, id);
        assert_eq!(names, body_names(&session, id), "{id}: before the save");
        let keys: Vec<&str> = names.iter().map(|(key, _)| key.as_str()).collect();
        assert_eq!(
            keys[1..6],
            [
                "PLANET_NAME_FORMAT",
                "PLANET_NAME_FORMAT",
                "ASTEROID_NAME_FORMAT",
                "ASTEROID_NAME_FORMAT",
                "PLANET_NAME_FORMAT"
            ]
        );
        let numerals: Vec<&str> = names
            .iter()
            .filter(|(key, _)| key == "PLANET_NAME_FORMAT")
            .map(|(_, numeral)| numeral.as_str())
            .collect();
        assert_eq!(numerals, ["I", "II", "III", "IV", "V", "VI"], "{names:?}");

        let opened = text(&(sample.open)());
        let asteroids: Vec<_> = common::planets(&reopened, id)
            .into_iter()
            .filter(|p| p.name.key == "ASTEROID_NAME_FORMAT")
            .collect();
        assert_eq!(asteroids.len(), 4);
        let mut seen = BTreeSet::new();
        for asteroid in asteroids {
            assert!(asteroid.class.ends_with("asteroid"), "{}", asteroid.class);
            assert_eq!(asteroid.size, Some(5));
            let [prefix, suffix] = &asteroid.name.variables[..] else {
                panic!("{:?}", asteroid.name);
            };
            assert_eq!(
                (prefix.name.as_str(), suffix.name.as_str()),
                ("prefix", "suffix")
            );
            let (prefix, suffix) = (&prefix.value.key, &suffix.value.key);
            assert!(seen.insert((prefix.clone(), suffix.clone())), "a name once");
            assert!(
                suffixes(&opened, prefix).contains(suffix),
                "{prefix}{suffix} was free in the pool"
            );
            assert!(
                !suffixes(&saved, prefix).contains(suffix),
                "{prefix}{suffix} leaves the pool"
            );
        }
        assert_eq!(findings(&reopened), before, "{id}: the save's own findings");
    }
}

#[test]
fn belted_systems_take_different_asteroid_names() {
    for sample in &SAMPLES {
        let (mut session, id) = ((sample.open)(), sample.id);
        let spec = belted((sample.spike)());
        let other = beside(&spec, id);
        let twin = another(&spec, &spec.name, sample.spots[1], vec![id]);
        round_trip_step(&mut session, "first", add(spec));
        round_trip_step(&mut session, "other", add(other));
        round_trip_step(&mut session, "twin", add(twin));
        let asteroids = |system: u32| -> BTreeSet<String> {
            body_names(&session, system)
                .into_iter()
                .filter(|(key, _)| key == "ASTEROID_NAME_FORMAT")
                .map(|(_, name)| name)
                .collect()
        };
        let (first, other, twin) = (asteroids(id), asteroids(id + 1), asteroids(id + 2));
        assert_eq!((first.len(), other.len(), twin.len()), (4, 4, 4));
        assert!(first.is_disjoint(&other), "{first:?} {other:?}");
        assert!(
            first.is_disjoint(&twin),
            "the same system name: {first:?} {twin:?}"
        );
    }
}
