//! Rolling a system into a save, rolling it again, renaming and deleting it, end to end on the
//! real sample save.
use serde_json::json;
use sgf_core::format::save::details::SystemDetails;
use sgf_core::projections::galaxy::SystemNode;
use sgf_core::views::{EditResult, ErrorKind, GalaxyView, OpenResult};

/// The Stellaris 4.5 sample, whose galaxy was set up at 2x resource abundance.
const SAMPLE_45: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/2201.03.25.sav");

use crate::common;
use common::{SAMPLE, SCENARIO, have_install, invoke, kind, open, webview};

/// A point inside the galaxy at least `clear` from every system.
fn free_spot(galaxy: &GalaxyView, clear: f64) -> (f64, f64) {
    free_spot_beside(galaxy, clear, &[])
}

/// As [`free_spot`], clear of the points `taken` too.
fn free_spot_beside(galaxy: &GalaxyView, clear: f64, taken: &[(f64, f64)]) -> (f64, f64) {
    let radius = galaxy.galaxy_radius;
    let step = clear / 2.0;
    let mut y = -radius;
    while y <= radius {
        let mut x = -radius;
        while x <= radius {
            let inside = x.hypot(y) < radius - clear;
            let spaced = galaxy
                .systems
                .iter()
                .map(|s| (s.x, s.y))
                .chain(taken.iter().copied())
                .all(|(sx, sy)| (sx - x).hypot(sy - y) >= clear);
            if inside && spaced {
                return (x, y);
            }
            x += step;
        }
        y += step;
    }
    panic!("no free spot in the sample galaxy");
}

fn added(result: &EditResult) -> &SystemNode {
    result
        .delta
        .systems
        .iter()
        .find(|s| s.added)
        .expect("the delta carries the added system")
}

#[test]
fn adding_a_system_needs_game_data_and_a_save() {
    let w = webview();
    let args = json!({ "seed": 7, "x": 0.0, "y": 0.0, "starClass": null });
    let classes: Vec<(String, String)> =
        invoke(&w, "get_generator_star_classes", json!({})).expect("star classes");
    assert!(classes.is_empty(), "no game data, no classes: {classes:?}");
    assert_eq!(
        kind(invoke::<EditResult>(&w, "add_random_system", args.clone())),
        ErrorKind::Op,
        "no game data"
    );
    open(&w, SAMPLE);
    let refused = invoke::<EditResult>(&w, "add_random_system", args).expect_err("no game data");
    assert!(refused.message.contains("game data"), "{}", refused.message);
}

#[test]
fn add_reroll_rename_delete_and_undo() {
    if !have_install() {
        return;
    }
    let w = webview();
    let opened: OpenResult = invoke(&w, "open_save", json!({ "path": SAMPLE })).expect("open");
    invoke::<serde_json::Value>(&w, "load_game_data", json!({ "mods": false })).expect("load");

    let classes: Vec<(String, String)> =
        invoke(&w, "get_generator_star_classes", json!({})).expect("star classes");
    let (key, label) = classes
        .iter()
        .find(|(key, _)| key == "sc_m")
        .expect("a red star is among the classes the layouts roll");
    assert_ne!(label, key, "the class is named from the localisation");

    let (x, y) = free_spot(&opened.galaxy, 12.0);
    let (near, _) = opened
        .galaxy
        .systems
        .iter()
        .map(|s| (s.id, (s.x - x).hypot(s.y - y)))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .expect("a nearest system");
    let result: EditResult = invoke(
        &w,
        "add_random_system",
        json!({ "seed": 42, "x": x, "y": y, "starClass": "sc_g" }),
    )
    .expect("add a system");
    let system = added(&result).clone();
    assert_eq!(system.star_class, "sc_g");
    assert!(
        (system.x - x).abs() < 1e-4 && (system.y - y).abs() < 1e-4,
        "at the point asked for"
    );
    assert!(system.lanes.is_empty(), "a new system has no lanes");
    assert!(
        result.entry.description.starts_with("Added "),
        "{}",
        result.entry.description
    );
    assert_eq!(result.history.undo.len(), 1, "one step");
    invoke::<EditResult>(
        &w,
        "apply_op",
        json!({ "op": { "type": "AddLane", "a": system.id, "b": near, "bridge": false } }),
    )
    .expect("lane it to the nearest system");

    let rolled: EditResult = invoke(
        &w,
        "reroll_system",
        json!({ "system": system.id, "seed": 43, "starClass": "sc_m" }),
    )
    .expect("roll it again as a red star");
    let again = added(&rolled);
    assert_eq!(again.id, system.id, "the id stays");
    assert_eq!(again.star_class, "sc_m");
    assert_eq!(again.name, system.name, "the name stays");
    assert_eq!(
        again.lanes.iter().map(|l| l.to).collect::<Vec<_>>(),
        [near],
        "the lane stays"
    );
    assert_eq!(rolled.history.undo.len(), 3, "one more step");

    let renamed: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "RenameSaveSystem", "system": system.id, "name": "Dorellion" } }),
    )
    .expect("rename it");
    assert_eq!(added(&renamed).name.key, "Dorellion");

    let deleted: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "RemoveSystem", "id": system.id } }),
    )
    .expect("delete it");
    assert_eq!(deleted.delta.removed, [system.id]);

    let undone: Option<EditResult> = invoke(&w, "undo", json!({})).expect("undo the delete");
    assert!(undone.is_some());
    let refused = invoke::<EditResult>(
        &w,
        "reroll_system",
        json!({ "system": 0, "seed": 1, "starClass": null }),
    )
    .expect_err("a system the file already held is refused");
    assert_eq!(refused.kind, ErrorKind::Op, "{}", refused.message);
}

/// The sample save open with game data loaded, or `None` without an install.
fn loaded() -> Option<(tauri::WebviewWindow<tauri::test::MockRuntime>, OpenResult)> {
    if !have_install() {
        return None;
    }
    let w = webview();
    let opened: OpenResult = invoke(&w, "open_save", json!({ "path": SAMPLE })).expect("open");
    invoke::<serde_json::Value>(&w, "load_game_data", json!({ "mods": false })).expect("load");
    Some((w, opened))
}

fn name_of(result: &EditResult, id: u32) -> String {
    result
        .delta
        .systems
        .iter()
        .find(|s| s.id == id)
        .unwrap_or_else(|| panic!("system {id} in the delta"))
        .name
        .key
        .clone()
}

#[test]
fn deleting_the_middle_of_three_added_systems_renumbers_and_undo_and_redo_follow() {
    let Some((w, opened)) = loaded() else {
        return;
    };
    let mut taken = Vec::new();
    let mut added_ids = Vec::new();
    let mut names = Vec::new();
    for seed in [1, 2, 3] {
        let (x, y) = free_spot_beside(&opened.galaxy, 12.0, &taken);
        taken.push((x, y));
        let result: EditResult = invoke(
            &w,
            "add_random_system",
            json!({ "seed": seed, "x": x, "y": y, "starClass": null }),
        )
        .expect("add a system");
        let system = added(&result);
        added_ids.push(system.id);
        names.push(system.name.key.clone());
    }
    let [a, b, c] = added_ids[..] else {
        panic!("three systems added");
    };
    assert_eq!([b, c], [a + 1, a + 2], "added systems take the next ids");

    let deleted: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "RemoveSystem", "id": b } }),
    )
    .expect("delete the middle one");
    assert_eq!(deleted.delta.renumbered, [(b, None), (c, Some(b))]);
    assert_eq!(deleted.delta.removed, [c], "the last id is gone");
    assert_eq!(
        name_of(&deleted, b),
        names[2],
        "the third system now has the second's id"
    );

    let undone: EditResult = invoke::<Option<EditResult>>(&w, "undo", json!({}))
        .expect("undo")
        .expect("a step to undo");
    assert_eq!(
        undone.delta.renumbered,
        [(b, Some(c))],
        "the third moves back up"
    );
    assert_eq!(
        name_of(&undone, b),
        names[1],
        "the second is back at its id"
    );
    assert_eq!(name_of(&undone, c), names[2]);

    let redone: EditResult = invoke::<Option<EditResult>>(&w, "redo", json!({}))
        .expect("redo")
        .expect("a step to redo");
    assert_eq!(redone.delta.renumbered, deleted.delta.renumbered);
    assert_eq!(redone.delta.removed, [c]);
    assert_eq!(name_of(&redone, b), names[2]);
}

#[test]
fn a_scenario_takes_no_rolled_system() {
    let Some((w, _)) = loaded() else {
        return;
    };
    open(&w, SCENARIO);
    let added = invoke::<EditResult>(
        &w,
        "add_random_system",
        json!({ "seed": 1, "x": 0.0, "y": 0.0, "starClass": null }),
    )
    .expect_err("a scenario is refused");
    let rolled = invoke::<EditResult>(
        &w,
        "reroll_system",
        json!({ "system": 0, "seed": 1, "starClass": null }),
    )
    .expect_err("a scenario is refused");
    for refused in [added, rolled] {
        assert_eq!(refused.kind, ErrorKind::Op, "{}", refused.message);
        assert!(
            refused.message.contains("only a save"),
            "{}",
            refused.message
        );
    }
}

#[test]
fn added_systems_roll_deposits_at_the_saves_abundance() {
    if !have_install() {
        return;
    }
    let w = webview();
    let opened: OpenResult = invoke(&w, "open_save", json!({ "path": SAMPLE_45 })).expect("open");
    invoke::<serde_json::Value>(&w, "load_game_data", json!({ "mods": false })).expect("load");
    let mut taken = Vec::new();
    let mut ids = Vec::new();
    for seed in [11, 12, 13] {
        let (x, y) = free_spot_beside(&opened.galaxy, 12.0, &taken);
        taken.push((x, y));
        let result: EditResult = invoke(
            &w,
            "add_random_system",
            json!({ "seed": seed, "x": x, "y": y, "starClass": null }),
        )
        .expect("add a system");
        ids.push(added(&result).id);
    }
    let rolled: EditResult = invoke(
        &w,
        "reroll_system",
        json!({ "system": ids[0], "seed": 14, "starClass": null }),
    )
    .expect("roll the first again");
    assert_eq!(added(&rolled).id, ids[0]);

    let details: Vec<SystemDetails> =
        invoke(&w, "get_system_details", json!({ "ids": ids })).expect("details");
    let deposits: u32 = details
        .iter()
        .flat_map(|d| &d.planets)
        .flat_map(|p| &p.deposit_keys)
        .map(|d| d.count)
        .sum();
    assert!(deposits > 0, "the rolled bodies carry deposits at 2x");
}
