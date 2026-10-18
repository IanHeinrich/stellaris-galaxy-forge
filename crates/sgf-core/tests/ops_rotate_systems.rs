//! A selection of systems turned about a point, on the sample save and the grammar
//! fixture: the diff a turn writes is snapshotted, the nebulae it carries are checked
//! against the systems' new positions, and undo puts back the bytes as opened.

use sgf_core::ops::{Op, OpError};
use sgf_core::session::Session;

use crate::common;
use common::diff::report;
use common::fixture::{GRAMMAR, from_scenario_text};
use common::{current, open, reprojected};

fn rotate(systems: &[u32], pivot: (f64, f64), degrees: f64, nebulae: bool) -> Op {
    Op::RotateSystems {
        systems: systems.to_vec(),
        pivot,
        degrees,
        nebulae,
    }
}

/// The ids of the systems that lie inside the `index`th cloud's circle, ascending.
fn inside(session: &Session, index: usize) -> Vec<u32> {
    let graph = session.graph();
    let n = &graph.nebulae[index];
    let mut ids: Vec<u32> = (graph.systems.values())
        .filter(|s| (s.x - n.x).hypot(s.y - n.y) <= n.radius)
        .map(|s| s.id)
        .collect();
    ids.sort_unstable();
    ids
}

/// Four members of nebula 0 and Mihil (455), which sits just outside it.
const SELECTION: [u32; 5] = [438, 623, 164, 108, 455];

/// [`SELECTION`]'s centroid, to two decimals.
fn centroid(session: &Session) -> (f64, f64) {
    let graph = session.graph();
    let n = SELECTION.len() as f64;
    let sum = SELECTION.iter().fold((0.0, 0.0), |acc, id| {
        (acc.0 + graph.systems[id].x, acc.1 + graph.systems[id].y)
    });
    let round = |v: f64| (v / n * 100.0).round() / 100.0;
    (round(sum.0), round(sum.1))
}

/// Nebula 0's centre is system 438's position, a corner of the selection's hull, so the
/// cloud turns with it and lands where 438 does.
#[test]
fn rotating_a_selection_with_its_nebula_decides_membership_on_the_moved_systems() {
    let mut session = open();
    let pivot = centroid(&session);
    let graph = session.graph();
    let before = graph.nebulae[0].clone();
    assert_eq!(
        (before.x, before.y),
        (graph.systems[&438].x, graph.systems[&438].y)
    );
    let stay: Vec<(u32, f64, f64)> = (graph.systems.values())
        .filter(|s| !SELECTION.contains(&s.id))
        .map(|s| (s.id, s.x, s.y))
        .collect();

    let result = session
        .apply(rotate(&SELECTION, pivot, -90.0, true))
        .unwrap();

    assert_eq!(
        result.entry.description,
        "Rotated 5 systems and 1 nebula by -90°"
    );
    let graph = session.graph();
    for (id, x, y) in stay {
        assert_eq!((graph.systems[&id].x, graph.systems[&id].y), (x, y), "{id}");
    }
    let corner = &graph.systems[&438];
    assert_eq!(
        (graph.nebulae[0].x, graph.nebulae[0].y),
        (corner.x, corner.y)
    );
    assert_eq!(graph.nebulae[0].radius, before.radius);

    // The members are the systems inside the turned circle at their turned positions.
    let members = inside(&session, 0);
    let mut listed = graph.nebulae[0].systems.clone();
    listed.sort_unstable();
    assert_eq!(listed, members);
    for system in graph.systems.values() {
        assert_eq!(
            system.nebula == Some(0),
            members.contains(&system.id),
            "system {}",
            system.id
        );
    }
    let fresh = reprojected(&session);
    assert_eq!(session.graph().systems, fresh.systems);
    assert_eq!(session.graph().nebulae, fresh.nebulae);
    common::snapshot("save_selection_and_nebula_0", &report(&session, &result));

    session.undo().unwrap().expect("undo");
    assert_eq!(current(&session), session.doc().original());
    assert_eq!(session.graph().nebulae[0], before);

    session.redo().unwrap().expect("redo");
    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc().original());
    assert_eq!(session.graph().nebulae[0], before);
}

#[test]
fn rotating_without_nebulae_leaves_every_cloud_where_it_stands() {
    let mut session = open();
    let pivot = centroid(&session);
    let before = session.graph().nebulae.clone();

    let result = session
        .apply(rotate(&SELECTION, pivot, -90.0, false))
        .unwrap();

    assert_eq!(result.entry.description, "Rotated 5 systems by -90°");
    let after = &session.graph().nebulae;
    for (was, now) in before.iter().zip(after) {
        assert_eq!((now.x, now.y, now.radius), (was.x, was.y, was.radius));
    }
    let mut listed = after[0].systems.clone();
    listed.sort_unstable();
    assert_eq!(listed, inside(&session, 0));

    session.undo().unwrap().expect("undo");
    assert_eq!(current(&session), session.doc().original());
}

/// Galactic Center, Coruscant and system 16 turned about Coruscant with the Heart of the
/// Galaxy, which leaves Corellia (111) outside the moved circle.
#[test]
fn rotating_a_scenario_selection_with_its_nebula_rebuilds_membership_on_the_moved_systems() {
    let fixture = GRAMMAR.bytes();
    let mut session = GRAMMAR.open();
    assert_eq!(session.graph().nebulae[0].systems, [1, 2, 111]);
    let before = session.graph().nebulae[0].clone();

    let result = session
        .apply(rotate(&[1, 2, 16], (0.0, -56.0), -90.0, true))
        .unwrap();

    assert_eq!(
        result.entry.description,
        "Rotated 3 systems and 1 nebula by -90°"
    );
    let graph = session.graph();
    assert_eq!((graph.systems[&1].x, graph.systems[&1].y), (-56.0, -56.0));
    assert_eq!((graph.systems[&2].x, graph.systems[&2].y), (0.0, -56.0));
    assert_eq!((graph.systems[&16].x, graph.systems[&16].y), (32.5, -110.0));
    assert_eq!((graph.nebulae[0].x, graph.nebulae[0].y), (-56.0, -56.0));
    assert_eq!(graph.nebulae[0].radius, before.radius);
    assert_eq!(graph.nebulae[0].systems, inside(&session, 0));
    assert_eq!(graph.nebulae[0].systems, [1, 2]);
    assert_eq!(graph.systems[&111].nebula, None);
    let far = &graph.nebulae[1];
    assert_eq!(
        (far.x, far.y),
        (-90.0, 90.0),
        "outside the hull, so it stays"
    );
    let fresh = from_scenario_text(current(&session));
    assert_eq!(session.graph().systems, fresh.graph().systems);
    assert_eq!(session.graph().nebulae, fresh.graph().nebulae);
    common::snapshot(
        "scenario_selection_and_nebula_0",
        &report(&session, &result),
    );

    session.undo().unwrap().expect("undo");
    assert_eq!(current(&session), fixture);
    assert_eq!(session.graph().nebulae[0], before);

    session.redo().unwrap().expect("redo");
    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), fixture);
    assert_eq!(session.graph().nebulae[0], before);
}

/// The map mirrors x, so a positive quarter turn takes Galactic Center from below
/// Coruscant, as the map shows them, to its left: (0, 0) about (0, -56) to (56, -56). The
/// Heart of the Galaxy sits on Galactic Center, an end of the two systems' segment.
#[test]
fn a_positive_turn_is_clockwise_as_the_map_shows_it() {
    let mut session = GRAMMAR.open();
    let result = session
        .apply(rotate(&[1, 2], (0.0, -56.0), 90.0, true))
        .unwrap();
    assert_eq!(
        result.entry.description,
        "Rotated 2 systems and 1 nebula by 90°"
    );
    let graph = session.graph();
    assert_eq!((graph.systems[&1].x, graph.systems[&1].y), (56.0, -56.0));
    assert_eq!((graph.systems[&2].x, graph.systems[&2].y), (0.0, -56.0));
    assert_eq!((graph.nebulae[0].x, graph.nebulae[0].y), (56.0, -56.0));
}

#[test]
fn the_description_reads_the_angle_as_the_map_drag_does() {
    for (degrees, shown) in [
        (180.0, "180"),
        (-180.0, "180"),
        (540.0, "180"),
        (270.0, "-90"),
        (-45.0, "-45"),
        (22.5, "22.5"),
        (100.0 / 3.0, "33.33"),
    ] {
        let mut session = GRAMMAR.open();
        let result = session
            .apply(rotate(&[2, 16], (0.0, -56.0), degrees, false))
            .unwrap();
        assert_eq!(
            result.entry.description,
            format!("Rotated 2 systems by {shown}°"),
            "{degrees}"
        );
    }
}

#[test]
fn a_rotation_refuses_a_bad_selection_a_non_finite_turn_and_a_whole_number_of_turns() {
    let mut session = GRAMMAR.open();
    let pivot = (0.0, -56.0);
    let refused = |session: &mut Session, op: Op| session.apply(op).expect_err("refused");
    assert!(matches!(
        refused(&mut session, rotate(&[], pivot, 90.0, true)),
        OpError::NoEntries
    ));
    assert!(matches!(
        refused(&mut session, rotate(&[1, 2, 1], pivot, 90.0, true)),
        OpError::DuplicateSystem(1)
    ));
    assert!(matches!(
        refused(&mut session, rotate(&[1, 999], pivot, 90.0, true)),
        OpError::UnknownSystem(999)
    ));
    for (pivot, degrees) in [
        ((f64::NAN, -56.0), 90.0),
        ((0.0, f64::INFINITY), 90.0),
        (pivot, f64::NAN),
    ] {
        assert!(matches!(
            refused(&mut session, rotate(&[1, 2], pivot, degrees, true)),
            OpError::NotFinite
        ));
    }
    for degrees in [0.0, 360.0, -720.0] {
        assert!(matches!(
            refused(&mut session, rotate(&[1, 2], pivot, degrees, true)),
            OpError::Unchanged { .. }
        ));
    }
    let whole = rotate(&[1, 2], pivot, 360.0, true);
    assert_eq!(
        session.check_op(&whole).as_deref(),
        Some("a turn of 360° about (0, -56) leaves 2 systems where they stand")
    );
    assert_eq!(session.check_op(&rotate(&[1, 2], pivot, 90.0, true)), None);
    assert_eq!(current(&session), GRAMMAR.bytes());
}

#[test]
fn a_rotation_in_a_batch_is_one_undo_step_with_the_rest() {
    let mut session = GRAMMAR.open();
    let result = session
        .apply(Op::Batch {
            description: "Turned and moved".to_owned(),
            ops: vec![
                rotate(&[1, 2], (0.0, -56.0), 90.0, true),
                Op::MoveSystem {
                    system: 16,
                    x: 10.0,
                    y: 10.0,
                },
            ],
        })
        .unwrap();
    assert_eq!(result.entry.description, "Turned and moved");
    let graph = session.graph();
    assert_eq!((graph.systems[&1].x, graph.systems[&1].y), (56.0, -56.0));
    assert_eq!((graph.systems[&16].x, graph.systems[&16].y), (10.0, 10.0));

    session.undo().unwrap().expect("undo");
    assert_eq!(current(&session), GRAMMAR.bytes());
}
