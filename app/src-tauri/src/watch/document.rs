//! Watching the open document's file. The folder is watched, not the file, so an editor that
//! saves through a temp file and a rename is seen too. A settled change is checked against the
//! session's stamp, which the app's own saves keep current, so they are never reported.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{DebounceEventResult, DebouncedEventKind, Debouncer, new_debouncer};
use sgf_core::session::DiskChange;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use super::DEBOUNCE;
use crate::commands::DOCUMENT_CHANGED_EVENT;
use crate::state::{AppState, relock};
use crate::views::{DocumentChange, DocumentChanged};
use sgf_core::paths::Case;

#[derive(Default)]
pub struct DocumentWatchState(Mutex<Option<Watched>>);

struct Watched {
    path: PathBuf,
    _debouncer: Debouncer<RecommendedWatcher>,
}

/// Watch the file at `path` in place of whatever was watched; `None` stops watching. A folder
/// that cannot be watched leaves the focus check and Save's own check to notice.
pub fn follow<R: Runtime>(app: &AppHandle<R>, path: Option<&Path>) {
    let state = app.state::<DocumentWatchState>();
    let mut slot = relock(&state.0);
    if slot.as_ref().map(|w| w.path.as_path()) == path {
        return;
    }
    let stopped = slot.take();
    *slot = path.and_then(|path| watch(app, path));
    drop(slot);
    // Dropping a watcher hands its OS handles back, which blocks.
    if let Some(stopped) = stopped {
        tauri::async_runtime::spawn_blocking(move || drop(stopped));
    }
}

/// How the open document's file stands on disk; `None` while it stands as opened or last
/// saved, and when nothing with a file is open.
pub fn check<R: Runtime>(app: &AppHandle<R>) -> Option<DocumentChanged> {
    let state = app.state::<AppState>();
    let guard = relock(&state.0);
    let session = guard.as_ref()?;
    let change = match session.disk_change() {
        DiskChange::Unchanged => return None,
        DiskChange::Changed => DocumentChange::Changed,
        DiskChange::Gone => DocumentChange::Gone,
    };
    Some(DocumentChanged {
        path: session.path()?.to_string_lossy().into_owned(),
        change,
        dirty: session.is_dirty(),
    })
}

fn watch<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Option<Watched> {
    let folder = path.parent().filter(|p| !p.as_os_str().is_empty())?;
    let name = path.file_name()?.to_owned();
    let reporter = app.clone();
    let mut debouncer = new_debouncer(DEBOUNCE, move |result: DebounceEventResult| {
        // After an error the watcher may have missed the change, so the stamp decides.
        let touched = result.map_or(true, |events| {
            events
                .iter()
                .any(|e| e.kind == DebouncedEventKind::Any && names_file(&e.path, &name))
        });
        if touched && let Some(changed) = check(&reporter) {
            let _ = reporter.emit(DOCUMENT_CHANGED_EVENT, changed);
        }
    })
    .ok()?;
    debouncer
        .watcher()
        .watch(folder, RecursiveMode::NonRecursive)
        .ok()?;
    Some(Watched {
        path: path.to_path_buf(),
        _debouncer: debouncer,
    })
}

/// Whether `path` names the watched file: by name alone, since only its folder is watched,
/// and case-blind where the file system is.
fn names_file(path: &Path, name: &OsStr) -> bool {
    path.file_name()
        .is_some_and(|own| Case::HERE.same_name(own, name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_file_is_known_by_name_and_its_neighbours_are_not() {
        let name = OsStr::new("my_scenario.txt");
        assert!(names_file(Path::new("C:/mods/x/my_scenario.txt"), name));
        assert!(!names_file(
            Path::new("C:/mods/x/my_scenario.txt.bak-20261011-120000"),
            name
        ));
        assert!(!names_file(Path::new("C:/mods/x/.tmpA1b2C3"), name));
        assert!(!names_file(Path::new("C:/mods/x/my_scenario.txt~"), name));
        assert_eq!(
            names_file(Path::new("C:/mods/x/My_Scenario.TXT"), name),
            Case::HERE == Case::Blind
        );
    }
}
