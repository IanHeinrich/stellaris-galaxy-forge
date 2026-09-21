//! Lane, system and history ops applied to the real sample save: the diff each one
//! produces is snapshotted, and undo, redo, add-then-remove and save-then-reload are
//! checked for identity.

use std::collections::BTreeSet;

use sgf_core::document::Document;
use sgf_core::ops::{InitializerSet, LaneLength, LanePair, Op, OpError, SystemMove};
use sgf_core::projections::galaxy::{GalaxyGraph, SpawnReservationPreset};
use sgf_core::session::Session;
use sgf_core::validate::Severity;

mod common;
use common::diff::{report, snapshot};
use common::{NEBULA_0_CENTRE, NEW_NEBULA, current, open, reloaded, reprojected};

#[test]
fn move_system_0() {
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
fn add_lane_0_1() {
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
fn add_bridge_lane_0_1() {
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
fn remove_lane_0_752() {
    snapshot("remove_lane_0_752", open(), Op::RemoveLane { a: 0, b: 752 });
}

#[test]
fn add_lanes_789_to_790_and_0() {
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
fn remove_lanes_0_to_752_and_200() {
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
fn add_lane_789_790_creates_the_blocks() {
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
fn set_lane_length_0_752() {
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
fn set_lane_length_788_760_keeps_the_decimal_form() {
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
fn normalise_lane_length_788_760_writes_the_floor_of_the_distance() {
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
fn move_system_786_keeps_decimal_lengths() {
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
fn remove_lane_708_154_removes_both_duplicate_entries() {
    snapshot(
        "remove_lane_708_154",
        open(),
        Op::RemoveLane { a: 708, b: 154 },
    );
}

#[test]
fn isolate_system_0() {
    snapshot("isolate_system_0", open(), Op::IsolateSystem { id: 0 });
}

#[test]
fn move_systems_0_and_86_keeps_the_length_between_them() {
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
fn add_lane_pairs_creates_blocks_with_two_entries() {
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
fn remove_lane_pairs() {
    snapshot(
        "remove_lane_pairs",
        open(),
        Op::RemoveLanePairs {
            lanes: vec![(0, 752), (86, 112)],
        },
    );
}

#[test]
fn isolate_systems_0_and_86_removes_their_shared_lane_once() {
    let mut session = open();
    let result = session
        .apply(Op::IsolateSystems { ids: vec![0, 86] })
        .unwrap();
    assert!(session.graph.systems[&0].lanes.is_empty());
    assert!(session.graph.systems[&86].lanes.is_empty());
    let Op::AddLanePairs { lanes } = &result.entry.inverse else {
        panic!("{:?}", result.entry.inverse);
    };
    assert_eq!(lanes.len(), 8);
    common::snapshot("isolate_systems_0_and_86", &report(&session, &result));
}

#[test]
fn set_lane_lengths() {
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
fn normalise_lane_lengths_after_move() {
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
    assert_eq!(session.graph.systems, reloaded(&session).systems);
    common::snapshot(
        "normalise_lane_lengths_after_move",
        &report(&session, &result),
    );

    session.apply(result.entry.inverse).unwrap();
    assert!(session.graph.systems[&786].lanes.iter().all(|l| l.stale));
}

#[test]
fn normalise_leaves_the_duplicated_lane_154_708_alone() {
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

    session.apply(set.entry.inverse).unwrap();
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
fn add_then_remove_lane_789_790_is_byte_identical() {
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
fn every_op_undoes_to_the_original_and_redoes_to_the_edit() {
    let ops = [
        Op::MoveSystem {
            id: 0,
            x: -150.0,
            y: 60.0,
        },
        Op::AddLane {
            a: 0,
            b: 1,
            bridge: true,
        },
        Op::AddLanes {
            from: 789,
            to: vec![(790, false), (0, true)],
        },
        Op::RemoveLane { a: 0, b: 752 },
        Op::RemoveLane { a: 708, b: 154 },
        Op::RemoveLanes {
            from: 0,
            to: vec![752, 200],
        },
        Op::SetLaneLength {
            a: 788,
            b: 760,
            length: 21.5,
        },
        Op::IsolateSystem { id: 0 },
        Op::MoveSystems {
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
        },
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
        Op::RemoveLanePairs {
            lanes: vec![(0, 752), (86, 112)],
        },
        Op::IsolateSystems { ids: vec![0, 86] },
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
        Op::NormaliseLaneLength { a: 788, b: 760 },
        Op::NormaliseLaneLengths { systems: vec![786] },
        Op::MoveSystem {
            id: 108,
            x: 200.0,
            y: -50.0,
        },
        Op::MoveSystem {
            id: 455,
            x: NEBULA_0_CENTRE.0,
            y: NEBULA_0_CENTRE.1,
        },
        Op::MoveNebula {
            index: 0,
            x: 0.0,
            y: 0.0,
        },
        Op::AddNebula {
            x: NEW_NEBULA.0,
            y: NEW_NEBULA.1,
            radius: NEW_NEBULA.2,
            name: Some("SGF_Test_Nebula".to_owned()),
        },
        Op::RemoveNebula { index: 0 },
        Op::SetNebulaRadius {
            index: 0,
            radius: 45.0,
        },
        Op::SetNebulaRadius {
            index: 0,
            radius: 15.0,
        },
        Op::SetNebulaName {
            index: 0,
            name: "Sgf_Test_Cloud".to_owned(),
        },
    ];
    let fresh = GalaxyGraph::build(&common::load()).unwrap();
    for op in ops {
        assert!(a_save_takes(&op), "{op:?}");
        let mut session = open();
        let applied = session
            .apply(op.clone())
            .unwrap_or_else(|e| panic!("{op:?}: {e}"));
        let edited = current(&session);
        assert_ne!(edited, session.doc.original(), "{op:?} changed nothing");
        assert!(session.is_dirty());
        assert_eq!(
            session.graph.systems,
            reprojected(&session).systems,
            "{op:?} projection after apply"
        );

        let undone = session.undo().unwrap().expect("something to undo");
        assert_eq!(undone.entry.description, applied.entry.description);
        assert_eq!(current(&session), session.doc.original(), "{op:?} undo");
        assert!(!session.doc.is_dirty(), "{op:?} left slots after undo");
        assert_eq!(
            session.graph.systems, fresh.systems,
            "{op:?} projection after undo"
        );
        assert_eq!(session.history().undo.len(), 0);
        assert_eq!(session.history().redo.len(), 1);

        let redone = session.redo().unwrap().expect("something to redo");
        assert_eq!(redone.entry.description, applied.entry.description);
        assert_eq!(current(&session), edited, "{op:?} redo");
        assert_eq!(
            session.graph.systems,
            reprojected(&session).systems,
            "{op:?} projection after redo"
        );
        assert_eq!(session.history().undo.len(), 1);
        assert!(session.redo().unwrap().is_none());
    }
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
        result.entry.inverse,
        Op::AddLanes {
            from: 0,
            to: vec![(200, false)],
        },
        "the inverse names no system the graph does not hold"
    );
    session
        .apply(result.entry.inverse)
        .expect("the inverse applies");
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

/// Whether a save's writer takes `op`. Exhaustive by construction: the match has no `_`
/// arm, so a variant added to `Op` stops this test compiling until it is given an op in
/// the list above or named here as one only a scenario takes.
fn a_save_takes(op: &Op) -> bool {
    match op {
        Op::MoveSystem { .. }
        | Op::AddLane { .. }
        | Op::AddLanes { .. }
        | Op::RemoveLane { .. }
        | Op::RemoveLanes { .. }
        | Op::SetLaneLength { .. }
        | Op::IsolateSystem { .. }
        | Op::MoveSystems { .. }
        | Op::AddLanePairs { .. }
        | Op::RemoveLanePairs { .. }
        | Op::IsolateSystems { .. }
        | Op::SetLaneLengths { .. }
        | Op::NormaliseLaneLength { .. }
        | Op::NormaliseLaneLengths { .. }
        | Op::MoveNebula { .. }
        | Op::AddNebula { .. }
        | Op::RemoveNebula { .. }
        | Op::SetNebulaRadius { .. }
        | Op::SetNebulaName { .. } => true,
        Op::AddSystem { .. }
        | Op::RemoveSystem { .. }
        | Op::SetSystemName { .. }
        | Op::SetInitializer { .. }
        | Op::SetInitializers { .. }
        | Op::SetHeaderField { .. }
        | Op::SetSpawnWeight { .. }
        | Op::SetSpawnWeights { .. }
        | Op::SetSpawnReservation { .. }
        | Op::SetSpawnScript { .. }
        | Op::SetSpawnScripts { .. }
        | Op::SetFeZone { .. }
        | Op::SetFeZones { .. }
        | Op::SetHeaderKeys { .. }
        | Op::SetWormholePair { .. }
        | Op::SetWormholeEnds { .. }
        | Op::PreventLane { .. }
        | Op::UnpreventLane { .. } => false,
    }
}

/// Whether `op` can have moved how the systems it touched are classified. Exhaustive by
/// construction: the match has no `_` arm, so a variant added to `Op` stops this test
/// compiling until it is named here and given an op in the list below.
fn reclassifies(op: &Op) -> bool {
    match op {
        Op::AddSystem { .. }
        | Op::RemoveSystem { .. }
        | Op::SetSystemName { .. }
        | Op::SetInitializer { .. }
        | Op::SetInitializers { .. }
        | Op::SetSpawnScript { .. }
        | Op::SetSpawnScripts { .. }
        | Op::SetWormholePair { .. }
        | Op::SetWormholeEnds { .. } => true,
        Op::MoveSystem { .. }
        | Op::AddLane { .. }
        | Op::AddLanes { .. }
        | Op::RemoveLane { .. }
        | Op::RemoveLanes { .. }
        | Op::SetLaneLength { .. }
        | Op::IsolateSystem { .. }
        | Op::MoveSystems { .. }
        | Op::AddLanePairs { .. }
        | Op::RemoveLanePairs { .. }
        | Op::IsolateSystems { .. }
        | Op::SetLaneLengths { .. }
        | Op::NormaliseLaneLength { .. }
        | Op::NormaliseLaneLengths { .. }
        | Op::MoveNebula { .. }
        | Op::AddNebula { .. }
        | Op::RemoveNebula { .. }
        | Op::SetNebulaRadius { .. }
        | Op::SetNebulaName { .. }
        | Op::SetHeaderField { .. }
        | Op::SetHeaderKeys { .. }
        | Op::SetSpawnWeight { .. }
        | Op::SetSpawnWeights { .. }
        | Op::SetSpawnReservation { .. }
        | Op::SetFeZone { .. }
        | Op::SetFeZones { .. }
        | Op::PreventLane { .. }
        | Op::UnpreventLane { .. } => false,
    }
}

/// Whether `op` leaves the details of the systems it touched stale. Exhaustive by
/// construction: the match has no `_` arm, so a variant added to `Op` stops this test
/// compiling until it is named here and given an op in the list below.
fn stales_details(op: &Op) -> bool {
    match op {
        Op::AddSystem { .. }
        | Op::RemoveSystem { .. }
        | Op::SetInitializer { .. }
        | Op::SetInitializers { .. }
        | Op::SetSpawnScript { .. }
        | Op::SetSpawnScripts { .. } => true,
        Op::MoveSystem { .. }
        | Op::AddLane { .. }
        | Op::AddLanes { .. }
        | Op::RemoveLane { .. }
        | Op::RemoveLanes { .. }
        | Op::SetLaneLength { .. }
        | Op::IsolateSystem { .. }
        | Op::MoveSystems { .. }
        | Op::AddLanePairs { .. }
        | Op::RemoveLanePairs { .. }
        | Op::IsolateSystems { .. }
        | Op::SetLaneLengths { .. }
        | Op::NormaliseLaneLength { .. }
        | Op::NormaliseLaneLengths { .. }
        | Op::MoveNebula { .. }
        | Op::AddNebula { .. }
        | Op::RemoveNebula { .. }
        | Op::SetNebulaRadius { .. }
        | Op::SetNebulaName { .. }
        | Op::SetSystemName { .. }
        | Op::SetHeaderField { .. }
        | Op::SetHeaderKeys { .. }
        | Op::SetSpawnWeight { .. }
        | Op::SetSpawnWeights { .. }
        | Op::SetSpawnReservation { .. }
        | Op::SetFeZone { .. }
        | Op::SetFeZones { .. }
        | Op::SetWormholePair { .. }
        | Op::SetWormholeEnds { .. }
        | Op::PreventLane { .. }
        | Op::UnpreventLane { .. } => false,
    }
}

/// One op of every variant, for the tests that assert a property of the whole enum.
fn one_of_each() -> Vec<Op> {
    let ops = vec![
        Op::MoveSystem {
            id: 0,
            x: 0.0,
            y: 0.0,
        },
        Op::AddLane {
            a: 0,
            b: 1,
            bridge: false,
        },
        Op::AddLanes {
            from: 0,
            to: vec![(1, false)],
        },
        Op::RemoveLane { a: 0, b: 1 },
        Op::RemoveLanes {
            from: 0,
            to: vec![1],
        },
        Op::SetLaneLength {
            a: 0,
            b: 1,
            length: 1.0,
        },
        Op::IsolateSystem { id: 0 },
        Op::MoveSystems {
            moves: vec![SystemMove {
                id: 0,
                x: 0.0,
                y: 0.0,
            }],
        },
        Op::AddLanePairs {
            lanes: vec![LanePair {
                a: 0,
                b: 1,
                bridge: false,
            }],
        },
        Op::RemoveLanePairs {
            lanes: vec![(0, 1)],
        },
        Op::IsolateSystems { ids: vec![0] },
        Op::SetLaneLengths {
            lanes: vec![LaneLength {
                a: 0,
                b: 1,
                length: 1.0,
            }],
        },
        Op::NormaliseLaneLength { a: 0, b: 1 },
        Op::NormaliseLaneLengths { systems: vec![0] },
        Op::MoveNebula {
            index: 0,
            x: 0.0,
            y: 0.0,
        },
        Op::AddNebula {
            x: 0.0,
            y: 0.0,
            radius: 10.0,
            name: None,
        },
        Op::RemoveNebula { index: 0 },
        Op::SetNebulaRadius {
            index: 0,
            radius: 10.0,
        },
        Op::SetNebulaName {
            index: 0,
            name: "Cloud".to_owned(),
        },
        Op::AddSystem {
            id: None,
            x: 0.0,
            y: 0.0,
            name: None,
            initializer: None,
            spawn_weight: None,
        },
        Op::RemoveSystem { id: 0 },
        Op::SetSystemName {
            id: 0,
            name: "Sol".to_owned(),
        },
        Op::SetInitializer {
            id: 0,
            initializer: None,
        },
        Op::SetInitializers {
            entries: vec![InitializerSet {
                id: 0,
                initializer: None,
            }],
        },
        Op::SetHeaderField {
            key: "name".to_owned(),
            value: None,
        },
        Op::SetSpawnWeight { id: 0, base: None },
        Op::SetSpawnWeights {
            entries: vec![(0, None)],
        },
        Op::SetSpawnReservation {
            id: 0,
            reserve: Some(SpawnReservationPreset::Human),
        },
        Op::SetSpawnScript {
            id: 0,
            script: None,
        },
        Op::SetSpawnScripts {
            entries: vec![(0, None)],
        },
        Op::SetFeZone { id: 0, zone: None },
        Op::SetFeZones {
            entries: vec![(0, None)],
        },
        Op::SetHeaderKeys {
            entries: vec![("name".to_owned(), "\"x\"".to_owned())],
        },
        Op::SetWormholePair {
            a: 0,
            b: 1,
            pair: None,
        },
        Op::SetWormholeEnds {
            entries: vec![(0, None)],
        },
        Op::PreventLane { a: 0, b: 1 },
        Op::UnpreventLane { a: 0, b: 1 },
    ];
    let named: BTreeSet<&str> = ops.iter().map(Op::name).collect();
    assert_eq!(named.len(), ops.len(), "one op of each variant: {named:?}");
    ops
}

#[test]
fn an_op_reclassifies_only_where_it_writes_an_initializer_or_a_name() {
    for op in one_of_each() {
        assert_eq!(op.reclassifies(), reclassifies(&op), "{}", op.name());
    }
}

/// The details projection is keyed by the systems the graph holds and a scenario
/// system's contents come from its initializer, so those are the ops that stale it; a
/// save's details are read from sections no op writes.
#[test]
fn an_op_stales_details_only_where_a_system_or_an_initializer_comes_or_goes() {
    for op in one_of_each() {
        assert_eq!(op.stales_details(), stales_details(&op), "{}", op.name());
    }
}

#[test]
fn two_ops_on_one_entity_undo_one_at_a_time() {
    let mut session = open();
    session
        .apply(Op::MoveSystem {
            id: 0,
            x: -150.0,
            y: 60.0,
        })
        .unwrap();
    let moved = current(&session);
    session.apply(Op::RemoveLane { a: 0, b: 752 }).unwrap();
    assert_ne!(current(&session), moved);

    session.undo().unwrap().expect("undo remove");
    assert_eq!(current(&session), moved);
    assert!(session.graph.lane(0, 752).is_some());
    session.undo().unwrap().expect("undo move");
    assert_eq!(current(&session), session.doc.original());
    assert!(session.undo().unwrap().is_none());
}

#[test]
fn add_lanes_inverse_removes_only_what_it_added() {
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
        result.entry.inverse,
        Op::RemoveLanes {
            from: 0,
            to: vec![1],
        }
    );
    let undo = session.apply(result.entry.inverse).unwrap();
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(session.graph.systems[&0].lanes.len(), 5);
    assert_eq!(
        undo.entry.inverse,
        Op::AddLanes {
            from: 0,
            to: vec![(1, false)],
        }
    );
}

#[test]
fn dirty_follows_the_saved_position_in_history() {
    let mut session = open();
    assert!(!session.is_dirty());
    session
        .apply(Op::AddLane {
            a: 0,
            b: 1,
            bridge: false,
        })
        .unwrap();
    assert!(session.is_dirty());
    session.undo().unwrap().unwrap();
    assert!(!session.is_dirty());
    session.redo().unwrap().unwrap();
    assert!(session.is_dirty());

    let dir = tempfile::tempdir().unwrap();
    session.save_as(dir.path().join("saved.sav")).unwrap();
    assert!(!session.is_dirty());
    session.undo().unwrap().unwrap();
    assert!(session.is_dirty());
    session.redo().unwrap().unwrap();
    assert!(!session.is_dirty());

    // A new op after an undo discards the saved state for good.
    session.undo().unwrap().unwrap();
    session.apply(Op::RemoveLane { a: 0, b: 752 }).unwrap();
    assert!(session.is_dirty());
    session.undo().unwrap().unwrap();
    assert!(session.is_dirty());
}

#[test]
fn isolate_then_undo_via_inverse_restores_every_lane() {
    let mut session = open();
    let before = session.graph.systems[&0].clone();
    let result = session.apply(Op::IsolateSystem { id: 0 }).unwrap();
    assert!(session.graph.systems[&0].lanes.is_empty());
    session.apply(result.entry.inverse).unwrap();
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
fn moved_system_projection_matches_a_reload_of_the_saved_file() {
    let mut session = open();
    session
        .apply(Op::MoveSystem {
            id: 0,
            x: -150.0,
            y: 60.0,
        })
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("moved.sav");
    session.save_as(&path).unwrap();
    assert!(!session.is_dirty());

    let reloaded = GalaxyGraph::build(&Document::load(&path).unwrap()).unwrap();
    let zero = &session.graph.systems[&0];
    assert_eq!((zero.x, zero.y), (-150.0, 60.0));
    assert_eq!(zero, &reloaded.systems[&0]);
    for lane in &zero.lanes {
        assert_eq!(
            session.graph.systems[&lane.to], reloaded.systems[&lane.to],
            "neighbour {}",
            lane.to
        );
        let other = &reloaded.systems[&lane.to];
        let dist = (zero.x - other.x).hypot(zero.y - other.y);
        assert_eq!(lane.length, dist.floor(), "lane 0 -> {}", lane.to);
        assert_eq!(reloaded.lane(lane.to, 0).unwrap().length, dist.floor());
    }
}

#[test]
fn added_lane_survives_save_and_reload() {
    let mut session = open();
    session
        .apply(Op::AddLane {
            a: 0,
            b: 1,
            bridge: false,
        })
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lane.sav");
    session.save_as(&path).unwrap();

    let reopened = Session::open(&path).unwrap();
    let (a, b) = (&reopened.graph.systems[&0], &reopened.graph.systems[&1]);
    let dist = (a.x - b.x).hypot(a.y - b.y);
    let lane = reopened.graph.lane(0, 1).expect("lane 0 -> 1");
    assert_eq!(lane.length, dist.floor());
    assert!(!lane.bridge);
    assert_eq!(reopened.graph.lane(1, 0).unwrap().length, dist.floor());
    assert!(
        reopened
            .validate()
            .iter()
            .all(|i| i.severity != Severity::Error),
        "{:?}",
        reopened.validate()
    );
}
