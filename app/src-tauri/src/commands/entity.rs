//! Reading the open document: a system, one entity's bytes, and search.

use sgf_core::entity::{self, EntityAddr, EntityKind, EntitySchema, EntitySource, EntityView};
use sgf_core::views::{SearchHit, SgfError, SystemDetail};
use tauri::State;

use super::lock;
use crate::state::{AppState, GameDataState};

#[tauri::command(async)]
pub fn get_system(state: State<'_, AppState>, id: u32) -> Result<SystemDetail, SgfError> {
    let guard = lock(&state);
    let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
    SystemDetail::of(&session.graph, id).ok_or_else(|| SgfError::not_found(format!("system {id}")))
}

/// One level of an entity's current bytes: the children at `path`, with what an op changed.
#[tauri::command(async)]
pub fn get_entity(
    state: State<'_, AppState>,
    addr: EntityAddr,
    path: Vec<String>,
) -> Result<EntityView, SgfError> {
    let guard = lock(&state);
    let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
    Ok(entity::get_entity(&session.doc, addr, &path)?)
}

/// An entity's current bytes with the ranges an op changed.
#[tauri::command(async)]
pub fn get_entity_source(
    state: State<'_, AppState>,
    addr: EntityAddr,
) -> Result<EntitySource, SgfError> {
    let guard = lock(&state);
    let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
    Ok(entity::get_entity_source(&session.doc, addr)?)
}

/// The fields the Data tab labels for a kind; unknown keys render raw.
#[tauri::command]
pub fn get_entity_schema(kind: EntityKind) -> EntitySchema {
    entity::get_entity_schema(kind)
}

/// Hits carry the localised name when game data is loaded.
#[tauri::command(async)]
pub fn search(
    state: State<'_, AppState>,
    game_data: State<'_, GameDataState>,
    query: String,
    limit: usize,
) -> Result<Vec<SearchHit>, SgfError> {
    let guard = lock(&state);
    let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
    let gd = game_data.loaded();
    let resolve = |key: &str| gd.as_ref().and_then(|gd| gd.loc.get(key));
    Ok(session.search(&query, limit, &resolve))
}
