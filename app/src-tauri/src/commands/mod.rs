//! The Tauri commands. Names and argument names match `app/src/api/ipc.ts`;
//! the event name matches `app/src/api/events.ts`.

pub mod entity;
pub mod gamedata;
pub mod listing;
pub mod scenario;
pub mod session;

pub use entity::*;
pub use gamedata::*;
pub use listing::*;
pub use scenario::*;
pub use session::*;

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
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let guard = lock(&state);
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
    .map_err(join_error)?
}

fn lock<'a>(state: &'a State<'_, AppState>) -> MutexGuard<'a, Option<Session>> {
    state.0.lock().unwrap_or_else(|e| e.into_inner())
}

fn load_error(e: LoadError) -> SgfError {
    match e {
        LoadError::NoInstall { .. } => SgfError::new(ErrorKind::NoInstall, e.to_string()),
    }
}

fn join_error(e: tauri::Error) -> SgfError {
    SgfError::new(ErrorKind::Io, e.to_string())
}

fn progress<R: Runtime>(app: &AppHandle<R>, phase: ProgressPhase, fraction: f64) {
    let _ = app.emit(PROGRESS_EVENT, Progress { phase, fraction });
}
