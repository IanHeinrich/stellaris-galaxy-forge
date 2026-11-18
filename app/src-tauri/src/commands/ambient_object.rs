//! Placing an ambient object in a system of the open scenario.

use sgf_core::ops::Op;
use sgf_core::views::SgfError;
use tauri::{AppHandle, Runtime};

use super::{require, with_session};
use crate::views::Added;

const NO_AMBIENT_OBJECTS: &str = "this document takes no added ambient object";

/// Add an ambient object of type `kind` to system `system` of the open document, at `x`, `y`
/// about the system's main star, as one [`Op::AddAmbientObject`], whose doc says what it
/// refuses. Answers the edit and the id of the object it created.
#[tauri::command]
pub async fn add_ambient_object<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
    kind: String,
    x: f64,
    y: f64,
) -> Result<Added, SgfError> {
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.ambient_objects, NO_AMBIENT_OBJECTS)?;
        let result = session.apply(Op::AddAmbientObject { system, kind, x, y })?;
        Ok(Added::of(session, result))
    })
    .await
}
