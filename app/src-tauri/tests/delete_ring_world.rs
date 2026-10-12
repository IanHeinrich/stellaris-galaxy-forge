//! Deleting a save ring world through its command on the 4.5 sample, at the radius the app
//! passes.
use serde_json::json;
use sgf_core::views::EditResult;

use crate::common::{SAMPLE_45, invoke, opened};

/// Without a radius the command takes every ring of the system, as the app asks for when the
/// system holds one; Lachium, system 203, holds a mixed ring.
#[test]
fn the_command_takes_a_radius() {
    let every: EditResult = invoke(
        &opened(SAMPLE_45),
        "delete_ring_world",
        json!({ "system": 203, "radius": null }),
    )
    .expect("delete every ring");
    assert_eq!(every.details_stale, [203]);

    let w = opened(SAMPLE_45);
    let refused = invoke::<EditResult>(
        &w,
        "delete_ring_world",
        json!({ "system": 100, "radius": 45.0 }),
    );
    assert!(refused.is_err(), "Ter Meku's segments stand at orbit 100");
    let applied: EditResult = invoke(
        &w,
        "delete_ring_world",
        json!({ "system": 100, "radius": 100.0 }),
    )
    .expect("delete");
    assert_eq!(applied.details_stale, [100]);
}
