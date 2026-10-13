//! Adding a megastructure of any type the install and its mods define to a system of the
//! open save, placed as its type says.

use sgf_core::ops::MegastructurePlace;
use sgf_core::views::SgfError;
use sgf_gamedata::generate;
use tauri::{AppHandle, Runtime};

use super::{game_data, require, with_session};
use crate::views::{Added, AddedMegastructure};

pub(super) const NO_MEGASTRUCTURES: &str = "this document takes no added megastructure";

/// Add a finished megastructure of type `kind` to system `system` of the open save at
/// `place`, as `sgf_gamedata::generate::megastructure_op` builds it, changing its planet as
/// its build does unless `keep_planet`. Answers what it created and the effects of its
/// construction left out.
#[tauri::command]
pub async fn add_megastructure<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
    kind: String,
    place: MegastructurePlace,
    keep_planet: bool,
) -> Result<AddedMegastructure, SgfError> {
    let gd = game_data(&app, "add a megastructure");
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.add_megastructures, NO_MEGASTRUCTURES)?;
        let gd = gd?;
        let planned = generate::megastructure_op(&gd, session, system, &kind, place, keep_planet)?;
        let result = session.apply(planned.op)?;
        Ok(AddedMegastructure {
            added: Added::of(session, result),
            unsure: planned.unsure,
            unwritten: planned.unwritten,
        })
    })
    .await
}
