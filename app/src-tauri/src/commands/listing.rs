//! The save, campaign and scenario listings, and the directories they are found in.

use std::path::{Path, PathBuf};

use sgf_core::format::scenario::listings::{self, ScenarioListings};
use sgf_core::library::{self, CampaignListing};
use sgf_core::views::{SaveFile, SgfError};
use sgf_gamedata::install::scenarios;
use tauri::{AppHandle, Manager, Runtime};

use super::join_error;
use crate::state::GameDataState;

#[tauri::command(async)]
pub fn save_dirs() -> Vec<String> {
    library::find_save_dirs()
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// Every `.sav` under the Stellaris save directories, local and Steam Cloud, newest first.
#[tauri::command]
pub async fn list_saves() -> Result<Vec<SaveFile>, SgfError> {
    tauri::async_runtime::spawn_blocking(library::list_saves)
        .await
        .map_err(join_error)
}

/// Every campaign folder under this machine's save directories, or under `dirs` when
/// given, newest first. One archive is opened per folder, for its newest save.
#[tauri::command]
pub async fn list_campaigns(dirs: Option<Vec<String>>) -> Result<Vec<CampaignListing>, SgfError> {
    tauri::async_runtime::spawn_blocking(move || match dirs {
        Some(dirs) => {
            let roots: Vec<(PathBuf, bool)> = dirs
                .into_iter()
                .map(PathBuf::from)
                .map(|dir| {
                    let cloud = library::is_cloud_save(&dir);
                    (dir, cloud)
                })
                .collect();
            library::list_campaigns_in(&roots)
        }
        None => library::list_campaigns(),
    })
    .await
    .map_err(join_error)
}

/// Every `.sav` directly in the campaign folder `dir`, newest first.
#[tauri::command]
pub async fn list_campaign_saves(dir: String) -> Result<Vec<SaveFile>, SgfError> {
    tauri::async_runtime::spawn_blocking(move || library::list_campaign_saves(Path::new(&dir)))
        .await
        .map_err(join_error)
}

/// Every static galaxy scenario the game could read, the user's own mods first, then the
/// enabled playset in load order, the installed mods it leaves out, and the install.
/// Without game data only the user's mods and the install are known; `install_path` and
/// `user_dir` override where those are looked for.
#[tauri::command]
pub async fn list_scenarios<R: Runtime>(
    app: AppHandle<R>,
    install_path: Option<String>,
    user_dir: Option<String>,
) -> Result<ScenarioListings, SgfError> {
    let gd = app.state::<GameDataState>().loaded();
    tauri::async_runtime::spawn_blocking(move || {
        let mut diagnostics = Vec::new();
        let roots = scenarios::scenario_roots(
            gd.as_deref(),
            install_path.map(PathBuf::from),
            user_dir.map(PathBuf::from),
            &mut diagnostics,
        );
        ScenarioListings {
            scenarios: listings::list_scenarios_in(&roots),
            diagnostics: diagnostics.iter().map(ToString::to_string).collect(),
        }
    })
    .await
    .map_err(join_error)
}

/// Whether `path` lies under a Steam Cloud save directory (see `SaveFile::cloud`).
#[tauri::command]
pub fn is_cloud_save(path: String) -> bool {
    library::is_cloud_save(Path::new(&path))
}

/// Every other scenario in the directory of `path`, as file name and header `name`.
#[tauri::command]
pub async fn sibling_scenario_names(path: String) -> Result<Vec<(String, String)>, SgfError> {
    tauri::async_runtime::spawn_blocking(move || listings::sibling_names(Path::new(&path)))
        .await
        .map_err(join_error)
}
