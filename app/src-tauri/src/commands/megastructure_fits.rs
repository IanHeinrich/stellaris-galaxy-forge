//! What the Add megastructure dialog offers at a spot of a system of the open save.

use sgf_core::views::SgfError;
use sgf_gamedata::generate::{self, AddSpot, MegastructureFit};
use tauri::{AppHandle, Runtime};

use super::add_megastructure::NO_MEGASTRUCTURES;
use super::{game_data, require, with_open};

/// Each type the install defines that goes at `spot` of system `system` of the open save, with
/// the type Add writes there, where its row stands and why the save would refuse it, as
/// `sgf_gamedata::generate::megastructure_fits` answers.
#[tauri::command]
pub async fn get_megastructure_fits<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
    spot: AddSpot,
) -> Result<Vec<MegastructureFit>, SgfError> {
    let gd = game_data(&app, "add a megastructure");
    with_open(app, move |session| {
        let session = require(Some(session), |c| c.add_megastructures, NO_MEGASTRUCTURES)?;
        let gd = gd?;
        Ok(generate::megastructure_fits(&gd, session, system, spot)?)
    })
    .await
}
