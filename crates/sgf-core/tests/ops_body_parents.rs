//! A save body given another parent on the 4.5 sample: a planet made a moon and a moon made
//! a planet, the moons lists that follow, companion stars and the planets they take with
//! them, and what a star parent refuses.

use sgf_core::entity::EntityKind;
use sgf_core::format::save::details::BodyRole;
use sgf_core::ops::Parent;
use sgf_core::ops::{Op, Subject};
use sgf_core::projections::galaxy::StarClasses;

use crate::common;
use crate::ops_bodies::{
    assert_near, at, drawn, move_body, offset, orbit_star, planet, set_parent,
};
use common::diff::snapshot_step;
use common::{open, open_4_5};

/// Planet 587 made a moon of 588, which has none: 588 gains a `moons` list before its
/// `planet_orbitals`, at its indentation.
#[test]
fn a_planet_without_moons_gains_a_moons_list() {
    let mut session = open_4_5();
    snapshot_step(
        &mut session,
        "gains_a_moons_list",
        set_parent(1, 587, Some(588), 15.0, 0.0),
    );
    let host = common::entity_text(&session, EntityKind::Planet, 588);
    assert!(
        host.contains("\t\t\tmoons=\n\t\t\t{\n\t\t\t\t587 \n\t\t\t}\n\t\t\tplanet_orbitals=\n"),
        "{host}"
    );
}

/// Planet 588 made a moon of 589, which has the higher id and already lists moon 590.
#[test]
fn a_planet_made_a_moon_of_a_higher_id() {
    let mut session = open_4_5();
    let result = snapshot_step(
        &mut session,
        "made_a_moon_of_a_higher_id",
        set_parent(1, 588, Some(589), 20.0, 90.0),
    );
    assert_eq!(
        result.entry.description,
        "Made planet #588 a moon of planet #589"
    );
    let Op::SetBodyParent {
        body: 588,
        parent: Parent::Centre,
        ..
    } = result.inverse
    else {
        panic!("the parent put back, not {:?}", result.inverse);
    };
    let moon = planet(&session, 1, 588);
    assert_eq!((moon.parent, moon.moon), (Some(589), true));
    assert_near(offset(&session, 1, 588, 589), (0.0, 20.0), "the new moon");
    let host = common::entity_text(&session, EntityKind::Planet, 589);
    assert!(
        host.contains("\t\t\tmoons=\n\t\t\t{\n\t\t\t\t588 590 \n"),
        "{host}"
    );
    let moon = common::entity_text(&session, EntityKind::Planet, 588);
    let flags = moon.find("\t\t\tbinary_flags=576\n").expect("the moon bit");
    let coordinate = moon.find("\t\t\tcoordinate=\n").expect("the coordinate");
    assert!(flags < coordinate, "{moon}");
    let moon_of = moon.find("\t\t\tmoon_of=589\n").expect("moon_of");
    let orbitals = moon
        .find("\t\t\tplanet_orbitals=\n")
        .expect("planet_orbitals");
    assert!(moon_of < orbitals, "{moon}");
    let mut expected: Vec<Subject> = [588, 589]
        .map(|id| Subject::Planet { id, system: 1 })
        .into();
    expected.sort();
    assert_eq!(result.subjects, expected);
}

/// Moon 590 made a planet: 589's moons list goes with it, and 590's `binary_flags`,
/// left with only 64, goes too. 589 keeps its ring's 320.
#[test]
fn a_moon_detached_from_its_planet() {
    let mut session = open_4_5();
    let result = snapshot_step(
        &mut session,
        "detached_moon",
        set_parent(1, 590, None, 100.0, 200.0),
    );
    assert_eq!(result.entry.description, "Made moon #590 a planet");
    assert!(
        matches!(
            result.inverse,
            Op::SetBodyParent {
                body: 590,
                parent: Parent::Body(589),
                ..
            }
        ),
        "{:?}",
        result.inverse
    );
    let host = common::entity_text(&session, EntityKind::Planet, 589);
    assert!(!host.contains("moons="), "{host}");
    assert!(host.contains("\t\t\tbinary_flags=320\n"), "{host}");
    let freed = common::entity_text(&session, EntityKind::Planet, 590);
    assert!(!freed.contains("\t\t\tbinary_flags="), "{freed}");
    assert!(!freed.contains("moon_of"), "{freed}");
    let planet = planet(&session, 1, 590);
    assert_eq!((planet.parent, planet.moon), (None, false));
    assert!((drawn(&session, 1, 590) - 100.0).abs() < 1e-4);
}

/// System 40's moons 58 and 59 name planet 57, which the save no longer holds. 58 cannot
/// move about it, but can be made a planet, keeping the fixed-name bit of its 577.
#[test]
fn a_moon_of_a_missing_planet_is_made_a_planet() {
    let mut session = open_4_5();
    let error = session
        .apply(move_body(40, 58, 20.0, 0.0))
        .expect_err("no parent to move about");
    assert_eq!(
        error.to_string(),
        "planet 58 is a moon of planet 57, which the save does not hold: make it a planet first"
    );
    let result = snapshot_step(
        &mut session,
        "orphan_made_a_planet",
        set_parent(40, 58, None, 120.0, 10.0),
    );
    assert_eq!(result.entry.description, "Made moon #58 a planet");
    let freed = common::entity_text(&session, EntityKind::Planet, 58);
    assert!(freed.contains("\t\t\tbinary_flags=65\n"), "{freed}");
}

/// Carmenekke (system 53 of the 4.4 sample): companion star 1205's planet 1206 has a moon
/// of its own, 1207, and all of them move with 1205.
#[test]
fn a_moon_of_a_stars_planet_moves_with_the_star() {
    let mut session = open();
    let moons = [1206, 1207, 1208, 1209, 1210];
    let before = moons.map(|id| offset(&session, 53, id, 1205));
    let orbits = moons.map(|id| planet(&session, 53, id).orbit);
    let radius = drawn(&session, 53, 1205);
    let result = snapshot_step(
        &mut session,
        "moon_of_a_moon",
        move_body(53, 1205, radius, 100.0),
    );
    assert_eq!(
        result.entry.description,
        "Moved star #1205 from orbit 220.02 at 128.38° to orbit 220.02 at 100°, with #1206, \
         #1207, #1208, #1209 and #1210"
    );
    for (i, id) in moons.into_iter().enumerate() {
        assert_near(
            offset(&session, 53, id, 1205),
            before[i],
            &format!("moon {id}"),
        );
        assert_eq!(
            planet(&session, 53, id).orbit,
            orbits[i],
            "moon {id}'s orbit"
        );
    }
}

/// Alpha Centauri, system 278 of the 4.4 sample: 327 is the far companion star, at orbit
/// 240, and planets 328 and 329 are `moon_of=327`.
#[test]
fn a_companion_star_moved_takes_its_planets_with_it() {
    let mut session = open();
    let planets = [328, 329].map(|id| offset(&session, 278, id, 327));
    let result = snapshot_step(
        &mut session,
        "companion_star",
        move_body(278, 327, 260.0, 100.0),
    );
    assert!(
        result.entry.description.starts_with("Moved star #327 ")
            && result.entry.description.contains(", with #328 and #329;"),
        "{}",
        result.entry.description
    );
    for (id, was) in [328, 329].into_iter().zip(planets) {
        assert_near(offset(&session, 278, id, 327), was, "a companion's planet");
    }
    assert_eq!(planet(&session, 278, 327).orbit, Some(260.0));
}

/// 325 is Alpha Centauri's primary, off the centre at orbit 15, and 326 stores orbit -20
/// while it stands 20.09 out.
#[test]
fn the_stars_of_a_binary_system_move() {
    let mut session = open();
    session
        .apply(move_body(278, 325, 18.0, 45.0))
        .expect("the primary moves");
    assert_eq!(planet(&session, 278, 325).orbit, Some(18.0));
    session
        .apply(move_body(278, 326, 30.0, 200.0))
        .expect("the second star moves");
    assert_eq!(planet(&session, 278, 326).orbit, Some(30.0));
    let error = session
        .apply(set_parent(278, 325, Some(327), 20.0, 0.0))
        .expect_err("the primary stays a planet of the centre");
    assert_eq!(
        error.to_string(),
        "planet 325 is the system's primary body, which orbits no other body"
    );
}

/// Alpha Centauri: planet 330 and its moon 331 orbit the centre. Made a planet of the
/// companion star 327, 330 joins 327's `moons` after 328 and 329, takes `moon_of=327`
/// and no moon bit, and 331 moves with it, out past the system's inner radius.
#[test]
fn a_planet_with_its_moon_made_a_planet_of_a_companion_star() {
    let mut session = open();
    let moon = offset(&session, 278, 331, 330);
    let result = snapshot_step(
        &mut session,
        "planet_to_companion_star",
        orbit_star(278, 330, 327, 90.0, 30.0),
    );
    assert_eq!(
        result.entry.description,
        "Made planet #330 a planet of star #327, with its moon #331; set the inner radius of \
         Alpha Centauri #278 from 330 to 360.02"
    );
    let Op::Batch { ops, .. } = &result.inverse else {
        panic!("a batch, not {:?}", result.inverse);
    };
    let Op::SetBodyParent {
        body: 330,
        parent: Parent::Centre,
        radius,
        angle,
        ..
    } = ops[0]
    else {
        panic!("the centre put back, not {:?}", ops[0]);
    };
    let planet_330 = common::entity_text(&session, EntityKind::Planet, 330);
    assert!(planet_330.contains("\t\t\tmoon_of=327\n"), "{planet_330}");
    assert!(!planet_330.contains("\t\t\tbinary_flags="), "{planet_330}");
    let star = common::entity_text(&session, EntityKind::Planet, 327);
    assert!(
        star.contains("\t\t\tmoons=\n\t\t\t{\n\t\t\t\t328 329 330 \n"),
        "{star}"
    );
    assert_near(offset(&session, 278, 331, 330), moon, "the moon's step");
    let (x, y) = (30f64.to_radians().cos(), 30f64.to_radians().sin());
    assert_near(
        offset(&session, 278, 330, 327),
        (90.0 * x, 90.0 * y),
        "the planet about its star",
    );

    let original = open();
    session
        .apply(set_parent(278, 330, None, radius, angle))
        .expect("back to the centre");
    assert_eq!(
        common::entity_text(&session, EntityKind::Planet, 327),
        common::entity_text(&original, EntityKind::Planet, 327)
    );
    assert!(!common::entity_text(&session, EntityKind::Planet, 330).contains("moon_of"));
    assert_near(at(&session, 278, 330), at(&original, 278, 330), "330 back");
}

/// 328 orbits the companion star 327 with `binary_flags=73`: made a planet of the centre,
/// it leaves 327's `moons` and keeps its flags. A planet of a star has no moon bit, so it
/// can take a moon.
#[test]
fn a_companion_stars_planet_made_a_planet_of_the_centre() {
    let mut session = open();
    let result = snapshot_step(
        &mut session,
        "companion_planet_to_centre",
        set_parent(278, 328, None, 150.0, 0.0),
    );
    assert_eq!(
        result.entry.description,
        "Made planet #328 a planet of the system's centre"
    );
    assert!(
        matches!(
            result.inverse,
            Op::SetBodyParent {
                parent: Parent::Body(327),
                ..
            }
        ),
        "{:?}",
        result.inverse
    );
    let freed = common::entity_text(&session, EntityKind::Planet, 328);
    assert!(!freed.contains("moon_of"), "{freed}");
    assert!(freed.contains("\t\t\tbinary_flags=73\n"), "{freed}");
    let star = common::entity_text(&session, EntityKind::Planet, 327);
    assert!(
        star.contains("\t\t\tmoons=\n\t\t\t{\n\t\t\t\t329 \n"),
        "{star}"
    );

    let mut session = open();
    session
        .apply(set_parent(278, 331, Some(329), 15.0, 0.0))
        .expect("a planet of a star takes a moon");
    assert_eq!(planet(&session, 278, 331).parent, Some(329));
}

/// Alpha Centauri's companion star 327 given a class the name rule does not know, which the
/// install says is a star's: planet 330 dropped on it becomes its planet, not a moon.
#[test]
fn a_planet_dropped_on_a_modded_companion_star_is_its_planet() {
    let mut session = common::open_edited(|gamestate| {
        let entity = gamestate
            .find(
                "
		327=
		{",
            )
            .expect("planet 327");
        let key = "planet_class=\"";
        let class = entity + gamestate[entity..].find(key).expect("its class") + key.len();
        let end = class + gamestate[class..].find('"').expect("the class's end");
        gamestate.replace_range(class..end, "pc_modded_dwarf");
    });
    session.set_star_classes(StarClasses {
        bodies: Some(["pc_modded_dwarf".to_owned()].into()),
        ..StarClasses::default()
    });
    assert_eq!(planet(&session, 278, 327).role, BodyRole::Star);
    session
        .apply(orbit_star(278, 330, 327, 90.0, 30.0))
        .expect("a planet of the star");
    let planet_330 = common::entity_text(&session, EntityKind::Planet, 330);
    assert!(
        planet_330.contains(
            "			moon_of=327
"
        ),
        "{planet_330}"
    );
    assert!(!planet_330.contains("\t\t\tbinary_flags="), "{planet_330}");
}

/// A planet with moons may orbit a star but not a planet, and the asteroids of the 4.5
/// sample's system 76 that name the star at its centre as `moon_of` already orbit the
/// centre.
#[test]
fn what_a_star_parent_refuses() {
    let mut session = open();
    common::assert_refusals(
        &mut session,
        [
            (
                set_parent(278, 330, Some(328), 15.0, 0.0),
                "planet 330 has moons, so it cannot become a moon",
            ),
            (
                orbit_star(278, 328, 327, 90.0, 0.0),
                "planet 328 already has that parent",
            ),
        ],
    );
    let mut session = open_4_5();
    common::assert_refusals(
        &mut session,
        [
            (
                set_parent(76, 1271, None, 40.0, 0.0),
                "planet 1271 already has that parent",
            ),
            (
                orbit_star(76, 1271, 1270, 40.0, 0.0),
                "planet 1270 is the system's primary body: to make planet 1271 a planet, give it no parent",
            ),
        ],
    );
}
