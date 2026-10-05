//! The Tauri commands. Names and argument names match the wrappers in `app/src/api/`, one
//! file per module here. The event names are written to `app/src/generated/shell.ts`.

pub mod add_body;
pub mod add_system;
pub mod entity;
pub mod gamedata;
pub mod listing;
pub mod nebula;
pub mod paint;
pub mod prepare;
pub mod scenario;
pub mod session;
pub mod update;

pub use add_body::*;
pub use add_system::*;
pub use entity::*;
pub use gamedata::*;
pub use listing::*;
pub use nebula::*;
pub use paint::*;
pub use prepare::*;
pub use scenario::*;
pub use session::*;
pub use update::*;

use std::ops::Deref;
use std::sync::{Arc, MutexGuard};

use sgf_core::ops::SystemRadii;
use sgf_core::session::Session;
use sgf_core::views::{Capabilities, ErrorKind, Progress, ProgressPhase, SgfError};
use sgf_gamedata::{GameData, LoadError};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::state::{AppState, GameDataState, relock};

pub const PROGRESS_EVENT: &str = "sgf://progress";
pub const GAME_DATA_CHANGED_EVENT: &str = "sgf://gamedata-changed";

/// Progress fractions: `START` and `DONE` bracket every job; the rest are where a
/// phase begins within its job (open: validate; game data: discover, definitions, localisation).
const START: f64 = 0.0;
const DONE: f64 = 1.0;
const VALIDATE_AT: f64 = 0.9;
const DISCOVER_AT: f64 = 0.1;
const DEFINITIONS_AT: f64 = 0.4;
const LOCALISATION_AT: f64 = 0.7;

/// Fit `session` to the loaded game data: systems sized by its defines and stars as the
/// install names them, or vanilla's sizes and the name rule without any.
pub(crate) fn fit_to_game_data<R: Runtime>(app: &AppHandle<R>, session: &mut Session) {
    let gd = app.state::<GameDataState>().loaded();
    session.set_radii(
        gd.as_ref()
            .map_or(SystemRadii::VANILLA, |gd| gd.system_radii),
    );
    session.set_star_classes(gd.map(|gd| gd.session_star_classes()).unwrap_or_default());
}

/// [`fit_to_game_data`] for the open session, once game data has loaded, unloaded or reloaded.
pub(crate) fn refit_open_session<R: Runtime>(app: &AppHandle<R>) {
    if let Some(session) = lock(&app.state::<AppState>()).as_mut() {
        fit_to_game_data(app, session);
    }
}

/// The loaded game data, or a refusal saying it is needed to `action`.
pub(crate) fn game_data<R: Runtime>(
    app: &AppHandle<R>,
    action: &str,
) -> Result<Arc<GameData>, SgfError> {
    app.state::<GameDataState>()
        .loaded()
        .ok_or_else(|| SgfError::no_game_data(action))
}

/// Run `f` over the open scenario and the loaded game data, off the caller's thread.
/// `None` without game data, on a document whose systems name no scripts, or when `f` finds
/// nothing; fails when nothing is open.
async fn with_scenario<R: Runtime, T: Send + 'static>(
    app: AppHandle<R>,
    f: impl FnOnce(&Session, &GameData, &GameDataState, u64) -> Option<T> + Send + 'static,
) -> Result<Option<T>, SgfError> {
    with_session(app.clone(), move |guard| {
        let session = guard.as_ref().ok_or_else(SgfError::no_session)?;
        let game_data = app.state::<GameDataState>();
        let Some((generation, gd)) = game_data.snapshot() else {
            return Ok(None);
        };
        if !Capabilities::of(session.doc()).scripted_owners {
            return Ok(None);
        }
        Ok(f(session, &gd, &game_data, generation))
    })
    .await
}

/// Run `f` over the open session on the blocking pool, so neither the main thread nor an
/// async worker waits on the session lock. `f` holds the lock and may release it early.
async fn with_session<R: Runtime, T: Send + 'static>(
    app: AppHandle<R>,
    f: impl FnOnce(MutexGuard<'_, Option<Session>>) -> Result<T, SgfError> + Send + 'static,
) -> Result<T, SgfError> {
    tauri::async_runtime::spawn_blocking(move || f(lock(&app.state::<AppState>())))
        .await
        .map_err(io_error)?
}

/// The open session when its document can do what `can` asks of its capabilities; else
/// `refusal`, as an `Op` error.
fn require<S: Deref<Target = Session>>(
    session: Option<S>,
    can: impl Fn(Capabilities) -> bool,
    refusal: &str,
) -> Result<S, SgfError> {
    let session = session.ok_or_else(SgfError::no_session)?;
    if !can(Capabilities::of(session.doc())) {
        return Err(SgfError::new(ErrorKind::Op, refusal));
    }
    Ok(session)
}

/// A document with its own details is a save, of any version: the core refuses what that
/// version cannot take.
fn is_save(capabilities: Capabilities) -> bool {
    capabilities.details
}

fn lock<'a>(state: &'a State<'_, AppState>) -> MutexGuard<'a, Option<Session>> {
    relock(&state.0)
}

fn load_error(e: LoadError) -> SgfError {
    match e {
        LoadError::NoInstall { .. } => SgfError::new(ErrorKind::NoInstall, e.to_string()),
    }
}

fn io_error(e: impl ToString) -> SgfError {
    SgfError::new(ErrorKind::Io, e.to_string())
}

fn progress<R: Runtime>(app: &AppHandle<R>, phase: ProgressPhase, fraction: f64) {
    let _ = app.emit(PROGRESS_EVENT, Progress { phase, fraction });
}
