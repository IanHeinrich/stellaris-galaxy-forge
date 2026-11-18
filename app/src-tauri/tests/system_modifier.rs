//! A scenario system's modifiers end to end: what its page offers to add, and what an add and
//! its undo leave in its details.
use serde_json::{Value, json};
use sgf_core::views::EditResult;
use sgf_core::views::details::{EffectModifier, SystemDetails};

use crate::common;
use common::{SCENARIO, invoke, with_game_data};

const SYSTEM: u32 = 9;

#[test]
fn a_scenario_system_is_offered_modifiers_and_its_details_list_what_an_add_writes() {
    let Some((w, _)) = with_game_data(SCENARIO) else {
        return;
    };
    let apply = |op: Value| {
        invoke::<EditResult>(&w, "apply_op", json!({ "op": op })).expect("apply");
    };
    let modifiers = || -> Vec<EffectModifier> {
        let details: Vec<SystemDetails> =
            invoke(&w, "get_system_details", json!({ "ids": [SYSTEM] })).expect("details");
        details[0]
            .spawn
            .as_ref()
            .expect("the spawn")
            .modifiers
            .clone()
    };
    apply(json!({
        "type": "SetInitializer",
        "system": SYSTEM,
        "initializer": "basic_init_02",
        "spawn_weight": null,
    }));

    let offered: Vec<Value> = invoke(
        &w,
        "get_system_modifier_choices",
        json!({ "present": ["turbulent_nebula"] }),
    )
    .expect("choices");
    let keys: Vec<&str> = offered
        .iter()
        .filter_map(|choice| choice["modifier"].as_str())
        .collect();
    assert!(!keys.is_empty(), "the install's scripts add some");
    assert!(
        !keys.contains(&"turbulent_nebula"),
        "the nebula's own is never offered, even where the file holds it: {keys:?}"
    );

    assert!(modifiers().is_empty());
    let modifier = keys[0].to_owned();
    apply(json!({ "type": "AddSystemModifier", "system": SYSTEM, "modifier": modifier }));
    assert_eq!(
        modifiers(),
        [EffectModifier {
            modifier,
            days: Some(-1.0),
            editable: true,
        }]
    );

    invoke::<Option<EditResult>>(&w, "undo", json!({}))
        .expect("undo")
        .expect("something to undo");
    assert!(modifiers().is_empty(), "undo takes it out again");
}
