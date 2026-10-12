//! Adding a ring world round a star of the real 4.5 sample save, end to end, and what
//! clearing a system for one would take.
use serde_json::json;
use sgf_app_lib::views::AddedRingWorld;
use sgf_core::views::{EditResult, ErrorKind, RingWorldClearing};

use crate::common;
use common::{SAMPLE_45, invoke, open, webview, with_game_data};

/// Habraq, owned by country 19: four planets, a moon and a belt round star 778.
const HABRAQ: u32 = 159;
/// Vinh, whose planet 517 is a colony.
const VINH: u32 = 174;

fn ring(system: u32, kind: &str, stages: &[&str], clear: bool) -> serde_json::Value {
    json!({ "system": system, "kind": kind, "stages": stages, "owner": 19, "clear": clear })
}

#[test]
fn adding_a_ring_world_needs_game_data() {
    let w = webview();
    open(&w, SAMPLE_45);
    let stages = ["finished"; 4];
    let refused = invoke::<AddedRingWorld>(
        &w,
        "add_ring_world",
        ring(HABRAQ, "ring_world_2_intermediate", &stages, true),
    )
    .expect_err("refused");
    assert_eq!(refused.kind, ErrorKind::Op);
    assert!(refused.message.contains("game data"), "{}", refused.message);
}

/// The clearing names Vinh's colony without game data, for the confirmation to name it.
#[test]
fn the_clearing_lists_the_bodies_and_colonies_that_go() {
    let w = webview();
    open(&w, SAMPLE_45);
    let clearing: RingWorldClearing =
        invoke(&w, "get_ring_world_clearing", json!({ "system": VINH })).expect("the clearing");
    assert_eq!(clearing.colonies, [517]);
    assert_eq!(clearing.belts, 1);
}

/// Cleared first, Habraq takes the twelve segments of a finished ring as one edit, which one
/// undo takes back. Any stage of the chain names the ring: its site, or one of its ruins.
#[test]
fn a_ring_world_is_added_whole_and_undone() {
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let added: AddedRingWorld = invoke(
        &w,
        "add_ring_world",
        ring(HABRAQ, "ring_world_1", &["finished"; 4], true),
    )
    .expect("a finished ring, asked for by its site");
    assert_eq!(added.planets.len(), 12);
    assert!(added.megastructures.is_empty());
    assert_eq!(
        added.edit.entry.description,
        "Added a ring world round Habraq #159, removing 4 planets, 1 moon and 1 belt"
    );
    assert_eq!(added.edit.details_stale, [HABRAQ]);
    let undone: EditResult = invoke(&w, "undo", json!({})).expect("undo");
    assert!(undone.history.undo.is_empty());

    let mixed: AddedRingWorld = invoke(
        &w,
        "add_ring_world",
        ring(
            HABRAQ,
            "ring_world_ruined",
            &["finished", "frame", "ruined", "damaged"],
            false,
        ),
    )
    .expect("a mixed ring, asked for by a ruin");
    assert_eq!(mixed.planets.len(), 6);
    assert_eq!(mixed.megastructures.len(), 2);
}

#[test]
fn a_type_that_lays_out_no_ring_is_refused() {
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let refused = invoke::<AddedRingWorld>(
        &w,
        "add_ring_world",
        ring(HABRAQ, "habitat_central_complex", &["finished"; 4], false),
    )
    .expect_err("a habitat");
    assert!(
        refused
            .message
            .contains("no stage of its chain lays out a ring world of 4 quadrants"),
        "{}",
        refused.message
    );
}
