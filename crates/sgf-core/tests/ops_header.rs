//! `SetHeaderField` on the grammar fixture: the diff each rewrite, insertion and removal
//! produces is snapshotted, undo is checked byte for byte, and the rebuilt header is read
//! back through the index the app lists it from.

use sgf_core::ops::{Op, OpError};
use sgf_core::session::Session;

use crate::common;
use common::current;
use common::diff::{plain_snapshot, round_trip};
use common::fixture::GRAMMAR;

fn set(key: &str, value: Option<&str>) -> Op {
    Op::SetHeaderField {
        key: key.to_owned(),
        value: value.map(str::to_owned),
    }
}

/// The key as the rebuilt index now reads it.
fn field(session: &Session, key: &str) -> Option<String> {
    let header = &session.doc.scenario().expect("a scenario").header;
    Some(header.get(key)?.field.value.clone())
}

#[test]
fn setting_a_scalar_rewrites_it_where_it_stands() {
    plain_snapshot(
        "set_core_radius",
        GRAMMAR.open(),
        set("core_radius", Some("25")),
    );
}

#[test]
fn setting_a_block_writes_raw_text_over_the_whole_value() {
    plain_snapshot(
        "set_num_empires",
        GRAMMAR.open(),
        set("num_empires", Some("{ min = 3 max = 5 }")),
    );
}

#[test]
fn a_key_the_header_lacks_is_inserted_before_the_first_system() {
    plain_snapshot(
        "insert_nomad_empire_default",
        GRAMMAR.open(),
        set("nomad_empire_default", Some("1")),
    );
}

#[test]
fn clearing_a_key_takes_the_line_it_had_to_itself() {
    plain_snapshot(
        "remove_supports_shape",
        GRAMMAR.open(),
        set("supports_shape", None),
    );
}

#[test]
fn the_header_ops_undo_and_redo_byte_for_byte() {
    round_trip(GRAMMAR.open(), set("core_radius", Some("25")));
    round_trip(
        GRAMMAR.open(),
        set("num_empires", Some("{ min = 3 max = 5 }")),
    );
    round_trip(GRAMMAR.open(), set("nomad_empire_default", Some("1")));
    round_trip(GRAMMAR.open(), set("supports_shape", None));
}

#[test]
fn the_rebuilt_header_reads_back_what_the_op_wrote() {
    let mut session = GRAMMAR.open();
    assert_eq!(field(&session, "core_radius").as_deref(), Some("10"));

    let result = session
        .apply(set("core_radius", Some("25")))
        .expect("set a scalar");
    assert_eq!(field(&session, "core_radius").as_deref(), Some("25"));
    assert_eq!(session.graph.core_radius, 25.0);
    let delta = session.edit_result(result).delta;
    assert!(delta.systems.is_empty() && delta.nebulae.is_none());
    let header = delta
        .header
        .expect("the app is handed the rewritten header");
    assert!(
        header
            .iter()
            .any(|f| f.key == "core_radius" && f.value == "25"),
        "{header:?}"
    );

    session
        .apply(set("nomad_empire_default", Some("1")))
        .expect("insert a key");
    assert_eq!(
        field(&session, "nomad_empire_default").as_deref(),
        Some("1")
    );

    session
        .apply(set("supports_shape", None))
        .expect("remove a key");
    assert_eq!(field(&session, "supports_shape"), None);

    let result = session
        .apply(set("name", Some("\"Renamed Scenario\"")))
        .expect("rename the scenario");
    assert_eq!(
        result.entry.description,
        "Set header name to \"Renamed Scenario\""
    );
    assert_eq!(session.title(), "Renamed Scenario");
    assert!(
        result.touched.is_empty(),
        "the header names no system for the map"
    );

    let undone = session.undo().expect("undo").expect("an op to undo");
    assert_eq!(
        undone.inverse,
        set("name", Some("\"sgf_grammar\"")),
        "the inverse carries the raw text it displaced"
    );
    assert_eq!(session.title(), "sgf_grammar");
}

#[test]
fn an_edited_header_survives_a_save_and_reopen() {
    let mut session = GRAMMAR.open();
    session
        .apply(set("name", Some("\"Renamed Scenario\"")))
        .expect("rename");
    session
        .apply(set("nomad_empire_max", Some("2")))
        .expect("insert a key");
    session
        .apply(set("supports_shape", None))
        .expect("remove a key");
    let edited = current(&session);

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("edited.txt");
    session.save_as(&path).expect("save the edited scenario");

    let reopened = Session::open(&path).expect("reopen what was saved");
    assert_eq!(std::fs::read(&path).unwrap(), edited);
    assert_eq!(reopened.title(), "Renamed Scenario");
    assert_eq!(field(&reopened, "nomad_empire_max").as_deref(), Some("2"));
    assert_eq!(field(&reopened, "supports_shape"), None);
    assert_eq!(reopened.graph.order, session.graph.order);
}

#[test]
fn raw_text_that_is_not_one_statements_value_is_refused() {
    let mut session = GRAMMAR.open();
    for value in ["{ min = 1", "1 }", "1\nmax = 2", "  "] {
        let error = session
            .apply(set("num_empires", Some(value)))
            .expect_err("refused");
        assert!(matches!(error, OpError::HeaderParse { .. }), "{error:?}");
    }
    // The lexer runs an open quote to the end of the file and a `#` comments out the rest
    // of a physical line, which a header shares with whatever statements follow it.
    for (key, value) in [
        ("name", "\"Renamed"),
        ("priority", "5 # mine"),
        ("priority", "5 6"),
    ] {
        let error = session.apply(set(key, Some(value))).expect_err("refused");
        assert!(
            matches!(error, OpError::HeaderParse { .. }),
            "{key} = {value}: {error:?}"
        );
    }
    let error = session
        .apply(set("nomad_empire_default", None))
        .expect_err("the header holds no such key");
    assert!(matches!(error, OpError::HeaderParse { .. }), "{error:?}");
    assert!(!session.is_dirty());
}

/// Braces inside a quoted name are text rather than structure, so the value is read as
/// the lexer reads it rather than counted.
#[test]
fn a_quoted_value_may_hold_a_brace() {
    let mut session = GRAMMAR.open();
    session
        .apply(set("name", Some("\"Sector { Alpha\"")))
        .expect("a brace inside quotes is text");
    assert_eq!(
        field(&session, "name").as_deref(),
        Some("\"Sector { Alpha\"")
    );
    assert_eq!(session.title(), "Sector { Alpha");
}

/// The header is every statement that is not an entity, so a key naming one would be
/// written as an entity and read back as a phantom system, lane or cloud.
#[test]
fn a_key_that_names_an_entity_statement_is_refused() {
    let mut session = GRAMMAR.open();
    for key in ["system", "add_hyperlane", "prevent_hyperlane", "nebula"] {
        let error = session.apply(set(key, Some("5"))).expect_err("refused");
        assert!(
            matches!(error, OpError::HeaderParse { .. }),
            "{key}: {error:?}"
        );
    }
    assert_eq!(session.graph.nebulae.len(), 2);
    assert_eq!(session.graph.systems.len(), 8);
    assert!(!session.is_dirty());
}

/// Removing one of a repeated key would record an inverse that puts the text back at the
/// survivor's statement, so the op is refused rather than half-described.
#[test]
fn removing_a_key_the_header_holds_twice_is_refused() {
    let fixture = GRAMMAR.text();
    let doubled = fixture.replacen(
        "\tsupports_shape = elliptical\n",
        "\tsupports_shape = elliptical\n\tsupports_shape = ring\n",
        1,
    );
    assert_ne!(doubled, fixture, "the fixture holds supports_shape once");
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("doubled.txt");
    std::fs::write(&path, &doubled).unwrap();

    let mut session = Session::open(&path).expect("open the doubled scenario");
    let error = session
        .apply(set("supports_shape", None))
        .expect_err("which statement to remove is ambiguous");
    let OpError::HeaderParse { reason, .. } = &error else {
        panic!("{error:?}");
    };
    assert!(
        reason.contains("2 times") && reason.contains("9, 10"),
        "{reason}"
    );
    assert!(!session.is_dirty());

    session
        .apply(set("supports_shape", Some("spiral")))
        .expect("the first statement is the one the game reads");
    assert_eq!(field(&session, "supports_shape").as_deref(), Some("spiral"));
    assert!(
        String::from_utf8_lossy(&current(&session)).contains("supports_shape = ring"),
        "the duplicate is left as it stands"
    );
}

/// An inserted key stands in a slot of its own rather than on a line of the file, so
/// removing it again empties that slot.
#[test]
fn a_key_inserted_and_removed_again_is_byte_identical() {
    let fixture = GRAMMAR.bytes();
    let mut session = GRAMMAR.open();
    session
        .apply(set("nomad_empire_default", Some("1")))
        .expect("insert");
    assert_eq!(
        field(&session, "nomad_empire_default").as_deref(),
        Some("1")
    );
    session
        .apply(set("nomad_empire_default", None))
        .expect("remove the key just inserted");
    assert_eq!(current(&session), fixture);
    assert_eq!(field(&session, "nomad_empire_default"), None);
}
