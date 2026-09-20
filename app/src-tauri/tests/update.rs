//! The updater IPC commands. `check_for_update` is never invoked from tests: it would
//! make a real request from CI.
use serde_json::json;
use sgf_core::views::ErrorKind;

mod common;
use common::{invoke, kind, webview};

#[test]
fn install_without_a_check_finds_nothing() {
    let w = webview();

    assert_eq!(
        kind(invoke::<()>(&w, "install_update", json!({}))),
        ErrorKind::NotFound
    );
    assert_eq!(
        kind(invoke::<()>(&w, "install_update", json!({}))),
        ErrorKind::NotFound
    );
}
