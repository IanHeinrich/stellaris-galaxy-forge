//! A shape's systems added to a save as one batch: the ids they take, the lanes between
//! them and to a held system, one undo step, and what the builder refuses before any op
//! is applied.

use sgf_core::ops::{BULK_ADD_CAP, LaneEnd, Op, OpError, SystemSpec};
use sgf_core::session::Session;

use crate::common;
use common::diff::{report, round_trip_step};
use common::open_4_5;
use common::spec::{SAMPLE_4_5, mura, small};

const DESCRIPTION: &str = "Added 3 systems in a ring";

fn specs(points: &[(f64, f64)]) -> Vec<SystemSpec> {
    points
        .iter()
        .enumerate()
        .map(|(i, &at)| small(&format!("Sgf_Shape_{i}"), at, Vec::new()))
        .collect()
}

/// Three systems at the spike's place and the two beside it.
fn three() -> Vec<SystemSpec> {
    let spike = mura();
    let [a, b] = SAMPLE_4_5.spots;
    specs(&[(spike.x, spike.y), a, b])
}

fn new(index: u32) -> LaneEnd {
    LaneEnd::New { index }
}

fn shape_op(session: &Session, specs: Vec<SystemSpec>, lanes: &[(LaneEnd, LaneEnd)]) -> Op {
    session
        .save("adding systems")
        .expect("a 4.5 save")
        .add_systems_op(specs, lanes, DESCRIPTION.to_owned())
        .expect("the op")
}

fn refused(specs: Vec<SystemSpec>, lanes: &[(LaneEnd, LaneEnd)]) -> OpError {
    let session = open_4_5();
    let error = session
        .save("adding systems")
        .expect("a 4.5 save")
        .add_systems_op(specs, lanes, DESCRIPTION.to_owned())
        .expect_err("refused");
    assert!(!session.doc().is_dirty(), "{error}");
    assert!(session.history().undo.is_empty(), "{error}");
    error
}

/// The three take the ids after the save's last, each marked added, joined in a ring with
/// the middle one linked to a system the save holds; one undo takes them all out byte for
/// byte and redo writes the same bytes.
#[test]
fn three_systems_in_a_ring_with_a_lane_to_a_held_system() {
    let mut session = open_4_5();
    let first = SAMPLE_4_5.id;
    let held = SAMPLE_4_5.near[0];
    let lanes = [
        (new(0), new(1)),
        (new(1), new(2)),
        (new(2), new(0)),
        (new(1), LaneEnd::Held { system: held }),
    ];
    let op = shape_op(&session, three(), &lanes);
    let result = round_trip_step(&mut session, "shape", op);

    assert_eq!(result.entry.description, DESCRIPTION);
    for id in first..first + 3 {
        assert!(session.system(id).expect("a new system").added, "{id}");
    }
    assert!(session.system(first + 3).is_none());
    let graph = session.graph();
    for (a, b) in [
        (first, first + 1),
        (first + 1, first + 2),
        (first + 2, first),
        (first + 1, held),
    ] {
        assert!(graph.lane(a, b).is_some(), "{a}-{b}");
    }
    common::snapshot("ring_and_held_lane", &report(&session, &result));
}

#[test]
fn what_the_builder_refuses() {
    let [a, _] = SAMPLE_4_5.spots;

    let error = refused(specs(&[a; BULK_ADD_CAP + 1]), &[]);
    assert!(
        matches!(
            error,
            OpError::TooManySystems {
                count: 201,
                cap: 200
            }
        ),
        "{error}"
    );

    let held = SAMPLE_4_5.near[0];
    let system = open_4_5().system(held).expect("the held system").clone();
    let error = refused(specs(&[(system.x + 9.9, system.y)]), &[]);
    assert!(
        matches!(error, OpError::TooClose { id, distance } if id == held && (distance - 9.9).abs() < 1e-9),
        "{error}"
    );

    let error = refused(specs(&[a, (a.0 - 9.9, a.1)]), &[]);
    assert!(
        matches!(error, OpError::TooClose { id, distance } if id == SAMPLE_4_5.id && (distance - 9.9).abs() < 1e-9),
        "{error}"
    );

    let error = refused(three(), &[(new(0), new(3))]);
    assert!(
        matches!(error, OpError::UnknownSystem(id) if id == SAMPLE_4_5.id + 3),
        "{error}"
    );

    let error = refused(Vec::new(), &[]);
    assert!(matches!(error, OpError::EmptyBatch), "{error}");
}
