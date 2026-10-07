//! Save planets copied and pasted as new bodies, end to end on the 4.5 sample: the copy the
//! app keeps, the op it applies, and the refusal for a star.
use serde_json::json;
use sgf_core::format::save::details::SystemDetails;
use sgf_core::ops::{NewBody, Op};
use sgf_core::validate::Issue;
use sgf_core::views::EditResult;

use crate::common::{SAMPLE_45, invoke, opened};

/// Gas giant 99 of system 140 has moons 100 and 101; 86 is a star. System 216 is Kazam.
#[test]
fn planets_are_copied_and_pasted() {
    let w = opened(SAMPLE_45);
    let copies: Vec<NewBody> =
        invoke(&w, "copy_bodies", json!({ "bodies": [99, 100] })).expect("a copy");
    assert_eq!(copies.len(), 1);
    assert_eq!(copies[0].moons.len(), 2);

    let refused = invoke::<Vec<NewBody>>(&w, "copy_bodies", json!({ "bodies": [86] }));
    assert!(refused.is_err());

    let op: Op = invoke(
        &w,
        "paste_bodies_op",
        json!({ "system": 216, "copies": copies, "at": null }),
    )
    .expect("the op");
    assert!(matches!(op, Op::AddBody { system: 216, .. }), "{op:?}");
    let applied: EditResult = invoke(&w, "apply_op", json!({ "op": op })).expect("apply");
    assert!(applied.dirty && applied.history.undo.len() == 1);
    let systems: Vec<u32> = applied.delta.systems.iter().map(|s| s.id).collect();
    assert!(systems.contains(&216), "{systems:?}");
}

/// Three planets pasted as one batch into Kazam, which has 14 bodies: the system details
/// the app reads next list all 20, the details having been built before the paste.
#[test]
fn a_pasted_group_shows_in_the_system_details() {
    let w = opened(SAMPLE_45);
    let _: Vec<Issue> = invoke(&w, "warm_details", json!({})).expect("warm");
    let copies: Vec<NewBody> =
        invoke(&w, "copy_bodies", json!({ "bodies": [10, 402, 1271] })).expect("a copy");
    let op: Op = invoke(
        &w,
        "paste_bodies_op",
        json!({ "system": 216, "copies": copies, "at": null }),
    )
    .expect("the op");
    let applied: EditResult = invoke(&w, "apply_op", json!({ "op": op })).expect("apply");
    assert!(
        applied.details_stale.contains(&216),
        "{:?}",
        applied.details_stale
    );
    let details: Vec<SystemDetails> =
        invoke(&w, "get_system_details", json!({ "ids": [216] })).expect("details");
    assert_eq!(details[0].planets.len(), 20);
}
