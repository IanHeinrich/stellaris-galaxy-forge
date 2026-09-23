//! `SetHeaderList` on the painted fixture, whose header lists ten `supports_shape`
//! statements: the diff a shorter list, a longer list and a cleared list each produce,
//! undo byte for byte, a key the header lacks, and the refusals.

use sgf_core::ops::{Op, OpError};
use sgf_core::session::Session;

mod common;
use common::current;
use common::diff::{plain_snapshot, round_trip};
use common::fixture::PAINTED;

const SHAPES: [&str; 10] = [
    "elliptical",
    "spiral_2",
    "spiral_3",
    "spiral_4",
    "spiral_6",
    "ring",
    "bar",
    "cartwheel",
    "cluster",
    "starburst",
];

fn set(key: &str, values: &[&str]) -> Op {
    Op::SetHeaderList {
        key: key.to_owned(),
        values: values.iter().map(|value| (*value).to_owned()).collect(),
    }
}

fn shapes(values: &[&str]) -> Op {
    set("supports_shape", values)
}

/// Every statement of `key` as the rebuilt index now reads it.
fn values(session: &Session, key: &str) -> Vec<String> {
    let header = &session.doc.scenario().expect("a scenario").header;
    header.all(key).map(|s| s.field.value.clone()).collect()
}

fn owned(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

#[test]
fn a_shorter_list_rewrites_the_first_statements_and_removes_the_rest() {
    plain_snapshot(
        "shapes_to_two",
        PAINTED.open(),
        shapes(&["elliptical", "spoked"]),
    );
    round_trip(PAINTED.open(), shapes(&["elliptical", "spoked"]));

    let mut session = PAINTED.open();
    let result = session
        .apply(shapes(&["elliptical", "spoked"]))
        .expect("set two shapes");
    assert_eq!(result.entry.description, "Set supports_shape to 2 values");
    assert_eq!(result.inverse, shapes(&SHAPES));
    assert_eq!(
        values(&session, "supports_shape"),
        owned(&["elliptical", "spoked"])
    );
    assert_eq!(session.history().undo.len(), 1);
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(values(&session, "supports_shape"), owned(&SHAPES));
}

#[test]
fn a_longer_list_writes_the_extra_values_after_the_last_statement() {
    let mut longer = SHAPES.to_vec();
    longer.push("spoked");
    plain_snapshot("shapes_plus_spoked", PAINTED.open(), shapes(&longer));
    round_trip(PAINTED.open(), shapes(&longer));

    let mut session = PAINTED.open();
    session.apply(shapes(&longer)).expect("add a shape");
    assert_eq!(values(&session, "supports_shape"), owned(&longer));
}

#[test]
fn an_empty_list_removes_every_statement_and_undo_puts_them_back() {
    plain_snapshot("shapes_to_none", PAINTED.open(), shapes(&[]));
    round_trip(PAINTED.open(), shapes(&[]));

    let mut session = PAINTED.open();
    let result = session.apply(shapes(&[])).expect("clear the shapes");
    assert_eq!(result.entry.description, "Set supports_shape to 0 values");
    assert_eq!(result.inverse, shapes(&SHAPES));
    assert!(values(&session, "supports_shape").is_empty());
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(values(&session, "supports_shape"), owned(&SHAPES));
    assert_eq!(current(&session), session.doc.original());
}

#[test]
fn a_key_the_header_lacks_is_inserted_before_the_first_system() {
    let mut session = PAINTED.open();
    session.apply(shapes(&[])).expect("clear the shapes");
    let cleared = current(&session);
    let result = session
        .apply(shapes(&["ring", "spoked"]))
        .expect("list the shapes again");
    assert_eq!(result.inverse, shapes(&[]));
    assert_eq!(
        values(&session, "supports_shape"),
        owned(&["ring", "spoked"])
    );
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), cleared);

    plain_snapshot(
        "insert_supports_language",
        PAINTED.open(),
        set("supports_language", &["english", "german"]),
    );
    round_trip(
        PAINTED.open(),
        set("supports_language", &["english", "german"]),
    );
}

#[test]
fn the_extra_values_step_over_a_line_an_earlier_removal_emptied() {
    let mut session = PAINTED.open();
    session
        .apply(Op::SetHeaderField {
            key: "random_hyperlanes".to_owned(),
            value: None,
        })
        .expect("remove the line after the shapes");
    let mut longer = SHAPES.to_vec();
    longer.push("spoked");
    session.apply(shapes(&longer)).expect("add a shape");
    assert_eq!(values(&session, "supports_shape"), owned(&longer));
    assert!(values(&session, "random_hyperlanes").is_empty());
    let text = String::from_utf8(current(&session)).expect("utf-8");
    assert!(
        text.contains(
            "\tsupports_shape = starburst\n\tsupports_shape = spoked\n\tnum_wormhole_pairs"
        ),
        "{text}"
    );
    session.undo().expect("undo").expect("an op to undo");
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), session.doc.original());
}

#[test]
fn a_missing_key_with_no_values_a_bad_value_and_a_save_are_refused() {
    let mut session = PAINTED.open();
    for (op, name) in [
        (set("supports_language", &[]), "nothing to remove"),
        (shapes(&["ring spoked"]), "two values in one"),
        (shapes(&[""]), "an empty value"),
        (set("system", &["5"]), "a scenario statement"),
    ] {
        let error = session.apply(op).expect_err(name);
        assert!(
            matches!(error, OpError::HeaderParse { .. }),
            "{name}: {error}"
        );
    }
    assert!(!session.is_dirty());

    let mut save = common::open();
    let error = save
        .apply(shapes(&["ring"]))
        .expect_err("a save has no header");
    assert!(
        matches!(
            error,
            OpError::Unsupported {
                op: "SetHeaderList",
                ..
            }
        ),
        "{error}"
    );
    assert!(!save.is_dirty());
}
