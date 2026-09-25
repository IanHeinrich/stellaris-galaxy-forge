//! Scaffolding shared by the IPC command test binaries, on the real sample save.
#![allow(dead_code)]

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use sgf_core::views::{ErrorKind, OpenResult, SgfError};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const SAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/4.4-early.sav");
/// The Stellaris 4.5 sample, whose galaxy was set up at 2x resource abundance and whose
/// pool holds 46 unused nebula names.
pub const SAMPLE_45: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/4.5-day-one.sav");
pub const SCENARIO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/scenario_grammar.txt"
);
pub const PAINTED: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/paint_a_galaxy.txt"
);

pub fn webview() -> WebviewWindow<MockRuntime> {
    let app = sgf_app_lib::configure(mock_builder())
        .build(tauri::generate_context!())
        .expect("build app");
    WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
        .build()
        .expect("build webview")
}

pub fn invoke<T: DeserializeOwned>(
    webview: &WebviewWindow<MockRuntime>,
    cmd: &str,
    args: Value,
) -> Result<T, SgfError> {
    match invoke_raw(webview, cmd, args) {
        Ok(body) => Ok(body.deserialize().expect("deserialise response")),
        Err(v) => Err(serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{e}: {v}"))),
    }
}

/// Open the document at `path` as the session; the test fails if it does not open.
pub fn open(webview: &WebviewWindow<MockRuntime>, path: impl Serialize) -> OpenResult {
    let path = json!(path);
    invoke(webview, "open_save", json!({ "path": path }))
        .unwrap_or_else(|e| panic!("open {path}: {}", e.message))
}

/// A fresh app with the document at `path` open.
pub fn opened(path: impl Serialize) -> WebviewWindow<MockRuntime> {
    let webview = webview();
    open(&webview, path);
    webview
}

/// A fresh app with the document at `path` open and the install's game data loaded without
/// mods, which may shadow what a test reads; `None` without an install.
pub fn with_game_data(path: impl Serialize) -> Option<(WebviewWindow<MockRuntime>, OpenResult)> {
    if !have_install() {
        return None;
    }
    let webview = webview();
    let opened = open(&webview, path);
    invoke::<Value>(&webview, "load_game_data", json!({ "mods": false }))
        .unwrap_or_else(|e| panic!("load game data: {}", e.message));
    Some((webview, opened))
}

/// The command's response as the IPC layer hands it back, from the webview's own
/// origin on this platform; an error is whatever the layer or the command rejected
/// with, which for a refused argument is a plain string rather than an `SgfError`.
pub fn invoke_raw(
    webview: &WebviewWindow<MockRuntime>,
    cmd: &str,
    args: Value,
) -> Result<InvokeResponseBody, Value> {
    let url = if cfg!(any(windows, target_os = "android")) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    let request = InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: url.parse().unwrap(),
        body: InvokeBody::Json(args),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    };
    get_ipc_response(webview, request)
}

/// The `rawVersion` of the install the tests read, so an assertion on the version
/// survives a game update.
pub fn install_version() -> Option<String> {
    let install = sgf_gamedata::install::discovery::find_install(None).ok()?;
    sgf_gamedata::install::discovery::install_version(&install)
}

/// Whether this machine has a Stellaris install. Without one the tests that
/// need it return green, which is what happens on CI; `SGF_REQUIRE_INSTALL`
/// turns that skip into a failure.
pub fn have_install() -> bool {
    if sgf_gamedata::install::discovery::find_install(None).is_ok() {
        return true;
    }
    let required = std::env::var_os("SGF_REQUIRE_INSTALL").is_some_and(|v| !v.is_empty());
    assert!(
        !required,
        "SGF_REQUIRE_INSTALL is set and no Stellaris install was found: \
         the tests that read one would have asserted nothing",
    );
    eprintln!("skipped: no Stellaris install");
    false
}

pub fn kind<T: std::fmt::Debug>(r: Result<T, SgfError>) -> ErrorKind {
    r.expect_err("expected an error").kind
}
