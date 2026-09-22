//! The one open document: opening it, editing it, and writing it back.

use std::path::Path;
use std::sync::Arc;

use sgf_core::archive;
use sgf_core::export::{self, ExportReport, ScenarioProfile};
use sgf_core::format::scenario::fe_zone::FeZone;
use sgf_core::format::scenario::header_counts::{empire_counts, seat_counts, zone_count};
use sgf_core::format::scenario::is_painted;
use sgf_core::format::scenario::marauder::clan_count;
use sgf_core::library;
use sgf_core::ops::Op;
use sgf_core::ops::rules::fe_zone as placement;
use sgf_core::session::{Session, SessionError};
use sgf_core::validate::Issue;
use sgf_core::views::{
    Capabilities, DocumentKind, EditResult, ErrorKind, ExportResult, GalaxyView, OpenResult,
    ProgressPhase, SaveResult, SgfError,
};
use sgf_gamedata::GameData;
use tauri::{AppHandle, Manager, Runtime};

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
/// untouched, and what the scenario could not carry over follows its issues. `profile`
/// is plain when absent. Emits `sgf://progress`.
#[tauri::command]
pub async fn open_as_scenario<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    profile: Option<ScenarioProfile>,
) -> Result<OpenResult, SgfError> {
    install_reporting(app, move |gd| {
        let resolve = |key: &str| gd.as_ref().and_then(|gd| gd.loc.get(key));
        let sources = |initializer: &str| {
            gd.as_ref()
                .and_then(|gd| gd.initializer_source(initializer))
        };
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
    let task_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<ExportResult, SgfError> {
        let state = task_app.state::<AppState>();
        let guard = lock(&state);
        let session = exportable(&guard)?;
        let gd = task_app.state::<GameDataState>().loaded();
        let resolve = |key: &str| gd.as_ref().and_then(|gd| gd.loc.get(key));
        let sources = |initializer: &str| {
            gd.as_ref()
                .and_then(|gd| gd.initializer_source(initializer))
        };
        let path = Path::new(&path);
        let name = path
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
        let outcome = export::write_scenario(path, &text)?;
        let save = SaveResult {
            path: outcome.path.to_string_lossy().into_owned(),
            cloud: library::is_cloud_save(&outcome.path),
            backup_path: outcome.backup.map(|p| p.to_string_lossy().into_owned()),
            dirty: session.is_dirty(),
        };
        Ok(ExportResult { save, report })
    })
    .await
    .map_err(join_error)??;
    progress(&app, ProgressPhase::Done, DONE);
    Ok(result)
}

/// What exporting the open save would report, without writing anything. The report is
/// the plain draft's, which every profile shares.
#[tauri::command]
pub async fn preview_export<R: Runtime>(app: AppHandle<R>) -> Result<ExportReport, SgfError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let guard = lock(&state);
        let session = exportable(&guard)?;
        let gd = app.state::<GameDataState>().loaded();
        let resolve = |key: &str| gd.as_ref().and_then(|gd| gd.loc.get(key));
        let sources = |initializer: &str| {
            gd.as_ref()
                .and_then(|gd| gd.initializer_source(initializer))
        };
        let (_, report) = export::draft(
            &session.graph,
            &export::options_for_session(session, &session.title()),
            &resolve,
            &sources,
        );
        Ok(report)
    })
    .await
    .map_err(join_error)?
}

/// The open session when it is a save, the only document an export reads.
fn exportable(guard: &Option<Session>) -> Result<&Session, SgfError> {
    let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
    if session.kind() != DocumentKind::Save {
        return Err(SgfError::new(
            ErrorKind::Op,
            "only a save can be exported as a scenario",
        ));
    }
    Ok(session)
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
    .map_err(join_error)??;
    with_session(app.clone(), move |guard| {
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

/// Run `f` over the open session on the blocking pool, so neither the main thread nor an
/// async worker waits on the session lock.
async fn with_session<R: Runtime, T: Send + 'static>(
    app: AppHandle<R>,
    f: impl FnOnce(&mut Option<Session>) -> Result<T, SgfError> + Send + 'static,
) -> Result<T, SgfError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut guard = lock(&state);
        f(&mut guard)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub async fn apply_op<R: Runtime>(app: AppHandle<R>, op: Op) -> Result<EditResult, SgfError> {
    with_session(app, move |guard| {
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        let result = session.apply(op)?;
        Ok(session.edit_result(result))
    })
    .await
}

/// Link `linked` to the fallen empire zone `anchor` anchors, as one `SetFeLinks` op:
/// the mod then lays the fallen empire's hyperlanes from those systems and no other.
/// An empty `linked` gives the zone back to the mod's own rule.
#[tauri::command]
pub async fn set_fe_links<R: Runtime>(
    app: AppHandle<R>,
    anchor: u32,
    linked: Vec<u32>,
) -> Result<EditResult, SgfError> {
    apply_op(app, Op::SetFeLinks { anchor, linked }).await
}

/// The entries of one `SetFeZones` op that replace the open scenario's automatic
/// fallen empire zones with `count` of the ones Paint a Galaxy's own rule would place
/// now, spread over the map; the zones the map author placed by hand are not among
/// them. The app applies the op.
#[tauri::command]
pub async fn fe_zone_fit<R: Runtime>(
    app: AppHandle<R>,
    count: usize,
) -> Result<Vec<(u32, Option<FeZone>)>, SgfError> {
    with_session(app, move |guard| {
        let session = scenario(guard)?;
        Ok(placement::fit(&placement::sites(&session.graph), count))
    })
    .await
}

/// How many automatic fallen empire zones Paint a Galaxy's rule can place on the open
/// scenario: the most `fe_zone_fit` accepts.
#[tauri::command]
pub async fn fe_zone_candidate_count<R: Runtime>(app: AppHandle<R>) -> Result<usize, SgfError> {
    with_session(app, |guard| {
        let session = scenario(guard)?;
        Ok(placement::candidate_count(&placement::sites(
            &session.graph,
        )))
    })
    .await
}

fn scenario(guard: &Option<Session>) -> Result<&Session, SgfError> {
    let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
    if session.kind() != DocumentKind::Scenario {
        return Err(SgfError::new(
            ErrorKind::Op,
            "only a scenario has fallen empire zones",
        ));
    }
    Ok(session)
}

/// The five empire-count header keys and the values Paint a Galaxy's formulas give
/// the open scenario's seats, for the app to apply as one `SetHeaderKeys`.
#[tauri::command]
pub async fn header_empire_counts<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<(String, String)>, SgfError> {
    with_session(app, |guard| {
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        if session.kind() != DocumentKind::Scenario {
            return Err(SgfError::new(
                ErrorKind::Op,
                "only a scenario has empire counts",
            ));
        }
        let seats = seat_counts(&session.graph);
        let zones = zone_count(&session.graph);
        let clans = clan_count(&session.graph);
        Ok(empire_counts(seats, zones, clans)
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn undo<R: Runtime>(app: AppHandle<R>) -> Result<Option<EditResult>, SgfError> {
    with_session(app, |guard| {
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        let result = session.undo()?;
        Ok(result.map(|r| session.edit_result(r)))
    })
    .await
}

#[tauri::command]
pub async fn redo<R: Runtime>(app: AppHandle<R>) -> Result<Option<EditResult>, SgfError> {
    with_session(app, |guard| {
        let session = guard.as_mut().ok_or_else(SgfError::no_session)?;
        let result = session.redo()?;
        Ok(result.map(|r| session.edit_result(r)))
    })
    .await
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

#[tauri::command]
pub async fn close_save<R: Runtime>(app: AppHandle<R>) -> Result<(), SgfError> {
    with_session(app, |guard| {
        *guard = None;
        Ok(())
    })
    .await
}
