//! Rolling a star system from the install's rules and writing it into the open save.

use std::sync::Arc;

use sgf_core::ops::{Op, SystemSpec};
use sgf_core::session::Session;
use sgf_core::views::{DocumentKind, EditResult, ErrorKind, SgfError};
use sgf_gamedata::GameData;
use sgf_gamedata::generate;
use tauri::{AppHandle, Manager, Runtime, State};

use super::with_session;
use crate::state::GameDataState;

const NEEDS_GAME_DATA: &str = "load game data to add a system";
const NO_NAMES: &str = "the save and the install have no unused star names left";

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
    let gd = game_data(&app)?;
    with_session(app, move |mut guard| {
        let session = save(guard.as_mut())?;
        let name = generate::pick_system_name(session, &gd, seed)
            .ok_or_else(|| SgfError::new(ErrorKind::Op, NO_NAMES))?;
        let spec = roll(session, &gd, seed, &name, (x, y), star_class.as_deref())?;
        let result = session.apply(Op::AddSaveSystem { spec })?;
        Ok(session.edit_result(result))
    })
    .await
}

/// Roll the added save system `system` again from `seed`, around `star_class` when given,
/// keeping its name, position and lanes: one `ReplaceSaveSystem`.
#[tauri::command]
pub async fn reroll_system<R: Runtime>(
    app: AppHandle<R>,
    system: u32,
    seed: u64,
    star_class: Option<String>,
) -> Result<EditResult, SgfError> {
    let gd = game_data(&app)?;
    with_session(app, move |mut guard| {
        let session = save(guard.as_mut())?;
        let node = session
            .system(system)
            .ok_or_else(|| SgfError::not_found(format!("system {system}")))?;
        let (name, at) = (node.name.key.clone(), (node.x, node.y));
        let spec = roll(session, &gd, seed, &name, at, star_class.as_deref())?;
        let result = session.apply(Op::ReplaceSaveSystem { system, spec })?;
        Ok(session.edit_result(result))
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

fn save(session: Option<&mut Session>) -> Result<&mut Session, SgfError> {
    let session = session.ok_or_else(SgfError::no_session)?;
    if session.kind() != DocumentKind::Save {
        return Err(SgfError::new(
            ErrorKind::Op,
            "only a save takes a rolled system",
        ));
    }
    Ok(session)
}

/// A system rolled from the install's rules, its deposits at the abundance the save was set up with.
fn roll(
    session: &Session,
    gd: &GameData,
    seed: u64,
    name: &str,
    at: (f64, f64),
    star_class: Option<&str>,
) -> Result<SystemSpec, SgfError> {
    let abundance = gd.deposit_defines.abundance(session.resource_abundance());
    generate::generate(gd, seed, name, at, star_class, abundance)
        .map_err(|e| SgfError::new(ErrorKind::Op, e.to_string()))
}
