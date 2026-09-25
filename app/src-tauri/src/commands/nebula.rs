//! Placing a nebula in the open document, named as the game names a galaxy's own.

use sgf_core::ops::Op;
use sgf_core::views::{EditResult, SgfError};
use sgf_gamedata::naming;
use tauri::{AppHandle, Manager, Runtime};

use super::with_session;
use crate::state::GameDataState;

/// Add a nebula at (`x`, `y`) with `radius` as one `AddNebula`, named from `seed` as
/// [`naming::nebula_name`] names it.
#[tauri::command]
pub async fn add_nebula<R: Runtime>(
    app: AppHandle<R>,
    seed: u64,
    x: f64,
    y: f64,
    radius: f64,
) -> Result<EditResult, SgfError> {
    let gd = app.state::<GameDataState>().loaded();
    with_session(app, move |mut guard| {
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        let name = naming::nebula_name(session, gd.as_deref(), seed);
        let result = session.apply(Op::AddNebula {
            x,
            y,
            radius,
            name: Some(name),
        })?;
        Ok(session.edit_result(result))
    })
    .await
}
