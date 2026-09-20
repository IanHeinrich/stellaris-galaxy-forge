//! The one open document: opening it, editing it, and writing it back.

use std::path::Path;
use std::sync::Arc;

use sgf_core::archive;
use sgf_core::export;
use sgf_core::library;
use sgf_core::ops::Op;
use sgf_core::session::{Session, SessionError};
use sgf_core::views::{
    Capabilities, DocumentKind, EditResult, ErrorKind, GalaxyView, OpenResult, ProgressPhase,
    SaveResult, SgfError,
};
use sgf_gamedata::GameData;
use tauri::{AppHandle, Manager, Runtime, State};

use super::{DONE, START, VALIDATE_AT, join_error, lock, progress};
use crate::state::{AppState, GameDataState};

/// Open `path`, a save or a scenario script, as the session, replacing any open one.
/// Emits `sgf://progress`.
#[tauri::command]
pub async fn open_save<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<OpenResult, SgfError> {
    install(app, move |_| Ok(Session::open(path)?)).await
}

/// Open the save at `path` as a new, unsaved scenario holding its galaxy; the save is
/// untouched. Emits `sgf://progress`.
#[tauri::command]
pub async fn open_as_scenario<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<OpenResult, SgfError> {
    install(app, move |gd| {
        let resolve = |key: &str| gd.as_ref().and_then(|gd| gd.loc.get(key));
        Ok(export::open_save_as_scenario(Path::new(&path), &resolve)?)
    })
    .await
}

/// Open scenario text received from elsewhere (e.g. Paint a Galaxy) as a new, unsaved
/// scenario. Emits `sgf://progress`.
#[tauri::command]
pub async fn open_scenario_text<R: Runtime>(
    app: AppHandle<R>,
    text: String,
) -> Result<OpenResult, SgfError> {
    install(app, move |_| {
        Ok(export::open_scenario_text(text.into_bytes())?)
    })
    .await
}

/// Start an empty, unsaved scenario called `name`; `radius` sizes the map's canvas
/// until systems give it an extent of its own, `core_radius` is written to the header.
/// Emits `sgf://progress`.
#[tauri::command]
pub async fn new_scenario<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    radius: f64,
    core_radius: f64,
) -> Result<OpenResult, SgfError> {
    install(app, move |_| {
        let mut session = export::new_scenario(&name, core_radius)?;
        session.graph.galaxy_radius = radius;
        Ok(session)
    })
    .await
}

/// Write the open save's galaxy as a scenario script at `path`, backing up any file
/// there; the session stays as it is. Emits `sgf://progress`.
#[tauri::command]
pub async fn export_scenario<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<SaveResult, SgfError> {
    progress(&app, ProgressPhase::Write, START);
    let task_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<SaveResult, SgfError> {
        let state = task_app.state::<AppState>();
        let guard = lock(&state);
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        if session.kind() != DocumentKind::Save {
            return Err(SgfError::new(
                ErrorKind::Op,
                "only a save can be exported as a scenario",
            ));
        }
        let gd = task_app.state::<GameDataState>().loaded();
        let resolve = |key: &str| gd.as_ref().and_then(|gd| gd.loc.get(key));
        let path = Path::new(&path);
        let name = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| session.title());
        let text = export::scenario_text(
            &session.graph,
            &export::options_for(&session.graph, &name),
            &resolve,
        );
        let outcome = export::write_scenario(path, &text)?;
        Ok(SaveResult {
            path: outcome.path.to_string_lossy().into_owned(),
            cloud: library::is_cloud_save(&outcome.path),
            backup_path: outcome.backup.map(|p| p.to_string_lossy().into_owned()),
            dirty: session.is_dirty(),
        })
    })
    .await
    .map_err(join_error)??;
    progress(&app, ProgressPhase::Done, DONE);
    Ok(result)
}

/// Build a session off the main thread, report it and make it the open one.
async fn install<R: Runtime>(
    app: AppHandle<R>,
    build: impl FnOnce(Option<Arc<GameData>>) -> Result<Session, SgfError> + Send + 'static,
) -> Result<OpenResult, SgfError> {
    progress(&app, ProgressPhase::Read, START);
    let gd = app.state::<GameDataState>().loaded();
    let session = tauri::async_runtime::spawn_blocking(move || build(gd))
        .await
        .map_err(join_error)??;
    progress(&app, ProgressPhase::Validate, VALIDATE_AT);
    let result = opened(&session)?;
    *lock(&app.state::<AppState>()) = Some(session);
    progress(&app, ProgressPhase::Done, DONE);
    Ok(result)
}

fn opened(session: &Session) -> Result<OpenResult, SgfError> {
    let meta = match session.kind() {
        DocumentKind::Save => Some(archive::parse_meta(session.doc.meta())?),
        DocumentKind::Scenario => None,
    };
    Ok(OpenResult {
        path: session
            .path
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned()),
        cloud: session.path.as_deref().is_some_and(library::is_cloud_save),
        kind: session.kind(),
        title: session.title(),
        meta,
        galaxy: GalaxyView::from(&session.graph),
        issues: session.validate(),
        capabilities: Capabilities::of(session.kind()),
    })
}

/// Builds the details projection so search also finds planets and fleets; idempotent.
#[tauri::command]
pub async fn warm_details<R: Runtime>(app: AppHandle<R>) -> Result<(), SgfError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut guard = lock(&state);
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        session.warm_details().map_err(SessionError::from)?;
        Ok(())
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub fn apply_op(state: State<'_, AppState>, op: Op) -> Result<EditResult, SgfError> {
    let mut guard = lock(&state);
    let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
    let result = session.apply(op)?;
    Ok(session.edit_result(result))
}

#[tauri::command]
pub fn undo(state: State<'_, AppState>) -> Result<Option<EditResult>, SgfError> {
    let mut guard = lock(&state);
    let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
    let result = session.undo()?;
    Ok(result.map(|r| session.edit_result(r)))
}

#[tauri::command]
pub fn redo(state: State<'_, AppState>) -> Result<Option<EditResult>, SgfError> {
    let mut guard = lock(&state);
    let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
    let result = session.redo()?;
    Ok(result.map(|r| session.edit_result(r)))
}

/// Write the open session in place, backing up any file already there. Emits `sgf://progress`.
#[tauri::command]
pub async fn save<R: Runtime>(app: AppHandle<R>) -> Result<SaveResult, SgfError> {
    save_to(app, None).await
}

/// Write the open session to `path`, which becomes the session's path. Emits `sgf://progress`.
#[tauri::command]
pub async fn save_as<R: Runtime>(app: AppHandle<R>, path: String) -> Result<SaveResult, SgfError> {
    save_to(app, Some(path)).await
}

async fn save_to<R: Runtime>(
    app: AppHandle<R>,
    path: Option<String>,
) -> Result<SaveResult, SgfError> {
    progress(&app, ProgressPhase::Write, START);
    let task_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<SaveResult, SgfError> {
        let state = task_app.state::<AppState>();
        let mut guard = lock(&state);
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        let report = |fraction| progress(&task_app, ProgressPhase::Write, fraction);
        let outcome = session.save_to_with(path.as_deref().map(Path::new), report)?;
        Ok(session.save_result(outcome))
    })
    .await
    .map_err(join_error)??;
    progress(&app, ProgressPhase::Done, DONE);
    Ok(result)
}

#[tauri::command(async)]
pub fn close_save(state: State<'_, AppState>) -> Result<(), SgfError> {
    *lock(&state) = None;
    Ok(())
}
