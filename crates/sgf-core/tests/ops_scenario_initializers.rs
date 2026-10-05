//! Initializers on the grammar fixture: what setting and clearing one writes into the file,
//! how undo and redo restore it, and which texts are refused before any write.

use crate::common::batch::initializers;
use sgf_core::document::Document;
use sgf_core::ops::{NewSystem, Op, OpError};
use sgf_core::session::Session;

use crate::common;
use common::current;
use common::diff::{round_trip, snapshot};
use common::fixture::GRAMMAR;

#[test]
fn set_initializer_adds_one_to_a_system_that_had_none() {
    snapshot(
        "set_initializer_16",
        GRAMMAR.open(),
        Op::SetInitializer {
            system: 16,
            initializer: Some("random_empire_init_01".to_owned()),
        },
    );
}

#[test]
fn set_initializer_leaves_the_spawn_weight_beside_it_alone() {
    snapshot(
        "set_initializer_2",
        GRAMMAR.open(),
        Op::SetInitializer {
            system: 2,
            initializer: Some("misc_system_init_01".to_owned()),
        },
    );
}

/// One that already names an initializer, one that names none, and one cleared.
fn three_entries() -> Vec<(u32, Option<String>)> {
    vec![
        (1, Some("sol_system_initializer".to_owned())),
        (16, Some("random_empire_init_01".to_owned())),
        (3018, None),
    ]
}

#[test]
fn set_initializers_writes_three_systems_at_once() {
    snapshot(
        "set_initializers_1_16_3018",
        GRAMMAR.open(),
        initializers(three_entries()),
    );
}

#[test]
fn set_initializers_is_one_history_entry_and_stales_every_system() {
    let mut session = GRAMMAR.open();
    let result = session
        .apply(initializers(three_entries()))
        .expect("set three initializers");
    assert_eq!(result.entry.description, "Set initializer of 3 systems");
    assert_eq!(result.details_stale, [1, 16, 3018]);
    let history = session.history();
    assert_eq!(history.undo.len(), 1, "three systems, one undo step");
    assert!(history.redo.is_empty());
}

#[test]
fn set_initializers_undo_and_redo_are_byte_identical() {
    round_trip(GRAMMAR.open(), initializers(three_entries()));
}

#[test]
fn clearing_an_initializer_leaves_the_spawn_weight_standing() {
    snapshot(
        "clear_initializer_3018",
        GRAMMAR.open(),
        Op::SetInitializer {
            system: 3018,
            initializer: None,
        },
    );
}

#[test]
fn clearing_an_initializer_keeps_the_comment_that_follows_it() {
    let text = String::from_utf8(GRAMMAR.bytes()).unwrap().replacen(
        "\t\tinitializer = random_empire_init_01\n",
        "\t\tinitializer = random_empire_init_01 # the seat\n",
        1,
    );
    let doc = Document::from_scenario_bytes(text.into_bytes()).expect("index the bytes");
    let mut session = Session::from_document(None, doc).expect("project the bytes");
    session
        .apply(Op::SetInitializer {
            system: 3018,
            initializer: None,
        })
        .expect("clear the initializer");
    let edited = String::from_utf8(current(&session)).unwrap();
    assert!(!edited.contains("random_empire_init_01"), "{edited}");
    assert!(edited.contains("# the seat\n"), "{edited}");
}

#[test]
fn an_initializer_that_is_not_one_bare_key_is_refused_before_any_write() {
    let bare = |id| NewSystem {
        system: id,
        x: 20.0,
        y: -30.5,
        name: None,
        initializer: Some("misc_system_init_01".to_owned()),
        spawn_weight: None,
        spawn_script: None,
        statement: None,
    };
    for text in ["misc system", "misc{", "a = b", "{ }"] {
        let bad = Some(text.to_owned());
        let ops = [
            Op::AddSystem {
                system: Some(4000),
                x: 20.0,
                y: -30.5,
                name: None,
                initializer: bad.clone(),
                spawn_weight: None,
                spawn_script: None,
            },
            Op::AddSystems {
                systems: vec![
                    bare(4000),
                    NewSystem {
                        initializer: bad.clone(),
                        ..bare(4001)
                    },
                ],
            },
            Op::SetInitializer {
                system: 16,
                initializer: bad.clone(),
            },
            initializers(vec![
                (16, Some("misc_system_init_01".to_owned())),
                (1, bad.clone()),
            ]),
        ];
        for op in ops {
            let mut session = GRAMMAR.open();
            let name = op.name();
            let error = session.apply(op).expect_err(name);
            assert!(
                matches!(&error, OpError::InvalidText { text: t, .. } if t == text),
                "{name} with {text:?}: {error}"
            );
            assert_eq!(current(&session), GRAMMAR.bytes(), "{name} with {text:?}");
        }
    }
}
