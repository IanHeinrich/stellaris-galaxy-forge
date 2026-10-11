//! Deleting a save megastructure end to end on the 4.5 sample: the dry run the menus ask
//! for, and the op the app applies.
use serde_json::json;
use sgf_core::ops::Op;
use sgf_core::views::EditResult;

use crate::common::{SAMPLE_45, invoke, opened};

/// Row 6 is the ruined gateway of system 116; row 0 is an L-Gate, whose bypass has not been
/// tried in game.
#[test]
fn a_delete_is_checked_and_applied() {
    let w = opened(SAMPLE_45);
    let check = |op: Op| -> Option<String> {
        invoke(&w, "check_op", json!({ "op": op })).expect("dry run")
    };
    let delete = |megastructure| Op::DeleteMegastructure { megastructure };
    assert_eq!(check(delete(6)), None);
    assert!(
        check(delete(0)).is_some_and(|r| !r.is_empty()),
        "the L-Gate is refused with a reason"
    );

    let applied: EditResult = invoke(&w, "apply_op", json!({ "op": delete(6) })).expect("apply");
    assert!(applied.dirty);
    assert_eq!(applied.history.undo.len(), 1);
    assert_eq!(applied.details_stale, [116]);
    assert!(
        check(delete(6)).is_some(),
        "the row is gone, so a second delete is refused"
    );
}
