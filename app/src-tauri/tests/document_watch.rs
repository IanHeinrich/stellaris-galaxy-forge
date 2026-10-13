//! The open document's file watched on disk: what an outside write, the app's own save and a
//! move report, and reading the file again, on a copy of the sample scenario.
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::json;
use sgf_app_lib::commands::DOCUMENT_CHANGED_EVENT;
use sgf_app_lib::views::{DocumentChange, DocumentChanged};
use sgf_core::views::{ErrorKind, OpenResult, SaveResult};
use tauri::test::MockRuntime;
use tauri::{Listener, Manager, WebviewWindow};

use crate::common;
use common::{SCENARIO, invoke, kind, open, webview};

/// Longer than the watcher's debounce, so a change it would report has been reported.
const SETTLE: Duration = Duration::from_millis(1500);

fn copy_scenario(dir: &Path) -> PathBuf {
    let path = dir.join("scenario_grammar.txt");
    std::fs::copy(SCENARIO, &path).expect("copy the sample scenario");
    path
}

/// Every `sgf://document-changed` the app emits from now on.
fn heard(w: &WebviewWindow<MockRuntime>) -> Arc<Mutex<Vec<DocumentChanged>>> {
    let heard = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&heard);
    w.app_handle()
        .listen_any(DOCUMENT_CHANGED_EVENT, move |event| {
            let changed = serde_json::from_str(event.payload()).expect("a DocumentChanged payload");
            sink.lock().unwrap().push(changed);
        });
    heard
}

fn wait_for(heard: &Mutex<Vec<DocumentChanged>>) -> Vec<DocumentChanged> {
    let deadline = Instant::now() + Duration::from_secs(10);
    while heard.lock().unwrap().is_empty() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    heard.lock().unwrap().clone()
}

fn move_a_system(w: &WebviewWindow<MockRuntime>) {
    invoke::<serde_json::Value>(
        w,
        "apply_op",
        json!({ "op": { "type": "MoveSystem", "system": 2, "x": 12.5, "y": -60.25 } }),
    )
    .expect("move a system");
}

fn check(w: &WebviewWindow<MockRuntime>) -> Option<DocumentChanged> {
    invoke(w, "check_document_on_disk", json!({})).expect("check the file")
}

#[test]
fn the_apps_own_save_is_not_reported_and_an_outside_write_is() {
    let dir = tempfile::tempdir().unwrap();
    let path = copy_scenario(dir.path());
    let w = webview();
    open(&w, &path);
    let heard = heard(&w);

    move_a_system(&w);
    let saved: SaveResult = invoke(&w, "save", json!({})).expect("save in place");
    assert!(
        saved.backup_path.is_some(),
        "the save renamed the file aside"
    );
    std::thread::sleep(SETTLE);
    assert!(
        heard.lock().unwrap().is_empty(),
        "{:?}",
        heard.lock().unwrap()
    );
    assert_eq!(check(&w), None);

    let mut bytes = std::fs::read(&path).unwrap();
    bytes.extend_from_slice(b"\n# written by an editor\n");
    std::fs::write(&path, bytes).unwrap();

    let expected = DocumentChanged {
        path: path.to_string_lossy().into_owned(),
        change: DocumentChange::Changed,
        dirty: false,
    };
    assert_eq!(wait_for(&heard).first(), Some(&expected));
    assert_eq!(check(&w), Some(expected));
}

#[test]
fn a_file_moved_away_is_gone_and_nothing_is_checked_once_closed() {
    let dir = tempfile::tempdir().unwrap();
    let path = copy_scenario(dir.path());
    let w = webview();
    open(&w, &path);
    move_a_system(&w);

    std::fs::rename(&path, dir.path().join("aside.txt")).unwrap();
    let found = check(&w).expect("the file is gone");
    assert_eq!(found.change, DocumentChange::Gone);
    assert!(found.dirty);

    invoke::<()>(&w, "close_document", json!({})).expect("close");
    assert_eq!(check(&w), None);
}

#[test]
fn reading_the_file_again_keeps_unsaved_edits_unless_told_to_discard_them() {
    let dir = tempfile::tempdir().unwrap();
    let path = copy_scenario(dir.path());
    let w = webview();
    let before = open(&w, &path);
    move_a_system(&w);

    assert_eq!(
        kind(invoke::<OpenResult>(&w, "reload_document", json!({}))),
        ErrorKind::Op
    );
    let reread: OpenResult =
        invoke(&w, "reload_document", json!({ "discard": true })).expect("discard and reread");
    assert_eq!(reread.path, before.path);
    let moved = |r: &OpenResult| r.galaxy.systems.iter().find(|s| s.id == 2).map(|s| s.x);
    assert_eq!(moved(&reread), moved(&before), "the edit was dropped");

    let clean: OpenResult =
        invoke(&w, "reload_document", json!({})).expect("a clean document reads again");
    assert_eq!(clean.path, before.path);
}

#[test]
fn a_document_with_no_file_has_nothing_to_read_again() {
    let w = webview();
    assert_eq!(
        kind(invoke::<OpenResult>(&w, "reload_document", json!({}))),
        ErrorKind::NoSession
    );
    invoke::<OpenResult>(
        &w,
        "new_scenario",
        json!({ "name": "Blank", "radius": 300.0, "coreRadius": 0.0 }),
    )
    .expect("a new scenario");
    assert_eq!(
        kind(invoke::<OpenResult>(&w, "reload_document", json!({}))),
        ErrorKind::Op
    );
    assert_eq!(check(&w), None);
}
