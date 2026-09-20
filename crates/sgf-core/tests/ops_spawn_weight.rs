//! The base spawn weight on the grammar fixture: what each op writes into a system
//! statement, and that undo puts the file back byte for byte.

use sgf_core::ops::Op;

mod common;
use common::diff::{plain_report, plain_snapshot, round_trip};
use common::scenario::{bytes, current, open};

#[test]
fn setting_the_weight_of_2_rewrites_the_base_beside_its_modifier() {
    plain_snapshot(
        "set_weight_2",
        open(),
        Op::SetSpawnWeight {
            id: 2,
            base: Some(5.0),
        },
    );
    round_trip(
        open(),
        Op::SetSpawnWeight {
            id: 2,
            base: Some(5.0),
        },
    );
}

#[test]
fn setting_the_weight_of_512_writes_a_base_into_its_modifier_only_block() {
    plain_snapshot(
        "set_weight_512",
        open(),
        Op::SetSpawnWeight {
            id: 512,
            base: Some(2.5),
        },
    );
    round_trip(
        open(),
        Op::SetSpawnWeight {
            id: 512,
            base: Some(2.5),
        },
    );
}

#[test]
fn setting_the_weight_of_1_writes_the_block_after_its_initializer() {
    plain_snapshot(
        "set_weight_1",
        open(),
        Op::SetSpawnWeight {
            id: 1,
            base: Some(1.0),
        },
    );
    round_trip(
        open(),
        Op::SetSpawnWeight {
            id: 1,
            base: Some(1.0),
        },
    );
}

#[test]
fn setting_the_weight_of_111_writes_the_block_after_its_position() {
    plain_snapshot(
        "set_weight_111",
        open(),
        Op::SetSpawnWeight {
            id: 111,
            base: Some(3.0),
        },
    );
    round_trip(
        open(),
        Op::SetSpawnWeight {
            id: 111,
            base: Some(3.0),
        },
    );
}

#[test]
fn setting_the_weight_of_3018_rewrites_the_base_on_its_own_line() {
    plain_snapshot(
        "set_weight_3018",
        open(),
        Op::SetSpawnWeight {
            id: 3018,
            base: Some(4.0),
        },
    );
    round_trip(
        open(),
        Op::SetSpawnWeight {
            id: 3018,
            base: Some(4.0),
        },
    );
}

#[test]
fn a_weight_of_zero_is_written_because_a_modifier_can_still_make_it_a_start() {
    plain_snapshot(
        "set_weight_zero_3018",
        open(),
        Op::SetSpawnWeight {
            id: 3018,
            base: Some(0.0),
        },
    );
    round_trip(
        open(),
        Op::SetSpawnWeight {
            id: 3018,
            base: Some(0.0),
        },
    );
    // The fixture's own idiom written where there was no base at all.
    round_trip(
        open(),
        Op::SetSpawnWeight {
            id: 512,
            base: Some(0.0),
        },
    );
}

/// Clearing a base takes the space before it with the statement, so writing one again
/// has to bring a space of its own; the two ops are inverses on any block shape.
#[test]
fn a_base_cleared_and_written_again_stands_apart_from_the_modifier_beside_it() {
    let mut session = open();
    session
        .apply(Op::SetSpawnWeight { id: 2, base: None })
        .expect("clear");
    let result = session
        .apply(Op::SetSpawnWeight {
            id: 2,
            base: Some(5.0),
        })
        .expect("set");
    let text = String::from_utf8(current(&session)).expect("utf-8");
    assert!(
        text.contains("spawn_weight = { base = 5 modifier = { add = 10000"),
        "the base ran into the modifier"
    );
    assert_eq!(session.graph.systems[&2].spawn_weight, Some(5.0));
    assert_eq!(session.graph.systems[&2].spawn_modifiers.len(), 1);
    common::snapshot("clear_then_set_weight_2", &plain_report(&session, &result));

    session
        .apply(Op::SetSpawnWeight {
            id: 3018,
            base: None,
        })
        .expect("clear the whole block");
    session
        .apply(Op::SetSpawnWeight {
            id: 3018,
            base: Some(2.0),
        })
        .expect("write it back");
    assert_eq!(session.graph.systems[&3018].spawn_weight, Some(2.0));

    for _ in 0..4 {
        session.undo().expect("undo").expect("an op to undo");
    }
    assert_eq!(current(&session), bytes());
}

#[test]
fn clearing_the_weight_of_2_leaves_the_modifier_standing() {
    let mut session = open();
    let result = session
        .apply(Op::SetSpawnWeight { id: 2, base: None })
        .expect("clear");
    assert_eq!(session.graph.systems[&2].spawn_weight, None);
    assert_eq!(session.graph.systems[&2].spawn_modifiers.len(), 1);
    common::snapshot("clear_weight_2", &plain_report(&session, &result));
    round_trip(open(), Op::SetSpawnWeight { id: 2, base: None });
}

#[test]
fn clearing_the_weight_of_3018_removes_the_whole_block() {
    let mut session = open();
    let result = session
        .apply(Op::SetSpawnWeight {
            id: 3018,
            base: None,
        })
        .expect("clear");
    assert_eq!(session.graph.systems[&3018].spawn_weight, None);
    common::snapshot("clear_weight_3018", &plain_report(&session, &result));
    round_trip(
        open(),
        Op::SetSpawnWeight {
            id: 3018,
            base: None,
        },
    );
}

#[test]
fn clearing_the_weight_of_a_system_that_has_none_writes_nothing() {
    let mut session = open();
    session
        .apply(Op::SetSpawnWeight { id: 9, base: None })
        .expect("clear");
    assert_eq!(current(&session), bytes());
}

#[test]
fn several_weights_are_one_undo_step() {
    let entries = vec![(2, Some(4.0)), (512, Some(2.0)), (1, None)];
    plain_snapshot(
        "set_weights",
        open(),
        Op::SetSpawnWeights {
            entries: entries.clone(),
        },
    );
    round_trip(open(), Op::SetSpawnWeights { entries });
}
