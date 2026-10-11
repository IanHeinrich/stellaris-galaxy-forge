//! Rolling a random system from an install's rules: the ranges, random lists and class
//! fields it reads, on a hand-written install and on the real one, and the spec it rolls
//! added to the 4.5 sample save.

use crate::common;

use std::collections::{BTreeMap, BTreeSet, HashSet};

use sgf_core::ops::{BeltSpec, BodySpec, Op, SystemSpec};
use sgf_core::session::Session;
use sgf_gamedata::GameData;
use sgf_gamedata::generate::generate;
use sgf_gamedata::install::script::Range;
use sgf_gamedata::layouts::plain_initializers;
use sgf_gamedata::naming::pick_unused;

use common::generate::{SEEDS, hand_written, specs, within};
use common::{ABUNDANCE, INSTALL, SPOT};

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
    assert_eq!(
        planet.change_orbit,
        Range::fixed(40.0),
        "both statements before it"
    );
    assert_eq!(init.planets[0].change_orbit, Range::fixed(0.0));
    assert_eq!(
        planet.moons[0].change_orbit,
        Range::fixed(10.0),
        "an @variable"
    );
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

fn range_of((min, max): (u32, u32)) -> Range {
    Range {
        min: f64::from(min),
        max: f64::from(max),
    }
}

#[test]
fn the_real_install_rolls_its_plain_single_star_initializers() {
    let Some(gd) = INSTALL.as_ref() else {
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
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    for (seed, spec) in specs(gd).iter().enumerate() {
        let init = gd.initializers.get(&spec.initializer).unwrap();
        let star_class = gd.star_classes.get(&spec.star_class).unwrap();
        assert_eq!(
            spec.star.class,
            star_class.planet_keys().next().unwrap(),
            "seed {seed}"
        );
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
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let mut drawn: BTreeMap<String, usize> = BTreeMap::new();
    for (seed, spec) in specs(gd).iter().enumerate() {
        *drawn.entry(spec.initializer.clone()).or_default() += 1;
        let init = gd.initializers.get(&spec.initializer).unwrap();
        let radii: Vec<Option<Range>> = init.asteroid_belts.iter().map(|b| b.radius).collect();
        assert_eq!(spec.belts.len(), radii.len(), "seed {seed}");
        for (belt, radius) in spec.belts.iter().zip(&radii) {
            assert!(
                radius.is_some_and(|r| r.contains(belt.inner_radius)),
                "seed {seed}: the layout's belts in order, each within its radius"
            );
        }
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
        .apply(Op::AddSystemFromSpec { spec: spec.clone() })
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
