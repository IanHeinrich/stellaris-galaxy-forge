//! Placing a nebula, end to end: named from a save's pool of unused nebula names with game
//! data or without, and "New Nebula", numbered, where no name is left to draw. Undo takes it
//! away in one step.
use serde_json::json;
use sgf_core::ops::free_nebula_names;
use sgf_core::session::Session;
use sgf_core::views::{EditResult, ErrorKind};

/// The Stellaris 4.5 sample, whose pool holds 46 unused nebula names.
const SAMPLE_45: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/2201.03.25.sav");

mod common;
use common::{SAMPLE, SCENARIO, have_install, invoke, kind, open, webview};

fn place(w: &tauri::WebviewWindow<tauri::test::MockRuntime>, seed: u64) -> EditResult {
    invoke(
        w,
        "add_nebula",
        json!({ "seed": seed, "x": -57.5, "y": -305.0, "radius": 40.0 }),
    )
    .expect("place a nebula")
}

/// The name of the nebula the edit appended.
fn placed(result: &EditResult) -> String {
    let nebulae = result
        .delta
        .nebulae
        .as_ref()
        .expect("the delta lists nebulae");
    nebulae.last().expect("the new nebula").name.key.clone()
}

#[test]
fn without_game_data_a_save_still_names_the_nebula_from_its_pool() {
    let w = webview();
    assert_eq!(
        kind(invoke::<EditResult>(
            &w,
            "add_nebula",
            json!({ "seed": 1, "x": 0.0, "y": 0.0, "radius": 30.0 })
        )),
        ErrorKind::NoSession
    );
    let pool = free_nebula_names(&Session::open(SAMPLE).expect("open").doc);
    let opened = open(&w, SAMPLE);
    let first = place(&w, 1);
    let name = placed(&first);
    assert!(pool.contains(&name), "{name} is not in the pool");
    assert_eq!(first.history.undo.len(), 1, "one step");
    let undone: EditResult = invoke::<Option<EditResult>>(&w, "undo", json!({}))
        .expect("undo")
        .expect("a step to undo");
    assert_eq!(
        undone.delta.nebulae.map(|n| n.len()),
        Some(opened.galaxy.nebulae.len()),
        "undo takes the nebula away"
    );
}

#[test]
fn a_scenario_without_game_data_gets_new_nebula_then_numbered() {
    let w = webview();
    open(&w, SCENARIO);
    assert_eq!(placed(&place(&w, 1)), "New Nebula");
    assert_eq!(placed(&place(&w, 2)), "New Nebula 2");
}

#[test]
fn with_game_data_a_save_names_the_nebula_from_its_pool() {
    if !have_install() {
        return;
    }
    let pool = free_nebula_names(&Session::open(SAMPLE_45).expect("open").doc);
    let w = webview();
    let opened = open(&w, SAMPLE_45);
    invoke::<serde_json::Value>(&w, "load_game_data", json!({ "mods": false })).expect("load");

    let result = place(&w, 42);
    let name = placed(&result);
    assert!(pool.contains(&name), "{name} is not in the pool");
    assert!(
        result.entry.description.contains(&name),
        "{}",
        result.entry.description
    );
    let again = place(&w, 42);
    assert_ne!(placed(&again), name, "a name taken is not drawn twice");

    for _ in 0..2 {
        invoke::<Option<EditResult>>(&w, "undo", json!({})).expect("undo");
    }
    let redone: EditResult = invoke::<Option<EditResult>>(&w, "redo", json!({}))
        .expect("redo")
        .expect("a step to redo");
    assert_eq!(placed(&redone), name);
    assert_eq!(
        redone.delta.nebulae.map(|n| n.len()),
        Some(opened.galaxy.nebulae.len() + 1)
    );
}
