//! Deleting a save planet and removing a colony, end to end on the 4.5 sample: the dry run
//! the menus ask for, and the op the app applies.
use serde_json::json;
use sgf_core::ops::Op;
use sgf_core::views::EditResult;

use crate::common::{SAMPLE_45, invoke, opened};

/// Gas giant 99 of system 140 has two bare moons; 0 is a star; colony 18 on planet 517 is
/// a fallen empire's; colony 0 on planet 2 is the player's capital.
#[test]
fn deletes_are_checked_and_applied() {
    let w = opened(SAMPLE_45);
    let check = |op: Op| -> Option<String> {
        invoke(&w, "check_op", json!({ "op": op })).expect("dry run")
    };
    assert_eq!(check(Op::DeleteSavePlanet { planet: 99 }), None);
    assert_eq!(
        check(Op::DeleteSavePlanet { planet: 0 }).as_deref(),
        Some("planet 0 is a star: only a planet or moon can be deleted")
    );
    assert_eq!(
        check(Op::RemoveColony { planet: 2 }).as_deref(),
        Some("the colony on planet 2 cannot be removed: it is the capital of country 0")
    );
    assert_eq!(check(Op::RemoveColony { planet: 517 }), None);

    let applied: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": Op::DeleteSavePlanet { planet: 99 } }),
    )
    .expect("apply");
    assert_eq!(
        applied.entry.description,
        "Deleted planet #99 and its 2 moons"
    );
    assert_eq!(applied.details_stale, [140]);
    assert_eq!(
        check(Op::DeleteSavePlanet { planet: 99 }).as_deref(),
        Some("planet 99 does not exist")
    );
}
