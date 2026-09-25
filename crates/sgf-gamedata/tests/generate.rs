//! Rolling a random system from an install's rules: the ranges, random lists and class
//! fields it reads, on a hand-written install and on the real one, and the spec it rolls
//! added to the 4.5 sample save.

use crate::common;

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::sync::Arc;

use sgf_core::archive;
use sgf_core::document::Document;
use sgf_core::ops::{BeltSpec, BodySpec, Op, SystemSpec, free_star_names};
use sgf_core::session::Session;
use sgf_gamedata::GameData;
use sgf_gamedata::body_effects::BodyEffect;
use sgf_gamedata::condition::Condition;
use sgf_gamedata::generate::{GenerateError, generate, generate_layout_for, star_classes};
use sgf_gamedata::install::script::Range;
use sgf_gamedata::layouts::{SaveFacts, plain_initializers, special_initializers};
use sgf_gamedata::naming::{pick_system_name, pick_unused};

use common::SAMPLE_4_5;
/// Free ground beside the player's home system 169, where the spike's system stood.
const SPOT: (f64, f64) = (-292.23404, -137.62265);
const SEEDS: u64 = 1000;
/// The Resource Abundance both sample saves were generated with.
const ABUNDANCE: f64 = 2.0;

use common::INSTALL;

const FILES: [(&str, &str); 8] = [
    (
        "common/scripted_variables/00_fx.txt",
        "@fx_min = 60\n@fx_max = 100\n@fx_odds = 0.5\n@fx_moon = 10\n",
    ),
    (
        "common/star_classes/00_stars.txt",
        "sc_sun = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 30\n\tnum_planets = { min = 2 max = 5 }\n\tpc_meadow = { spawn_odds = 0.25 }\n}\n\
         sc_ember = {\n\tclass = ember_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 10\n}\n\
         sc_pair = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 5\n}\n\
         sc_blaze = {\n\tclass = blaze_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 90\n}\n",
    ),
    (
        "common/star_classes/randomizers/00_lists.txt",
        "rl_single = {\n\tstars = {\n\t\t\"sc_sun\"\n\t\t\"sc_ember\"\n\t}\n}\n\
         rl_pair = {\n\tstars = { \"sc_pair\" }\n}\n\
         rl_warm = {\n\tstars = { sc_sun sc_blaze }\n}\n",
    ),
    (
        "common/planet_classes/00_planets.txt",
        "pc_sun_star = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 30 }\n}\n\
         pc_meadow = {\n\tmin_distance_from_sun = @fx_min\n\tmax_distance_from_sun = @fx_max\n\tspawn_odds = @fx_odds\n\tchance_of_ring = 0.2\n\textra_orbit_size = 0\n\textra_planet_count = 0\n\tplanet_size = { min = 12 max = 20 }\n\tmoon_size = { min = 8 max = 10 }\n\tcolonizable = yes\n}\n\
         pc_rock = {\n\tmin_distance_from_sun = 0\n\tmax_distance_from_sun = 1000\n\tspawn_odds = 10\n\tplanet_size = { min = 10 max = 20 }\n\tmoon_size = { min = 5 max = 8 }\n}\n\
         pc_puff = {\n\tmin_distance_from_sun = 40\n\tmax_distance_from_sun = 1000\n\tspawn_odds = 6\n\textra_orbit_size = 0\n\textra_planet_count = 2\n\tcan_be_moon = no\n\tplanet_size = { min = 20 max = 30 }\n\tmoon_size = { min = 8 max = 15 }\n}\n\
         pc_boulder = {\n\tasteroid = yes\n\tspawn_odds = 10\n\tplanet_size = 5\n}\n",
    ),
    (
        "common/solar_system_initializers/00_fx.txt",
        "fx_plain = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { count = 1 class = star orbit_distance = 0 orbit_angle = 1 size = { min = 20 max = 30 } }\n\
         \tchange_orbit = 30\n\tchange_orbit = 10\n\
         \tplanet = {\n\t\tcount = { min = 2 max = 4 }\n\t\torbit_distance = 20\n\t\torbit_angle = { min = 90 max = 270 }\n\t\tchange_orbit = @fx_moon\n\t\tmoon = { count = { min = 0 max = 1 } orbit_distance = 5 orbit_angle = { min = 90 max = 270 } }\n\t}\n}\n\
         fx_warm = {\n\tclass = rl_warm\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { count = 1 class = star orbit_distance = 0 orbit_angle = 1 size = { min = 20 max = 30 } }\n\
         \tchange_orbit = 40\n\
         \tplanet = {\n\t\tcount = { min = 2 max = 4 }\n\t\torbit_distance = 20\n\t\torbit_angle = { min = 90 max = 270 }\n\t}\n}\n\
         fx_rocks = {\n\tclass = rl_single\n\tasteroid_belt = { type = rocky_asteroid_belt radius = 40 }\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n\tchange_orbit = 40\n\tplanet = { count = { min = 2 max = 4 } class = pc_boulder orbit_distance = 0 orbit_angle = { min = 90 max = 270 } }\n\tchange_orbit = -10\n\tplanet = { count = 1 orbit_distance = 40 }\n}\n\
         fx_moonrock = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n\tchange_orbit = 40\n\tplanet = { count = 1 class = pc_boulder orbit_distance = 0 moon = { count = 1 orbit_distance = 5 } }\n}\n\
         fx_unmeasured = {\n\tclass = rl_single\n\tasteroid_belt = { type = rocky_asteroid_belt }\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n}\n\
         fx_pair = {\n\tclass = rl_pair\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n}\n\
         fx_effect = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n\tinit_effect = { set_star_flag = fx }\n}\n\
         fx_conditional = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = { base = 5 }\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n}\n",
    ),
    ("localisation/english/fx_l_english.yml", "l_english:\n"),
    (
        "common/random_names/base/00_names.txt",
        "asteroid_prefix = {\n\tZz\n}\nstar_names = {\n\t### REAL ###\n\t\"Fx_Alpha\"\n\tFx_Beta\n}\n",
    ),
    (
        "common/random_names/01_more.txt",
        "star_names = {\n\tFx_Beta\n\tFx_Gamma\n}\n",
    ),
];

fn hand_written() -> (tempfile::TempDir, GameData) {
    install_of(&FILES)
}

fn install_of(files: &[(&str, &str)]) -> (tempfile::TempDir, GameData) {
    let dir = tempfile::tempdir().expect("temp dir");
    let install = dir.path().join("install");
    for &(rel, text) in files {
        let file = install.join(rel);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, text).unwrap();
    }
    let opts = sgf_gamedata::LoadOptions {
        install: Some(install),
        user_dir: Some(dir.path().join("user")),
        language: "english".to_owned(),
        mods: false,
    };
    let gd = sgf_gamedata::load(&opts, &mut |_| {}).expect("the hand-written install loads");
    (dir, gd)
}

#[test]
fn a_hand_written_install_gives_its_ranges_lists_and_class_fields() {
    let (_dir, gd) = hand_written();

    let init = gd.initializers.get("fx_plain").expect("fx_plain");
    assert_eq!(init.usage_odds, Some(5.0));
    let planet = &init.planets[1];
    assert_eq!(planet.count, Range { min: 2.0, max: 4.0 });
    assert_eq!(planet.instances(), 3, "the midpoint consumers still read");
    assert_eq!(planet.orbit_distance, Some(Range::fixed(20.0)));
    assert_eq!(
        planet.orbit_angle,
        Some(Range {
            min: 90.0,
            max: 270.0
        })
    );
    assert_eq!(planet.change_orbit, 40.0, "both statements before it");
    assert_eq!(init.planets[0].change_orbit, 0.0);
    assert_eq!(planet.moons[0].change_orbit, 10.0, "an @variable");
    assert_eq!(planet.moons[0].count, Range { min: 0.0, max: 1.0 });
    let conditional = gd.initializers.get("fx_conditional").unwrap();
    assert_eq!(conditional.usage_odds, None, "a block of conditions");
    assert!(gd.initializers.get("fx_effect").unwrap().init_effect);

    let list = gd.star_lists.get("rl_single").expect("the random list");
    assert_eq!(list.stars, ["sc_sun", "sc_ember"]);
    assert!(
        gd.star_classes.get("rl_single").is_none(),
        "a list is no class"
    );
    let sun = gd.star_classes.get("sc_sun").unwrap();
    assert_eq!(sun.num_planets, Some(Range { min: 2.0, max: 5.0 }));
    assert_eq!(sun.planet_odds("pc_meadow"), 0.25);
    assert_eq!(sun.planet_odds("pc_rock"), 1.0);

    let meadow = gd.planet_classes.get("pc_meadow").unwrap();
    assert_eq!(meadow.spawn_odds, 0.5);
    assert_eq!(
        meadow.distance_from_sun,
        Some(Range {
            min: 60.0,
            max: 100.0
        })
    );
    assert_eq!(
        meadow.moon_size,
        Some(Range {
            min: 8.0,
            max: 10.0
        })
    );
    assert_eq!(meadow.chance_of_ring, 0.2);
    assert_eq!(
        gd.planet_classes.get("pc_puff").unwrap().extra_planet_count,
        2.0
    );
    assert!(!gd.planet_classes.get("pc_puff").unwrap().can_be_moon);
    assert!(
        gd.planet_classes.get("pc_rock").unwrap().can_be_moon,
        "unless it says no"
    );
    assert!(gd.planet_classes.get("pc_boulder").unwrap().asteroid);
    assert_eq!(
        gd.planet_classes
            .get("pc_sun_star")
            .unwrap()
            .distance_from_sun,
        None
    );
}

#[test]
fn a_hand_written_install_rolls_its_plain_initializers() {
    let (_dir, gd) = hand_written();
    let plain: BTreeSet<&str> = plain_initializers(&gd)
        .iter()
        .map(|i| i.name.as_str())
        .collect();
    assert_eq!(
        plain,
        BTreeSet::from(["fx_plain", "fx_rocks", "fx_warm"]),
        "the binary, effect, conditional, moon-bearing asteroid and radius-less belt ones are left out"
    );

    let unmeasured = gd.initializers.get("fx_unmeasured").unwrap();
    assert_eq!(
        unmeasured.asteroid_belts[0].radius, None,
        "left out for that alone"
    );

    let mut rolled = BTreeSet::new();
    for seed in 0..100 {
        let spec = generate(&gd, seed, "Fx", (1.0, 2.0), None, ABUNDANCE).expect("a system");
        rolled.insert(spec.initializer.clone());
        if spec.initializer == "fx_rocks" {
            check_rocks(&spec, seed);
            continue;
        }
        assert!(spec.belts.is_empty());
        assert!(["sc_sun", "sc_ember", "sc_blaze"].contains(&spec.star_class.as_str()));
        assert_eq!(spec.star.class, "pc_sun_star");
        assert!((20..=30).contains(&spec.star.size));
        let orbits: Vec<f64> = spec.planets.iter().map(|p| p.orbit).collect();
        let expected: Vec<f64> = (0..orbits.len()).map(|i| 60.0 + 20.0 * i as f64).collect();
        assert_eq!(orbits, expected, "seed {seed}");
        assert!((2..=4).contains(&spec.planets.len()));
        for planet in &spec.planets {
            assert!(planet.moons.len() <= 1);
            for moon in &planet.moons {
                assert_eq!(moon.orbit, 15.0);
                assert_ne!(moon.class, "pc_puff", "a class that cannot be a moon");
            }
        }
    }
    assert_eq!(rolled, plain.iter().map(|&n| n.to_owned()).collect());
}

/// Two to four boulders on the belt at 40, then one drawn planet at 70.
fn check_rocks(spec: &SystemSpec, seed: u64) {
    assert_eq!(
        spec.belts,
        [BeltSpec {
            kind: "rocky_asteroid_belt".to_owned(),
            inner_radius: 40.0
        }]
    );
    let (rocks, rest) = spec.planets.split_at(spec.planets.len() - 1);
    assert!((2..=4).contains(&rocks.len()), "seed {seed}");
    for rock in rocks {
        assert_eq!(
            (rock.class.as_str(), rock.size, rock.orbit, rock.asteroid),
            ("pc_boulder", 5, 40.0, true),
            "seed {seed}"
        );
        assert!(rock.moons.is_empty());
    }
    assert_eq!(rest[0].orbit, 70.0, "seed {seed}");
    assert!(!rest[0].asteroid);
    assert_ne!(
        rest[0].class, "pc_boulder",
        "a drawn class is never an asteroid"
    );
}

/// `None`, and the test returns, when this machine has no Stellaris install.
fn install() -> Option<&'static GameData> {
    INSTALL.as_ref()
}

fn specs(gd: &GameData) -> Vec<SystemSpec> {
    (0..SEEDS)
        .map(|seed| generate(gd, seed, "Gen", SPOT, None, ABUNDANCE).expect("a system"))
        .collect()
}

fn range_of((min, max): (u32, u32)) -> Range {
    Range {
        min: f64::from(min),
        max: f64::from(max),
    }
}

fn within(size: u32, range: Range) -> bool {
    range.contains(f64::from(size))
}

#[test]
fn the_real_install_rolls_its_plain_single_star_initializers() {
    let Some(gd) = install() else {
        return;
    };
    let plain: BTreeSet<&str> = plain_initializers(gd)
        .iter()
        .map(|i| i.name.as_str())
        .collect();
    assert_eq!(
        plain,
        BTreeSet::from([
            "asteroid_init_01",
            "basic_init_01",
            "basic_init_02",
            "basic_init_03",
            "basic_init_04",
            "basic_init_05",
            "basic_init_06",
        ])
    );
    let odds: f64 = plain_initializers(gd)
        .iter()
        .filter_map(|i| i.usage_odds)
        .sum();
    assert_eq!(odds, 72.0);
    assert_eq!(
        gd.star_lists.get("rl_standard_stars").unwrap().stars.len(),
        7
    );
    let habitable = gd.planet_classes.get("pc_continental").unwrap();
    assert_eq!(habitable.spawn_odds, 0.3, "@habitable_spawn_odds");
    assert_eq!(
        habitable.planet_size,
        Some(Range {
            min: 12.0,
            max: 25.0
        }),
        "@habitable_planet_min_size and _max_size"
    );
}

#[test]
fn every_rolled_body_is_a_real_class_of_a_size_and_orbit_it_allows() {
    let Some(gd) = install() else {
        return;
    };
    for (seed, spec) in specs(gd).iter().enumerate() {
        let init = gd.initializers.get(&spec.initializer).unwrap();
        let star_class = gd.star_classes.get(&spec.star_class).unwrap();
        assert_eq!(spec.star.class, star_class.planet_keys[0], "seed {seed}");
        assert!(gd.planet_classes.get(&spec.star.class).unwrap().star);
        assert_eq!(spec.star.orbit, 0.0);
        assert!(within(
            spec.star.size,
            range_of(init.planets[0].size.unwrap())
        ));

        let moon_size = init
            .planets
            .iter()
            .flat_map(|p| &p.moons)
            .find_map(|m| m.size)
            .map(range_of);
        let belts: Vec<f64> = spec.belts.iter().map(|b| b.inner_radius).collect();
        let mut last = 0.0;
        for planet in &spec.planets {
            let class = gd.planet_classes.get(&planet.class).expect("a real class");
            assert!(!class.star, "seed {seed}: {}", planet.class);
            assert_eq!(planet.asteroid, class.asteroid);
            if class.asteroid {
                assert!(
                    belts.contains(&planet.orbit),
                    "seed {seed}: {} at {} off the belts {belts:?}",
                    planet.class,
                    planet.orbit
                );
                assert!(within(planet.size, class.planet_size.unwrap()));
                assert!(planet.moons.is_empty());
                continue;
            }
            assert!(planet.orbit > last, "seed {seed}: orbits increase");
            last = planet.orbit;
            let band = class.distance_from_sun.expect("a band");
            assert!(
                band.contains(planet.orbit),
                "seed {seed}: {} at {}",
                planet.class,
                planet.orbit
            );
            let fixed = init
                .planets
                .iter()
                .find(|p| p.class.written() == planet.class)
                .and_then(|p| p.size);
            let fixed = fixed.map(range_of).is_some_and(|r| within(planet.size, r));
            assert!(
                fixed || within(planet.size, class.planet_size.unwrap()),
                "seed {seed}: {} size {}",
                planet.class,
                planet.size
            );
            check_moons(gd, seed, planet, moon_size);
        }
    }
}

fn check_moons(gd: &GameData, seed: usize, planet: &BodySpec, fixed: Option<Range>) {
    let mut last = 0.0;
    for moon in &planet.moons {
        let class = gd.planet_classes.get(&moon.class).expect("a real class");
        assert!(class.can_be_moon, "seed {seed}: {}", moon.class);
        assert!(
            moon.orbit > last,
            "seed {seed}: moons orbit their planet outwards"
        );
        last = moon.orbit;
        assert!(moon.moons.is_empty());
        let size = fixed.or(class.moon_size).expect("a moon size");
        assert!(
            within(moon.size, size),
            "seed {seed}: moon {} size {}",
            moon.class,
            moon.size
        );
        assert!(class.distance_from_sun.unwrap().contains(planet.orbit));
    }
}

#[test]
fn belt_layouts_are_drawn_with_their_asteroids_on_the_belts() {
    let Some(gd) = install() else {
        return;
    };
    let mut drawn: BTreeMap<String, usize> = BTreeMap::new();
    for (seed, spec) in specs(gd).iter().enumerate() {
        *drawn.entry(spec.initializer.clone()).or_default() += 1;
        let init = gd.initializers.get(&spec.initializer).unwrap();
        let radii: Vec<Option<f64>> = init.asteroid_belts.iter().map(|b| b.radius).collect();
        let written: Vec<Option<f64>> = spec.belts.iter().map(|b| Some(b.inner_radius)).collect();
        assert_eq!(written, radii, "seed {seed}: the layout's belts in order");
        let asteroids: Vec<&BodySpec> = spec.planets.iter().filter(|p| p.asteroid).collect();
        assert_eq!(asteroids.is_empty(), spec.belts.is_empty(), "seed {seed}");
        for belt in &spec.belts {
            let class = match belt.kind.as_str() {
                "icy_asteroid_belt" => "pc_ice_asteroid",
                _ => "pc_asteroid",
            };
            let on: Vec<&&BodySpec> = asteroids
                .iter()
                .filter(|a| a.orbit == belt.inner_radius)
                .collect();
            assert!(
                !on.is_empty() && on.iter().all(|a| a.class == class && a.size == 5),
                "seed {seed}: {} at {}: {on:?}",
                belt.kind,
                belt.inner_radius
            );
        }
    }
    for layout in [
        "basic_init_02",
        "basic_init_04",
        "basic_init_05",
        "basic_init_06",
        "asteroid_init_01",
    ] {
        assert!(drawn.contains_key(layout), "{layout} in {drawn:?}");
    }
    let belted: usize = drawn
        .iter()
        .filter(|(name, _)| !matches!(name.as_str(), "basic_init_01" | "basic_init_03"))
        .map(|(_, n)| n)
        .sum();
    let share = belted as f64 / SEEDS as f64;
    assert!((share - 42.0 / 72.0).abs() < 0.05, "{share:.3} {drawn:?}");
}

#[test]
fn star_classes_come_up_about_as_often_as_their_odds() {
    let Some(gd) = install() else {
        return;
    };
    let mut drawn: BTreeMap<String, f64> = BTreeMap::new();
    for spec in specs(gd) {
        *drawn.entry(spec.star_class).or_default() += 1.0 / SEEDS as f64;
        if spec.initializer == "basic_init_01" {
            assert_eq!(spec.planets[0].orbit, 65.0, "as the trace found it");
        }
    }
    let list = gd.star_lists.get("rl_standard_stars").unwrap();
    let odds: Vec<(String, f64)> = list
        .stars
        .iter()
        .map(|key| (key.clone(), gd.star_classes.get(key).unwrap().spawn_odds))
        .collect();
    let total: f64 = odds.iter().map(|(_, o)| o).sum();
    assert_eq!(
        drawn.keys().cloned().collect::<BTreeSet<_>>(),
        list.stars.iter().cloned().collect::<BTreeSet<_>>()
    );
    for (key, odds) in odds {
        let share = drawn[&key];
        assert!(
            (share - odds / total).abs() < 0.04,
            "{key}: drawn {share:.3}, weighted {:.3}",
            odds / total
        );
    }
}

#[test]
fn a_seed_always_rolls_the_same_system_and_another_seed_another() {
    let (_dir, gd) = hand_written();
    let roll = |seed| generate(&gd, seed, "Gen", (0.0, 0.0), None, ABUNDANCE).unwrap();
    assert_eq!(roll(7), roll(7));
    assert_ne!(roll(1), roll(2));
    let names = ["Aaa".to_owned(), "Bbb".to_owned(), "Ccc".to_owned()];
    let none = HashSet::new();
    assert_eq!(
        pick_unused(&names, &[], &none, 7),
        pick_unused(&names, &[], &none, 7)
    );
    assert_eq!(pick_unused(&[], &[], &none, 7), None);
}

#[test]
fn a_rolled_system_is_added_to_a_save_and_reopens_with_its_findings() {
    let (_dir, gd) = hand_written();
    let mut session = common::open_4_5();
    let before = findings(&session);
    let mut spec = generate(&gd, 3, "Gen", SPOT, None, ABUNDANCE).unwrap();
    spec.lanes = vec![169];
    let bodies = 1 + spec
        .planets
        .iter()
        .map(|p| 1 + p.moons.len())
        .sum::<usize>();
    session
        .apply(Op::AddSaveSystem { spec: spec.clone() })
        .expect("the op takes the spec");
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("gen.sav");
    session.save_as(&path).expect("save");

    let reopened = Session::open(&path).expect("reopen");
    let system = reopened.system(601).expect("the new system");
    assert_eq!(system.star_class, spec.star_class);
    assert_eq!(system.initializer, spec.initializer);
    assert_eq!(system.planet_count as usize, bodies);
    assert_eq!(system.lanes[0].to, 169);
    assert_eq!(findings(&reopened), before);
}

fn findings(session: &Session) -> BTreeSet<(String, Vec<u32>, String)> {
    session
        .validate()
        .into_iter()
        .map(|issue| (issue.code.to_string(), issue.systems, issue.message))
        .collect()
}

#[test]
fn a_hand_written_install_rolls_the_star_class_asked_for() {
    let (_dir, gd) = hand_written();
    assert_eq!(star_classes(&gd), ["sc_sun", "sc_ember", "sc_blaze"]);
    for seed in 0..50 {
        let spec =
            generate(&gd, seed, "Fx", (1.0, 2.0), Some("sc_ember"), ABUNDANCE).expect("a system");
        assert_eq!(spec.star_class, "sc_ember", "seed {seed}");
        assert_eq!(spec.star.class, "pc_sun_star");
        assert_eq!(
            generate(&gd, seed, "Fx", (1.0, 2.0), Some("sc_ember"), ABUNDANCE),
            Ok(spec),
            "the same seed and class"
        );
    }
    assert_eq!(
        generate(&gd, 1, "Fx", (0.0, 0.0), Some("sc_pair"), ABUNDANCE),
        Err(GenerateError::NoLayoutFor("sc_pair".to_owned())),
        "only a binary layout makes it"
    );
    assert_eq!(
        generate(&gd, 1, "Fx", (0.0, 0.0), Some("sc_nowhere"), ABUNDANCE),
        Err(GenerateError::UnknownStar("sc_nowhere".to_owned())),
        "no star class at all"
    );
}

#[test]
fn a_star_class_draws_each_layout_as_often_as_it_rolls_that_class() {
    let (_dir, gd) = hand_written();
    let draws = 4000;
    let mut drawn: BTreeMap<String, f64> = BTreeMap::new();
    for seed in 0..draws {
        let spec =
            generate(&gd, seed, "Fx", (0.0, 0.0), Some("sc_sun"), ABUNDANCE).expect("a system");
        assert_eq!(spec.star_class, "sc_sun");
        *drawn.entry(spec.initializer).or_default() += 1.0 / draws as f64;
    }
    // sc_sun is 30 of rl_single's 40 and 30 of rl_warm's 120, each layout at odds 5.
    let expected = [("fx_plain", 3.75), ("fx_rocks", 3.75), ("fx_warm", 1.25)];
    for (layout, weight) in expected {
        let share = drawn.get(layout).copied().unwrap_or_default();
        assert!(
            (share - weight / 8.75).abs() < 0.03,
            "{layout}: drawn {share:.3} of {drawn:?}"
        );
    }
    for seed in 0..50 {
        let spec = generate(&gd, seed, "Fx", (0.0, 0.0), Some("sc_blaze"), ABUNDANCE).unwrap();
        assert_eq!(spec.initializer, "fx_warm", "the one list that holds it");
    }
}

#[test]
fn a_hand_written_install_lists_its_star_names_once_each_in_file_order() {
    let (_dir, gd) = hand_written();
    assert_eq!(*gd.star_names, ["Fx_Beta", "Fx_Gamma", "Fx_Alpha"]);
}

#[test]
fn the_real_install_rolls_each_class_it_lists_and_refuses_the_others() {
    let Some(gd) = install() else {
        return;
    };
    let classes = star_classes(gd);
    let standard = &gd.star_lists.get("rl_standard_stars").unwrap().stars;
    let (plain, special) = classes.split_at(standard.len());
    assert_eq!(plain, standard);
    assert_eq!(special, ["sc_black_hole", "sc_neutron_star", "sc_pulsar"]);
    assert_eq!(star_classes(gd), classes, "a stable order");
    let specials: Vec<String> = special_initializers(gd)
        .iter()
        .map(|i| i.name.clone())
        .collect();
    for class in &classes {
        let star = gd.star_classes.get(class).unwrap();
        for seed in 0..40 {
            let spec = generate(gd, seed, "Gen", SPOT, Some(class), ABUNDANCE).expect("a system");
            assert_eq!(spec.star_class, *class, "seed {seed}");
            assert_eq!(spec.star.class, star.planet_keys[0], "seed {seed}");
            let plain_layout = plain_initializers(gd)
                .iter()
                .any(|i| i.name == spec.initializer);
            assert_eq!(
                plain_layout,
                plain.contains(class),
                "seed {seed}: {class} from {}",
                spec.initializer
            );
            assert!(plain_layout || specials.contains(&spec.initializer));
            assert_eq!(
                generate(gd, seed, "Gen", SPOT, Some(class), ABUNDANCE),
                Ok(spec)
            );
        }
    }
    let error =
        generate(gd, 1, "Gen", SPOT, Some("sc_binary_1"), ABUNDANCE).expect_err("no layout");
    assert_eq!(error, GenerateError::NoLayoutFor("sc_binary_1".to_owned()));
}

/// The 4.5 sample with its pool of unused star names holding `pool` instead.
fn with_star_pool(pool: &str) -> Session {
    let raw = archive::read_sav(SAMPLE_4_5).expect("read the 4.5 sample");
    let mut text = String::from_utf8(raw.gamestate).expect("utf-8");
    let head = "\tstar_names=\n\t{\n";
    let start = text.find(head).expect("the pool") + head.len();
    let end = start + text[start..].find("\t}\n").expect("its end");
    text.replace_range(start..end, pool);
    let doc = Document::from_bytes(text.into_bytes(), raw.meta).expect("index the gamestate");
    Session::from_document(None, doc).expect("project the gamestate")
}

fn star_pool(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let start = text.find("\tstar_names=").expect("the pool");
    let end = start + text[start..].find("\t}\n").expect("its end");
    text[start..end].to_owned()
}

#[test]
fn the_real_installs_star_names_hold_the_sample_pool() {
    let Some(gd) = install() else {
        return;
    };
    let session = common::open_4_5();
    let pool = free_star_names(&session.doc);
    assert!(
        pool.iter().all(|name| gd.star_names.contains(name)),
        "the pool is the install's list less the names the galaxy took"
    );
}

#[test]
fn a_name_comes_from_the_pool_then_from_the_install_then_from_no_one() {
    let (_dir, gd) = hand_written();
    let gd = &gd;
    let session = common::open_4_5();
    let pool = free_star_names(&session.doc);
    let name = pick_system_name(&session, gd, 5).expect("a name");
    assert!(pool.contains(&name));

    let mut session = with_star_pool("");
    assert!(free_star_names(&session.doc).is_empty());
    let used: Vec<String> = session
        .graph
        .systems
        .values()
        .map(|s| s.name.key.clone())
        .collect();
    let name = pick_system_name(&session, gd, 5).expect("a name from the install");
    assert!(
        gd.star_names.contains(&name) && !used.contains(&name),
        "{name}"
    );
    assert_eq!(pick_system_name(&session, gd, 5), Some(name.clone()));

    let mut spec = generate(gd, 5, &name, SPOT, None, ABUNDANCE).unwrap();
    spec.lanes = vec![169];
    session
        .apply(Op::AddSaveSystem { spec })
        .expect("the op takes a name the pool lacks");
    let current: Vec<u8> = session.doc.pieces().flatten().copied().collect();
    assert_eq!(
        star_pool(&current),
        star_pool(session.doc.original()),
        "nothing taken from the pool"
    );
    assert_eq!(session.system(601).unwrap().name.key, name);

    let mut spent = gd.clone();
    spent.star_names = Arc::new(used);
    assert_eq!(pick_system_name(&session, &spent, 5), None);
}

#[test]
fn a_pooled_name_a_system_holds_is_passed_over_and_one_listed_twice_counts_once() {
    let (_dir, gd) = hand_written();
    let gd = &gd;
    let session = with_star_pool("\t\t\"Sgf_Twice\"\n\t\t\"Sgf_Twice\"\n\t\t\"Dristmak\"\n");
    assert_eq!(session.system(0).unwrap().name.key, "Dristmak");
    assert_eq!(free_star_names(&session.doc).len(), 3);
    for seed in 0..20 {
        assert_eq!(
            pick_system_name(&session, gd, seed).as_deref(),
            Some("Sgf_Twice"),
            "seed {seed}"
        );
    }
    let session = with_star_pool("\t\t\"Dristmak\"\n");
    let name = pick_system_name(&session, gd, 3).expect("a name from the install");
    assert_ne!(name, "Dristmak");
    assert!(gd.star_names.contains(&name));
}

const INITIALIZERS: &str = "common/solar_system_initializers/00_fx.txt";

/// One layout whose bodies carry deposit effects, and the deposits they name.
const EFFECTS: [(&str, &str); 2] = [
    (
        INITIALIZERS,
        "fx_effects = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { count = 1 class = star orbit_distance = 0 init_effect = { set_deposit = d_fx_bright } }\n\
         \tchange_orbit = 40\n\
         \tplanet = {\n\t\tcount = 1 class = pc_rock orbit_distance = 20\n\t\tinit_effect = {\n\t\t\tclear_deposits = yes\n\t\t\tadd_deposit = d_fx_gem\n\t\t\tadd_deposit = d_fx_gem\n\
         \t\t\tif = { limit = { always = yes } add_deposit = d_fx_bright }\n\t\t\tadd_deposit = random_blocker\n\t\t}\n\t}\n\
         \tplanet = {\n\t\tcount = 1 class = pc_rock orbit_distance = 20\n\t\tinit_effect = { add_deposit = d_fx_gem }\n\
         \t\tmoon = { count = 1 class = pc_rock orbit_distance = 5 init_effect = { clear_deposits = yes } }\n\t}\n\
         \tplanet = { count = 1 class = pc_rock orbit_distance = 20 init_effect = { add_deposit = d_fx_gem set_deposit = d_fx_bright } }\n}\n",
    ),
    (
        "common/deposits/00_fx.txt",
        "d_null_deposit = {\n\tis_null = yes\n\tpotential = { is_primary_star = no }\n\tdrop_weight = { weight = 100 }\n}\n\
         d_fx_shine = {\n\tpotential = { is_star = yes }\n}\n\
         d_fx_ore = {\n\tpotential = { is_planet_class = pc_rock }\n}\n\
         d_fx_gem = {\n\tpotential = { always = no }\n}\n\
         d_fx_bright = {\n\tpotential = { always = no }\n}\n",
    ),
];

fn with_effects() -> (tempfile::TempDir, GameData) {
    let files: Vec<(&str, &str)> = FILES
        .iter()
        .filter(|(rel, _)| *rel != INITIALIZERS)
        .chain(&EFFECTS)
        .copied()
        .collect();
    install_of(&files)
}

/// Each body's deposits, the star first, then every planet followed by its moons.
fn deposits(spec: &SystemSpec) -> Vec<Vec<String>> {
    let mut out = vec![spec.star.deposits.clone()];
    for planet in &spec.planets {
        out.push(planet.deposits.clone());
        out.extend(planet.moons.iter().map(|m| m.deposits.clone()));
    }
    out
}

#[test]
fn a_layouts_body_effects_are_read_in_order_with_what_cannot_be_written() {
    let (_dir, gd) = with_effects();
    let init = gd.initializers.get("fx_effects").expect("fx_effects");
    let gem = || "d_fx_gem".to_owned();
    let bright = || "d_fx_bright".to_owned();
    assert_eq!(init.planets[0].effects, [BodyEffect::SetDeposit(bright())]);
    assert_eq!(
        init.planets[1].effects,
        [
            BodyEffect::ClearDeposits,
            BodyEffect::AddDeposit(gem()),
            BodyEffect::AddDeposit(gem()),
            BodyEffect::Branch(vec![(
                Some(Condition::All(vec![Condition::Always(true)])),
                vec![BodyEffect::AddDeposit(bright())]
            )]),
        ],
        "the `if` kept with its check"
    );
    assert_eq!(
        init.planets[1].unwritten.as_deref(),
        Some("add_deposit"),
        "a random blocker is no deposit key"
    );
    assert_eq!(
        init.planets[2].effects,
        [BodyEffect::AddDeposit(gem())],
        "its moon's aside"
    );
    assert_eq!(
        init.planets[2].moons[0].effects,
        [BodyEffect::ClearDeposits]
    );
    assert_eq!(
        init.planets[3].effects,
        [
            BodyEffect::AddDeposit(gem()),
            BodyEffect::SetDeposit(bright())
        ]
    );
}

#[test]
fn a_layouts_deposit_effects_run_after_the_roll() {
    let (_dir, gd) = with_effects();
    let keys = |keys: &[&str]| keys.iter().map(|&k| k.to_owned()).collect::<Vec<_>>();
    for seed in 0..20 {
        let spec = generate(&gd, seed, "Fx", (0.0, 0.0), None, 5.0).expect("a system");
        assert_eq!(spec.initializer, "fx_effects");
        assert_eq!(
            deposits(&spec),
            [
                keys(&["d_fx_bright"]),
                keys(&["d_fx_gem", "d_fx_gem", "d_fx_bright"]),
                keys(&["d_fx_ore", "d_fx_gem"]),
                keys(&[]),
                keys(&["d_fx_bright"]),
            ],
            "seed {seed}: set replaces the star's roll, clear empties the first planet's and \
             the moon's, an `if` that always holds adds, add keeps the second planet's, and \
             set after add leaves one"
        );
        let bare = generate(&gd, seed, "Fx", (0.0, 0.0), None, 0.0).unwrap();
        assert_eq!(
            deposits(&bare),
            [
                keys(&["d_fx_bright"]),
                keys(&["d_fx_gem", "d_fx_gem", "d_fx_bright"]),
                keys(&["d_fx_gem"]),
                keys(&[]),
                keys(&["d_fx_bright"]),
            ],
            "seed {seed}: at 0 nothing is rolled and the effects still run"
        );
    }
}

/// A layout whose one planet is given a gem when the save has neither of two DLC.
const NEITHER: (&str, &str) = (
    INITIALIZERS,
    "fx_neither = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = 5\n\
     \tplanet = { count = 1 class = star orbit_distance = 0 }\n\tchange_orbit = 40\n\
     \tplanet = {\n\t\tcount = 1 class = pc_rock orbit_distance = 20\n\
     \t\tinit_effect = { if = { limit = { NOT = { host_has_dlc = \"Fx A\" host_has_dlc = \"Fx B\" } } add_deposit = d_fx_gem } }\n\t}\n}\n",
);

#[test]
fn a_not_of_two_conditions_holds_only_when_neither_does() {
    let files: Vec<(&str, &str)> = FILES
        .iter()
        .filter(|(rel, _)| *rel != INITIALIZERS)
        .chain([&NEITHER, &EFFECTS[1]])
        .copied()
        .collect();
    let (_dir, gd) = install_of(&files);
    for (dlcs, gem) in [
        (&[][..], true),
        (&["Fx A"][..], false),
        (&["Fx A", "Fx B"][..], false),
    ] {
        let save = SaveFacts {
            dlcs: dlcs.iter().map(|&d| d.to_owned()).collect(),
            ..SaveFacts::default()
        };
        let spec = generate_layout_for(&gd, &save, 1, "Fx", (0.0, 0.0), "fx_neither", 0.0)
            .expect("a system");
        assert_eq!(
            spec.planets[0].deposits == ["d_fx_gem"],
            gem,
            "with {dlcs:?}: {:?}",
            spec.planets[0].deposits
        );
    }
}

/// `spec` with every body's deposits taken off.
fn bare(mut spec: SystemSpec) -> SystemSpec {
    spec.star.deposits.clear();
    for planet in &mut spec.planets {
        planet.deposits.clear();
        for moon in &mut planet.moons {
            moon.deposits.clear();
        }
    }
    spec
}

#[test]
fn deposits_are_drawn_apart_so_a_seed_rolls_the_same_bodies_at_any_abundance() {
    let files: Vec<(&str, &str)> = FILES.iter().chain([&EFFECTS[1]]).copied().collect();
    let (_dir, gd) = install_of(&files);
    let gd = &gd;
    let mut with = 0;
    for seed in 0..200 {
        let rolled = generate(gd, seed, "Gen", SPOT, None, ABUNDANCE).unwrap();
        assert_eq!(
            generate(gd, seed, "Gen", SPOT, None, ABUNDANCE),
            Ok(rolled.clone()),
            "seed {seed}: the same seed and abundance"
        );
        let none = generate(gd, seed, "Gen", SPOT, None, 0.0).unwrap();
        let most = generate(gd, seed, "Gen", SPOT, None, 5.0).unwrap();
        assert!(deposits(&none).iter().all(Vec::is_empty), "seed {seed}");
        with += usize::from(deposits(&rolled).iter().any(|d| !d.is_empty()));
        assert_eq!(bare(rolled), none, "seed {seed}");
        assert_eq!(bare(most), none, "seed {seed}");
    }
    assert_eq!(with, 200, "every star rolls one");
}
