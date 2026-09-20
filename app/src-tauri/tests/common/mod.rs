//! Scaffolding shared by the IPC command test binaries, on the real sample save.
#![allow(dead_code)]

use serde::de::DeserializeOwned;
use serde_json::Value;
use sgf_core::views::{ErrorKind, SgfError};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const SAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/2206.11.16.sav");

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
    match get_ipc_response(webview, request) {
        Ok(body) => Ok(body.deserialize().expect("deserialise response")),
        Err(v) => Err(serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{e}: {v}"))),
    }
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
