//! Adding the habitat a megastructure type's finished stage is to a body of the open save,
//! as a planet in place of the type's row.

use sgf_core::views::SgfError;
use sgf_gamedata::generate;
use tauri::{AppHandle, Runtime};

use super::{game_data, with_session};
use crate::views::Added;

/// Add the habitat finishing a megastructure of type `kind` at body `body` of system `system`
/// leaves, as `sgf_gamedata::generate::habitat_op` builds it, and answer what it created.
#[tauri::command]
pub async fn add_habitat<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
    body: u32,
    kind: String,
) -> Result<Added, SgfError> {
    let gd = game_data(&app, "add a habitat")?;
    with_session(app, move |mut guard| {
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        let planned = generate::habitat_op(&gd, session, system, body, &kind)?;
        let result = session.apply(planned.op)?;
        Ok(Added::of(session, result))
    })
    .await
}
