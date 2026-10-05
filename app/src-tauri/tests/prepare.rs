//! Preparing a scenario for a new game end to end, through the mock runtime: the sample save
//! opened as a scenario, its systems sorted by the real install, a preset previewed and applied
//! as one undo step.
use serde_json::{Value, json};
use sgf_app_lib::views::{PreparePreview, PreparedEdit};
use sgf_core::export::ScenarioProfile;
use sgf_core::prepare::{PreparePreset, PrepareRow};
use sgf_core::views::{EditResult, ErrorKind, OpenResult};

use crate::common;
use common::{SAMPLE, game_data_webview, invoke, kind, open, webview};

fn choices(preset: PreparePreset) -> Value {
    json!(preset.choices())
}

fn preview(
    w: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    preset: PreparePreset,
) -> PreparePreview {
    invoke(w, "prepare_preview", json!({ "choices": choices(preset) })).expect("preview")
}

#[test]
fn prepare_needs_game_data_and_an_open_scenario() {
    let w = webview();
    let opened: OpenResult =
        invoke(&w, "open_as_scenario", json!({ "path": SAMPLE })).expect("open as scenario");
    assert!(opened.galaxy.systems.len() > 1);
    let refused = invoke::<PreparePreview>(
        &w,
        "prepare_preview",
        json!({ "choices": choices(PreparePreset::Faithful) }),
    )
    .expect_err("no game data to sort the systems by");
    assert_eq!(refused.kind, ErrorKind::Op);
    assert!(
        refused.message.contains("load game data"),
        "{}",
        refused.message
    );

    let Some(w) = game_data_webview() else {
        return;
    };
    let faithful = json!({ "choices": choices(PreparePreset::Faithful) });
    assert_eq!(
        kind(invoke::<PreparePreview>(
            &w,
            "prepare_preview",
            faithful.clone()
        )),
        ErrorKind::NoSession
    );
    open(&w, SAMPLE);
    assert_eq!(
        kind(invoke::<PreparePreview>(
            &w,
            "prepare_preview",
            faithful.clone()
        )),
        ErrorKind::Op,
        "a save is not prepared"
    );
    assert_eq!(
        kind(invoke::<Option<PreparedEdit>>(
            &w,
            "prepare_apply",
            faithful
        )),
        ErrorKind::Op
    );
    invoke::<OpenResult>(&w, "open_as_scenario", json!({ "path": SAMPLE })).expect("open");
    let unoffered = invoke::<PreparePreview>(
        &w,
        "prepare_preview",
        json!({ "choices": [{ "row": "empire_seats", "choice": "plain" }] }),
    )
    .expect_err("seats offer no plain system");
    assert_eq!(unoffered.kind, ErrorKind::Op);
}

#[test]
fn a_preset_previews_its_changes_and_applies_them_as_one_undo_step() {
    let Some(w) = game_data_webview() else {
        return;
    };
    let opened: OpenResult =
        invoke(&w, "open_as_scenario", json!({ "path": SAMPLE })).expect("open as scenario");

    let faithful = preview(&w, PreparePreset::Faithful);
    assert_eq!(faithful.profile, ScenarioProfile::Plain);
    assert_eq!(faithful.changes, 0);
    let rows: Vec<PrepareRow> = faithful.rows.iter().map(|r| r.row).collect();
    assert_eq!(rows, PrepareRow::ALL);
    let names = faithful
        .rows
        .iter()
        .find(|r| r.row == PrepareRow::SystemNames);
    assert_eq!(
        names.map(|r| r.systems.len()),
        Some(opened.galaxy.systems.len())
    );
    let nothing: Option<PreparedEdit> = invoke(
        &w,
        "prepare_apply",
        json!({ "choices": choices(PreparePreset::Faithful) }),
    )
    .expect("apply faithful");
    assert!(nothing.is_none(), "Faithful changes nothing");

    let fresh = preview(&w, PreparePreset::FreshStart);
    assert!(fresh.changes > 0, "{}", fresh.changes);
    assert_eq!(
        fresh.rows, faithful.rows,
        "the rows do not depend on the choices"
    );
    let prepared: PreparedEdit = invoke::<Option<PreparedEdit>>(
        &w,
        "prepare_apply",
        json!({ "choices": choices(PreparePreset::FreshStart) }),
    )
    .expect("apply fresh start")
    .expect("an edit");
    assert_eq!(prepared.changes, fresh.changes);
    let applied = prepared.edit;
    assert!(applied.dirty);
    assert_eq!(applied.history.undo.len(), 1, "one undo step");
    assert_eq!(
        applied.entry.description,
        format!("Prepared {} systems for a new game", fresh.changes)
    );
    assert_eq!(preview(&w, PreparePreset::FreshStart).changes, 0);

    let undone: EditResult = invoke::<Option<EditResult>>(&w, "undo", json!({}))
        .expect("undo")
        .expect("something to undo");
    assert!(undone.history.undo.is_empty());
    assert_eq!(
        preview(&w, PreparePreset::FreshStart).changes,
        fresh.changes
    );
}

#[test]
fn a_paint_a_galaxy_map_previews_under_its_own_profile() {
    let Some(w) = game_data_webview() else {
        return;
    };
    invoke::<OpenResult>(
        &w,
        "open_as_scenario",
        json!({ "path": SAMPLE, "profile": "paint_a_galaxy" }),
    )
    .expect("open as scenario");
    let shell = preview(&w, PreparePreset::BareShell);
    assert_eq!(shell.profile, ScenarioProfile::PaintAGalaxy);
    let applied: PreparedEdit = invoke::<Option<PreparedEdit>>(
        &w,
        "prepare_apply",
        json!({ "choices": choices(PreparePreset::BareShell), "seed": 7 }),
    )
    .expect("apply bare shell")
    .expect("an edit");
    assert_eq!(
        applied.edit.entry.description,
        format!("Prepared {} systems for a new game", shell.changes)
    );
}
