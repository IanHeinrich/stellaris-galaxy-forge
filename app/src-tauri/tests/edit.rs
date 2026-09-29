//! Edit / undo / redo IPC commands end to end, through the mock runtime, on the real sample save.
use serde_json::json;
use sgf_core::format::save::details::SystemDetails;
use sgf_core::projections::galaxy::BypassLink;
use sgf_core::validate::Issue;
use sgf_core::views::{EditResult, ErrorKind, OpenResult, SystemDetail};

use crate::common;
use common::{SAMPLE, SAMPLE_45, invoke, kind, opened, webview, with_game_data};

#[test]
fn edit_undo_redo() {
    let w = webview();

    assert_eq!(
        kind(invoke::<EditResult>(
            &w,
            "apply_op",
            json!({ "op": { "type": "MoveSystem", "id": 0, "x": 1.0, "y": 1.0 } })
        )),
        ErrorKind::NoSession,
        "apply_op before any open"
    );
    assert_eq!(
        kind(invoke::<Option<EditResult>>(&w, "undo", json!({}))),
        ErrorKind::NoSession,
        "undo before any open"
    );

    let opened: OpenResult = invoke(&w, "open_save", json!({ "path": SAMPLE })).expect("open");
    let original = opened
        .galaxy
        .systems
        .iter()
        .find(|s| s.id == 0)
        .expect("system 0 in the opened galaxy")
        .clone();

    assert_eq!(
        invoke::<Option<EditResult>>(&w, "undo", json!({})).expect("undo with nothing applied"),
        None,
        "nothing to undo right after open"
    );
    assert_eq!(
        invoke::<Option<EditResult>>(&w, "redo", json!({})).expect("redo with nothing undone"),
        None,
        "nothing to redo right after open"
    );

    let moved: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "MoveSystem", "id": 0, "x": -150.0, "y": 60.0 } }),
    )
    .expect("move system 0");
    assert!(moved.dirty, "move dirties the session");
    assert_eq!(moved.history.undo.len(), 1, "one op on the undo stack");
    assert!(moved.history.redo.is_empty(), "nothing to redo yet");
    assert_eq!(moved.entry.seq, 1, "first applied op is seq 1");
    assert!(
        !moved.entry.description.is_empty(),
        "move has a description"
    );
    assert_eq!(
        moved.delta.systems.len(),
        6,
        "system 0 plus its 5 neighbours: {:?}",
        moved.delta.systems
    );
    let moved_system = moved
        .delta
        .systems
        .iter()
        .find(|s| s.id == 0)
        .expect("system 0 in the move delta");
    assert_eq!(moved_system.x, -150.0, "moved x");
    assert_eq!(moved_system.y, 60.0, "moved y");

    let detail: SystemDetail =
        invoke(&w, "get_system", json!({ "id": 0 })).expect("get_system after move");
    assert_eq!(detail.system.x, -150.0, "get_system reflects the move");
    assert_eq!(detail.system.y, 60.0, "get_system reflects the move");

    let linked: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "AddLane", "a": 789, "b": 790, "bridge": false } }),
    )
    .expect("add lane 789-790");
    let mut linked_ids: Vec<u32> = linked.delta.systems.iter().map(|s| s.id).collect();
    linked_ids.sort_unstable();
    assert_eq!(
        linked_ids,
        vec![789, 790],
        "add lane touches exactly its two endpoints"
    );
    for s in &linked.delta.systems {
        let other = if s.id == 789 { 790 } else { 789 };
        assert_eq!(
            s.lanes.len(),
            1,
            "system {} should have exactly one lane: {:?}",
            s.id,
            s.lanes
        );
        assert_eq!(s.lanes[0].to, other, "system {} lane target", s.id);
    }
    assert_eq!(linked.history.undo.len(), 2, "two ops on the undo stack");

    assert_eq!(
        kind(invoke::<EditResult>(
            &w,
            "apply_op",
            json!({ "op": { "type": "AddLane", "a": 789, "b": 790, "bridge": false } })
        )),
        ErrorKind::Op,
        "789 and 790 are already linked"
    );
    assert_eq!(
        kind(invoke::<EditResult>(
            &w,
            "apply_op",
            json!({ "op": { "type": "MoveSystem", "id": 999999, "x": 0.0, "y": 0.0 } })
        )),
        ErrorKind::NotFound,
        "system 999999 does not exist"
    );

    let undo_lane = invoke::<Option<EditResult>>(&w, "undo", json!({}))
        .expect("undo the add-lane")
        .expect("something to undo");
    assert_eq!(undo_lane.entry.seq, 2, "undo reports the op it undid");
    assert_eq!(undo_lane.history.undo.len(), 1, "one op remains applied");
    assert_eq!(
        undo_lane.history.redo.len(),
        1,
        "the undone op is now redoable"
    );
    let mut undo_lane_ids: Vec<u32> = undo_lane.delta.systems.iter().map(|s| s.id).collect();
    undo_lane_ids.sort_unstable();
    assert_eq!(
        undo_lane_ids,
        vec![789, 790],
        "undoing the lane touches its endpoints"
    );
    for s in &undo_lane.delta.systems {
        assert!(
            s.lanes.is_empty(),
            "system {} should be unlinked again: {:?}",
            s.id,
            s.lanes
        );
    }

    let undo_move = invoke::<Option<EditResult>>(&w, "undo", json!({}))
        .expect("undo the move")
        .expect("something to undo");
    assert_eq!(undo_move.entry.seq, 1, "undo reports the op it undid");
    assert!(!undo_move.dirty, "back at the state open produced");
    let restored = undo_move
        .delta
        .systems
        .iter()
        .find(|s| s.id == 0)
        .expect("system 0 in the undo delta");
    assert_eq!(restored.x, original.x, "system 0 x restored");
    assert_eq!(restored.y, original.y, "system 0 y restored");

    assert_eq!(
        invoke::<Option<EditResult>>(&w, "undo", json!({})).expect("undo with nothing left"),
        None,
        "no third op to undo"
    );

    let redone = invoke::<Option<EditResult>>(&w, "redo", json!({}))
        .expect("redo the move")
        .expect("something to redo");
    assert_eq!(redone.entry.seq, 1, "redo reports the op it redid");
    assert!(redone.dirty, "redoing the move dirties the session again");

    let isolated: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "IsolateSystem", "id": 0 } }),
    )
    .expect("isolate system 0");
    assert!(
        isolated.history.redo.is_empty(),
        "applying a fresh op drops the redo stack"
    );
    let isolated_system = isolated
        .delta
        .systems
        .iter()
        .find(|s| s.id == 0)
        .expect("system 0 in the isolate delta");
    assert!(
        isolated_system.lanes.is_empty(),
        "system 0 has no lanes left"
    );
    assert!(
        isolated.issues.iter().any(|i| i.systems.contains(&0)),
        "isolating system 0 should raise an issue naming it: {:?}",
        isolated.issues
    );
}

#[test]
fn a_body_moved_onto_another_raises_an_overlap_and_undo_names_the_move() {
    let w = common::opened(common::SAMPLE_45);
    let before: Vec<Issue> = invoke(&w, "warm_details", json!({})).expect("warm");
    assert!(
        before.iter().all(|i| i.code.as_str() != "bodies_overlap"),
        "the sample opens with no overlap"
    );

    let details: Vec<SystemDetails> =
        invoke(&w, "get_system_details", json!({ "ids": [1] })).expect("system 1");
    let details = &details[0];
    let spot = |id: u32| {
        let p = details.planets.iter().find(|p| p.id == id).expect("planet");
        let (x, y) = p.layout.as_ref().and_then(|l| l.at).expect("a point");
        (x.hypot(y), y.atan2(x).to_degrees())
    };
    let (radius, angle) = spot(587);
    let moved: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "MoveSaveBody", "system": 1, "body": 588, "radius": radius, "angle": angle } }),
    )
    .expect("move 588 onto 587");
    assert!(
        moved.entry.description.starts_with("Moved planet #588"),
        "{}",
        moved.entry.description
    );
    assert!(
        moved
            .issues
            .iter()
            .any(|i| i.code.as_str() == "bodies_overlap"),
        "the move reports the overlap"
    );

    let undone = invoke::<Option<EditResult>>(&w, "undo", json!({}))
        .expect("undo")
        .expect("something to undo");
    assert_eq!(undone.entry.description, moved.entry.description);
    assert!(
        undone
            .issues
            .iter()
            .all(|i| i.code.as_str() != "bodies_overlap")
    );
}

#[test]
fn a_wormhole_pair_added_and_undone_sends_the_bypass_links() {
    let w = opened(SAMPLE_45);
    let pair = BypassLink::Wormhole { a: 1, b: 140 };
    let added: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "AddSaveWormholePair", "a": 1, "b": 140 } }),
    )
    .expect("add the pair");
    let links = added.delta.bypasses.expect("the delta lists the links");
    assert!(links.contains(&pair), "{links:?}");

    let undone = invoke::<Option<EditResult>>(&w, "undo", json!({}))
        .expect("undo")
        .expect("something to undo");
    let links = undone.delta.bypasses.expect("the delta lists the links");
    assert!(!links.contains(&pair), "{links:?}");
}

fn class_op(from: &str, from_change: &str, to: &str, to_change: &str) -> serde_json::Value {
    json!({
        "type": "SetPlanetClass",
        "planet": 585,
        "from": { "class": from, "change": from_change, "models": 3 },
        "to": { "class": to, "change": to_change, "models": 3 },
    })
}

/// Planet 585 is barren and uncolonised. The rules a caller sends with a class change are
/// replaced by the install's, so a rule that lies changes nothing.
#[test]
fn a_class_change_takes_its_rules_from_the_install() {
    let w = opened(SAMPLE_45);
    let error = invoke::<EditResult>(
        &w,
        "apply_op",
        json!({ "op": class_op("pc_barren", "uncolonised", "pc_ocean", "any") }),
    )
    .expect_err("no game data");
    assert_eq!(error.kind, ErrorKind::Op);
    assert_eq!(error.message, "load game data to change a planet class");

    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let lie = class_op("pc_barren", "uncolonised", "pc_habitat", "any");
    let refused = invoke::<EditResult>(&w, "apply_op", json!({ "op": lie }));
    assert_eq!(
        refused.expect_err("a habitat").message,
        "pc_habitat is a class no planet is changed to or from"
    );
    let batch = json!({
        "type": "Batch",
        "description": "Change classes",
        "ops": [class_op("pc_barren", "uncolonised", "pc_ringworld_habitable", "any")],
    });
    let refused = invoke::<EditResult>(&w, "apply_op", json!({ "op": batch }));
    assert_eq!(
        refused.expect_err("a ring world in a batch").message,
        "pc_ringworld_habitable is a class no planet is changed to or from"
    );
    let unknown = class_op("pc_barren", "uncolonised", "pc_no_such_class", "any");
    let refused = invoke::<EditResult>(&w, "apply_op", json!({ "op": unknown }));
    assert_eq!(
        refused.expect_err("an unknown class").message,
        "the install has no planet class pc_no_such_class"
    );

    let honest = class_op("pc_barren", "never", "pc_ocean", "never");
    let changed: EditResult =
        invoke(&w, "apply_op", json!({ "op": honest })).expect("the install's rules allow it");
    assert_eq!(
        changed.entry.description,
        "Set the class of planet #585 from pc_barren to pc_ocean"
    );
}
