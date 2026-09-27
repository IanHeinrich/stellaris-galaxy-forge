//! Moving a save body along and across its orbit, and making it a moon or a planet, on the
//! 4.x samples: each edit's diff, the inner radius it grows, byte-exact undo, and what is
//! refused.

use sgf_core::format::save::details::{Bounds, HeuristicResolver, RawPlanet};
use sgf_core::ops::rules::bodies::{Body, least_inner_radius};
use sgf_core::ops::{Op, Subject};
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::{current, open, open_3_4, open_4_5, text};

fn move_body(system: u32, body: u32, radius: f64, angle: f64) -> Op {
    Op::MoveSaveBody {
        system,
        body,
        radius,
        angle,
    }
}

fn set_parent(system: u32, body: u32, parent: Option<u32>, radius: f64, angle: f64) -> Op {
    Op::SetSaveBodyParent {
        system,
        body,
        parent,
        radius,
        angle,
    }
}

fn planet(session: &Session, system: u32, id: u32) -> RawPlanet {
    common::planets(session, system)
        .into_iter()
        .find(|p| p.id == id)
        .unwrap_or_else(|| panic!("planet {id}"))
}

fn at(session: &Session, system: u32, id: u32) -> (f64, f64) {
    planet(session, system, id).at.expect("a point")
}

/// Where `moon` stands from `parent`.
fn offset(session: &Session, system: u32, moon: u32, parent: u32) -> (f64, f64) {
    let (mx, my) = at(session, system, moon);
    let (px, py) = at(session, system, parent);
    (mx - px, my - py)
}

fn assert_near(a: (f64, f64), b: (f64, f64), what: &str) {
    assert!(
        (a.0 - b.0).abs() < 1e-4 && (a.1 - b.1).abs() < 1e-4,
        "{what}: {a:?} is not {b:?}"
    );
}

/// The radius the scene draws `id` at about its parent.
fn drawn(session: &Session, system: u32, id: u32) -> f64 {
    let details = session.details().expect("details");
    let resolved = details
        .resolve(system, &HeuristicResolver, false)
        .expect("the system's details");
    let body = resolved.planets.into_iter().find(|p| p.id == id);
    let layout = body.and_then(|p| p.layout).expect("the body's layout");
    layout.orbit.expect("a drawn radius").min
}

/// The planet's entity as the session's bytes now hold it.
fn entity(session: &Session, id: u32) -> String {
    let text = text(session);
    let planets = text.find("\nplanets=\n").expect("the planets");
    let start = planets
        + text[planets..]
            .find(&format!("\n\t\t{id}=\n\t\t{{\n"))
            .unwrap_or_else(|| panic!("planet {id}"));
    let end = start + 1 + text[start + 1..].find("\n\t\t}\n").expect("its end");
    text[start..end].to_owned()
}

/// Planet 585 of the 4.5 sample's system 1 stands 65.02 from the star, its moon 586 at
/// 15 from it.
#[test]
fn a_planet_moved_along_its_ring_takes_its_moon_with_it() {
    let mut session = open_4_5();
    let radius = drawn(&session, 1, 585);
    let moon = offset(&session, 1, 586, 585);
    let result = snapshot_step(
        &mut session,
        "along_its_ring",
        move_body(1, 585, radius, 100.0),
    );
    assert_eq!(
        result.entry.description,
        "Moved planet #585 from orbit 65.02 at 28.2° to orbit 65.02 at 100°, with its moon #586"
    );
    let Op::MoveSaveBody {
        system: 1,
        body: 585,
        radius: back,
        angle,
    } = result.inverse
    else {
        panic!("a move back, not {:?}", result.inverse);
    };
    assert!((back - radius).abs() < 1e-9, "{back}");
    assert!((angle - 28.198).abs() < 0.001, "{angle}");
    assert_eq!(result.details_stale, [1]);
    assert_near(offset(&session, 1, 586, 585), moon, "the moon's step");
    assert_eq!(planet(&session, 1, 586).orbit, Some(15.0));
    assert!((drawn(&session, 1, 585) - radius).abs() < 1e-4);
}

/// System 1's inner radius is 186.71. At 180 out, 585's moon reaches 195, so the inner
/// radius grows to 225 with the move, and undo takes both back.
#[test]
fn a_planet_moved_past_the_inner_radius_grows_it() {
    let mut session = open_4_5();
    let result = snapshot_step(
        &mut session,
        "across_past_the_inner_radius",
        move_body(1, 585, 180.0, 40.0),
    );
    assert_eq!(
        result.entry.description,
        "Moved planet #585 from orbit 65.02 at 28.2° to orbit 180 at 40°, with its moon #586; \
         set the inner radius of system #1 from 186.71 to 225"
    );
    let Op::Batch { ops, .. } = &result.inverse else {
        panic!("a batch, not {:?}", result.inverse);
    };
    assert!(
        matches!(ops[..], [Op::MoveSaveBody { body: 585, .. }, _]),
        "{ops:?}"
    );
    assert_eq!(
        ops[1],
        Op::SetSaveInnerRadius {
            system: 1,
            radius: 186.71
        }
    );
    assert!(result.subjects.contains(&Subject::System(1)));
    let details = session.details().expect("details");
    assert_eq!(details.raw(1).expect("system 1").inner_radius, Some(225.0));
}

/// Systems of the 4.5 sample below the rule whose outermost reach is a moon: system 2's
/// moon 604 of planet 603, drawn 200.06 out, and the like. Dragging the planet round its
/// ring takes the moon no further, so the inner radius stays at every whole degree.
#[test]
fn a_planet_with_a_moon_moved_round_its_ring_leaves_the_inner_radius() {
    let mut session = open_4_5();
    for (system, planet) in [
        (0, 582),
        (2, 603),
        (21, 768),
        (30, 855),
        (34, 909),
        (47, 1028),
    ] {
        let radius = drawn(&session, system, planet);
        for angle in 0..360 {
            let result = session
                .apply(move_body(system, planet, radius, f64::from(angle)))
                .unwrap_or_else(|e| panic!("move {planet} to {angle}°: {e}"));
            assert!(
                !result.subjects.contains(&Subject::System(system)),
                "{angle}°: {}",
                result.entry.description
            );
            session.undo().expect("undo").expect("the move");
        }
    }
}

/// Moved along its ring, 585 keeps its stored `orbit=65` though it is drawn 65.02 out,
/// and the move back writes the bytes the game wrote.
#[test]
fn a_move_along_the_ring_keeps_the_stored_orbit() {
    let mut session = open_4_5();
    let radius = drawn(&session, 1, 585);
    let result = session
        .apply(move_body(1, 585, radius, 100.0))
        .expect("move 585 along its ring");
    assert!(entity(&session, 585).contains("\t\t\torbit=65\n"));
    session.apply(result.inverse).expect("move it back");
    assert_eq!(current(&session), session.doc.original());
}

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
    let host = entity(&session, 588);
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
    let Op::SetSaveBodyParent {
        body: 588,
        parent: None,
        ..
    } = result.inverse
    else {
        panic!("the parent put back, not {:?}", result.inverse);
    };
    let moon = planet(&session, 1, 588);
    assert_eq!((moon.parent, moon.moon), (Some(589), true));
    assert_near(offset(&session, 1, 588, 589), (0.0, 20.0), "the new moon");
    let host = entity(&session, 589);
    assert!(
        host.contains("\t\t\tmoons=\n\t\t\t{\n\t\t\t\t588 590 \n"),
        "{host}"
    );
    let moon = entity(&session, 588);
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
            Op::SetSaveBodyParent {
                body: 590,
                parent: Some(589),
                ..
            }
        ),
        "{:?}",
        result.inverse
    );
    let host = entity(&session, 589);
    assert!(!host.contains("moons="), "{host}");
    assert!(host.contains("\t\t\tbinary_flags=320\n"), "{host}");
    let freed = entity(&session, 590);
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
    let freed = entity(&session, 58);
    assert!(freed.contains("\t\t\tbinary_flags=65\n"), "{freed}");
}

/// Carmenekke (system 53 of the 4.4 sample): planet 1205's moon 1206 has a moon of its
/// own, 1207, and all of them move with 1205.
#[test]
fn a_moon_of_a_moon_moves_with_its_planet() {
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
        "Moved planet #1205 from orbit 220.02 at 128.38° to orbit 220.02 at 100°, with its \
         moons #1206, #1207, #1208, #1209 and #1210"
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

#[test]
fn a_moved_moon_round_trips() {
    round_trip(open_4_5(), move_body(1, 586, 20.0, 300.0));
    round_trip(open_4_5(), set_parent(1, 590, Some(585), 20.0, 0.0));
}

#[test]
fn a_move_to_where_the_body_stands_is_refused() {
    let mut session = open_4_5();
    session
        .apply(move_body(1, 585, 70.0, 40.0))
        .expect("the first move");
    let error = session
        .apply(move_body(1, 585, 70.0, 400.0))
        .expect_err("already there");
    assert_eq!(error.to_string(), "planet 585 already stands there");
    assert_eq!(session.history().undo.len(), 1);
}

#[test]
fn body_edits_are_refused() {
    let mut session = open_4_5();
    let refusals = [
        (
            move_body(1, 584, 10.0, 0.0),
            "planet 584 is its system's primary body, which stays where it is",
        ),
        (
            set_parent(1, 584, None, 10.0, 0.0),
            "planet 584 is its system's primary body, which stays where it is",
        ),
        (
            move_body(2, 585, 70.0, 40.0),
            "planet 585 is not a body of system 2",
        ),
        (
            move_body(1, 99_999, 70.0, 40.0),
            "planet 99999 does not exist",
        ),
        (
            move_body(1, 585, 0.0, 40.0),
            "radius 0 is invalid: a body's orbit must be greater than zero",
        ),
        (
            move_body(1, 585, f64::NAN, 40.0),
            "value is not a finite number",
        ),
        (
            move_body(1, 585, 70.0, f64::NAN),
            "value is not a finite number",
        ),
        (
            set_parent(1, 588, Some(52), 20.0, 0.0),
            "planet 52 is not a body of system 1",
        ),
        (
            set_parent(1, 588, Some(588), 20.0, 0.0),
            "planet 588 cannot orbit itself",
        ),
        (
            set_parent(26, 807, Some(810), 20.0, 0.0),
            "planet 810 is one of planet 807's moons, so it cannot be its parent",
        ),
        (
            set_parent(1, 588, Some(586), 20.0, 0.0),
            "planet 586 is a moon, and a moon cannot have moons",
        ),
        (
            set_parent(1, 588, Some(584), 20.0, 0.0),
            "planet 584 is the system's primary body: to make planet 588 a planet, give it no parent",
        ),
        (
            set_parent(1, 585, Some(589), 20.0, 0.0),
            "planet 585 has moons, so it cannot become a moon",
        ),
        (
            set_parent(1, 590, Some(589), 20.0, 0.0),
            "planet 590 already has that parent",
        ),
        (
            set_parent(1, 588, None, 20.0, 0.0),
            "planet 588 already has that parent",
        ),
    ];
    for (op, message) in refusals {
        let error = session.apply(op).expect_err(message);
        assert_eq!(error.to_string(), message);
    }
    assert!(!session.doc.is_dirty());
    assert!(session.history().undo.is_empty());
}

#[test]
fn a_3_4_save_refuses_body_edits() {
    let mut session = open_3_4();
    for op in [
        move_body(1, 2, 70.0, 40.0),
        set_parent(1, 2, None, 70.0, 40.0),
    ] {
        let error = session.apply(op).expect_err("a 3.4 save");
        assert!(
            error
                .to_string()
                .starts_with("this edit needs a save from Stellaris 4.0 or later"),
            "{error}"
        );
    }
}

/// The systems of the 4.5 sample, 531 of its 601, whose `inner_radius` sits inside
/// max(150, outermost reach + 30) with reach measured from where each body is drawn. A move
/// there grows the radius only once a body passes the old reach, and setting the radius
/// takes the system's own value as its floor, so these systems can be edited without their
/// radius jumping out.
#[test]
fn the_4_5_samples_systems_below_the_inner_radius_rule() {
    let session = open_4_5();
    let details = session.details().expect("details");
    let below = session
        .graph
        .systems
        .keys()
        .filter(|&&id| {
            let raw = details.raw(id).expect("the system's details");
            let bodies: Vec<Body> = raw
                .planets
                .iter()
                .filter_map(|p| {
                    Some(Body {
                        id: p.id,
                        parent: p.parent,
                        at: p.at?,
                        orbit: p.orbit?,
                    })
                })
                .collect();
            raw.inner_radius
                .is_some_and(|radius| radius < least_inner_radius(&bodies))
        })
        .count();
    assert_eq!(below, 531);
}

/// 585's drawn radius and point, read back through the details after the move.
#[test]
fn a_moved_planets_layout_is_what_was_sent() {
    let mut session = open_4_5();
    session.apply(move_body(1, 585, 70.0, 40.0)).expect("move");
    let details = session.details().expect("details");
    let system = details
        .resolve(1, &HeuristicResolver, false)
        .expect("system 1");
    let body = system.planets.iter().find(|p| p.id == 585).expect("585");
    let layout = body.layout.clone().expect("a layout");
    assert_eq!(layout.orbit, Some(Bounds::fixed(70.0)));
    let angle = 40f64.to_radians();
    assert_near(
        layout.at.expect("a point"),
        (70.0 * angle.cos(), 70.0 * angle.sin()),
        "585's point",
    );
}
