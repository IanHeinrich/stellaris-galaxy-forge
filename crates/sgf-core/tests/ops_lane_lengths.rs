//! Lane length ops applied to the real sample save: setting a length, normalising it to the
//! floor of the distance, lanes listed twice and lanes whose ends disagree.

use sgf_core::ops::{LaneLength, Op, OpError};

use crate::common;
use crate::ops_lanes::only_once;
use common::diff::{report, snapshot};
use common::{current, open, reprojected};

#[test]
fn setting_a_length_rewrites_both_entries() {
    snapshot(
        "set_lane_length_0_752",
        open(),
        Op::SetLaneLength {
            a: 0,
            b: 752,
            length: 40.0,
        },
    );
}

#[test]
fn setting_a_decimal_length_keeps_the_decimal_form() {
    snapshot(
        "set_lane_length_788_760",
        open(),
        Op::SetLaneLength {
            a: 788,
            b: 760,
            length: 21.5,
        },
    );
}

#[test]
fn normalising_a_lane_writes_the_floor_of_the_distance() {
    snapshot(
        "normalise_lane_length_788_760",
        open(),
        Op::NormaliseLaneLength { a: 788, b: 760 },
    );
}

#[test]
fn normalise_lane_length_is_refused_where_there_is_nothing_to_do() {
    let mut session = open();
    assert!(!session.graph().lane(0, 752).unwrap().stale);
    assert!(matches!(
        session.apply(Op::NormaliseLaneLength { a: 0, b: 752 }),
        Err(OpError::AlreadyNormal)
    ));
    assert!(matches!(
        session.apply(Op::NormaliseLaneLength { a: 0, b: 1 }),
        Err(OpError::NoSuchLane(0, 1))
    ));
    assert!(matches!(
        session.apply(Op::NormaliseLaneLength { a: 0, b: 0 }),
        Err(OpError::SelfLane(0))
    ));
    assert!(!session.is_dirty());
}

#[test]
fn setting_several_lengths_rewrites_every_entry() {
    snapshot(
        "set_lane_lengths",
        open(),
        Op::SetLaneLengths {
            lanes: vec![
                LaneLength {
                    a: 0,
                    b: 752,
                    length: 40.0,
                },
                LaneLength {
                    a: 788,
                    b: 760,
                    length: 21.5,
                },
            ],
        },
    );
}

#[test]
fn normalising_after_a_move_rewrites_only_the_decimal_lengths() {
    // A move keeps each entry's form, so an integer length is already floor(distance).
    let mut session = open();
    session
        .apply(Op::MoveSystem {
            system: 0,
            x: -150.0,
            y: 60.0,
        })
        .unwrap();
    let moved = current(&session);
    assert!(matches!(
        session.apply(Op::NormaliseLaneLengths { systems: vec![0] }),
        Err(OpError::AlreadyNormal)
    ));
    assert_eq!(current(&session), moved);

    // 786's lanes were written by an event as exact decimals, which the move preserves.
    let mut session = open();
    session
        .apply(Op::MoveSystem {
            system: 786,
            x: -60.0,
            y: -190.0,
        })
        .unwrap();
    assert!(session.graph().systems[&786].lanes.iter().all(|l| l.stale));
    let result = session
        .apply(Op::NormaliseLaneLengths { systems: vec![786] })
        .unwrap();
    assert!(session.graph().systems[&786].lanes.iter().all(|l| !l.stale));
    assert_eq!(session.graph().systems, reprojected(&session).systems);
    common::snapshot(
        "normalise_lane_lengths_after_move",
        &report(&session, &result),
    );

    session.apply(result.inverse).unwrap();
    assert!(session.graph().systems[&786].lanes.iter().all(|l| l.stale));
}

/// The game lists 154-708 twice on both ends. While every entry holds one length, one
/// length put back restores them all, so the lane is normalised like any other.
#[test]
fn a_lane_listed_twice_is_normalised_on_every_entry_and_put_back() {
    let mut session = open();
    let set = session
        .apply(Op::SetLaneLength {
            a: 154,
            b: 708,
            length: 99.0,
        })
        .unwrap();
    let lengthened = current(&session);
    assert!(session.graph().lane(154, 708).unwrap().stale);

    let normalised = session
        .apply(Op::NormaliseLaneLengths { systems: vec![154] })
        .expect("normalise");
    let floor = (session.graph().systems[&154].x - session.graph().systems[&708].x)
        .hypot(session.graph().systems[&154].y - session.graph().systems[&708].y)
        .floor();
    for (a, b) in [(154, 708), (708, 154)] {
        let lengths: Vec<f64> = (session.graph().systems[&a].lanes.iter())
            .filter(|lane| lane.to == b)
            .map(|lane| lane.length)
            .collect();
        assert_eq!(lengths, [floor, floor], "{a} lists {b}");
    }
    session.apply(normalised.inverse).unwrap();
    assert_eq!(current(&session), lengthened);

    session.apply(set.inverse).unwrap();
    assert_eq!(current(&session), session.doc().original());
}

/// A lane whose two ends hold different lengths cannot be set or normalised: the one
/// length an inverse carries would write the wrong one back on one end.
#[test]
fn a_lane_whose_ends_disagree_is_refused_a_new_length() {
    // System 0 lists 752 at 40 where 752 lists 0 at 33.
    let mut session = common::open_edited(|gamestate| {
        *gamestate = only_once(
            gamestate,
            "\t\t\t\tto=752\n\t\t\t\tlength=33",
            "\t\t\t\tto=752\n\t\t\t\tlength=40",
        );
    });
    assert_eq!(session.graph().lane(0, 752).map(|l| l.length), Some(40.0));
    assert_eq!(session.graph().lane(752, 0).map(|l| l.length), Some(33.0));
    let disagree =
        |result: Result<_, OpError>| matches!(result, Err(OpError::LaneEndsDisagree(0, 752)));

    let set = session.apply(Op::SetLaneLength {
        a: 0,
        b: 752,
        length: 50.0,
    });
    assert!(disagree(set.map(|r| r.inverse)), "SetLaneLength");
    let set = session.apply(Op::SetLaneLengths {
        lanes: vec![LaneLength {
            a: 0,
            b: 752,
            length: 50.0,
        }],
    });
    assert!(disagree(set.map(|r| r.inverse)), "SetLaneLengths");
    let normalise = session.apply(Op::NormaliseLaneLength { a: 0, b: 752 });
    assert!(
        disagree(normalise.map(|r| r.inverse)),
        "NormaliseLaneLength"
    );
    // The plural leaves the lane as it is and normalises the rest of system 0's.
    let normalised = session.apply(Op::NormaliseLaneLengths { systems: vec![0] });
    assert_eq!(session.graph().lane(0, 752).map(|l| l.length), Some(40.0));
    assert_eq!(session.graph().lane(752, 0).map(|l| l.length), Some(33.0));
    if normalised.is_ok() {
        session.undo().expect("undo");
    }
    assert_eq!(current(&session), session.doc().original());
}
