//! Undo and redo on the grammar fixture: every op puts the file back byte for byte.

use sgf_core::ops::Op;

mod common;
use common::diff::{round_trip, snapshot};
use common::scenario::open;

#[test]
fn add_lane_undo_and_redo_are_byte_identical() {
    round_trip(
        open(),
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
        open(),
        Op::AddSystem {
            id: None,
            x: 20.0,
            y: -30.5,
            name: Some("Alderaan".to_owned()),
            initializer: None,
            spawn_weight: None,
        },
    );
}

#[test]
fn add_system_with_a_spawn_weight_writes_it_on_one_history_entry() {
    snapshot(
        "add_system_with_spawn_weight",
        open(),
        Op::AddSystem {
            id: None,
            x: 20.0,
            y: -30.5,
            name: Some("Alderaan".to_owned()),
            initializer: Some("empire_init_01".to_owned()),
            spawn_weight: Some(1.0),
        },
    );
}

#[test]
fn add_system_with_a_spawn_weight_undo_and_redo_are_byte_identical() {
    round_trip(
        open(),
        Op::AddSystem {
            id: None,
            x: 20.0,
            y: -30.5,
            name: Some("Alderaan".to_owned()),
            initializer: Some("empire_init_01".to_owned()),
            spawn_weight: Some(1.0),
        },
    );
}

#[test]
fn remove_system_undo_and_redo_are_byte_identical() {
    round_trip(open(), Op::RemoveSystem { id: 1 });
}
