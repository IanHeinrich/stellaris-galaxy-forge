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

/// `preset`'s choices on a plain map, which the sample opens as unless told otherwise.
fn choices(preset: PreparePreset) -> Value {
    json!(preset.choices(ScenarioProfile::Plain))
}

/// The arguments both commands take for `preset`, the space around seats kept clear.
fn args(preset: PreparePreset) -> Value {
    json!({ "choices": choices(preset), "options": options(true, 0) })
}

fn options(clear_around_seats: bool, seed: u64) -> Value {
    json!({ "clear_around_seats": clear_around_seats, "seed": seed })
}

fn preview(
    w: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    preset: PreparePreset,
) -> PreparePreview {
    preview_with(w, choices(preset), true)
}

fn preview_with(
    w: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    choices: Value,
    clear_around_seats: bool,
) -> PreparePreview {
    invoke(
        w,
        "prepare_preview",
        json!({ "choices": choices, "options": options(clear_around_seats, 0) }),
    )
    .expect("preview")
}

#[test]
fn prepare_needs_game_data_and_an_open_scenario() {
    let w = webview();
    let opened: OpenResult =
        invoke(&w, "open_as_scenario", json!({ "path": SAMPLE })).expect("open as scenario");
    assert!(opened.galaxy.systems.len() > 1);
    let refused = invoke::<PreparePreview>(&w, "prepare_preview", args(PreparePreset::Faithful))
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
    let faithful = args(PreparePreset::Faithful);
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
        json!({
            "choices": [{ "row": "empire_seats", "choice": "plain" }],
            "options": options(true, 0),
        }),
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
    let nothing: Option<PreparedEdit> =
        invoke(&w, "prepare_apply", args(PreparePreset::Faithful)).expect("apply faithful");
    assert!(nothing.is_none(), "Faithful changes nothing");

    let fresh = preview(&w, PreparePreset::FreshStart);
    assert!(fresh.changes > 0, "{}", fresh.changes);
    assert_eq!(
        fresh.rows, faithful.rows,
        "the rows do not depend on the choices"
    );
    let prepared: PreparedEdit =
        invoke::<Option<PreparedEdit>>(&w, "prepare_apply", args(PreparePreset::FreshStart))
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
fn keeping_the_space_around_seats_clear_is_previewed_and_applied_as_chosen() {
    let Some(w) = game_data_webview() else {
        return;
    };
    invoke::<OpenResult>(&w, "open_as_scenario", json!({ "path": SAMPLE }))
        .expect("open as scenario");

    let faithful = preview(&w, PreparePreset::Faithful);
    assert!(faithful.kept_clear.is_empty(), "no row is left to the game");
    assert!(faithful.cut_off.is_empty());

    let shell = preview(&w, PreparePreset::BareShell);
    assert!(!shell.kept_clear.is_empty());
    let unguarded = preview_with(&w, choices(PreparePreset::BareShell), false);
    assert!(unguarded.kept_clear.is_empty(), "the option is off");
    assert_eq!(unguarded.rows, shell.rows);

    let applied: PreparedEdit = invoke::<Option<PreparedEdit>>(
        &w,
        "prepare_apply",
        json!({
            "choices": choices(PreparePreset::BareShell),
            "options": options(false, 0),
        }),
    )
    .expect("apply bare shell")
    .expect("an edit");
    assert_eq!(applied.changes, unguarded.changes);
}

#[test]
fn a_une_seat_is_refused_on_a_plain_map() {
    let Some(w) = game_data_webview() else {
        return;
    };
    invoke::<OpenResult>(&w, "open_as_scenario", json!({ "path": SAMPLE }))
        .expect("open as scenario");
    let refused = invoke::<PreparePreview>(
        &w,
        "prepare_preview",
        json!({
            "choices": [{ "row": "sol", "choice": "une_seat" }],
            "options": options(true, 0),
        }),
    )
    .expect_err("a plain map has no UNE seat");
    assert_eq!(refused.kind, ErrorKind::Op);
    assert_eq!(refused.message, "Only a Paint a Galaxy map has a UNE seat.");
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
    let bare_shell = json!(PreparePreset::BareShell.choices(ScenarioProfile::PaintAGalaxy));
    let shell = preview_with(&w, bare_shell.clone(), true);
    assert_eq!(shell.profile, ScenarioProfile::PaintAGalaxy);
    assert!(
        !shell.cut_off.is_empty(),
        "taking the pairs out cuts a system off"
    );
    let applied: PreparedEdit = invoke::<Option<PreparedEdit>>(
        &w,
        "prepare_apply",
        json!({ "choices": bare_shell, "options": options(true, 7) }),
    )
    .expect("apply bare shell")
    .expect("an edit");
    assert_eq!(
        applied.edit.entry.description,
        format!("Prepared {} systems for a new game", shell.changes)
    );
}
