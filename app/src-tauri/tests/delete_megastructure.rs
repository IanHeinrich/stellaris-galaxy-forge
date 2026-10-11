//! Deleting a save megastructure end to end on the 4.5 sample: the dry run the menus ask
//! for, and the op the app applies.
use serde_json::json;
use sgf_core::ops::Op;
use sgf_core::views::EditResult;

use crate::common::{SAMPLE_45, invoke, opened, with_game_data};

/// Row 6 is the ruined gateway of system 116; row 0 is an L-Gate, whose bypass has not been
/// tried in game.
#[test]
fn a_delete_is_checked_and_applied() {
    let w = opened(SAMPLE_45);
    let check = |op: Op| -> Option<String> {
        invoke(&w, "check_op", json!({ "op": op })).expect("dry run")
    };
    let delete = |megastructure| Op::DeleteMegastructure {
        megastructure,
        dismantle: None,
    };
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

/// The Shroud Seal, row 2 of system 14, leaves its modifier on the system. With the install's
/// game data the command takes it back with the row; without, the row goes alone.
#[test]
fn the_command_takes_back_what_the_install_says() {
    let w = opened(SAMPLE_45);
    let alone: EditResult = invoke(&w, "delete_megastructure", json!({ "megastructure": 2 }))
        .expect("delete without game data");
    assert_eq!(
        alone.entry.description,
        "Deleted megastructure #2 (shroud_seal) in Mareenius #14"
    );

    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let taken: EditResult = invoke(&w, "delete_megastructure", json!({ "megastructure": 2 }))
        .expect("delete with game data");
    assert_eq!(
        taken.entry.description,
        "Deleted megastructure #2 (shroud_seal) in Mareenius #14, and took back 1 modifier"
    );
    assert_eq!(taken.details_stale, [14]);
}
