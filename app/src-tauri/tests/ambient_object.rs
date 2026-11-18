//! Placing an ambient object in a system of the sample scenario, end to end.
use serde_json::json;
use sgf_app_lib::views::Added;
use sgf_core::format::scenario::placed::ambient_object_id;
use sgf_core::views::ErrorKind;

use crate::common;
use common::{SAMPLE_45, SCENARIO, invoke, opened};

fn derelict() -> serde_json::Value {
    json!({ "system": 9, "kind": "derelict_ship_object", "x": 40.0, "y": -25.0 })
}

/// The add answers the id of the object it wrote, which the app opens the page of.
#[test]
fn an_ambient_object_added_to_a_scenario_answers_its_id() {
    let w = opened(SCENARIO);
    let added: Added = invoke(&w, "add_ambient_object", derelict()).expect("added");
    assert_eq!(
        added.ambient_objects,
        [ambient_object_id(9, 0).expect("an id")]
    );
    assert_eq!(added.edit.details_stale, [9]);
    assert!(added.planets.is_empty() && added.megastructures.is_empty());
}

#[test]
fn a_save_takes_no_added_ambient_object() {
    let refused =
        invoke::<Added>(&opened(SAMPLE_45), "add_ambient_object", derelict()).expect_err("refused");
    assert_eq!(refused.kind, ErrorKind::Op);
    assert!(
        refused.message.contains("ambient object"),
        "{}",
        refused.message
    );
}
