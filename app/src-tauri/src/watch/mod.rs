//! Watching the loaded install and mod roots: a file the loaders read changes,
//! its registry is reread, and the app is told which ones moved.
//!
//! One task owns the [`Guard`] and awaits its own rebuild, so two rebuilds can
//! never overlap; everything arriving meanwhile queues in the channel.
//!
//! Whatever the watcher cannot do it says why in [`WatchView::reason`], which
//! rides the summary and every `sgf://gamedata-changed`.

mod guard;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{
    DebounceEventHandler, DebounceEventResult, DebouncedEventKind, Debouncer, new_debouncer,
};
use sgf_gamedata::install::layers::Layer;
use sgf_gamedata::views::{GameDataChanged, WatchView};
use sgf_gamedata::{GameData, RegistryKind};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tokio::time::timeout_at;

use crate::commands::GAME_DATA_CHANGED_EVENT;
use crate::state::GameDataState;
use guard::{Action, Guard};

/// How long a path must sit still before the debouncer reports it.
const DEBOUNCE: Duration = Duration::from_millis(300);

/// The live watcher; dropping it stops the OS watches and ends the task.
pub struct Watch {
    _debouncer: Debouncer<RecommendedWatcher>,
    to_task: UnboundedSender<Message>,
    shutdown: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    roots: u32,
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
    }
}

/// The watcher, when there is one, and what it is failing to do either way.
#[derive(Default)]
struct Status {
    watch: Option<Watch>,
    /// The roots this watcher never got, which stands as long as the watcher does.
    start: Option<String>,
    /// Why the last reread failed; the next one that succeeds takes it back.
    rebuild: Option<String>,
    /// The last error the OS watcher reported, after which changes may have gone
    /// unseen; it stands as long as the watcher does.
    missed: Option<String>,
}

impl Status {
    /// What the watcher is failing to do: the last reread's news, the changes it
    /// missed, then the roots it never got.
    fn reason(&self) -> Option<String> {
        let reasons: Vec<&str> = [&self.rebuild, &self.missed, &self.start]
            .into_iter()
            .flatten()
            .map(String::as_str)
            .collect();
        (!reasons.is_empty()).then(|| reasons.join("; "))
    }
}

#[derive(Default)]
pub struct WatchState(Mutex<Status>);

enum Message {
    Changed(Vec<PathBuf>),
    Failed(String),
    Resume,
}

enum Woke {
    Message(Message),
    Timer,
    Closed,
}

/// Watch every root `gd` was loaded from, replacing any watcher already running.
pub fn start<R: Runtime>(app: &AppHandle<R>, gd: &GameData) {
    stop(app);
    let (to_task, from_watcher) = unbounded_channel();
    let Ok(mut debouncer) = new_debouncer(DEBOUNCE, Sink(to_task.clone())) else {
        note_start(
            app,
            Some("the file watcher could not be started".to_owned()),
        );
        return;
    };
    let (to_watch, missing) = roots_of(&gd.layout.layers);
    let mut roots = 0;
    let mut refused: Vec<String> = missing
        .iter()
        .map(|root| format!("{}: no such folder", root.display()))
        .collect();
    for root in to_watch {
        match debouncer.watcher().watch(&root, RecursiveMode::Recursive) {
            Ok(()) => roots += 1,
            Err(e) => refused.push(format!("{}: {e}", root.display())),
        }
    }
    let reason = reason_for(roots, &refused);
    if roots == 0 {
        note_start(app, reason);
        return;
    }
    let shutdown = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicBool::new(false));
    let task_app = app.clone();
    let task_shutdown = Arc::clone(&shutdown);
    let task_paused = Arc::clone(&paused);
    tauri::async_runtime::spawn(async move {
        run(task_app, from_watcher, task_shutdown, task_paused).await
    });
    let state = app.state::<WatchState>();
    *lock(&state) = Status {
        watch: Some(Watch {
            _debouncer: debouncer,
            to_task,
            shutdown,
            paused,
            roots,
        }),
        start: reason,
        rebuild: None,
        missed: None,
    };
}

fn reason_for(roots: u32, refused: &[String]) -> Option<String> {
    match (roots, refused) {
        (_, []) if roots > 0 => None,
        (_, []) => Some("the loaded game data names no folder to watch".to_owned()),
        (_, refused) => Some(format!("could not watch {}", refused.join("; "))),
    }
}

/// Dropping the watcher hands its OS handles back, which blocks, so the drop
/// runs off the caller's thread.
pub fn stop<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<WatchState>();
    let stopped = {
        let mut status = lock(&state);
        status.start = None;
        status.rebuild = None;
        status.missed = None;
        status.watch.take()
    };
    let Some(watch) = stopped else {
        return;
    };
    watch.shutdown.store(true, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || drop(watch));
}

/// What the app is told about auto-reload: the roots held, the breaker, the reason.
pub fn view<R: Runtime>(app: &AppHandle<R>) -> WatchView {
    let state = app.state::<WatchState>();
    let status = lock(&state);
    WatchView {
        watching: status.watch.as_ref().map_or(0, |w| w.roots),
        paused: status
            .watch
            .as_ref()
            .is_some_and(|w| w.paused.load(Ordering::Relaxed)),
        reason: status.reason(),
    }
}

/// Let the watcher rebuild again after the breaker paused it.
pub fn resume<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<WatchState>();
    if let Some(watch) = lock(&state).watch.as_ref() {
        let _ = watch.to_task.send(Message::Resume);
    }
}

fn note_start<R: Runtime>(app: &AppHandle<R>, reason: Option<String>) {
    lock(&app.state::<WatchState>()).start = reason;
}

fn note_rebuild<R: Runtime>(app: &AppHandle<R>, reason: Option<String>) {
    lock(&app.state::<WatchState>()).rebuild = reason;
}

fn note_missed<R: Runtime>(app: &AppHandle<R>, reason: String) {
    lock(&app.state::<WatchState>()).missed = Some(reason);
}

async fn run<R: Runtime>(
    app: AppHandle<R>,
    mut from_watcher: UnboundedReceiver<Message>,
    shutdown: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
) {
    let mut guard = Guard::default();
    let mut wake_at: Option<Instant> = None;
    while !shutdown.load(Ordering::Relaxed) {
        let mut action = match woke(&mut from_watcher, wake_at).await {
            Woke::Closed => break,
            Woke::Timer => guard.wake(Instant::now()),
            Woke::Message(Message::Resume) => {
                let action = guard.resume(Instant::now());
                paused.store(false, Ordering::Relaxed);
                announce(&app, Vec::new(), None);
                action
            }
            Woke::Message(Message::Failed(reason)) => {
                note_missed(&app, reason);
                announce(&app, Vec::new(), None);
                continue;
            }
            Woke::Message(Message::Changed(paths)) => {
                let Some(gd) = app.state::<GameDataState>().loaded() else {
                    continue;
                };
                let hits = paths
                    .into_iter()
                    .filter_map(|p| Some((p.clone(), RegistryKind::classify(&gd.layout, &p)?)));
                guard.changed(Instant::now(), hits)
            }
        };
        wake_at = None;
        loop {
            match action {
                Action::Idle => break,
                Action::WakeAt(at) => {
                    wake_at = Some(at);
                    break;
                }
                Action::Pause { file, count } => {
                    paused.store(true, Ordering::Relaxed);
                    announce(&app, Vec::new(), Some((file, count)));
                    break;
                }
                Action::Rebuild(kinds) => {
                    rebuild(&app, kinds, &shutdown).await;
                    action = guard.wake(Instant::now());
                }
            }
        }
    }
}

async fn woke(from_watcher: &mut UnboundedReceiver<Message>, wake_at: Option<Instant>) -> Woke {
    let received = match wake_at {
        Some(at) => match timeout_at(at.into(), from_watcher.recv()).await {
            Ok(received) => received,
            Err(_) => return Woke::Timer,
        },
        None => from_watcher.recv().await,
    };
    received.map_or(Woke::Closed, Woke::Message)
}

/// Reread `kinds` against the snapshot the rebuild started from, and take the
/// result only if that snapshot is still the loaded one and the watcher has
/// not been stopped meanwhile.
async fn rebuild<R: Runtime>(
    app: &AppHandle<R>,
    kinds: BTreeSet<RegistryKind>,
    shutdown: &AtomicBool,
) {
    let state = app.state::<GameDataState>();
    let Some((from, gd)) = state.snapshot() else {
        return;
    };
    let asked = RegistryKind::closure(&kinds);
    let (rebuilt, replaced) =
        match tauri::async_runtime::spawn_blocking(move || gd.rebuild(&kinds)).await {
            Ok(rebuilt) => rebuilt,
            Err(e) => {
                note_rebuild(
                    app,
                    Some(format!("a reread of the changed files failed: {e}")),
                );
                announce(app, Vec::new(), None);
                return;
            }
        };
    note_rebuild(app, all_kept(&asked, &replaced));
    if shutdown.load(Ordering::Relaxed) {
        return;
    }
    if state.swap(from, Arc::new(rebuilt)).is_some() {
        let registries = replaced.iter().map(|k| k.as_str().to_owned()).collect();
        announce(app, registries, None);
    }
}

/// Why a rebuild that replaced none of the registries it reread changed nothing, naming
/// the ones that kept their old definitions; `None` when any was replaced.
fn all_kept(asked: &BTreeSet<RegistryKind>, replaced: &BTreeSet<RegistryKind>) -> Option<String> {
    if !replaced.is_empty() || asked.is_empty() {
        return None;
    }
    let kinds: Vec<&str> = asked.iter().map(|k| k.as_str()).collect();
    Some(format!(
        "a reread of {} found nothing; the definitions already loaded stay in use",
        kinds.join(", ")
    ))
}

fn announce<R: Runtime>(app: &AppHandle<R>, registries: Vec<String>, hot: Option<(PathBuf, u32)>) {
    let (hot_file, hot_count) = match hot {
        Some((file, count)) => (Some(file.display().to_string()), count),
        None => (None, 0),
    };
    let _ = app.emit(
        GAME_DATA_CHANGED_EVENT,
        GameDataChanged {
            registries,
            version: app.state::<GameDataState>().generation(),
            watch: view(app),
            hot_file,
            hot_count,
        },
    );
}

/// Every layer root that is there, without duplicates and without one another root
/// already covers, and beside them the roots that are no folder at all.
fn roots_of(layers: &[Layer]) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut roots: Vec<PathBuf> = Vec::new();
    let mut missing: Vec<PathBuf> = Vec::new();
    for layer in layers {
        if !layer.root.is_dir() {
            missing.push(layer.root.clone());
            continue;
        }
        if roots.iter().any(|r| covers(r, &layer.root)) {
            continue;
        }
        roots.retain(|r| !covers(&layer.root, r));
        roots.push(layer.root.clone());
    }
    (roots, missing)
}

/// Whether `outer` is `inner` or one of its ancestors, compared case-blind
/// because Windows echoes a path in the case the caller used.
fn covers(outer: &Path, inner: &Path) -> bool {
    let (outer, inner) = (key(outer), key(inner));
    inner == outer || inner.starts_with(&format!("{outer}/"))
}

fn key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

fn lock(state: &WatchState) -> MutexGuard<'_, Status> {
    state.0.lock().unwrap_or_else(|e| e.into_inner())
}

struct Sink(UnboundedSender<Message>);

impl DebounceEventHandler for Sink {
    /// A path still being written comes back as `AnyContinuous` and again as
    /// `Any` once it settles, so only the settled report is passed on.
    fn handle_event(&mut self, result: DebounceEventResult) {
        let events = match result {
            Ok(events) => events,
            Err(e) => {
                let reason = format!("the file watcher may have missed changes: {e}");
                let _ = self.0.send(Message::Failed(reason));
                return;
            }
        };
        let paths: Vec<PathBuf> = events
            .into_iter()
            .filter(|e| e.kind == DebouncedEventKind::Any)
            .map(|e| e.path)
            .collect();
        if !paths.is_empty() {
            let _ = self.0.send(Message::Changed(paths));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer(root: &Path) -> Layer {
        Layer {
            name: root.display().to_string(),
            root: root.to_path_buf(),
            replace_paths: Vec::new(),
        }
    }

    /// A root that is no folder is reported on its own, never pushed among the roots
    /// to watch, where it would evict the ones it covers.
    #[test]
    fn a_root_that_is_not_a_folder_stays_out_of_the_roots() {
        let dir = tempfile::tempdir().expect("tempdir");
        let live = dir.path().join("live");
        std::fs::create_dir(&live).expect("the mod folder");
        let gone = dir.path().join("gone");

        let (roots, missing) = roots_of(&[layer(&gone), layer(&live)]);

        assert_eq!(roots, [live]);
        assert_eq!(missing, [gone]);
    }

    /// A reread that succeeds takes back its own reason and leaves the roots the
    /// watcher never got named.
    #[test]
    fn a_rebuild_reason_clears_without_touching_the_start_reason() {
        let mut status = Status {
            watch: None,
            start: Some("could not watch C:/mods/gone".to_owned()),
            rebuild: Some("a reread of the changed files failed".to_owned()),
            missed: None,
        };
        assert_eq!(
            status.reason().as_deref(),
            Some("a reread of the changed files failed; could not watch C:/mods/gone")
        );

        status.rebuild = None;
        assert_eq!(
            status.reason().as_deref(),
            Some("could not watch C:/mods/gone")
        );
    }

    /// A rebuild that kept every registry it reread says so; one that replaced any says nothing.
    #[test]
    fn a_rebuild_that_replaced_nothing_names_what_it_kept() {
        let asked = BTreeSet::from([RegistryKind::Colors, RegistryKind::Localisation]);
        let reason = all_kept(&asked, &BTreeSet::new()).expect("a reason");
        assert!(reason.contains(RegistryKind::Colors.as_str()), "{reason}");
        assert!(
            reason.contains(RegistryKind::Localisation.as_str()),
            "{reason}"
        );
        assert_eq!(
            all_kept(&asked, &BTreeSet::from([RegistryKind::Colors])),
            None
        );
    }

    /// An error the OS watcher reports reaches the task as a reason, and the reason
    /// rides the view beside the others.
    #[test]
    fn a_watcher_error_becomes_a_reason() {
        let (to_task, mut from_watcher) = unbounded_channel();
        Sink(to_task).handle_event(Err(notify_debouncer_mini::notify::Error::generic(
            "event buffer overflow",
        )));

        let Ok(Message::Failed(reason)) = from_watcher.try_recv() else {
            panic!("the error was not passed on");
        };
        assert!(reason.contains("event buffer overflow"), "{reason}");

        let status = Status {
            watch: None,
            start: Some("could not watch C:/mods/gone".to_owned()),
            rebuild: None,
            missed: Some(reason.clone()),
        };
        assert_eq!(
            status.reason(),
            Some(format!("{reason}; could not watch C:/mods/gone"))
        );
    }
}
