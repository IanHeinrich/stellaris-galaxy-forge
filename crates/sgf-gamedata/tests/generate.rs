//! Rolling a random system from an install's rules: the ranges, random lists and class
//! fields it reads, on a hand-written install and on the real one, and the spec it rolls
//! added to the 4.5 sample save.

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::sync::LazyLock;

use sgf_core::ops::{BeltSpec, BodySpec, Op, SystemSpec};
use sgf_core::session::Session;
use sgf_gamedata::GameData;
use sgf_gamedata::generate::{generate, pick_name, plain_initializers};
use sgf_gamedata::install::script::Range;

const SAMPLE_4_5: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/2201.03.25.sav");
/// Free ground beside the player's home system 169, where the spike's system stood.
const SPOT: (f64, f64) = (-292.23404, -137.62265);
const SEEDS: u64 = 1000;

static INSTALL: LazyLock<Option<GameData>> = LazyLock::new(common::load_real);

const FILES: [(&str, &str); 6] = [
    (
        "common/scripted_variables/00_fx.txt",
        "@fx_min = 60\n@fx_max = 100\n@fx_odds = 0.5\n@fx_moon = 10\n",
    ),
    (
        "common/star_classes/00_stars.txt",
        "sc_sun = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 30\n\tnum_planets = { min = 2 max = 5 }\n\tpc_meadow = { spawn_odds = 0.25 }\n}\n\
         sc_ember = {\n\tclass = ember_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 10\n}\n\
         sc_pair = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 5\n}\n",
    ),
    (
        "common/star_classes/randomizers/00_lists.txt",
        "rl_single = {\n\tstars = {\n\t\t\"sc_sun\"\n\t\t\"sc_ember\"\n\t}\n}\n\
         rl_pair = {\n\tstars = { \"sc_pair\" }\n}\n",
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
         fx_rocks = {\n\tclass = rl_single\n\tasteroid_belt = { type = rocky_asteroid_belt radius = 40 }\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n\tchange_orbit = 40\n\tplanet = { count = { min = 2 max = 4 } class = pc_boulder orbit_distance = 0 orbit_angle = { min = 90 max = 270 } }\n\tchange_orbit = -10\n\tplanet = { count = 1 orbit_distance = 40 }\n}\n\
         fx_moonrock = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n\tchange_orbit = 40\n\tplanet = { count = 1 class = pc_boulder orbit_distance = 0 moon = { count = 1 orbit_distance = 5 } }\n}\n\
         fx_unmeasured = {\n\tclass = rl_single\n\tasteroid_belt = { type = rocky_asteroid_belt }\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n}\n\
         fx_pair = {\n\tclass = rl_pair\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n}\n\
         fx_effect = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n\tinit_effect = { set_star_flag = fx }\n}\n\
         fx_conditional = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = { base = 5 }\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n}\n",
    ),
    ("localisation/english/fx_l_english.yml", "l_english:\n"),
];

fn hand_written() -> (tempfile::TempDir, GameData) {
    let dir = tempfile::tempdir().expect("temp dir");
    let install = dir.path().join("install");
    for (rel, text) in FILES {
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
        BTreeSet::from(["fx_plain", "fx_rocks"]),
        "the binary, effect, conditional, moon-bearing asteroid and radius-less belt ones are left out"
    );

    let unmeasured = gd.initializers.get("fx_unmeasured").unwrap();
    assert_eq!(
        unmeasured.asteroid_belts[0].radius, None,
        "left out for that alone"
    );

    let mut rolled = BTreeSet::new();
    for seed in 0..100 {
        let spec = generate(&gd, seed, "Fx", 1.0, 2.0).expect("a system");
        rolled.insert(spec.initializer.clone());
        if spec.initializer == "fx_rocks" {
            check_rocks(&spec, seed);
            continue;
        }
        assert!(spec.belts.is_empty());
        assert!(["sc_sun", "sc_ember"].contains(&spec.star_class.as_str()));
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
        .map(|seed| generate(gd, seed, "Gen", SPOT.0, SPOT.1).expect("a system"))
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
                .find(|p| p.class == planet.class)
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
    let Some(gd) = install() else {
        return;
    };
    let roll = |seed| generate(gd, seed, "Gen", 0.0, 0.0).unwrap();
    assert_eq!(roll(7), roll(7));
    assert_ne!(roll(1), roll(2));
    let names = ["Aaa".to_owned(), "Bbb".to_owned(), "Ccc".to_owned()];
    assert_eq!(pick_name(&names, 7), pick_name(&names, 7));
    assert_eq!(pick_name(&[], 7), None);
}

#[test]
fn a_rolled_system_is_added_to_a_save_and_reopens_with_its_findings() {
    let Some(gd) = install() else {
        return;
    };
    let mut session = Session::open(SAMPLE_4_5).expect("open the 4.5 sample");
    let before = findings(&session);
    let mut spec = generate(gd, 3, "Gen", SPOT.0, SPOT.1).unwrap();
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
