//! Deleting a save megastructure through its command on the 4.5 sample: what the install's
//! game data adds to the delete.
use serde_json::json;
use sgf_core::views::EditResult;

use crate::common::{SAMPLE_45, invoke, opened, with_game_data};

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
