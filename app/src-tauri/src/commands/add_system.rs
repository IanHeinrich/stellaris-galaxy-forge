//! Rolling a star system from the install's rules and writing it into the open save, and
//! deleting the systems added this session.

use sgf_core::ops::{LaneEnd, Op};
use sgf_core::views::{EditResult, ErrorKind, SgfError};
use sgf_gamedata::generate::{self, ClusterRoll, Pick, SystemAsk};
use sgf_gamedata::picks::StarClassPick;
use sgf_gamedata::summary::{self, AddSystemPicks, ClusterPick, SpecialPick};
use tauri::{AppHandle, Runtime, State};

use super::{game_data, require, with_session};
use crate::state::GameDataState;

const ADD_A_SYSTEM: &str = "add a system";
const NO_ROLLS: &str = "this document takes no rolled system";
const NO_BULK_ADD: &str = "this document takes no systems added together";
const NO_ADDED: &str = "this document has no systems added this session";
const NONE_ADDED: &str = "none of these systems was added this session";

/// Roll a system at (`x`, `y`) from `seed`, around `star_class` when given, named from the
/// save's pool of unused star names, and add it to the open save as one `AddSystemFromSpec`.
#[tauri::command]
pub async fn add_random_system<R: Runtime>(
    app: AppHandle<R>,
    seed: u64,
    x: f64,
    y: f64,
    star_class: Option<String>,
) -> Result<EditResult, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.added_systems, NO_ROLLS)?;
        let pick = Pick::Random(star_class);
        let spec = generate::for_save(&gd, session, seed, (x, y), &pick)?;
        let result = session.apply(Op::AddSystemFromSpec { spec })?;
        Ok(session.edit_result(result))
    })
    .await
}

/// Roll a system at each of `systems` around its star class, all from `seed`, named from one
/// draw so no two share a name, and add them with `lanes` to the open save as one `Batch`
/// described as `description`.
#[tauri::command]
pub async fn add_random_systems<R: Runtime>(
    app: AppHandle<R>,
    seed: u64,
    systems: Vec<SystemAsk>,
    lanes: Vec<(LaneEnd, LaneEnd)>,
    description: String,
) -> Result<EditResult, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.bulk_add_systems, NO_BULK_ADD)?;
        let op = generate::systems_op(&gd, session, seed, &systems, &lanes, description)?;
        let result = session.apply(op)?;
        Ok(session.edit_result(result))
    })
    .await
}

/// Build a system of the special layout `layout` at (`x`, `y`) from `seed`, and add it to the
/// open save with what its script plants beside its bodies, as one `Batch`: the planet flags
/// and global event targets always, the anomalies and dig sites when `extras`. It takes the
/// layout's fixed name unless a system of the save holds it, and a name from the pool
/// otherwise. A capped layout the galaxy already has is placed all the same. A scenario takes
/// a system statement naming the layout as its initializer, and `extras` says nothing.
#[tauri::command]
pub async fn add_special_system<R: Runtime>(
    app: AppHandle<R>,
    seed: u64,
    x: f64,
    y: f64,
    layout: String,
    extras: bool,
) -> Result<EditResult, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.bulk_add_systems, NO_BULK_ADD)?;
        let op = generate::special_op(&gd, session, seed, (x, y), &layout, extras)?;
        let result = session.apply(op)?;
        Ok(session.edit_result(result))
    })
    .await
}

/// The Special menu's cluster `cluster` rolled from `seed` with its home at (`x`, `y`), as
/// `add_special_cluster` adds it from the same arguments: each system's layout, name, place
/// and star class, why the add refuses its place, and the lanes between them. Nothing is
/// written; another seed places and rolls them again.
#[tauri::command]
pub async fn roll_special_cluster<R: Runtime>(
    app: AppHandle<R>,
    seed: u64,
    x: f64,
    y: f64,
    cluster: String,
) -> Result<ClusterRoll, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.bulk_add_systems, NO_BULK_ADD)?;
        let rolled = generate::roll_cluster(&gd, session, seed, (x, y), &cluster)?;
        Ok(rolled.view(&gd))
    })
    .await
}

/// Add the Special menu's cluster `cluster`, rolled from `seed` with its home at (`x`, `y`)
/// as `roll_special_cluster` previews it, as one `Batch` with the lanes between its systems.
/// A save takes each system as `add_special_system` does, with the anomalies, dig sites and
/// megastructures of all of them when `extras`; a scenario takes a statement naming each
/// one's initializer, and `extras` says nothing. Refused with nothing applied when a system's
/// place is refused.
#[tauri::command]
pub async fn add_special_cluster<R: Runtime>(
    app: AppHandle<R>,
    seed: u64,
    x: f64,
    y: f64,
    cluster: String,
    extras: bool,
) -> Result<EditResult, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.bulk_add_systems, NO_BULK_ADD)?;
        let op = generate::cluster_op(&gd, session, seed, (x, y), &cluster, extras)?;
        let result = session.apply(op)?;
        Ok(session.edit_result(result))
    })
    .await
}

/// The Special menu's layouts for the open document, each with its card, in a scenario as in a
/// save: what `get_add_system_picks` lists as its `special`.
#[tauri::command]
pub async fn get_special_layouts<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<SpecialPick>, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.bulk_add_systems, NO_BULK_ADD)?;
        Ok(summary::special_picks(&gd, session))
    })
    .await
}

/// The Special menu's clusters for the open document, each with its card, in a scenario as
/// in a save: what `get_add_system_picks` lists as its `clusters`.
#[tauri::command]
pub async fn get_special_clusters<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<ClusterPick>, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.bulk_add_systems, NO_BULK_ADD)?;
        Ok(summary::cluster_picks(&gd, session))
    })
    .await
}

/// Roll the added save system `system` again from `seed`, keeping its name, position and lanes:
/// one `ReplaceSystemFromSpec`. With `keep_special`, a system of a Special menu layout is built from
/// that layout again. Otherwise it is rolled around `star_class` when given, a random class
/// when not.
#[tauri::command]
pub async fn reroll_system<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
    seed: u64,
    star_class: Option<String>,
    keep_special: Option<bool>,
) -> Result<EditResult, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.added_systems, NO_ROLLS)?;
        let keep_special = keep_special.unwrap_or(false);
        let spec = Pick::of_added(session, &gd, system, keep_special, star_class)
            .and_then(|pick| generate::reroll(&gd, session, seed, system, &pick))?;
        let result = session.apply(Op::ReplaceSystemFromSpec { system, spec })?;
        Ok(session.edit_result(result))
    })
    .await
}

/// Delete the systems among `ids` added to the open save this session as one `RemoveSystems`,
/// leaving the file's own systems among them alone.
#[tauri::command]
pub async fn remove_added_systems<R: Runtime>(
    app: AppHandle<R>,
    ids: Vec<u32>,
) -> Result<EditResult, SgfError> {
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.added_systems, NO_ADDED)?;
        let added = generate::added_among(session, ids);
        if added.is_empty() {
            return Err(SgfError::new(ErrorKind::Op, NONE_ADDED));
        }
        let result = session.apply(Op::RemoveSystems { systems: added })?;
        Ok(session.edit_result(result))
    })
    .await
}

/// Everything the Add system menu offers for the open save, each with what it can produce:
/// Random, each star class, and the Special menu's layouts with their marks.
#[tauri::command]
pub async fn get_add_system_picks<R: Runtime>(
    app: AppHandle<R>,
) -> Result<AddSystemPicks, SgfError> {
    let gd = game_data(&app, ADD_A_SYSTEM)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), |c| c.added_systems, NO_ROLLS)?;
        Ok(summary::add_system_picks(&gd, session))
    })
    .await
}

/// The star classes a rolled system can have, each with its localised name, in the order the
/// install's layouts name them; empty without game data.
#[tauri::command(async)]
pub fn get_generator_star_classes(game_data: State<'_, GameDataState>) -> Vec<StarClassPick> {
    game_data
        .loaded()
        .map_or_else(Vec::new, |gd| gd.star_class_picks())
}
