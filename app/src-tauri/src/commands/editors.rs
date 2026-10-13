//! Opening script files in the user's editor and the app's own links in the browser.

use std::path::{Path, PathBuf};

use sgf_core::views::{Capabilities, ErrorKind, SgfError};
use sgf_gamedata::views::WorkshopLinks;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

use super::{io_error, with_session};
use crate::editors::{
    self, EditorChoices, EditorPick, OpenedFile, PendingProgram, PickedProgramFile,
};
use crate::state::GameDataState;
use sgf_core::paths;

/// Open a game-data script file or the open scenario's own file with the system default, or
/// show it in its folder. The check in [`openable`] keeps a stray path in a view, or a program,
/// from reaching the shell.
#[tauri::command]
pub async fn open_script<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    reveal: bool,
) -> Result<(), SgfError> {
    let file = openable(&app, path).await?;
    tauri::async_runtime::spawn_blocking(move || match reveal {
        true => tauri_plugin_opener::reveal_item_in_dir(&file),
        false => tauri_plugin_opener::open_path(&file, None::<&str>),
    })
    .await
    .map_err(io_error)?
    .map_err(io_error)
}

/// The editors found on this machine, looked for once a run off the UI thread, the program
/// picked for Other…, and whether Steam replaces the file at `path` when it updates.
#[tauri::command]
pub async fn editor_choices<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<EditorChoices, SgfError> {
    let install = install_dir(&app);
    let store = picked_program_file(&app);
    tauri::async_runtime::spawn_blocking(move || EditorChoices {
        editors: editors::found()
            .iter()
            .map(|editor| editor.view.clone())
            .collect(),
        other: store
            .as_deref()
            .and_then(editors::picked_program)
            .map(|program| editors::program_name(&program)),
        steam_replaces: editors::steam_replaces(Path::new(&path), install.as_deref()),
    })
    .await
    .map_err(io_error)
}

/// What the Other… file dialog lists. Linux has no extension a program takes, so it lists every
/// file.
#[cfg(windows)]
const PROGRAM_EXTENSIONS: &[&str] = &["exe"];
#[cfg(target_os = "macos")]
const PROGRAM_EXTENSIONS: &[&str] = &["app"];
#[cfg(not(any(windows, target_os = "macos")))]
const PROGRAM_EXTENSIONS: &[&str] = &[];

/// Ask for the program Other… opens files with in the system's file dialog, and hold it until
/// the chooser answers ([`answer_editor_chooser`]). Answers with its name; `None` when the
/// dialog was cancelled.
#[tauri::command]
pub async fn choose_editor_program<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<String>, SgfError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_title("Choose the editor");
        if !PROGRAM_EXTENSIONS.is_empty() {
            dialog = dialog.add_filter("Programs", PROGRAM_EXTENSIONS);
        }
        let Some(picked) = dialog.blocking_pick_file() else {
            return Ok(None);
        };
        let program = picked.into_path().map_err(io_error)?;
        let name = editors::program_name(&program);
        app.state::<PendingProgram>().set(program);
        Ok(Some(name))
    })
    .await
    .map_err(io_error)?
}

/// The editor chooser's answer: `editor` picked, or `None` when it was cancelled. Other… keeps
/// the program [`choose_editor_program`] holds in the app's config folder; any other answer
/// drops it.
#[tauri::command]
pub async fn answer_editor_chooser<R: Runtime>(
    app: AppHandle<R>,
    editor: Option<EditorPick>,
) -> Result<(), SgfError> {
    let Some(program) = app.state::<PendingProgram>().take() else {
        return Ok(());
    };
    if !matches!(editor, Some(EditorPick::Other { .. })) {
        return Ok(());
    }
    let store = picked_program_file(&app)
        .ok_or_else(|| SgfError::new(ErrorKind::Io, "The app has no settings folder"))?;
    tauri::async_runtime::spawn_blocking(move || editors::keep_program(&store, &program))
        .await
        .map_err(io_error)?
        .map_err(io_error)
}

/// Open a file [`open_script`] would open in `editor`, at `line` or at its top without one.
/// Other… opens it with the program [`answer_editor_chooser`] kept, and is refused before one
/// is. An editor that cannot be started leaves the file to the system default, and the answer
/// says so.
#[tauri::command]
pub async fn open_in_editor<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    line: Option<u32>,
    editor: EditorPick,
) -> Result<OpenedFile, SgfError> {
    let file = openable(&app, path).await?;
    let install = install_dir(&app);
    let store = picked_program_file(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let picked = match editor {
            EditorPick::Other { .. } => Some(
                store
                    .as_deref()
                    .and_then(editors::picked_program)
                    .ok_or_else(|| {
                        SgfError::new(ErrorKind::NotFound, "Choose a program for Other… first")
                    })?,
            ),
            _ => None,
        };
        let started =
            editors::launch_for(&editor, editors::found(), picked.as_deref(), &file, line)
                .is_some_and(|launch| editors::start(&launch).is_ok());
        if !started {
            tauri_plugin_opener::open_path(&file, None::<&str>).map_err(io_error)?;
        }
        Ok(OpenedFile {
            fell_back: !started && editor != EditorPick::SystemDefault,
            steam_replaces: editors::steam_replaces(&file, install.as_deref()),
        })
    })
    .await
    .map_err(io_error)?
}

fn install_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.state::<GameDataState>()
        .loaded()
        .map(|gd| gd.layout.install.clone())
}

fn picked_program_file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.state::<PickedProgramFile>().get().or_else(|| {
        let dir = app.path().app_config_dir().ok()?;
        Some(dir.join(editors::PICKED_PROGRAM_FILE))
    })
}

/// `path`, when it is a file the app opens for the user: the open document's own when it is a
/// text file, or a script text file of the loaded game data. A save is never one, since its
/// gamestate is zipped, and nor is a program or a shortcut under the game's folders, which the
/// system would run.
async fn openable<R: Runtime>(app: &AppHandle<R>, path: String) -> Result<PathBuf, SgfError> {
    let gd = app.state::<GameDataState>().loaded();
    with_session(app.clone(), move |session| {
        let own_file = session
            .as_ref()
            .filter(|session| Capabilities::of(session.doc()).text_file)
            .and_then(|session| session.path().map(Path::to_path_buf));
        drop(session);
        let file = PathBuf::from(&path);
        if own_file.is_some_and(|open| paths::same_file(&open, &file)) {
            return Ok(file);
        }
        if !editors::is_script_text(&file) {
            return Err(SgfError::new(
                ErrorKind::NotFound,
                format!("{path} is not a script file"),
            ));
        }
        let Some(gd) = gd else {
            return Err(SgfError::no_game_data("open a script"));
        };
        if !gd.layout.contains(&file) {
            return Err(SgfError::new(
                ErrorKind::NotFound,
                format!("{path} is not a file of the loaded game data or the open scenario"),
            ));
        }
        Ok(file)
    })
    .await
}

/// Open one of the app's own links in the user's browser. Only the releases page, the guide and
/// the [`WorkshopLinks`] pages are opened: the check keeps a URL that reached a view from
/// elsewhere from being handed to the shell.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), SgfError> {
    if url != super::update::RELEASES_URL
        && !super::update::is_guide_url(&url)
        && !WorkshopLinks::default().contains(&url)
    {
        return Err(SgfError::new(
            ErrorKind::NotFound,
            format!("{url} is not a link this app opens"),
        ));
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(io_error)
}

/// The Steam Workshop pages the app links to, which `open_url` opens.
#[tauri::command]
pub fn workshop_links() -> WorkshopLinks {
    WorkshopLinks::default()
}
