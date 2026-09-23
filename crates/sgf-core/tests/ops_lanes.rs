//! Lane and system ops applied to the real sample save: the diff each one produces is
//! snapshotted, and the refusals and inverses of the lane ops are checked.

use sgf_core::ops::{LaneLength, LanePair, Op, OpError, SystemMove};

mod common;
use common::diff::{report, snapshot};
use common::{current, open, reprojected};

#[test]
fn a_move_rewrites_every_lane_length_on_both_ends() {
    snapshot(
        "move_system_0",
        open(),
        Op::MoveSystem {
            id: 0,
            x: -150.0,
            y: 60.0,
        },
    );
}

#[test]
fn a_new_lane_is_written_on_both_ends_with_the_floor_of_its_length() {
    snapshot(
        "add_lane_0_1",
        open(),
        Op::AddLane {
            a: 0,
            b: 1,
            bridge: false,
        },
    );
}

#[test]
fn a_bridge_lane_is_marked_on_both_ends() {
    snapshot(
        "add_bridge_lane_0_1",
        open(),
        Op::AddLane {
            a: 0,
            b: 1,
            bridge: true,
        },
    );
}

#[test]
fn removing_a_lane_takes_its_entry_from_both_ends() {
    snapshot("remove_lane_0_752", open(), Op::RemoveLane { a: 0, b: 752 });
}

#[test]
fn adding_lanes_to_systems_without_any_creates_their_hyperlane_blocks() {
    snapshot(
        "add_lanes_789_to_790_and_0",
        open(),
        Op::AddLanes {
            from: 789,
            to: vec![(790, false), (0, true)],
        },
    );
}

#[test]
fn removing_several_lanes_of_a_system_takes_every_entry() {
    snapshot(
        "remove_lanes_0_to_752_and_200",
        open(),
        Op::RemoveLanes {
            from: 0,
            to: vec![752, 200],
        },
    );
}

#[test]
fn a_lane_between_systems_without_any_creates_both_blocks() {
    snapshot(
        "add_lane_789_790",
        open(),
        Op::AddLane {
            a: 789,
            b: 790,
            bridge: false,
        },
    );
}

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
    assert!(!session.graph.lane(0, 752).unwrap().stale);
    assert!(matches!(
        session.apply(Op::NormaliseLaneLength { a: 0, b: 752 }),
        Err(OpError::Empty)
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
fn a_move_keeps_lengths_an_event_wrote_as_decimals() {
    snapshot(
        "move_system_786",
        open(),
        Op::MoveSystem {
            id: 786,
            x: -60.0,
            y: -190.0,
        },
    );
}

#[test]
fn removing_a_duplicated_lane_takes_every_entry() {
    snapshot(
        "remove_lane_708_154",
        open(),
        Op::RemoveLane { a: 708, b: 154 },
    );
}

#[test]
fn isolating_a_system_takes_its_block_and_every_neighbours_entry() {
    snapshot("isolate_system_0", open(), Op::IsolateSystem { id: 0 });
}

#[test]
fn moving_two_linked_systems_together_keeps_the_length_between_them() {
    let mut session = open();
    let before = session.graph.lane(0, 86).unwrap().length;
    let result = session
        .apply(Op::MoveSystems {
            moves: vec![
                SystemMove {
                    id: 0,
                    x: -134.22,
                    y: 67.36,
                },
                SystemMove {
                    id: 86,
                    x: -143.47,
                    y: 40.99,
                },
            ],
        })
        .unwrap();
    assert_eq!(session.graph.lane(0, 86).unwrap().length, before);
    assert_eq!(session.graph.lane(86, 0).unwrap().length, before);
    common::snapshot("move_systems_0_and_86", &report(&session, &result));
}

#[test]
fn adding_lane_pairs_creates_blocks_with_two_entries() {
    snapshot(
        "add_lane_pairs",
        open(),
        Op::AddLanePairs {
            lanes: vec![
                LanePair {
                    a: 789,
                    b: 790,
                    bridge: false,
                },
                LanePair {
                    a: 789,
                    b: 0,
                    bridge: true,
                },
                LanePair {
                    a: 1,
                    b: 790,
                    bridge: false,
                },
            ],
        },
    );
}

#[test]
fn removing_lane_pairs_takes_bridges_and_plain_lanes_alike() {
    snapshot(
        "remove_lane_pairs",
        open(),
        Op::RemoveLanePairs {
            lanes: vec![(0, 752), (86, 112)],
        },
    );
}

#[test]
fn isolating_two_linked_systems_removes_their_shared_lane_once() {
    let mut session = open();
    let result = session
        .apply(Op::IsolateSystems { ids: vec![0, 86] })
        .unwrap();
    assert!(session.graph.systems[&0].lanes.is_empty());
    assert!(session.graph.systems[&86].lanes.is_empty());
    let Op::AddLanePairs { lanes } = &result.inverse else {
        panic!("{:?}", result.inverse);
    };
    assert_eq!(lanes.len(), 8);
    common::snapshot("isolate_systems_0_and_86", &report(&session, &result));
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
            id: 0,
            x: -150.0,
            y: 60.0,
        })
        .unwrap();
    let moved = current(&session);
    assert!(matches!(
        session.apply(Op::NormaliseLaneLengths { systems: vec![0] }),
        Err(OpError::Empty)
    ));
    assert_eq!(current(&session), moved);

    // 786's lanes were written by an event as exact decimals, which the move preserves.
    let mut session = open();
    session
        .apply(Op::MoveSystem {
            id: 786,
            x: -60.0,
            y: -190.0,
        })
        .unwrap();
    assert!(session.graph.systems[&786].lanes.iter().all(|l| l.stale));
    let result = session
        .apply(Op::NormaliseLaneLengths { systems: vec![786] })
        .unwrap();
    assert!(session.graph.systems[&786].lanes.iter().all(|l| !l.stale));
    assert_eq!(session.graph.systems, reprojected(&session).systems);
    common::snapshot(
        "normalise_lane_lengths_after_move",
        &report(&session, &result),
    );

    session.apply(result.inverse).unwrap();
    assert!(session.graph.systems[&786].lanes.iter().all(|l| l.stale));
}

#[test]
fn normalising_leaves_a_duplicated_lane_alone() {
    let mut session = open();
    let set = session
        .apply(Op::SetLaneLength {
            a: 154,
            b: 708,
            length: 99.0,
        })
        .unwrap();
    let lengthened = current(&session);
    assert!(session.graph.lane(154, 708).unwrap().stale);

    // The game lists this lane twice on both ends, so one restored length could not put
    // back what each entry had.
    assert!(matches!(
        session.apply(Op::NormaliseLaneLengths { systems: vec![154] }),
        Err(OpError::Empty)
    ));
    assert_eq!(current(&session), lengthened);

    session.apply(set.inverse).unwrap();
    assert_eq!(current(&session), session.doc.original());
}

#[test]
fn bulk_ops_refuse_duplicates() {
    let mut session = open();
    assert!(matches!(
        session.apply(Op::MoveSystems {
            moves: vec![
                SystemMove {
                    id: 0,
                    x: -150.0,
                    y: 60.0,
                },
                SystemMove {
                    id: 0,
                    x: -151.0,
                    y: 60.0,
                },
            ],
        }),
        Err(OpError::DuplicateSystem(0))
    ));
    assert!(matches!(
        session.apply(Op::AddLanePairs {
            lanes: vec![
                LanePair {
                    a: 0,
                    b: 1,
                    bridge: false,
                },
                LanePair {
                    a: 1,
                    b: 0,
                    bridge: true,
                },
            ],
        }),
        Err(OpError::DuplicateLane(1, 0))
    ));
    assert!(matches!(
        session.apply(Op::RemoveLanePairs {
            lanes: vec![(0, 752), (752, 0)],
        }),
        Err(OpError::DuplicateLane(752, 0))
    ));
    assert!(matches!(
        session.apply(Op::IsolateSystems {
            ids: vec![0, 86, 0]
        }),
        Err(OpError::DuplicateSystem(0))
    ));
    assert!(matches!(
        session.apply(Op::SetLaneLengths {
            lanes: vec![
                LaneLength {
                    a: 0,
                    b: 752,
                    length: 40.0,
                },
                LaneLength {
                    a: 752,
                    b: 0,
                    length: 41.0,
                },
            ],
        }),
        Err(OpError::DuplicateLane(752, 0))
    ));
    assert_eq!(current(&session), session.doc.original());
}

#[test]
fn adding_then_removing_a_lane_is_byte_identical() {
    let mut session = open();
    session
        .apply(Op::AddLane {
            a: 789,
            b: 790,
            bridge: false,
        })
        .unwrap();
    assert!(session.graph.lane(789, 790).is_some());
    session.apply(Op::RemoveLane { a: 789, b: 790 }).unwrap();
    assert_eq!(current(&session), session.doc.original());
    assert!(session.graph.systems[&789].lanes.is_empty());
    assert!(session.graph.systems[&790].lanes.is_empty());
}

#[test]
fn the_inverse_of_an_isolation_restores_every_lane() {
    let mut session = open();
    let before = session.graph.systems[&0].clone();
    let result = session.apply(Op::IsolateSystem { id: 0 }).unwrap();
    assert!(session.graph.systems[&0].lanes.is_empty());
    session.apply(result.inverse).unwrap();
    let after = &session.graph.systems[&0];
    let mut expected: Vec<_> = before.lanes.iter().map(|l| (l.to, l.bridge)).collect();
    let mut actual: Vec<_> = after.lanes.iter().map(|l| (l.to, l.bridge)).collect();
    expected.sort_unstable();
    actual.sort_unstable();
    assert_eq!(actual, expected);
    for lane in &after.lanes {
        assert!(
            session.graph.lane(lane.to, 0).is_some(),
            "{} lost 0",
            lane.to
        );
    }
}

#[test]
fn the_inverse_of_adding_lanes_removes_only_what_it_added() {
    let mut session = open();
    assert!(matches!(
        session.apply(Op::AddLanes {
            from: 789,
            to: vec![],
        }),
        Err(OpError::Empty)
    ));
    assert!(matches!(
        session.apply(Op::RemoveLanes {
            from: 0,
            to: vec![],
        }),
        Err(OpError::Empty)
    ));
    assert_eq!(current(&session), session.doc.original());

    let result = session
        .apply(Op::AddLanes {
            from: 0,
            to: vec![(1, false)],
        })
        .unwrap();
    assert_eq!(
        result.inverse,
        Op::RemoveLanes {
            from: 0,
            to: vec![1],
        }
    );
    let undo = session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(session.graph.systems[&0].lanes.len(), 5);
    assert_eq!(
        undo.inverse,
        Op::AddLanes {
            from: 0,
            to: vec![(1, false)],
        }
    );
}

#[test]
fn removing_a_lane_to_a_missing_system_is_refused_singly_and_left_out_of_a_bulk_inverse() {
    // The sample holds no dangling lane, so system 0's entry for 752 is pointed at an
    // id no `galactic_object` carries.
    let mut session = common::open_edited(|gamestate| {
        let at = find(
            gamestate,
            b"				to=752
				length=33",
        );
        gamestate.splice(at + 7..at + 10, *b"999");
    });
    assert!(session.graph.systems[&0].lanes.iter().any(|l| l.to == 999));
    assert!(!session.graph.systems.contains_key(&999));

    assert!(matches!(
        session.apply(Op::RemoveLane { a: 0, b: 999 }),
        Err(OpError::NoSuchLane(0, 999))
    ));
    assert_eq!(current(&session), session.doc.original());

    let result = session
        .apply(Op::RemoveLanes {
            from: 0,
            to: vec![999, 200],
        })
        .expect("remove a dangling lane beside a real one");
    assert_eq!(
        result.inverse,
        Op::AddLanes {
            from: 0,
            to: vec![(200, false)],
        },
        "the inverse names no system the graph does not hold"
    );
    session.apply(result.inverse).expect("the inverse applies");
    assert!(session.graph.lane(0, 200).is_some());
}

/// Where `needle` starts in `haystack`; the sample holds it exactly once.
fn find(haystack: &[u8], needle: &[u8]) -> usize {
    let at = haystack
        .windows(needle.len())
        .position(|w| w == needle)
        .expect("the sample holds the lane entry");
    assert!(
        haystack[at + 1..]
            .windows(needle.len())
            .all(|w| w != needle),
        "the lane entry is not unique"
    );
    at
}
