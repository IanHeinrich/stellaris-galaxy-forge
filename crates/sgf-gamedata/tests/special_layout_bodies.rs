//! Where a special layout's bodies stand and what they are: stars marked, angles, distances
//! and moons, and the blockers, models and DLC branches its effects run.

use crate::common;

use sgf_core::ops::SystemSpec;
use sgf_gamedata::generate::generate_layout_for;
use sgf_gamedata::initializers::InitPlanet;
use sgf_gamedata::install::script::Range;
use sgf_gamedata::layouts::SaveFacts;

use common::layouts::{self, by_name};
use common::{ABUNDANCE, INSTALL, SPOT};

/// A body whose class the install makes a star is marked a star, as the system's own star
/// is, so the core writes it with a star's carrier flags whatever the class is called.
#[test]
fn a_body_of_a_star_class_is_marked_a_star() {
    let (_dir, gd) = layouts::hand_written();
    let spec = by_name(&gd, 1, "Fx", (1.0, 2.0), "fx_haven").unwrap();
    assert!(spec.star.star, "the system's own star");
    let marked: Vec<(&str, bool)> = spec
        .planets
        .iter()
        .flat_map(|planet| std::iter::once(planet).chain(&planet.moons))
        .map(|body| (body.class.as_str(), body.star))
        .collect();
    assert!(marked.contains(&("pc_hole", true)), "{marked:?}");
    assert!(
        marked
            .iter()
            .all(|&(class, star)| star == (class == "pc_hole")),
        "{marked:?}"
    );
}

/// Barnard's Star gives its planets no `orbit_angle`. The game's own, system 614 of the 4.4
/// sample, has them at angles scattered about the star, so each one is drawn.
#[test]
fn planets_with_no_orbit_angle_do_not_line_up() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let mut checked = 0;
    for seed in 0..20 {
        let spec = by_name(gd, seed, "Gen", SPOT, "sol_neighbor_t1").unwrap();
        let lines: Vec<f64> = spec
            .planets
            .iter()
            .map(|p| p.angle.rem_euclid(180.0))
            .collect();
        if lines.len() < 3 {
            continue;
        }
        checked += 1;
        let first = lines[0];
        assert!(
            lines.iter().any(|a| {
                let apart = (a - first).abs();
                apart.min(180.0 - apart) > 1.0
            }),
            "seed {seed}: every planet on one line through the star: {lines:?}"
        );
    }
    assert!(checked > 0);
}

/// The black hole layout gives its broken world and its cold barren world no
/// `orbit_distance`, and the debris belt its molten world. Each lies 10 to 20 past the
/// running orbit, as the game places them, and the bodies after it move out with it.
#[test]
fn a_body_with_no_orbit_distance_is_rolled_10_to_20_past_the_running_orbit() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let band = |orbit: f64, running: f64| (running + 10.0..=running + 20.0).contains(&orbit);
    for seed in 0..20 {
        let hole = by_name(gd, seed, "Gen", SPOT, "special_init_01").unwrap();
        let mut running = 60.0;
        for planet in &hole.planets {
            if planet.class == "pc_barren_cold" {
                running += 30.0;
            }
            assert!(
                band(planet.orbit, running),
                "seed {seed}: {} at {}, running orbit {running}",
                planet.class,
                planet.orbit
            );
            running = planet.orbit;
        }

        let debris = by_name(gd, seed, "Gen", SPOT, "debris_belt_initializer").unwrap();
        let (molten, cabin) = (&debris.planets[0], &debris.planets[1]);
        assert_eq!(molten.class, "pc_molten");
        assert!(
            band(molten.orbit, 60.0),
            "seed {seed}: molten world at {}",
            molten.orbit
        );
        assert_eq!(
            cabin.orbit,
            molten.orbit + 86.0,
            "seed {seed}: The Cabin lies its change_orbit and distance past the molten world"
        );

        for spec in [&hole, &debris] {
            let orbits: Vec<f64> = spec.planets.iter().map(|p| p.orbit).collect();
            assert!(
                orbits.first().is_none_or(|&first| first > 0.0),
                "seed {seed}: {} has a planet on the star: {orbits:?}",
                spec.initializer
            );
            assert!(
                orbits.windows(2).all(|pair| pair[1] > pair[0]),
                "seed {seed}: {} has a planet on the orbit before it: {orbits:?}",
                spec.initializer
            );
        }
    }
}

/// Each moon lies its `orbit_angle` on from the moon before it, and the first moon its
/// `orbit_angle` on from 180°. Sol's Jupiter has four moons with fixed angles, and
/// `basic_init_03`'s gas giants one to four at 90° to 270°.
#[test]
fn each_moon_turns_on_from_the_moon_before() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let mut checked = 0;
    for layout in ["sol_system_initializer", "basic_init_03"] {
        let init = gd.initializers.get(layout).unwrap();
        for seed in 0..20 {
            let spec = by_name(gd, seed, "Gen", SPOT, layout).unwrap();
            for planet in spec.planets.iter().filter(|p| !p.moons.is_empty()) {
                let block = init
                    .planets
                    .iter()
                    .find(|b| match &planet.name {
                        Some(name) => b.name.as_ref() == Some(name),
                        None => b.class.written() == planet.class,
                    })
                    .unwrap_or_else(|| panic!("{layout}: no block for {}", planet.class));
                let ranges = moon_angles(block, planet.moons.len());
                let mut from = 180.0;
                for (n, (moon, range)) in planet.moons.iter().zip(ranges).enumerate() {
                    assert!(
                        turned(from, moon.angle, range),
                        "{layout} seed {seed}: moon {n} of {} at {}°, {range:?} on from {from}°",
                        planet.class,
                        moon.angle
                    );
                    from = moon.angle;
                    checked += 1;
                }
            }
        }
    }
    assert!(checked > 100, "{checked} moons");
}

/// A system whose first planet has a fixed count and angle has that planet at 180° plus the
/// star's `orbit_angle` and its own. Sol fixes every body's angle.
#[test]
fn the_planets_turn_on_from_180_degrees() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let sol = gd.initializers.get("sol_system_initializer").unwrap();
    for seed in 0..5 {
        let spec = by_name(gd, seed, "Gen", SPOT, "sol_system_initializer").unwrap();
        let bodies = std::iter::once(&spec.star).chain(&spec.planets);
        assert_eq!(sol.planets.len(), 1 + spec.planets.len());
        let mut from = 180.0;
        for (body, block) in bodies.zip(&sol.planets) {
            let range = block.orbit_angle.expect("Sol gives every body an angle");
            assert!(
                turned(from, body.angle, range),
                "seed {seed}: {:?} at {}°, {range:?} on from {from}°",
                body.name,
                body.angle
            );
            from = body.angle;
        }
    }
}

/// Whether `to` lies `range` on from `from`, in degrees.
fn turned(from: f64, to: f64, range: Range) -> bool {
    let turn = (to - from - range.min).rem_euclid(360.0);
    turn <= range.max - range.min + 0.01 || turn >= 359.99
}

/// The `orbit_angle` of each of `moons` moons `block` spawns.
fn moon_angles(block: &InitPlanet, moons: usize) -> Vec<Range> {
    let angle = |moon: &InitPlanet| moon.orbit_angle.expect("a moon with an angle");
    match block.moons.as_slice() {
        [only] => vec![angle(only); moons],
        several => several
            .iter()
            .map(|moon| {
                assert_eq!(moon.count, Range::fixed(1.0));
                angle(moon)
            })
            .collect(),
    }
}

#[test]
fn a_bodys_blockers_class_model_and_dlc_branches_run_in_order() {
    let (_dir, gd) = layouts::hand_written();
    let gem = || "d_fx_gem".to_owned();
    let block = || "d_fx_block".to_owned();
    let pack = SaveFacts {
        dlcs: ["Fx Pack".to_owned()].into(),
        ..SaveFacts::default()
    };
    let with_pack =
        generate_layout_for(&gd, &pack, 1, "Fx", (0.0, 0.0), "fx_works", ABUNDANCE).unwrap();
    let rock = &with_pack.planets[0];
    assert_eq!(
        rock.deposits,
        [gem(), block(), gem(), gem(), gem()],
        "clear_blockers took the first blocker, add_blocker put one back, the loop ran three times"
    );
    assert_eq!(rock.class, "pc_meadow", "with the DLC");
    assert_eq!(rock.entity_name.as_deref(), Some("fx_meadow_entity"));
    assert!(rock.modifiers.is_empty());
    assert_eq!(
        rock.moons.len(),
        1,
        "a planet written inside a planet is its moon"
    );
    let without = SaveFacts::default();
    let bare =
        generate_layout_for(&gd, &without, 1, "Fx", (0.0, 0.0), "fx_works", ABUNDANCE).unwrap();
    let rock = &bare.planets[0];
    assert_eq!(
        (rock.class.as_str(), rock.entity_name.as_deref()),
        ("pc_rock", None)
    );
    assert_eq!(rock.modifiers, ["fx_mod"], "the else arm");
}

#[test]
fn the_real_installs_effect_layouts_come_out_as_their_scripts_say() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let layout = |key: &str| by_name(gd, 1, "Gen", SPOT, key).unwrap();
    let relic = |spec: &SystemSpec| {
        spec.planets
            .iter()
            .find(|p| p.name.as_deref() == Some("NAME_Unique_System_2_Planet"))
            .cloned()
            .expect("Larionessi's world")
    };
    let refuge = relic(&layout("unique_system_initializer_02"));
    assert_eq!(refuge.class, "pc_relic", "with Ancient Relics");
    assert!(refuge.deposits.contains(&"d_rich_mountain".to_owned()));
    let without = SaveFacts::default();
    let bare = generate_layout_for(
        gd,
        &without,
        1,
        "Gen",
        SPOT,
        "unique_system_initializer_02",
        ABUNDANCE,
    )
    .unwrap();
    let refuge = relic(&bare);
    assert_eq!(refuge.class, "pc_tropical", "without it");
    assert!(refuge.deposits.contains(&"d_green_hills".to_owned()));

    let mall = layout("the_star_mall_initializer");
    let habitat = mall
        .planets
        .iter()
        .flat_map(|p| &p.moons)
        .find(|m| m.class == "pc_habitat")
        .expect("the mall");
    assert_eq!(
        habitat.entity_name.as_deref(),
        Some("habitat_phase_03_entity")
    );
    let stalls = habitat
        .deposits
        .iter()
        .filter(|d| *d == "d_star_mall_blocker")
        .count();
    assert_eq!(stalls, 8, "the while loop");

    let collided = layout("collided_planet_system_initializer");
    let planet = collided
        .planets
        .iter()
        .find(|p| p.modifiers.contains(&"collided_planet".to_owned()))
        .expect("the collided planet");
    for blocker in ["d_former_battlefield", "d_crater", "d_ruined_district"] {
        assert!(planet.deposits.contains(&blocker.to_owned()), "{blocker}");
    }
    assert!(
        planet.moons.iter().all(|m| !m.asteroid),
        "asteroid moons are lettered, not pool-named"
    );

    let flare = layout("superflare_system");
    let nuked = flare
        .planets
        .iter()
        .flat_map(|p| &p.moons)
        .find(|m| m.class == "pc_nuked")
        .expect("the nuked moon");
    let blockers: Vec<&String> = nuked.deposits.iter().filter(|d| gd.is_blocker(d)).collect();
    assert!(
        blockers
            .iter()
            .all(|d| ["d_radioactive_wasteland", "d_irradiated_valley"].contains(&d.as_str())),
        "only the ones added after clear_blockers: {blockers:?}"
    );
}
