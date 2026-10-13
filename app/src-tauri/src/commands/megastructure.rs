//! Deleting a megastructure from the open save, with what the install says its dismantle
//! takes back, and deleting a ring world whole.

use sgf_core::ops::Op;
use sgf_core::views::{EditResult, SgfError};
use tauri::{AppHandle, Manager, Runtime};

use super::with_session;
use crate::state::GameDataState;

/// Delete megastructure row `megastructure` of the open save as one `DeleteMegastructure`,
/// taking back the modifiers, deposits and owner counters its type's dismantle removes.
/// Without game data, or for a type the install does not define, it is deleted with nothing
/// taken back.
#[tauri::command]
pub async fn delete_megastructure<R: Runtime>(
    app: AppHandle<R>,
    megastructure: u32,
) -> Result<EditResult, SgfError> {
    let gd = app.state::<GameDataState>().loaded();
    with_session(app, move |mut guard| {
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        let dismantle = gd.and_then(|gd| {
            let kind = session
                .save("reading a megastructure's type")
                .ok()?
                .megastructure_kind(megastructure)?;
            let dismantle = gd.megastructures.get(&kind)?.dismantle.clone();
            (!dismantle.is_empty()).then_some(dismantle)
        });
        let result = session.apply(Op::DeleteMegastructure {
            megastructure,
            dismantle,
        })?;
        Ok(session.edit_result(result))
    })
    .await
}

/// Delete the ring world of system `system` of the open save as one `DeleteRingWorld`: the
/// ring at `radius`, or every ring of the system without one.
#[tauri::command]
pub async fn delete_ring_world<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
    radius: Option<f64>,
) -> Result<EditResult, SgfError> {
    with_session(app, move |mut guard| {
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        let result = session.apply(Op::DeleteRingWorld { system, radius })?;
        Ok(session.edit_result(result))
    })
    .await
}
