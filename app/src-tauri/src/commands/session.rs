//! The one open document: opening it, editing it, and writing it back.

use std::path::Path;
use std::sync::Arc;

use sgf_core::archive;
use sgf_core::export::{self, ExportReport, ScenarioProfile};
use sgf_core::format::scenario::is_painted;
use sgf_core::library;
use sgf_core::ops::Op;
use sgf_core::session::{Session, SessionError};
use sgf_core::validate::Issue;
use sgf_core::views::{
    Capabilities, DocumentKind, EditResult, ExportResult, GalaxyView, OpenResult, ProgressPhase,
    SaveResult, SgfError,
};
use sgf_gamedata::GameData;
use tauri::{AppHandle, Manager, Runtime};

use super::{DONE, START, VALIDATE_AT, io_error, progress, require, with_session};
use crate::state::GameDataState;

const ONLY_A_SAVE_EXPORTS: &str = "only a save can be exported as a scenario";

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
/// untouched, and what the scenario could not carry over follows its issues. `profile`
/// is plain when absent. Emits `sgf://progress`.
#[tauri::command]
pub async fn open_as_scenario<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    profile: Option<ScenarioProfile>,
) -> Result<OpenResult, SgfError> {
    install_reporting(app, move |gd| {
        let (resolve, sources) = sgf_gamedata::export_resolvers(gd.as_deref());
        let (session, report) = export::open_save_as_scenario(
            Path::new(&path),
            &resolve,
            &sources,
            profile.unwrap_or_default(),
        )?;
        Ok((session, report.issues()))
    })
    .await
}

/// Start an empty, unsaved scenario called `name`; `radius` sizes the map's canvas
/// until systems give it an extent of its own, `core_radius` is written to the header.
/// `profile` is plain when absent. Emits `sgf://progress`.
#[tauri::command]
pub async fn new_scenario<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    radius: f64,
    core_radius: f64,
    profile: Option<ScenarioProfile>,
) -> Result<OpenResult, SgfError> {
    install(app, move |_| {
        let mut session = export::new_scenario(&name, core_radius, profile.unwrap_or_default())?;
        session.graph.galaxy_radius = radius;
        Ok(session)
    })
    .await
}

/// Write the open save's galaxy as a scenario script at `path`, backing up any file
/// there; the session stays as it is. `profile` is plain when absent. Emits
/// `sgf://progress`.
#[tauri::command]
pub async fn export_scenario<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    profile: Option<ScenarioProfile>,
) -> Result<ExportResult, SgfError> {
    progress(&app, ProgressPhase::Write, START);
    let gd = app.state::<GameDataState>().loaded();
    let (text, report, dirty) = with_session(app.clone(), {
        let path = path.clone();
        move |guard| {
            let session = require(guard.as_ref(), DocumentKind::Save, ONLY_A_SAVE_EXPORTS)?;
            let (resolve, sources) = sgf_gamedata::export_resolvers(gd.as_deref());
            let name = Path::new(&path)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| session.title());
            let (text, report) = export::scenario_text(
                &session.graph,
                &export::options_for_session(session, &name),
                &resolve,
                &sources,
                profile.unwrap_or_default(),
            );
            Ok((text, report, session.is_dirty()))
        }
    })
    .await?;
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        export::write_scenario(Path::new(&path), &text)
    })
    .await
    .map_err(io_error)??;
    let save = SaveResult {
        path: outcome.path.to_string_lossy().into_owned(),
        cloud: library::is_cloud_save(&outcome.path),
        backup_path: outcome.backup.map(|p| p.to_string_lossy().into_owned()),
        dirty,
    };
    progress(&app, ProgressPhase::Done, DONE);
    Ok(ExportResult { save, report })
}

/// What exporting the open save would report, without writing anything. The report is
/// the plain draft's: the statement counts are the plain profile's, and the rest every
/// profile shares.
#[tauri::command]
pub async fn preview_export<R: Runtime>(app: AppHandle<R>) -> Result<ExportReport, SgfError> {
    let gd = app.state::<GameDataState>().loaded();
    with_session(app, move |guard| {
        let session = require(guard.as_ref(), DocumentKind::Save, ONLY_A_SAVE_EXPORTS)?;
        let (resolve, sources) = sgf_gamedata::export_resolvers(gd.as_deref());
        let (_, report) = export::draft(
            &session.graph,
            &export::options_for_session(session, &session.title()),
            &resolve,
            &sources,
        );
        Ok(report)
    })
    .await
}

/// Build a session off the main thread, report it and make it the open one.
async fn install<R: Runtime>(
    app: AppHandle<R>,
    build: impl FnOnce(Option<Arc<GameData>>) -> Result<Session, SgfError> + Send + 'static,
) -> Result<OpenResult, SgfError> {
    install_reporting(app, move |gd| Ok((build(gd)?, Vec::new()))).await
}

/// As [`install`], for a build with issues of its own to add after the session's.
async fn install_reporting<R: Runtime>(
    app: AppHandle<R>,
    build: impl FnOnce(Option<Arc<GameData>>) -> Result<(Session, Vec<Issue>), SgfError>
    + Send
    + 'static,
) -> Result<OpenResult, SgfError> {
    progress(&app, ProgressPhase::Read, START);
    let gd = app.state::<GameDataState>().loaded();
    let task_app = app.clone();
    let (session, result) = tauri::async_runtime::spawn_blocking(move || {
        let (session, extra) = build(gd)?;
        progress(&task_app, ProgressPhase::Validate, VALIDATE_AT);
        let mut result = opened(&session)?;
        result.issues.extend(extra);
        Ok::<_, SgfError>((session, result))
    })
    .await
    .map_err(io_error)??;
    with_session(app.clone(), move |mut guard| {
        *guard = Some(session);
        Ok(())
    })
    .await?;
    progress(&app, ProgressPhase::Done, DONE);
    Ok(result)
}

fn opened(session: &Session) -> Result<OpenResult, SgfError> {
    let (meta, painted) = match session.kind() {
        DocumentKind::Save => (Some(archive::parse_meta(session.doc.meta())?), false),
        DocumentKind::Scenario => (None, is_painted(session.doc.original())),
    };
    Ok(OpenResult {
        path: session
            .path
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned()),
        cloud: session.path.as_deref().is_some_and(library::is_cloud_save),
        kind: session.kind(),
        painted,
        title: session.title(),
        meta,
        galaxy: GalaxyView::from(&session.graph),
        issues: session.validate(),
        capabilities: Capabilities::of(&session.doc),
    })
}

/// Builds the details projection so search also finds planets and fleets; idempotent.
#[tauri::command]
pub async fn warm_details<R: Runtime>(app: AppHandle<R>) -> Result<(), SgfError> {
    with_session(app, |mut guard| {
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        session.warm_details().map_err(SessionError::from)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn apply_op<R: Runtime>(app: AppHandle<R>, op: Op) -> Result<EditResult, SgfError> {
    with_session(app, move |mut guard| {
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        let result = session.apply(op)?;
        Ok(session.edit_result(result))
    })
    .await
}

#[tauri::command]
pub async fn undo<R: Runtime>(app: AppHandle<R>) -> Result<Option<EditResult>, SgfError> {
    with_session(app, |mut guard| {
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        let result = session.undo()?;
        Ok(result.map(|r| session.edit_result(r)))
    })
    .await
}

#[tauri::command]
pub async fn redo<R: Runtime>(app: AppHandle<R>) -> Result<Option<EditResult>, SgfError> {
    with_session(app, |mut guard| {
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        let result = session.redo()?;
        Ok(result.map(|r| session.edit_result(r)))
    })
    .await
}

/// Write the open session in place, backing up any file already there. Refuses with
/// `changed_on_disk` when something else wrote the file since it was opened or last saved,
/// unless `force`. Emits `sgf://progress`.
#[tauri::command]
pub async fn save<R: Runtime>(
    app: AppHandle<R>,
    force: Option<bool>,
) -> Result<SaveResult, SgfError> {
    save_to(app, None, force.unwrap_or(false)).await
}

/// Write the open session to `path`, which becomes the session's path. When `path` is the
/// session's own file it refuses and takes `force` as `save` does. Emits `sgf://progress`.
#[tauri::command]
pub async fn save_as<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    force: Option<bool>,
) -> Result<SaveResult, SgfError> {
    save_to(app, Some(path), force.unwrap_or(false)).await
}

async fn save_to<R: Runtime>(
    app: AppHandle<R>,
    path: Option<String>,
    force: bool,
) -> Result<SaveResult, SgfError> {
    progress(&app, ProgressPhase::Write, START);
    let task_app = app.clone();
    let result = with_session(app.clone(), move |mut guard| {
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        let report = |fraction| progress(&task_app, ProgressPhase::Write, fraction);
        let outcome = session.save_to_with(path.as_deref().map(Path::new), force, report)?;
        Ok(session.save_result(outcome))
    })
    .await?;
    progress(&app, ProgressPhase::Done, DONE);
    Ok(result)
}

#[tauri::command]
pub async fn close_save<R: Runtime>(app: AppHandle<R>) -> Result<(), SgfError> {
    with_session(app, |mut guard| {
        *guard = None;
        Ok(())
    })
    .await
}
