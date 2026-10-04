//! Deleting a save planet and removing a colony, end to end on the 4.5 sample: the dry run
//! the menus ask for, and the op the app applies.
use serde_json::json;
use sgf_core::ops::Op;
use sgf_core::views::{EditResult, ErrorKind};

use crate::common::{SAMPLE_45, invoke, kind, opened};

/// Gas giant 99 of system 140 has two bare moons; 0 is a star; colony 18 on planet 517 is
/// a fallen empire's; 2445 is a ring world segment.
#[test]
fn deletes_are_checked_and_applied() {
    let w = opened(SAMPLE_45);
    let check = |op: Op| -> Option<String> {
        invoke(&w, "check_op", json!({ "op": op })).expect("dry run")
    };
    assert_eq!(check(Op::DeleteBody { body: 99 }), None);
    assert_eq!(
        check(Op::DeleteBody { body: 0 }).as_deref(),
        Some("planet 0 is a star: only a planet or moon can be deleted")
    );
    assert_eq!(
        check(Op::DeleteBody { body: 2445 }).as_deref(),
        Some(
            "planet 2445 cannot be deleted: it is a ring world segment, which has not been tried in game"
        )
    );
    assert_eq!(check(Op::RemoveColony { body: 517 }), None);

    let applied: EditResult =
        invoke(&w, "apply_op", json!({ "op": Op::DeleteBody { body: 99 } })).expect("apply");
    assert_eq!(
        applied.entry.description,
        "Deleted planet #99 and its 2 moons"
    );
    assert_eq!(applied.details_stale, [140]);
    assert_eq!(
        check(Op::DeleteBody { body: 99 }).as_deref(),
        Some("planet 99 does not exist")
    );
}

/// The inverse a delete records writes whole entities, so the app may not send it, and a
/// batch cannot be dry-run.
#[test]
fn a_restore_and_a_batch_are_refused() {
    let w = opened(SAMPLE_45);
    let restore = Op::RestoreEntities {
        description: "Restored planet #23".to_owned(),
        entities: Vec::new(),
    };
    let applied: Result<EditResult, _> = invoke(&w, "apply_op", json!({ "op": restore }));
    assert_eq!(kind(applied), ErrorKind::Op);
    let batch = Op::Batch {
        description: "Restored".to_owned(),
        ops: vec![restore.clone()],
    };
    let applied: Result<EditResult, _> = invoke(&w, "apply_op", json!({ "op": batch }));
    assert_eq!(kind(applied), ErrorKind::Op);
    let checked: Result<Option<String>, _> = invoke(&w, "check_op", json!({ "op": restore }));
    assert_eq!(kind(checked), ErrorKind::Op);

    let batch = Op::Batch {
        description: "Deleted two".to_owned(),
        ops: vec![Op::DeleteBody { body: 23 }, Op::DeleteBody { body: 99 }],
    };
    let checked: Option<String> = invoke(&w, "check_op", json!({ "op": batch })).expect("check");
    assert_eq!(
        checked.as_deref(),
        Some("a batch cannot be checked: check each of its ops")
    );
}
