//! Moving a save megastructure end to end on the 4.5 sample: the dry run the drag asks for,
//! the op the app applies, and undo.
use serde_json::json;
use sgf_core::ops::{MegastructurePlace, Op};
use sgf_core::views::EditResult;

use crate::common::{SAMPLE_45, invoke, opened};

fn moved(megastructure: u32, at: MegastructurePlace) -> Op {
    Op::MoveMegastructure { megastructure, at }
}

/// Row 6 is the ruined gateway of system 116, at a point of its own; row 4 the ruined orbital
/// ring of system 38, around planet 936; row 0 an L-Gate, whose bypass has not been tried in
/// game.
#[test]
fn a_move_is_checked_applied_and_undone() {
    let w = opened(SAMPLE_45);
    let check = |op: Op| -> Option<String> {
        invoke(&w, "check_op", json!({ "op": op })).expect("dry run")
    };
    let point = MegastructurePlace::Free {
        x: 250.0,
        y: -100.0,
    };
    assert_eq!(check(moved(6, point)), None);
    assert_eq!(
        check(moved(4, MegastructurePlace::Body { body: 933 })),
        None
    );
    assert!(
        check(moved(0, point)).is_some_and(|r| !r.is_empty()),
        "the L-Gate is refused with a reason"
    );
    assert!(
        check(moved(4, point)).is_some_and(|r| !r.is_empty()),
        "a row on a body is not sent to a point"
    );

    let applied: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": moved(4, MegastructurePlace::Body { body: 933 }) }),
    )
    .expect("apply");
    assert!(applied.dirty);
    assert_eq!(applied.history.undo.len(), 1);
    assert_eq!(applied.details_stale, [38]);
    assert!(
        check(moved(4, MegastructurePlace::Body { body: 933 })).is_some(),
        "it stands there now"
    );

    let undone: EditResult = invoke(&w, "undo", json!({})).expect("undo");
    assert!(!undone.dirty);
    assert_eq!(
        check(moved(4, MegastructurePlace::Body { body: 933 })),
        None
    );
}
