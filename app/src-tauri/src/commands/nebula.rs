//! Placing a nebula in the open document, named as the game names a galaxy's own.

use sgf_core::ops::Op;
use sgf_core::session::Session;
use sgf_core::views::{EditResult, SgfError};
use sgf_gamedata::naming;
use tauri::{AppHandle, Manager, Runtime};

use super::with_session;
use crate::state::GameDataState;

/// What a nebula is called when the save's pool has no name left and the install, when game
/// data is loaded, has none either.
const FALLBACK_NAME: &str = "New Nebula";

/// Add a nebula at (`x`, `y`) with `radius` as one `AddNebula`, named from `seed` out of a
/// save's pool of unused nebula names, else the install's lists when game data is loaded,
/// else [`FALLBACK_NAME`], numbered when a nebula already holds it.
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
        let picked = match gd {
            Some(gd) => naming::pick_nebula_name(session, &gd, seed),
            None => naming::pick_pooled_nebula_name(session, seed),
        };
        let name = picked.unwrap_or_else(|| fallback_name(session));
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

/// [`FALLBACK_NAME`], or the first of `New Nebula 2`, `New Nebula 3`, … no nebula holds.
fn fallback_name(session: &Session) -> String {
    let taken = |name: &str| session.graph.nebulae.iter().any(|n| n.name.key == name);
    std::iter::once(FALLBACK_NAME.to_owned())
        .chain((2..).map(|n| format!("{FALLBACK_NAME} {n}")))
        .find(|name| !taken(name))
        .unwrap_or_default()
}
