//! The Tauri commands. Names and argument names match `app/src/api/ipc.ts`;
//! the event name matches `app/src/api/events.ts`.

pub mod add_system;
pub mod entity;
pub mod gamedata;
pub mod listing;
pub mod nebula;
pub mod paint;
pub mod scenario;
pub mod session;
pub mod update;

pub use add_system::*;
pub use entity::*;
pub use gamedata::*;
pub use listing::*;
pub use nebula::*;
pub use paint::*;
pub use scenario::*;
pub use session::*;
pub use update::*;

use std::ops::Deref;
use std::sync::MutexGuard;

use sgf_core::session::Session;
use sgf_core::views::{DocumentKind, ErrorKind, Progress, ProgressPhase, SgfError};
use sgf_gamedata::{GameData, LoadError};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::state::{AppState, GameDataState};

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

/// Run `f` over the open scenario and the loaded game data, off the caller's thread.
/// `None` on a save, without game data, or when `f` finds nothing; fails when nothing is open.
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
        if session.kind() != DocumentKind::Scenario {
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

/// The open session when it is a document of `kind`; else `refusal`, as an `Op` error.
fn require<S: Deref<Target = Session>>(
    session: Option<S>,
    kind: DocumentKind,
    refusal: &str,
) -> Result<S, SgfError> {
    let session = session.ok_or_else(SgfError::no_session)?;
    if session.kind() != kind {
        return Err(SgfError::new(ErrorKind::Op, refusal));
    }
    Ok(session)
}

fn lock<'a>(state: &'a State<'_, AppState>) -> MutexGuard<'a, Option<Session>> {
    state.0.lock().unwrap_or_else(|e| e.into_inner())
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
