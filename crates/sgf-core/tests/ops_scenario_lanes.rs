//! Lanes on the grammar fixture: the diff each op produces is snapshotted, and both
//! ends of every pair are checked.

use sgf_core::ops::{LanePair, Op, OpError};

mod common;
use common::diff::snapshot;
use common::scenario::open;

#[test]
fn add_lane_2_16() {
    snapshot(
        "add_lane_2_16",
        open(),
        Op::AddLane {
            a: 2,
            b: 16,
            bridge: false,
        },
    );
}

#[test]
fn add_lane_is_refused_when_the_pair_is_already_linked() {
    let mut session = open();
    let error = session
        .apply(Op::AddLane {
            a: 1,
            b: 16,
            bridge: false,
        })
        .expect_err("1 and 16 are linked twice over");
    assert!(matches!(error, OpError::LaneExists(1, 16)), "{error:?}");
    assert!(!session.doc.is_dirty());
}

#[test]
fn remove_lane_1_2_empties_both_directions() {
    snapshot("remove_lane_1_2", open(), Op::RemoveLane { a: 1, b: 2 });
}

#[test]
fn remove_lane_1_16_empties_the_duplicate_pair() {
    snapshot("remove_lane_1_16", open(), Op::RemoveLane { a: 1, b: 16 });
}

#[test]
fn remove_lane_pairs_takes_several_at_once() {
    snapshot(
        "remove_lane_pairs",
        open(),
        Op::RemoveLanePairs {
            lanes: vec![(1, 2), (111, 3018)],
        },
    );
}

#[test]
fn remove_lane_pairs_is_refused_when_one_pair_is_not_linked() {
    let mut session = open();
    let error = session
        .apply(Op::RemoveLanePairs {
            lanes: vec![(1, 2), (9, 512)],
        })
        .expect_err("9 and 512 are not linked");
    assert!(matches!(error, OpError::NoSuchLane(9, 512)), "{error:?}");
    assert!(!session.doc.is_dirty());
}

#[test]
fn isolate_1_cuts_every_lane_and_leaves_prevent_hyperlane() {
    snapshot("isolate_system_1", open(), Op::IsolateSystem { id: 1 });
}

#[test]
fn add_lane_pairs_writes_one_statement_each() {
    snapshot(
        "add_lane_pairs",
        open(),
        Op::AddLanePairs {
            lanes: vec![
                LanePair {
                    a: 2,
                    b: 9,
                    bridge: false,
                },
                LanePair {
                    a: 9,
                    b: 3018,
                    bridge: false,
                },
            ],
        },
    );
}
