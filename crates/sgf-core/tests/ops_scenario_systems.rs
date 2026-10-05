//! Systems on the grammar fixture: what adding, removing and renaming one writes into the
//! file, and what each op refuses. Initializers are in `ops_scenario_initializers`, and
//! ops on several systems at once in `ops_scenario_systems_bulk`.

use sgf_core::document::Document;
use sgf_core::ops::{Op, OpError};
use sgf_core::session::Session;

use crate::common;
use common::current;
use common::diff::snapshot;
use common::fixture::GRAMMAR;

#[test]
fn a_system_edited_earlier_can_still_be_removed() {
    let mut session = GRAMMAR.open();
    session
        .apply(Op::MoveSystem {
            system: 2,
            x: 5.0,
            y: -50.0,
        })
        .expect("move");
    session
        .apply(Op::RenameSystem {
            system: 2,
            name: "Imperial Center".into(),
        })
        .expect("rename");
    session
        .apply(Op::RemoveSystem { system: 2 })
        .expect("remove a system that earlier ops rewrote");
    assert!(!session.graph().systems.contains_key(&2));
    assert!(session.graph().lane(1, 2).is_none());
    for _ in 0..3 {
        session.undo().expect("undo").expect("something to undo");
    }
    assert_eq!(current(&session), GRAMMAR.bytes());
}

#[test]
fn a_system_the_file_left_nameless_gets_its_statement_back_on_undo() {
    let nameless = b"static_galaxy_scenario = {\n\tname = \"nameless\"\n\tsystem = { id = \"1\" position = { x = 0 y = 0 } }\n}\n";
    let doc = Document::from_scenario_bytes(nameless.to_vec()).expect("index");
    let mut session = Session::from_document(None, doc).expect("project");

    let named = session
        .apply(Op::RenameSystem {
            system: 1,
            name: "Sol".into(),
        })
        .expect("name a system the file left nameless");
    assert_eq!(
        named.inverse,
        Op::RenameSystem {
            system: 1,
            name: String::new(),
        }
    );
    assert!(
        current(&session)
            .windows(12)
            .any(|w| w == b"name = \"Sol\"")
    );

    session
        .apply(named.inverse)
        .expect("the inverse takes the statement away again");
    assert_eq!(current(&session), nameless);
    assert_eq!(session.graph().systems[&1].name, Default::default());
}

#[test]
fn clearing_the_name_of_a_named_system_takes_the_statement_away_and_undo_puts_it_back() {
    let fixture = GRAMMAR.bytes();
    let mut session = GRAMMAR.open();

    let cleared = session
        .apply(Op::RenameSystem {
            system: 9,
            name: String::new(),
        })
        .expect("clear the name of a system the file named");
    assert_eq!(
        cleared.entry.description,
        "Left Lonely #9 for the game to name"
    );
    assert_eq!(
        cleared.inverse,
        Op::RenameSystem {
            system: 9,
            name: "Lonely".into(),
        }
    );
    assert!(
        !current(&session)
            .windows(15)
            .any(|w| w == b"name = \"Lonely\"")
    );
    assert_eq!(session.graph().systems[&9].name, Default::default());

    session.undo().expect("undo").expect("something to undo");
    assert_eq!(current(&session), fixture);
    assert_eq!(session.graph().systems[&9].name.key, "Lonely");
}

#[test]
fn a_name_that_cannot_be_quoted_is_refused() {
    let mut session = GRAMMAR.open();
    for name in ["Sol \"Prime\"", "back\\slash", "two\nlines"] {
        let err = session
            .apply(Op::RenameSystem {
                system: 16,
                name: name.into(),
            })
            .expect_err("refused");
        assert!(
            matches!(err, OpError::InvalidText { what: "a name", .. }),
            "{name}: {err}"
        );
        let err = session
            .apply(Op::AddSystem {
                system: None,
                x: 1.0,
                y: 1.0,
                name: Some(name.into()),
                initializer: None,
                spawn_weight: None,
                spawn_script: None,
            })
            .expect_err("refused");
        assert!(
            matches!(err, OpError::InvalidText { what: "a name", .. }),
            "{name}: {err}"
        );
    }
    let err = session
        .apply(Op::AddSystem {
            system: None,
            x: 1.0,
            y: 1.0,
            name: Some(String::new()),
            initializer: None,
            spawn_weight: None,
            spawn_script: None,
        })
        .expect_err("an empty name is no name");
    assert!(
        matches!(err, OpError::EmptyText { what: "a name" }),
        "{err}"
    );
    assert!(!session.is_dirty());
}

#[test]
fn add_system_takes_the_next_id_and_lands_before_the_closing_brace() {
    snapshot(
        "add_system",
        GRAMMAR.open(),
        Op::AddSystem {
            system: None,
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
fn add_system_is_refused_when_the_id_is_taken() {
    let mut session = GRAMMAR.open();
    let error = session
        .apply(Op::AddSystem {
            system: Some(2),
            x: 0.0,
            y: 0.0,
            name: None,
            initializer: None,
            spawn_weight: None,
            spawn_script: None,
        })
        .expect_err("2 is Coruscant");
    assert!(matches!(error, OpError::SystemExists(2)), "{error:?}");
    assert_eq!(error.to_string(), "system 2 already exists");
    assert!(!session.doc().is_dirty());
}

#[test]
fn remove_system_1_takes_its_line_and_every_lane_naming_it() {
    snapshot(
        "remove_system_1",
        GRAMMAR.open(),
        Op::RemoveSystem { system: 1 },
    );
}

#[test]
fn removing_a_system_tells_the_map_to_drop_it_and_redraw_its_neighbours() {
    let mut session = GRAMMAR.open();
    let result = session
        .apply(Op::RemoveSystem { system: 1 })
        .expect("remove");
    let delta = session.edit_result(result).delta;
    assert_eq!(delta.removed, [1]);
    let mut redrawn: Vec<u32> = delta.systems.iter().map(|s| s.id).collect();
    redrawn.sort_unstable();
    assert_eq!(redrawn, [2, 9, 16], "both ends of every cut lane");
}

#[test]
fn adding_a_system_and_removing_it_again_is_byte_identical() {
    let fixture = GRAMMAR.bytes();
    let mut session = GRAMMAR.open();
    session
        .apply(Op::AddSystem {
            system: None,
            x: 20.0,
            y: -30.5,
            name: None,
            initializer: None,
            spawn_weight: None,
            spawn_script: None,
        })
        .expect("add");
    assert!(session.graph().systems.contains_key(&3019));
    session
        .apply(Op::RemoveSystem { system: 3019 })
        .expect("remove the system just added");
    assert_eq!(current(&session), fixture);
    assert!(!session.graph().systems.contains_key(&3019));
}

#[test]
fn set_system_name_writes_a_name_the_statement_had_empty() {
    snapshot(
        "set_system_name_16",
        GRAMMAR.open(),
        Op::RenameSystem {
            system: 16,
            name: "Alderaan".to_owned(),
        },
    );
}

#[test]
fn set_system_name_reaches_into_a_multi_line_system() {
    snapshot(
        "set_system_name_3018",
        GRAMMAR.open(),
        Op::RenameSystem {
            system: 3018,
            name: "NAME_Iridonia".to_owned(),
        },
    );
}

#[test]
fn a_system_with_one_lane_is_removed_with_one_lane() {
    let mut session = GRAMMAR.open();
    let removed = session
        .apply(Op::RemoveSystem { system: 888 })
        .expect("remove");
    assert_eq!(removed.entry.description, "Removed Reserved #888 (1 lane)");
}
