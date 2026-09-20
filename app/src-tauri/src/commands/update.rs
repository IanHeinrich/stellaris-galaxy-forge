use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use sgf_core::views::{ErrorKind, SgfError};
use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::UpdaterExt;

use crate::state::UpdateState;
use crate::views::{InstallKind, UpdateCheck, UpdateProgress, UpdateView};

pub const UPDATE_PROGRESS_EVENT: &str = "sgf://update-progress";
pub const RELEASES_URL: &str =
    "https://github.com/IanHeinrich/stellaris-galaxy-forge/releases/latest";

/// Ask the endpoint what it offers, and park what it answers for `install_update`.
#[tauri::command]
pub async fn check_for_update<R: Runtime>(app: AppHandle<R>) -> Result<UpdateCheck, SgfError> {
    let current = app.package_info().version.to_string();
    let found = app
        .updater()
        .map_err(update_error)?
        .check()
        .await
        .map_err(update_error)?;
    let update = found.as_ref().map(|u| UpdateView {
        version: u.version.clone(),
        notes: u.body.clone().unwrap_or_default(),
        date: u
            .raw_json
            .get("pub_date")
            .and_then(|v| v.as_str())
            .map(str::to_owned),
        install: install_kind(),
    });
    app.state::<UpdateState>().put(found);
    Ok(UpdateCheck {
        current,
        update,
        releases_url: RELEASES_URL.into(),
    })
}

/// Download and run the parked update. On Windows the installer ends this process
/// itself; elsewhere the app restarts.
#[tauri::command]
pub async fn install_update<R: Runtime>(app: AppHandle<R>) -> Result<(), SgfError> {
    let update = app
        .state::<UpdateState>()
        .take()
        .ok_or_else(|| SgfError::new(ErrorKind::NotFound, "no update has been checked for"))?;

    let downloaded = Arc::new(AtomicU64::new(0));
    let counted = Arc::clone(&downloaded);
    let chunked = app.clone();
    let finished = app.clone();
    let installed = update
        .download_and_install(
            move |chunk, total| {
                let chunk = chunk as u64;
                let downloaded = counted.fetch_add(chunk, Ordering::Relaxed) + chunk;
                let _ = chunked.emit(
                    UPDATE_PROGRESS_EVENT,
                    UpdateProgress {
                        downloaded,
                        total,
                        done: false,
                    },
                );
            },
            move || {
                let _ = finished.emit(
                    UPDATE_PROGRESS_EVENT,
                    UpdateProgress {
                        downloaded: downloaded.load(Ordering::Relaxed),
                        total: None,
                        done: true,
                    },
                );
            },
        )
        .await;
    if let Err(e) = installed {
        // A failed install is retried from the same check.
        app.state::<UpdateState>().put(Some(update));
        return Err(update_error(e));
    }
    app.restart()
}

/// The package-manager formats need privilege escalation the app does not drive, and a
/// raw executable (the portable zip) has no bundle type patched in.
fn install_kind() -> InstallKind {
    match bundle_type() {
        Some(BundleType::Nsis | BundleType::Msi | BundleType::AppImage | BundleType::App) => {
            InstallKind::App
        }
        _ => InstallKind::Manual,
    }
}

fn update_error(e: tauri_plugin_updater::Error) -> SgfError {
    SgfError::new(ErrorKind::Io, e.to_string())
}
