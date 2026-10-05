//! Moving a save body along and across its orbit on the 4.x samples: each move's diff, the
//! inner radius it grows, byte-exact undo, and what is refused.

use sgf_core::entity::EntityKind;
use sgf_core::format::save::details::{Bounds, HeuristicResolver, RawPlanet};
use sgf_core::ops::Parent;
use sgf_core::ops::{Op, OpError, Subject, SystemRadii};
use sgf_core::projections::geometry::{Body, system_reach};
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::{current, open_4_5, text};

pub(crate) fn move_body(system: u32, body: u32, radius: f64, angle: f64) -> Op {
    Op::MoveBody {
        system,
        body,
        radius,
        angle,
    }
}

pub(crate) fn set_parent(
    system: u32,
    body: u32,
    parent: Option<u32>,
    radius: f64,
    angle: f64,
) -> Op {
    Op::SetBodyParent {
        system,
        body,
        parent: parent.into(),
        radius,
        angle,
    }
}

pub(crate) fn orbit_star(system: u32, body: u32, star: u32, radius: f64, angle: f64) -> Op {
    Op::SetBodyParent {
        system,
        body,
        parent: Parent::Body(star),
        radius,
        angle,
    }
}

pub(crate) fn planet(session: &Session, system: u32, id: u32) -> RawPlanet {
    common::planets(session, system)
        .into_iter()
        .find(|p| p.id == id)
        .unwrap_or_else(|| panic!("planet {id}"))
}

pub(crate) fn at(session: &Session, system: u32, id: u32) -> (f64, f64) {
    planet(session, system, id).at.expect("a point")
}

/// Where `moon` stands from `parent`.
pub(crate) fn offset(session: &Session, system: u32, moon: u32, parent: u32) -> (f64, f64) {
    let (mx, my) = at(session, system, moon);
    let (px, py) = at(session, system, parent);
    (mx - px, my - py)
}

pub(crate) fn assert_near(a: (f64, f64), b: (f64, f64), what: &str) {
    assert!(
        (a.0 - b.0).abs() < 1e-4 && (a.1 - b.1).abs() < 1e-4,
        "{what}: {a:?} is not {b:?}"
    );
}

/// The radius the scene draws `id` at about its parent.
pub(crate) fn drawn(session: &Session, system: u32, id: u32) -> f64 {
    let details = session.details().expect("details");
    let resolved = details
        .resolve(system, &HeuristicResolver, false)
        .expect("the system's details");
    let body = resolved.planets.into_iter().find(|p| p.id == id);
    let layout = body.and_then(|p| p.layout).expect("the body's layout");
    layout.orbit.expect("a drawn radius").min
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
    let Op::MoveBody {
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
         set the inner radius of Xu Nur #1 from 186.71 to 225"
    );
    let Op::Batch { ops, .. } = &result.inverse else {
        panic!("a batch, not {:?}", result.inverse);
    };
    assert!(
        matches!(ops[..], [Op::MoveBody { body: 585, .. }, _]),
        "{ops:?}"
    );
    assert_eq!(
        ops[1],
        Op::SetInnerRadius {
            system: 1,
            radius: 186.71
        }
    );
    assert!(result.subjects.contains(&Subject::System(1)));
    let details = session.details().expect("details");
    assert_eq!(details.raw(1).expect("system 1").inner_radius, Some(225.0));
}

/// System 14 of the 4.5 sample has its inner radius at 150 and a belt at 230, out past it.
/// Planet 713 moved to 200 is inside the belt but outside the inner radius, so the inner
/// radius grows to 230, and so it does for a belt added at 200.
#[test]
fn a_body_moved_outside_the_inner_radius_inside_a_belt_past_it_grows_it() {
    let mut session = open_4_5();
    let details = session.details().expect("details");
    let raw = details.raw(14).expect("system 14");
    assert_eq!(raw.inner_radius, Some(150.0));
    let belts: Vec<f64> = raw.belts.iter().map(|b| b.inner_radius).collect();
    assert_eq!(belts, [230.0]);

    let result = snapshot_step(
        &mut session,
        "outside_the_inner_radius_inside_a_belt",
        move_body(14, 713, 200.0, 0.0),
    );
    assert!(
        result
            .entry
            .description
            .ends_with("; set the inner radius of Mareenius #14 from 150 to 230"),
        "{}",
        result.entry.description
    );
    let details = session.details().expect("details");
    assert_eq!(
        details.raw(14).expect("system 14").inner_radius,
        Some(230.0)
    );

    let mut session = open_4_5();
    let result = session
        .apply(Op::AddBelt {
            system: 14,
            kind: "rocky_asteroid_belt".to_owned(),
            radius: 200.0,
        })
        .expect("the belt");
    assert!(
        result
            .entry
            .description
            .ends_with("; set the inner radius of Mareenius #14 from 150 to 230"),
        "{}",
        result.entry.description
    );
}

/// Systems of the 4.5 sample below the rule whose outermost reach is a moon: system 2's
/// moon 604 of planet 603, drawn 200.06 out, and the like. Dragging the planet round its
/// ring takes the moon no further, so the inner radius stays at every fifth degree.
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
        for angle in (0..360).step_by(5) {
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
    assert!(common::entity_text(&session, EntityKind::Planet, 585).contains("\t\t\torbit=65\n"));
    session.apply(result.inverse).expect("move it back");
    assert_eq!(current(&session), session.doc().original());
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
            "planet 584 stands at the system's centre",
        ),
        (
            set_parent(1, 584, None, 10.0, 0.0),
            "planet 584 stands at the system's centre",
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
        (
            orbit_star(1, 588, 584, 20.0, 0.0),
            "planet 584 is the system's primary body: to make planet 588 a planet, give it no parent",
        ),
    ];
    common::assert_refusals(&mut session, refusals);
}

/// The systems of the 4.5 sample, 522 of its 601, whose `inner_radius` sits inside the
/// generator's max(150, outermost reach + 30), with reach measured from where each body is
/// drawn and an event-placed body at `orbit` zero or less set aside (`system_reach`). The
/// ops take the system's own value as the floor for these, so they can be edited without
/// their radius jumping out.
#[test]
fn the_4_5_samples_systems_below_the_inner_radius_rule() {
    let session = open_4_5();
    let details = session.details().expect("details");
    let below = session
        .graph()
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
            raw.inner_radius.is_some_and(|radius| {
                radius < SystemRadii::VANILLA.inner_about(system_reach(&bodies, &[]))
            })
        })
        .count();
    assert_eq!(below, 522);
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

/// A session given other radii, as an install's defines can set them, grows system 1 by
/// their offsets and floors its inner radius by their minimum: 585's moon reaching 195
/// grows it to 245, and the outer radius to 445.
#[test]
fn a_session_with_other_radii_sizes_systems_by_them() {
    let radii = SystemRadii {
        min_inner: 170.0,
        inner_offset: 50.0,
        outer_offset: 200.0,
    };
    let mut session = open_4_5();
    session.set_radii(radii);
    session
        .apply(move_body(1, 585, 180.0, 40.0))
        .expect("the move");
    assert!(
        text(&session).contains("\t\tinner_radius=245\n\t\touter_radius=445\n"),
        "system 1 grown by the session's radii"
    );

    let mut session = open_4_5();
    session.set_radii(radii);
    let error = session
        .apply(Op::SetInnerRadius {
            system: 1,
            radius: 165.0,
        })
        .expect_err("below the session's minimum");
    assert!(
        matches!(error, OpError::InnerRadiusTooSmall { least } if least == 170.0),
        "{error}"
    );
}
