//! Adding a ring world round the star of a system of the open save, whole, with each quadrant
//! at the stage the player picks, and what clearing the system for it would take.

use sgf_core::views::{RingWorldClearing, SgfError};
use sgf_gamedata::construction::ring_world::RingStage;
use sgf_gamedata::generate;
use tauri::{AppHandle, Runtime};

use super::{game_data, require, with_session};
use crate::views::Added;

const NO_RING_WORLDS: &str = "this document takes no added ring world";

/// Add the ring world of megastructure type `kind`, any stage of its chain, round the star of
/// system `system`, each quadrant at its stage in `stages`, clearing the system first with
/// `clear`, as `sgf_gamedata::generate::ring_world_op` builds it. Answers the planets and
/// rows it wrote, in the quadrants' order.
#[tauri::command]
pub async fn add_ring_world<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
    kind: String,
    stages: Vec<RingStage>,
    clear: bool,
) -> Result<Added, SgfError> {
    let gd = game_data(&app, "add a ring world")?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.add_megastructures, NO_RING_WORLDS)?;
        let planned = generate::ring_world_op(&gd, session, system, &kind, &stages, clear)?;
        let result = session.apply(planned.op)?;
        Ok(Added::of(session, result))
    })
    .await
}

/// What clearing system `system` of the open save for a ring world would take: every body
/// that is not a star, with the colonies on them, and every belt.
#[tauri::command]
pub async fn get_ring_world_clearing<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
) -> Result<RingWorldClearing, SgfError> {
    with_session(app, move |guard| {
        let session = require(guard.as_ref(), |c| c.add_megastructures, NO_RING_WORLDS)?;
        Ok(session
            .save("clearing a system for a ring world")?
            .ring_world_clearing(system)?)
    })
    .await
}
