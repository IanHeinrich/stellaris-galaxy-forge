//! Rolling a star system from the install's rules and writing it into the open save, and
//! deleting the systems added this session.

use std::sync::Arc;

use sgf_core::ops::Op;
use sgf_core::views::{DocumentKind, EditResult, ErrorKind, SgfError};
use sgf_gamedata::GameData;
use sgf_gamedata::generate::{self, ForSaveError, Pick};
use sgf_gamedata::summary::{self, AddSystemPicks};
use tauri::{AppHandle, Manager, Runtime, State};

use super::{require, with_session};
use crate::state::GameDataState;

const NEEDS_GAME_DATA: &str = "load game data to add a system";
const ONLY_A_SAVE_ROLLS: &str = "only a save takes a rolled system";
const ONLY_A_SAVE_ADDS: &str = "only a save has systems added this session";
const NONE_ADDED: &str = "none of these systems was added this session";

/// Roll a system at (`x`, `y`) from `seed`, around `star_class` when given, named from the
/// save's pool of unused star names, and add it to the open save as one `AddSaveSystem`.
#[tauri::command]
pub async fn add_random_system<R: Runtime>(
    app: AppHandle<R>,
    seed: u64,
    x: f64,
    y: f64,
    star_class: Option<String>,
) -> Result<EditResult, SgfError> {
    add(app, seed, (x, y), Pick::Random(star_class)).await
}

/// Build a system of the special layout `layout` at (`x`, `y`) from `seed`, and add it to the
/// open save as one `AddSaveSystem`. It takes the layout's fixed name unless a system of the
/// save holds it, and a name from the pool otherwise. A capped layout the galaxy already has
/// is placed all the same.
#[tauri::command]
pub async fn add_special_system<R: Runtime>(
    app: AppHandle<R>,
    seed: u64,
    x: f64,
    y: f64,
    layout: String,
) -> Result<EditResult, SgfError> {
    add(app, seed, (x, y), Pick::Layout(layout)).await
}

/// Roll the added save system `system` again from `seed`, keeping its name, position and lanes:
/// one `ReplaceSaveSystem`. With `keep_special`, a system of a Special menu layout is built from
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
    let gd = game_data(&app)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), DocumentKind::Save, ONLY_A_SAVE_ROLLS)?;
        let keep_special = keep_special.unwrap_or(false);
        let spec = Pick::of_added(session, &gd, system, keep_special, star_class)
            .and_then(|pick| generate::reroll(&gd, session, seed, system, &pick))
            .map_err(refusal)?;
        let result = session.apply(Op::ReplaceSaveSystem { system, spec })?;
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
        let session = require(guard.as_mut(), DocumentKind::Save, ONLY_A_SAVE_ADDS)?;
        let added = generate::added_among(session, ids);
        if added.is_empty() {
            return Err(SgfError::new(ErrorKind::Op, NONE_ADDED));
        }
        let result = session.apply(Op::RemoveSystems { ids: added })?;
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
    let gd = game_data(&app)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), DocumentKind::Save, ONLY_A_SAVE_ROLLS)?;
        Ok(summary::add_system_picks(&gd, session))
    })
    .await
}

/// The star classes a rolled system can have, each with its localised name, in the order the
/// install's layouts name them; empty without game data.
#[tauri::command(async)]
pub fn get_generator_star_classes(game_data: State<'_, GameDataState>) -> Vec<(String, String)> {
    game_data.loaded().map_or_else(Vec::new, |gd| {
        generate::star_classes(&gd)
            .into_iter()
            .map(|key| {
                let name = gd.loc.get(&key).unwrap_or_else(|| key.clone());
                (key, name)
            })
            .collect()
    })
}

fn game_data<R: Runtime>(app: &AppHandle<R>) -> Result<Arc<GameData>, SgfError> {
    app.state::<GameDataState>()
        .loaded()
        .ok_or_else(|| SgfError::new(ErrorKind::Op, NEEDS_GAME_DATA))
}

/// Add the system `pick` gives at `at` from `seed` to the open save, as one `AddSaveSystem`.
async fn add<R: Runtime>(
    app: AppHandle<R>,
    seed: u64,
    at: (f64, f64),
    pick: Pick,
) -> Result<EditResult, SgfError> {
    let gd = game_data(&app)?;
    with_session(app, move |mut guard| {
        let session = require(guard.as_mut(), DocumentKind::Save, ONLY_A_SAVE_ROLLS)?;
        let spec = generate::for_save(&gd, session, seed, at, &pick).map_err(refusal)?;
        let result = session.apply(Op::AddSaveSystem { spec })?;
        Ok(session.edit_result(result))
    })
    .await
}

fn refusal(e: ForSaveError) -> SgfError {
    match e {
        ForSaveError::NoSystem(id) => SgfError::not_found(format!("system {id}")),
        e => SgfError::new(ErrorKind::Op, e.to_string()),
    }
}
