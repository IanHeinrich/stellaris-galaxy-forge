//! `PreventLane` and `UnpreventLane` on the grammar fixture: the diff each one produces
//! is snapshotted, the pairs each end reports are checked, and undo is checked for byte
//! identity against the file as it was opened.

use sgf_core::ops::{Op, OpError};

use crate::common;
use common::current;
use common::diff::{round_trip, snapshot};
use common::fixture::GRAMMAR;

#[test]
fn prevent_writes_one_statement_for_a_pair_with_no_lane() {
    snapshot(
        "prevent_2_9",
        GRAMMAR.open(),
        Op::PreventLane { a: 2, b: 9 },
    );
}

#[test]
fn prevent_is_refused_when_the_pair_is_linked_either_way_round() {
    let mut session = GRAMMAR.open();
    for (a, b) in [(1, 2), (2, 1)] {
        let error = session
            .apply(Op::PreventLane { a, b })
            .expect_err("refused");
        assert!(matches!(error, OpError::PreventLinked(_, _)), "{error}");
    }
    assert!(!session.is_dirty());
}

#[test]
fn prevent_is_refused_when_the_pair_is_prevented_either_way_round() {
    let mut session = GRAMMAR.open();
    for (a, b) in [(9, 1), (1, 9)] {
        let error = session
            .apply(Op::PreventLane { a, b })
            .expect_err("refused");
        assert!(matches!(error, OpError::PreventExists(_, _)), "{error}");
    }
    assert!(!session.is_dirty());
}

#[test]
fn prevent_is_refused_for_a_system_that_is_not_there() {
    let mut session = GRAMMAR.open();
    let error = session
        .apply(Op::PreventLane { a: 2, b: 4242 })
        .expect_err("refused");
    assert!(matches!(error, OpError::UnknownSystem(4242)), "{error}");
    let error = session
        .apply(Op::PreventLane { a: 2, b: 2 })
        .expect_err("refused");
    assert!(matches!(error, OpError::SelfLane(2)), "{error}");
    assert!(!session.is_dirty());
}

#[test]
fn unprevent_erases_the_whole_line() {
    snapshot(
        "unprevent_9_1",
        GRAMMAR.open(),
        Op::UnpreventLane { a: 1, b: 9 },
    );
}

#[test]
fn unprevent_is_refused_when_the_pair_is_not_prevented() {
    let mut session = GRAMMAR.open();
    let error = session
        .apply(Op::UnpreventLane { a: 1, b: 2 })
        .expect_err("refused");
    assert!(matches!(error, OpError::NotPrevented(1, 2)), "{error}");
    assert!(!session.is_dirty());
}

#[test]
fn a_linked_pair_is_cut_and_prevented_as_one_edit() {
    let cut_and_prevent = || Op::Batch {
        description: "Cut and prevented lane 1 <-> 2".into(),
        ops: vec![
            Op::RemoveLane { a: 1, b: 2 },
            Op::PreventLane { a: 1, b: 2 },
        ],
    };
    let mut session = GRAMMAR.open();
    session.apply(cut_and_prevent()).expect("apply");
    assert!(session.graph.lane(1, 2).is_none());
    assert!(session.graph.lane(2, 1).is_none());
    assert!(session.graph.systems[&1].prevented.contains(&2));
    round_trip(GRAMMAR.open(), cut_and_prevent());
}

#[test]
fn a_prevention_this_session_inserted_can_be_taken_out_again() {
    let fixture = GRAMMAR.bytes();
    let mut session = GRAMMAR.open();
    session
        .apply(Op::PreventLane { a: 2, b: 9 })
        .expect("prevent");
    session
        .apply(Op::UnpreventLane { a: 9, b: 2 })
        .expect("unprevent the statement just inserted");
    assert!(session.graph.systems[&2].prevented.is_empty());
    for _ in 0..2 {
        session.undo().expect("undo").expect("an op to undo");
    }
    assert_eq!(current(&session), fixture, "undo is not byte-identical");
}

#[test]
fn a_prevented_pair_reaches_both_ends_and_an_unprevented_one_leaves_them() {
    let mut session = GRAMMAR.open();
    assert_eq!(session.graph.systems[&9].prevented, [1]);
    assert_eq!(session.graph.systems[&1].prevented, [9]);
    assert!(session.graph.systems[&2].prevented.is_empty());

    session
        .apply(Op::PreventLane { a: 2, b: 9 })
        .expect("apply");
    assert_eq!(session.graph.systems[&2].prevented, [9]);
    assert_eq!(session.graph.systems[&9].prevented, [1, 2]);
    assert!(session.graph.lane(2, 9).is_none(), "prevention is no lane");

    session
        .apply(Op::UnpreventLane { a: 9, b: 1 })
        .expect("apply");
    assert_eq!(session.graph.systems[&9].prevented, [2]);
    assert!(session.graph.systems[&1].prevented.is_empty());
}

#[test]
fn removing_an_endpoint_drops_the_prevent_statement() {
    let mut session = GRAMMAR.open();
    session.apply(Op::RemoveSystem { id: 9 }).expect("remove");
    assert!(session.graph.systems[&1].prevented.is_empty());
    let text = String::from_utf8(current(&session)).expect("utf-8");
    assert!(!text.contains("prevent_hyperlane"), "{text}");
}
