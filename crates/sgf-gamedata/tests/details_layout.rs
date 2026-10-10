//! Where a system's details place its bodies: the steps and turns its initializer writes,
//! and the example roll drawn from them.

use crate::common;

use sgf_core::ops::BeltSpec;

use common::{INSTALL, fixed, range};

/// Distances add up from the running orbit, at each level; a ranged count lists the most it
/// can spawn.
#[test]
fn a_fixture_systems_layout_is_what_its_initializer_defines() {
    let gd = common::cached_fixture();
    let details = gd
        .initializer_details(6, "layout_init", None)
        .expect("the layout fixture");
    let id = |index: usize| details.planets[index].id;
    let layouts: Vec<_> = details
        .planets
        .iter()
        .map(|p| {
            let layout = p.layout.as_ref().expect("every scenario body is laid out");
            assert_eq!(layout.at, None, "a scenario stores no point");
            assert_eq!(p.orbit, None, "a scenario stores no orbit");
            (p.parent, layout.orbit, layout.size)
        })
        .collect();
    assert_eq!(
        layouts,
        [
            (None, Some(fixed(0.0)), None),
            (None, Some(range(30.0, 35.0)), Some(fixed(16.0))),
            (Some(id(1)), Some(fixed(8.0)), None),
            (Some(id(1)), Some(fixed(10.0)), None),
            (None, Some(range(60.0, 65.0)), None),
            (None, Some(range(80.0, 85.0)), None),
            (None, Some(range(100.0, 105.0)), None),
            (None, Some(range(110.0, 125.0)), None),
            (None, Some(range(135.0, 150.0)), None),
        ],
        "change_orbit moves the moons out, and the siblings \
         after it; a count of one to three lists three; an undeclared distance lies 10 to \
         20 past the running orbit and moves the bodies after it out as far"
    );
    assert_eq!(
        details.belts,
        [
            BeltSpec {
                kind: "rocky_asteroid_belt".to_owned(),
                inner_radius: 50.0,
            },
            BeltSpec {
                kind: "icy_asteroid_belt".to_owned(),
                inner_radius: 90.0,
            },
        ]
    );
    assert_eq!(details.inner_radius, None);
}

/// The game wrote system 217 of the sample from Sol's initializer, its planets turned by one
/// angle; each planet's moons start from 180 degrees in the save's frame, whatever that turn.
#[test]
fn sol_is_laid_out_where_the_game_put_it() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let sol = gd
        .initializer_details(217, "sol_system_initializer", None)
        .expect("Sol");
    let session = common::open_4_4();
    let projection = session.details().expect("the sample's details");
    let saved = projection.raw(217).expect("system 217");
    assert_eq!(sol.planets.len(), saved.planets.len());

    let point = |id: u32| {
        saved
            .planets
            .iter()
            .find(|p| p.id == id)
            .and_then(|p| p.at)
            .expect("a point")
    };
    let roll = gd.system_roll(217, "sol_system_initializer", "", 0, 1000.0);
    let mut turn = None;
    for ((laid, body), rolled) in sol.planets.iter().zip(&saved.planets).zip(&roll.bodies) {
        assert_eq!(laid.name_key, body.name_key);
        let (x, y) = body.at.expect("a point");
        let (cx, cy) = body.parent.map_or((0.0, 0.0), point);
        let (dx, dy) = (x - cx, y - cy);
        let layout = laid.layout.as_ref().expect("a layout");
        let orbit = layout.orbit.expect("Sol gives every body a distance");
        assert_eq!(orbit.min, orbit.max, "{}", body.name_key);
        assert!(
            (dx.hypot(dy) - orbit.min).abs() < 1.0,
            "{}: saved at {}, laid out at {}",
            body.name_key,
            dx.hypot(dy),
            orbit.min
        );
        if orbit.min == 0.0 {
            continue;
        }
        let angle = rolled.angle;
        let saved_angle = dy.atan2(dx).to_degrees();
        let turn = if body.parent.is_some() {
            0.0
        } else {
            *turn.get_or_insert(saved_angle - angle)
        };
        let off = (angle + turn - saved_angle).rem_euclid(360.0);
        assert!(
            off.min(360.0 - off) < 0.1,
            "{}: saved at {saved_angle}°, rolled at {angle}° turned by {turn}°",
            body.name_key,
        );
    }
}

/// A body with no `orbit_distance` lies 10 to 20 past the running orbit, and the bodies after
/// it lie that much further out too: the 4.4 sample's systems 52, 55 and 57 were rolled from
/// these initializers, whose counts are fixed or, in 55, spawn the star and the broken world.
#[test]
fn a_body_with_no_distance_lies_in_a_band_past_the_running_orbit_and_moves_the_rest_out() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let session = common::open_4_4();
    let projection = session.details().expect("the sample's details");
    for (system, initializer, bodies) in [
        (52, "hostile_init_20", 15),
        (55, "special_init_01", 2),
        (57, "salvager_enclave_init_03", 7),
    ] {
        let saved = projection.raw(system).expect("a saved system");
        let laid = gd
            .initializer_details(system, initializer, None)
            .expect("the initializer's details");
        assert_eq!(saved.planets.len(), bodies, "{initializer}");
        for (index, (laid, saved)) in laid.planets.iter().zip(&saved.planets).enumerate() {
            let saved_orbit = saved.orbit.expect("the saved body's orbit");
            let orbit = laid
                .layout
                .as_ref()
                .and_then(|l| l.orbit)
                .unwrap_or_else(|| panic!("{initializer}: body {index} has no orbit"));
            if index > 0 {
                assert_eq!(laid.class, saved.class, "{initializer}: body {index}");
                assert!(
                    orbit.min > 0.0,
                    "{initializer}: body {index} is on the star"
                );
            }
            assert!(
                orbit.min <= saved_orbit && saved_orbit <= orbit.max,
                "{initializer}: body {index} laid out at {orbit:?}, saved at {saved_orbit}"
            );
        }
    }
}

/// Each scenario body carries its steps as its initializer writes them: `basic_init_05` moves
/// the running orbit in by 210 after its icy belt, so its first planet steps 30 out from 30.
#[test]
fn a_scenario_body_steps_out_from_the_running_orbit_and_turns_from_the_body_before_it() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let details = gd
        .initializer_details(9, "basic_init_05", None)
        .expect("basic_init_05");
    let layout = |index: usize| {
        details.planets[index]
            .layout
            .clone()
            .expect("every scenario body is laid out")
    };
    let last_ice = details
        .planets
        .iter()
        .rposition(|p| p.class == "pc_ice_asteroid")
        .expect("the icy belt's asteroids");
    let ice = &details.planets[last_ice];
    let first_planet = last_ice + 1;
    let planet = layout(first_planet);
    assert_eq!(planet.orbit, Some(fixed(60.0)));
    assert_eq!(planet.orbit_step, Some(fixed(30.0)));
    assert_eq!(planet.angle_step, Some(range(90.0, 270.0)));
    assert_eq!(planet.turns_from, Some(ice.id));

    let star = layout(0);
    assert_eq!(star.turns_from, None, "the first body turns from 180°");
    assert_eq!(star.orbit_step, Some(fixed(0.0)));

    let moon_index = details
        .planets
        .iter()
        .position(|p| p.parent == Some(details.planets[first_planet].id))
        .expect("the planet's moon");
    let moon = layout(moon_index);
    assert_eq!(moon.turns_from, None, "a moon's walk starts afresh");
    let moon_roll = gd.system_roll(9, "basic_init_05", "", 0, 1000.0).bodies[moon_index];
    assert_eq!(
        moon_roll.from, 180.0,
        "the game turns a planet's first moon on from 180°"
    );
    assert_eq!(moon.orbit_step, Some(fixed(5.0)));

    let broken = gd
        .initializer_details(55, "special_init_01", None)
        .expect("special_init_01")
        .planets[1]
        .layout
        .clone()
        .expect("a layout");
    assert_eq!(
        broken.orbit_step,
        Some(range(10.0, 20.0)),
        "no orbit_distance"
    );
    assert_eq!(broken.angle_step, None, "no orbit_angle");
}

/// An initializer the install defines answers even when it places nothing, with every list
/// empty and nothing left unread, so a system using it is told apart from one whose initializer
/// is `random`, empty or undefined, whose planets the game rolls. No vanilla initializer places
/// nothing without an `inline_script`, so this one is the fixture's.
#[test]
fn a_defined_initializer_that_places_nothing_answers_with_empty_lists() {
    let gd = common::cached_fixture();
    let details = gd
        .initializer_details(4, "empty_init", None)
        .expect("a record for a defined initializer");
    assert_eq!(details.id, 4);
    assert!(details.planets.is_empty());
    assert!(details.sites.is_empty());
    assert!(details.megastructures.is_empty());
    assert!(details.starbase.is_none());
    assert!(!gd.rolls_planets("empty_init"));
    for undefined in ["random", "", "no_such_initializer"] {
        assert!(
            gd.initializer_details(4, undefined, None).is_none(),
            "{undefined:?}"
        );
    }
}

/// The void worms' systems place their bodies through an `inline_script`, which is read in place
/// of the call: its star class and bodies are the system's, and the game rolls none of them.
#[test]
fn an_initializer_placing_its_bodies_through_an_inline_script_lists_the_scripts_bodies() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let worms = gd
        .initializer_details(4, "voidworms_spawn_system_tiny", None)
        .expect("a record for a defined initializer");
    let classes: Vec<&str> = worms.planets.iter().map(|p| p.class.as_str()).collect();
    assert_eq!(
        classes,
        ["pc_black_hole", "pc_toxic", "pc_toxic", "pc_toxic"]
    );
    let script = "grand_archive/voidworms_system_planet_initializer";
    assert!(worms.planets.iter().all(|p| {
        p.spawn
            .as_ref()
            .is_some_and(|s| s.from_script.as_deref() == Some(script))
    }));
    let spawn = worms.spawn.expect("a scenario system's spawn");
    assert_eq!(spawn.from_script.as_deref(), Some(script));
    assert_eq!(
        gd.scenario_star_class("voidworms_spawn_system_tiny"),
        "sc_black_hole"
    );
    let roll = gd.system_roll(4, "voidworms_spawn_system_tiny", "", 0, 150.0);
    assert!(!roll.rolls_planets && roll.placeholders.is_empty());
    assert_eq!(roll.bodies.len(), worms.planets.len());
    assert!(!gd.rolls_planets("basic_init_05"));
    assert!(
        !gd.rolls_planets("fallen_1_2"),
        "an inline_script in a body's init_effect places no body"
    );
}

/// Each fixture body's steps as the walk drew them: how far it steps out, its turn and the body
/// it turns from, each walk starting afresh.
#[test]
fn a_fixture_systems_bodies_step_and_turn_as_the_walk_drew_them() {
    let gd = common::cached_fixture();
    let details = gd
        .initializer_details(6, "layout_init", None)
        .expect("the layout fixture");
    let id = |index: usize| details.planets[index].id;
    let steps: Vec<_> = details
        .planets
        .iter()
        .map(|p| {
            let layout = p.layout.as_ref().expect("every scenario body is laid out");
            (layout.orbit_step, layout.angle_step, layout.turns_from)
        })
        .collect();
    assert_eq!(
        steps,
        [
            (Some(fixed(0.0)), None, None),
            (Some(range(10.0, 15.0)), Some(fixed(90.0)), Some(id(0))),
            (Some(fixed(5.0)), Some(fixed(30.0)), None),
            (Some(fixed(2.0)), Some(range(10.0, 50.0)), Some(id(2))),
            (Some(fixed(20.0)), Some(range(-30.0, 30.0)), Some(id(1))),
            (Some(fixed(20.0)), Some(range(-30.0, 30.0)), Some(id(4))),
            (Some(fixed(20.0)), Some(range(-30.0, 30.0)), Some(id(5))),
            (Some(range(10.0, 20.0)), Some(fixed(45.0)), Some(id(6))),
            (Some(fixed(25.0)), None, Some(id(7))),
        ],
        "a moon's walk starts afresh; an undeclared distance steps 10 to 20"
    );
}

/// An example roll places every body the details list, by the same id, within its bounds and
/// at whole-number distances where the initializer writes whole ones; the same system and roll
/// give the same roll, and every walk turns from 180°.
#[test]
fn a_fixture_systems_example_roll_is_its_walk_drawn_once() {
    let gd = common::cached_fixture();
    let details = gd
        .initializer_details(6, "layout_init", None)
        .expect("the layout fixture");
    let roll = gd.system_roll(6, "layout_init", "", 0, 150.0);
    assert!(!roll.rolls_planets && roll.placeholders.is_empty());
    assert_eq!(
        roll.bodies.iter().map(|b| b.id).collect::<Vec<_>>(),
        details.planets.iter().map(|p| p.id).collect::<Vec<_>>()
    );
    for (body, planet) in roll.bodies.iter().zip(&details.planets) {
        let layout = planet.layout.as_ref().expect("a layout");
        let (orbit, step) = (layout.orbit.unwrap(), layout.orbit_step.unwrap());
        let stepped = body.orbit - body.base;
        assert!(
            orbit.min <= body.orbit && body.orbit <= orbit.max,
            "{body:?}"
        );
        assert!(step.min <= stepped && stepped <= step.max, "{body:?}");
        assert_eq!(
            body.orbit.fract(),
            0.0,
            "whole distances draw whole: {body:?}"
        );
        assert!((0.0..360.0).contains(&body.angle) && (0.0..360.0).contains(&body.from));
        if let Some(turn) = layout.angle_step {
            let turned = body.angle - body.from;
            let fits = [turned - 360.0, turned, turned + 360.0]
                .iter()
                .any(|t| turn.min - 1e-9 <= *t && *t <= turn.max + 1e-9);
            assert!(fits, "{body:?} turned {turned} of {turn:?}");
        }
    }
    let by_id = |id: u32| roll.bodies.iter().find(|b| b.id == id).expect("rolled");
    for planet in &details.planets {
        let body = by_id(planet.id);
        match planet.layout.as_ref().and_then(|l| l.turns_from) {
            Some(before) => assert_eq!(body.from, by_id(before).angle),
            None => assert_eq!(body.from, 180.0, "{body:?}: a walk turns from 180°"),
        }
    }
    assert_eq!(gd.system_roll(6, "layout_init", "", 0, 150.0), roll);
    assert_ne!(
        gd.system_roll(6, "layout_init", "", 1, 150.0).bodies,
        roll.bodies
    );
    assert_ne!(
        gd.system_roll(7, "layout_init", "", 0, 150.0).bodies,
        roll.bodies
    );
}
