//! Several systems at once on the grammar fixture: what adding and removing them writes
//! into the file, that each is one history entry whose inverse puts them back exactly, and
//! what the bulk ops refuse.

use sgf_core::ops::{NewSystem, Op, OpError};

use crate::common;
use common::current;
use common::diff::{assert_removal_inverts_exactly, round_trip, snapshot};
use common::fixture::GRAMMAR;

/// One named with an initializer, one weighted, one bare.
fn three_new_systems() -> Vec<NewSystem> {
    let new = |id, x, y| NewSystem {
        system: id,
        x,
        y,
        name: None,
        initializer: None,
        spawn_weight: None,
        spawn_script: None,
        statement: None,
    };
    vec![
        NewSystem {
            name: Some("Alderaan".to_owned()),
            initializer: Some("misc_system_init_01".to_owned()),
            ..new(4000, 20.0, -30.5)
        },
        NewSystem {
            spawn_weight: Some(5.0),
            ..new(4001, 30.0, -40.0)
        },
        new(4002, -100.0, 100.25),
    ]
}

#[test]
fn add_systems_writes_three_systems_before_the_closing_brace() {
    snapshot(
        "add_systems_4000_4001_4002",
        GRAMMAR.open(),
        Op::AddSystems {
            systems: three_new_systems(),
        },
    );
}

#[test]
fn add_systems_is_one_history_entry_and_undo_and_redo_are_byte_identical() {
    let mut session = GRAMMAR.open();
    let result = session
        .apply(Op::AddSystems {
            systems: three_new_systems(),
        })
        .expect("add three systems");
    assert_eq!(result.entry.description, "Added 3 systems");
    assert_eq!(
        result.inverse,
        Op::RemoveSystems {
            systems: vec![4000, 4001, 4002]
        }
    );
    assert_eq!(
        session.history().undo.len(),
        1,
        "three systems, one undo step"
    );
    round_trip(
        GRAMMAR.open(),
        Op::AddSystems {
            systems: three_new_systems(),
        },
    );
}

#[test]
fn remove_systems_takes_each_line_and_every_lane_naming_one_once() {
    snapshot(
        "remove_systems_1_16_888",
        GRAMMAR.open(),
        Op::RemoveSystems {
            systems: vec![1, 16, 888],
        },
    );
}

#[test]
fn remove_systems_undo_and_redo_are_byte_identical_and_its_inverse_puts_them_back_exactly() {
    round_trip(
        GRAMMAR.open(),
        Op::RemoveSystems {
            systems: vec![1, 16, 888],
        },
    );
    // 2 and 888 weigh by a modifier, 16 has a z, 111 a range and a spawn design, 3018 an
    // effect block over several lines and 9 a prevented pair; 1 is linked to 2 and to 16
    // twice each.
    assert_removal_inverts_exactly(GRAMMAR.open(), &[1, 2, 16, 111, 3018, 9, 888]);
}

#[test]
fn bulk_system_ops_refuse_a_repeated_taken_or_unknown_id_and_leave_the_file_alone() {
    let mut session = GRAMMAR.open();
    let mut repeated = three_new_systems();
    repeated[2].system = 4000;
    let error = session
        .apply(Op::AddSystems { systems: repeated })
        .expect_err("4000 twice");
    assert!(matches!(error, OpError::DuplicateSystem(4000)), "{error:?}");

    let mut taken = three_new_systems();
    taken[1].system = 2;
    let error = session
        .apply(Op::AddSystems { systems: taken })
        .expect_err("2 is Coruscant");
    assert!(matches!(error, OpError::SystemExists(2)), "{error:?}");

    let mut null = three_new_systems();
    null[0].system = u32::MAX;
    let error = session
        .apply(Op::AddSystems { systems: null })
        .expect_err("the null id");
    assert!(
        matches!(error, OpError::NullSystemId(u32::MAX)),
        "{error:?}"
    );

    let mut unplaced = three_new_systems();
    unplaced[2].x = f64::NAN;
    let error = session
        .apply(Op::AddSystems { systems: unplaced })
        .expect_err("not a coordinate");
    assert!(matches!(error, OpError::NotFinite), "{error:?}");

    let error = session
        .apply(Op::RemoveSystems {
            systems: vec![1, 16, 1],
        })
        .expect_err("1 twice");
    assert!(matches!(error, OpError::DuplicateSystem(1)), "{error:?}");

    let error = session
        .apply(Op::RemoveSystems {
            systems: vec![1, 77],
        })
        .expect_err("no system 77");
    assert!(matches!(error, OpError::UnknownSystem(77)), "{error:?}");

    let error = session
        .apply(Op::RemoveSystems {
            systems: Vec::new(),
        })
        .expect_err("nothing to remove");
    assert!(matches!(error, OpError::NoEntries), "{error:?}");

    assert!(!session.doc().is_dirty());
    assert_eq!(current(&session), GRAMMAR.bytes());
    assert!(session.history().undo.is_empty());
}
