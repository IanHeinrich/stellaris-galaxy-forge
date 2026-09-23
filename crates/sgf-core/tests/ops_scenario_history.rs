//! Undo and redo on the grammar fixture: every op puts the file back byte for byte.

use sgf_core::ops::{Op, OpError};

mod common;
use common::current;
use common::diff::{report, round_trip, snapshot};
use common::fixture::GRAMMAR;

#[test]
fn add_lane_undo_and_redo_are_byte_identical() {
    round_trip(
        GRAMMAR.open(),
        Op::AddLane {
            a: 2,
            b: 16,
            bridge: false,
        },
    );
}

#[test]
fn add_system_undo_and_redo_are_byte_identical() {
    round_trip(
        GRAMMAR.open(),
        Op::AddSystem {
            id: None,
            x: 20.0,
            y: -30.5,
            name: Some("Alderaan".to_owned()),
            initializer: None,
            spawn_weight: None,
            spawn_script: None,
        },
    );
}

#[test]
fn add_system_with_a_spawn_weight_writes_it_on_one_history_entry() {
    snapshot(
        "add_system_with_spawn_weight",
        GRAMMAR.open(),
        Op::AddSystem {
            id: None,
            x: 20.0,
            y: -30.5,
            name: Some("Alderaan".to_owned()),
            initializer: Some("empire_init_01".to_owned()),
            spawn_weight: Some(1.0),
            spawn_script: None,
        },
    );
}

#[test]
fn add_system_with_a_spawn_weight_undo_and_redo_are_byte_identical() {
    round_trip(
        GRAMMAR.open(),
        Op::AddSystem {
            id: None,
            x: 20.0,
            y: -30.5,
            name: Some("Alderaan".to_owned()),
            initializer: Some("empire_init_01".to_owned()),
            spawn_weight: Some(1.0),
            spawn_script: None,
        },
    );
}

#[test]
fn remove_system_undo_and_redo_are_byte_identical() {
    round_trip(GRAMMAR.open(), Op::RemoveSystem { id: 1 });
}

fn add_system(id: u32, x: f64, y: f64, initializer: &str) -> Op {
    Op::AddSystem {
        id: Some(id),
        x,
        y,
        name: None,
        initializer: Some(initializer.to_owned()),
        spawn_weight: None,
        spawn_script: None,
    }
}

/// A marauder clan as the app adds one: a home, two raid bases and the lanes to them.
fn clan() -> Op {
    Op::Batch {
        description: "Added marauder clan 1".to_owned(),
        ops: vec![
            add_system(4000, 100.0, 100.0, "marauder_1_1"),
            add_system(4001, 100.0, 80.0, "marauder_1_2"),
            add_system(4002, 125.0, 100.0, "marauder_1_3"),
            Op::AddLanes {
                from: 4000,
                to: vec![(4001, false), (4002, false)],
            },
        ],
    }
}

#[test]
fn a_batch_of_systems_and_lanes_is_one_edit_and_one_undo_step() {
    let mut session = GRAMMAR.open();
    let result = session.apply(clan()).expect("apply the batch");
    assert_eq!(session.history().undo.len(), 1);
    assert!(session.graph.lane(4000, 4001).is_some());
    assert!(session.graph.lane(4000, 4002).is_some());
    common::snapshot("batch_clan", &report(&session, &result));

    session.undo().expect("undo").expect("the batch to undo");
    assert_eq!(current(&session), GRAMMAR.bytes());
    assert_eq!(session.history().undo.len(), 0);
    assert!(!session.graph.systems.contains_key(&4000));
    round_trip(GRAMMAR.open(), clan());
}

#[test]
fn a_batch_that_rewrites_a_statement_it_inserted_undoes_and_redoes_byte_for_byte() {
    round_trip(
        GRAMMAR.open(),
        Op::Batch {
            description: "Added and named a system".to_owned(),
            ops: vec![
                add_system(4000, 10.0, 10.0, "random_empire_init_01"),
                Op::SetSystemName {
                    id: 4000,
                    name: "Nowhere".to_owned(),
                },
            ],
        },
    );
}

#[test]
fn a_batch_whose_last_member_is_refused_leaves_nothing_behind() {
    let mut session = GRAMMAR.open();
    let error = session
        .apply(Op::Batch {
            description: "Added a base to nowhere".to_owned(),
            ops: vec![
                add_system(4000, 100.0, 100.0, "marauder_1_1"),
                Op::AddLanes {
                    from: 4000,
                    to: vec![(9999, false)],
                },
            ],
        })
        .expect_err("a lane to a system the file lacks");
    assert!(matches!(error, OpError::UnknownSystem(9999)), "{error}");
    assert_eq!(current(&session), GRAMMAR.bytes());
    assert_eq!(session.history().undo.len(), 0);
    assert!(!session.is_dirty());
    assert!(!session.graph.systems.contains_key(&4000));
}

#[test]
fn an_empty_batch_and_a_nested_one_are_refused() {
    let mut session = GRAMMAR.open();
    let error = session
        .apply(Op::Batch {
            description: "Nothing".to_owned(),
            ops: vec![],
        })
        .expect_err("empty");
    assert!(matches!(error, OpError::EmptyBatch), "{error}");
    assert_eq!(error.to_string(), "a batch with nothing in it");
    let error = session
        .apply(Op::Batch {
            description: "Outer".to_owned(),
            ops: vec![clan()],
        })
        .expect_err("nested");
    assert!(matches!(error, OpError::NestedBatch), "{error}");
    assert_eq!(error.to_string(), "a batch may not hold another batch");
    assert_eq!(current(&session), GRAMMAR.bytes());
    assert!(!session.is_dirty());
}
