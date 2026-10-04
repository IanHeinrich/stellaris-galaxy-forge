//! Reading the open document: a system, one entity's bytes, search, and where save planets
//! may move.

use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::Arc;

use sgf_core::entity::{
    self, EntityAddr, EntityKind, EntitySchema, EntitySource, EntityView, PlanetPage,
};
use sgf_core::ops::Op;
use sgf_core::projections::galaxy::GalaxyGraph;
use sgf_core::views::{
    OrbitPlacement, PlanetMoveCheck, PlanetMoveTargets, SearchResult, SgfError, SystemDetail,
};
use sgf_gamedata::GameData;
use sgf_gamedata::special::{self, SpecialKind};
use tauri::{AppHandle, Manager, Runtime};

use super::with_session;
use crate::state::{GameDataState, SpecialLabels};

#[tauri::command]
pub async fn get_system<R: Runtime>(app: AppHandle<R>, id: u32) -> Result<SystemDetail, SgfError> {
    with_session(app, move |guard| {
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        SystemDetail::of(session.graph(), id)
            .ok_or_else(|| SgfError::not_found(format!("system {id}")))
    })
    .await
}

/// One level of an entity's current bytes: the children at `path`, with what an op changed.
#[tauri::command]
pub async fn get_entity<R: Runtime>(
    app: AppHandle<R>,
    addr: EntityAddr,
    path: Vec<String>,
) -> Result<EntityView, SgfError> {
    with_session(app, move |guard| {
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        Ok(entity::get_entity(session.doc(), addr, &path)?)
    })
    .await
}

/// An entity's current bytes with the ranges an op changed.
#[tauri::command]
pub async fn get_entity_source<R: Runtime>(
    app: AppHandle<R>,
    addr: EntityAddr,
) -> Result<EntitySource, SgfError> {
    with_session(app, move |guard| {
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        Ok(entity::get_entity_source(session.doc(), addr)?)
    })
    .await
}

/// A save body's own Overview; `not_found` on a scenario, whose planets have no entities.
#[tauri::command]
pub async fn get_planet_page<R: Runtime>(
    app: AppHandle<R>,
    id: u32,
) -> Result<PlanetPage, SgfError> {
    with_session(app, move |guard| {
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        Ok(entity::get_planet_page(session.doc(), id)?)
    })
    .await
}

/// Where the save planets `planets` may move together, and which of them cannot move.
#[tauri::command]
pub async fn planet_move_targets<R: Runtime>(
    app: AppHandle<R>,
    planets: Vec<u32>,
) -> Result<PlanetMoveTargets, SgfError> {
    with_session(app, move |guard| {
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        Ok(session.planet_move_targets(&planets))
    })
    .await
}

/// Why moving `planets` to system `to` would be refused, or else the colonies and stations
/// it takes into another country's system. The session is left as it was.
#[tauri::command]
pub async fn planet_move_check<R: Runtime>(
    app: AppHandle<R>,
    planets: Vec<u32>,
    to: u32,
    at: Option<OrbitPlacement>,
) -> Result<PlanetMoveCheck, SgfError> {
    with_session(app, move |guard| {
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        Ok(session.planet_move_check(&planets, to, at))
    })
    .await
}

/// The op that moves `planets` to system `to`, for `apply_op`.
#[tauri::command]
pub async fn planet_move_op<R: Runtime>(
    app: AppHandle<R>,
    planets: Vec<u32>,
    to: u32,
    at: Option<OrbitPlacement>,
) -> Result<Op, SgfError> {
    with_session(app, move |guard| {
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        Ok(session.planet_move_op(&planets, to, at)?)
    })
    .await
}

/// The fields the Data tab labels for a kind; unknown keys render raw.
#[tauri::command]
pub fn get_entity_schema(kind: EntityKind) -> EntitySchema {
    entity::get_entity_schema(kind)
}

/// Hits carry the localised name when game data is loaded, which also lets a system match
/// on its special kinds.
#[tauri::command]
pub async fn search<R: Runtime>(
    app: AppHandle<R>,
    query: String,
    limit: usize,
) -> Result<SearchResult, SgfError> {
    with_session(app.clone(), move |guard| {
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        let game_data = app.state::<GameDataState>();
        let snapshot = game_data.snapshot();
        let gd = snapshot.as_ref().map(|(_, gd)| gd);
        let resolve = |key: &str| gd.and_then(|gd| gd.loc.get(key));
        let kinds = snapshot
            .as_ref()
            .map(|(generation, gd)| special_labels(session.graph(), gd, &game_data, *generation))
            .unwrap_or_default();
        let special = |id: u32| kinds.get(&id).cloned().unwrap_or_default();
        Ok(session.search(&query, limit, &resolve, &special))
    })
    .await
}

/// Each special system's kinds by their labels, kept until the game data or a system's
/// initializer or flags change, so a query typed a letter at a time classifies once.
fn special_labels(
    graph: &GalaxyGraph,
    gd: &GameData,
    state: &GameDataState,
    generation: u64,
) -> Arc<SpecialLabels> {
    let digest = classified_from(graph);
    if let Some(cached) = state.special_labels(generation, digest) {
        return cached;
    }
    let labels: SpecialLabels = special::classify(graph, Some(gd))
        .systems
        .into_iter()
        .map(|s| (s.id, s.kinds.into_iter().filter_map(searchable).collect()))
        .collect();
    let labels = Arc::new(labels);
    state.store_special_labels(generation, digest, Arc::clone(&labels));
    labels
}

/// What classifying a system reads of it: its id, initializer and flags.
fn classified_from(graph: &GalaxyGraph) -> u64 {
    let mut hasher = DefaultHasher::new();
    for system in graph.systems.values() {
        system.id.hash(&mut hasher);
        system.initializer.hash(&mut hasher);
        system.flags.hash(&mut hasher);
    }
    hasher.finish()
}

/// `Unique` names every hand-written system, so it is not something to search for.
fn searchable(kind: SpecialKind) -> Option<&'static str> {
    (kind != SpecialKind::Unique).then(|| kind.label())
}
