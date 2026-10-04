//! Where save planets may move, end to end on the 4.5 sample: the targets, a dry run, and
//! the op the app applies.
use serde_json::json;
use sgf_core::ops::Op;
use sgf_core::views::{EditResult, PlanetMoveCheck, PlanetMoveTargets};

use crate::common::{SAMPLE_45, invoke, opened};

/// Gas giant 99 of system 140 has moons 100 and 101 and no owner; 86 is a star. Colony 402
/// is country 16777226's, and goes to system 216, which nobody owns.
#[test]
fn planet_moves_are_queried_and_applied() {
    let w = opened(SAMPLE_45);
    let targets = |planets: &[u32]| -> PlanetMoveTargets {
        invoke(&w, "planet_move_targets", json!({ "planets": planets })).expect("targets")
    };

    let neutral = targets(&[99, 100]);
    assert_eq!(neutral.planets, [99]);
    assert!(neutral.refused.is_empty());
    let listed: Vec<u32> = neutral.systems.iter().map(|t| t.system).collect();
    assert!(listed.contains(&216) && !listed.contains(&140));

    let star = targets(&[86]);
    assert!(star.systems.is_empty());
    assert_eq!(
        star.refused[0].reason,
        "planet 86 is a star: only a planet can move to another system"
    );

    let dry_run = |planets: &[u32]| -> PlanetMoveCheck {
        invoke(
            &w,
            "planet_move_check",
            json!({ "planets": planets, "to": 216, "at": null }),
        )
        .expect("dry run")
    };
    assert_eq!(dry_run(&[402]), PlanetMoveCheck::default());
    assert_eq!(
        dry_run(&[86]).refusal.as_deref(),
        Some("planet 86 is a star: only a planet can move to another system")
    );
    let placed: PlanetMoveCheck = invoke(
        &w,
        "planet_move_check",
        json!({ "planets": [99], "to": 216, "at": { "radius": 120.0, "angle": 90.0 } }),
    )
    .expect("dry run");
    assert_eq!(placed.refusal, None);

    let op: Op = invoke(
        &w,
        "planet_move_op",
        json!({ "planets": [99, 100], "to": 216, "at": null }),
    )
    .expect("the op");
    assert_eq!(
        op,
        Op::MoveBodyToSystem {
            body: 99,
            to: 216,
            at: None
        }
    );
    let applied: EditResult = invoke(&w, "apply_op", json!({ "op": op })).expect("apply");
    assert!(
        applied
            .entry
            .description
            .starts_with("Moved planet #99 and its 2 moons from system #140 to system #216"),
        "{}",
        applied.entry.description
    );
    assert!(applied.dirty && applied.history.undo.len() == 1);
    let systems: Vec<u32> = applied.delta.systems.iter().map(|s| s.id).collect();
    assert!(
        systems.contains(&140) && systems.contains(&216),
        "{systems:?}"
    );
}
