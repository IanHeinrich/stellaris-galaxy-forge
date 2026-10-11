//! Deleting a save ring world end to end on the 4.5 sample: the dry run the menus ask for,
//! and the command the app applies.
use serde_json::json;
use sgf_core::ops::Op;
use sgf_core::views::EditResult;

use crate::common::{SAMPLE_45, invoke, opened};

/// Lachium, system 203, holds a mixed ring with a colony; Sargas, system 38, holds none.
#[test]
fn a_ring_world_delete_is_checked_and_applied() {
    let w = opened(SAMPLE_45);
    let check = |op: Op| -> Option<String> {
        invoke(&w, "check_op", json!({ "op": op })).expect("dry run")
    };
    let delete = |system| Op::DeleteRingWorld {
        system,
        radius: None,
    };
    assert_eq!(check(delete(203)), None);
    assert_eq!(
        check(delete(38)).as_deref(),
        Some("system 38 has no ring world")
    );

    let applied: EditResult =
        invoke(&w, "delete_ring_world", json!({ "system": 203 })).expect("delete");
    assert!(applied.dirty);
    assert_eq!(applied.history.undo.len(), 1);
    assert_eq!(applied.details_stale, [203]);
    assert_eq!(
        applied.entry.description,
        "Deleted the ring world in Lachium #203, its 6 planets and 2 sections, with the colony on Lachium I #2447"
    );
    assert_eq!(
        check(delete(203)).as_deref(),
        Some("system 203 has no ring world"),
        "the ring is gone, so a second delete is refused"
    );
}

#[test]
fn the_command_takes_a_radius() {
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
