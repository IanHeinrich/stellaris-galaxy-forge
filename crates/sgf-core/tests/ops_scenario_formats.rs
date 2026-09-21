//! What each document format takes: the ops a save refuses, and the ops that leave a
//! scenario system's details stale.

use sgf_core::ops::{InitializerSet, Op, OpError};
use sgf_core::views::DocumentKind;

mod common;
use common::scenario::open;

#[test]
fn a_save_refuses_the_scenario_only_ops() {
    let mut session = common::open();
    for op in [
        Op::AddSystem {
            id: None,
            x: 0.0,
            y: 0.0,
            name: None,
            initializer: None,
            spawn_weight: None,
            spawn_script: None,
        },
        Op::RemoveSystem { id: 0 },
        Op::SetSystemName {
            id: 0,
            name: "x".to_owned(),
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
    ] {
        let name = op.name();
        let error = session.apply(op).expect_err("a save has no such op");
        assert!(
            matches!(
                error,
                OpError::Unsupported {
                    kind: DocumentKind::Save,
                    ..
                }
            ),
            "{name}: {error:?}"
        );
    }
    assert!(!session.doc.is_dirty());
}

/// A scenario system's details come from its initializer, so the three ops that write one
/// stale them and the app refetches; nothing else does.
#[test]
fn the_ops_that_write_an_initializer_stale_the_systems_details() {
    let mut session = open();

    let set = session
        .apply(Op::SetInitializer {
            id: 16,
            initializer: Some("sol_system_initializer".into()),
        })
        .expect("set the initializer");
    assert_eq!(set.details_stale, [16]);
    assert_eq!(
        session.edit_result(set).details_stale,
        [16],
        "and it reaches the app"
    );

    let added = session
        .apply(Op::AddSystem {
            id: Some(77),
            x: 10.0,
            y: 10.0,
            name: Some("Fresh".into()),
            initializer: Some("basic_init_01".into()),
            spawn_weight: None,
            spawn_script: None,
        })
        .expect("add a system");
    assert_eq!(added.details_stale, [77]);

    let removed = session
        .apply(Op::RemoveSystem { id: 16 })
        .expect("remove system 16");
    assert_eq!(
        removed.details_stale,
        [16],
        "the lanes it took with it name no system of their own"
    );

    let undone = session.undo().expect("undo").expect("something to undo");
    assert_eq!(undone.details_stale, [16]);
    let redone = session.redo().expect("redo").expect("something to redo");
    assert_eq!(redone.details_stale, [16]);

    let moved = session
        .apply(Op::MoveSystem {
            id: 2,
            x: 1.0,
            y: 2.0,
        })
        .expect("move");
    assert!(
        moved.details_stale.is_empty(),
        "a move leaves the initializer alone"
    );
    let named = session
        .apply(Op::SetSystemName {
            id: 2,
            name: "Renamed".into(),
        })
        .expect("rename");
    assert!(named.details_stale.is_empty());
}
