//! Deleting a save ring world through its command on the 4.5 sample, with the flags the
//! install says its ring leaves.
use serde_json::json;
use sgf_app_lib::views::AddedRingWorld;
use sgf_core::views::EditResult;
use tauri::WebviewWindow;
use tauri::test::MockRuntime;

use crate::common::{SAMPLE_45, invoke, opened, with_game_data};

/// Habraq, owned by country 19: four planets, a moon and a belt round star 778.
const HABRAQ: u32 = 159;

/// The system's `flags` block as it stands, each flag as written.
fn system_flags(w: &WebviewWindow<MockRuntime>, system: u32) -> Vec<String> {
    let source: serde_json::Value = invoke(
        w,
        "get_entity_source",
        json!({ "addr": { "kind": "system", "id": system } }),
    )
    .expect("the system's source");
    let text = source["text"].as_str().expect("text");
    let open = "\n\t\tflags=\n\t\t{\n";
    let Some(at) = text.find(open) else {
        return Vec::new();
    };
    let block = &text[at + open.len()..];
    let end = block.find("\n\t\t}").expect("the flags block closes");
    block[..end]
        .lines()
        .map(|line| line.trim().to_owned())
        .collect()
}

/// The command takes every ring of the system; Lachium, system 203, holds a mixed ring.
#[test]
fn the_command_takes_every_ring() {
    let every: EditResult = invoke(
        &opened(SAMPLE_45),
        "delete_ring_world",
        json!({ "system": 203 }),
    )
    .expect("delete every ring");
    assert_eq!(every.details_stale, [203]);
}

/// With game data, a ring added and deleted again leaves the system's flags as they were:
/// the command takes the flags the install's chain sets.
#[test]
fn a_ring_added_and_deleted_leaves_the_flags_as_they_were() {
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let before = system_flags(&w, HABRAQ);
    let stages = ["finished"; 4];
    let ring = json!({ "system": HABRAQ, "kind": "ring_world_1", "stages": stages, "owner": 19, "clear": true });
    let _: AddedRingWorld = invoke(&w, "add_ring_world", ring).expect("a finished ring");
    assert_ne!(system_flags(&w, HABRAQ), before, "the ring sets its flags");
    let _: EditResult =
        invoke(&w, "delete_ring_world", json!({ "system": HABRAQ })).expect("delete");
    assert_eq!(system_flags(&w, HABRAQ), before);
}
