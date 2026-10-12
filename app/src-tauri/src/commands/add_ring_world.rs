//! Adding a ring world round the star of a system of the open save, whole, with each quadrant
//! at the stage the player picks, and what clearing the system for it would take.

use sgf_core::ops::Op;
use sgf_core::views::{ErrorKind, RingWorldClearing, SgfError};
use sgf_gamedata::construction::ring_world::{RingStage, ring_world};
use tauri::{AppHandle, Runtime};

use super::{game_data, is_save, require, with_session};
use crate::views::AddedRingWorld;

const ONLY_A_SAVE_ADDS: &str = "only a save takes an added ring world";

/// Add the ring world of megastructure type `kind`, any stage of its chain (its site, frame,
/// a quadrant or a ruin), round the star of system `system`, each quadrant at its stage in
/// `stages`, in the order the chain spawns them. Rows that take an owner are owned by
/// `owner`, and its graphical culture picks the culture of the rows and segment models that
/// take one; with no owner the classes' own models are drawn. With `clear`, every body that
/// is not a star and every belt go first, in the same edit, as the game's frame clears the
/// system; without it they stay where they are. A type the install does not define, a chain
/// that lays out no ring of as many quadrants as `stages` holds, a clearing that would delete
/// a planet a starbase orbits, and anything `AddRingWorld` refuses are refused.
#[tauri::command]
pub async fn add_ring_world<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
    kind: String,
    stages: Vec<RingStage>,
    owner: Option<u32>,
    clear: bool,
) -> Result<AddedRingWorld, SgfError> {
    let gd = game_data(&app, "add a ring world")?;
    if gd.megastructures.get(&kind).is_none() {
        return Err(SgfError::new(
            ErrorKind::Op,
            format!("the install and its mods define no megastructure {kind}"),
        ));
    }
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), is_save, ONLY_A_SAVE_ADDS)?;
        let graph = session.graph();
        let culture = owner
            .and_then(|owner| graph.countries.iter().find(|c| c.id == owner))
            .and_then(|country| country.graphical_culture.clone());
        let ring = ring_world(&gd, &kind, &stages, culture.as_deref()).map_err(|reason| {
            SgfError::new(
                ErrorKind::Op,
                format!("a ring world of {kind} cannot be added: {reason}"),
            )
        })?;
        let op = session.ring_world_op(system, owner, ring, clear)?;
        let result = session.apply(op)?;
        let written = match &result.inverse {
            Op::Batch { ops, .. } => ops.iter().find_map(written_by),
            inverse => written_by(inverse),
        }
        .ok_or_else(|| SgfError::new(ErrorKind::Op, "the add named no new ring world"))?;
        Ok(AddedRingWorld {
            edit: session.edit_result(result),
            planets: written.0,
            megastructures: written.1,
        })
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
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), is_save, ONLY_A_SAVE_ADDS)?;
        Ok(session.ring_world_clearing(system)?)
    })
    .await
}

/// The planets and rows the ring world whose removal `op` is wrote.
fn written_by(op: &Op) -> Option<(Vec<u32>, Vec<u32>)> {
    match op {
        Op::RemoveRingWorld { written, .. } => {
            Some((written.planets.clone(), written.rows.clone()))
        }
        _ => None,
    }
}
