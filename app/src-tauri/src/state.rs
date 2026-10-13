use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use sgf_core::session::Session;
use sgf_gamedata::GameData;
use sgf_gamedata::scripts::{ScenarioBypasses, ScenarioOwners};
use sgf_gamedata::textures::Textures;
use tauri_plugin_updater::Update;

#[derive(Default)]
pub struct AppState(pub Mutex<Option<Session>>);

/// The loaded install and mods; shared with blocking tasks, so behind an `Arc`.
/// `generation` counts every load, unload and accepted rebuild, and is the
/// version the app sees.
#[derive(Default)]
pub struct GameDataState {
    data: Mutex<Option<Arc<GameData>>>,
    generation: AtomicU64,
    /// Each scenario system's owner, kept until the game data or the scenario changes.
    pub owners: Cached<ScenarioOwners>,
    /// The bypasses the scripts place, on the same terms as the owners.
    pub bypasses: Cached<ScenarioBypasses>,
    /// The search labels, kept until the game data or a system's initializer or flags change.
    pub special_labels: Cached<SpecialLabels>,
}

/// Each special system's kinds, by the labels search matches them on.
pub type SpecialLabels = HashMap<u32, Vec<&'static str>>;

/// A whole-document pass last computed, with what it was computed from: the game-data
/// generation and a digest of the document's systems.
pub struct Cached<T>(Mutex<Option<Entry<T>>>);

struct Entry<T> {
    generation: u64,
    digest: u64,
    value: Arc<T>,
}

impl<T> Default for Cached<T> {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

impl<T> Cached<T> {
    /// The pass as last computed from this `generation` and `digest`, else `compute`d and kept.
    /// The lock is not held while `compute` runs.
    pub fn get_or_compute(
        &self,
        generation: u64,
        digest: u64,
        compute: impl FnOnce() -> T,
    ) -> Arc<T> {
        if let Some(cached) = relock(&self.0)
            .as_ref()
            .filter(|cached| cached.generation == generation && cached.digest == digest)
        {
            return Arc::clone(&cached.value);
        }
        let value = Arc::new(compute());
        *relock(&self.0) = Some(Entry {
            generation,
            digest,
            value: Arc::clone(&value),
        });
        value
    }
}

impl GameDataState {
    /// A handle on the loaded game data that outlives the lock.
    pub fn loaded(&self) -> Option<Arc<GameData>> {
        self.lock().clone()
    }

    /// The loaded data and the generation it is, read together so a rebuild
    /// can tell whether anything replaced it meanwhile.
    pub fn snapshot(&self) -> Option<(u64, Arc<GameData>)> {
        let slot = self.lock();
        Some((self.generation(), slot.clone()?))
    }

    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Relaxed)
    }

    /// Replace whatever is loaded, and return the new generation.
    pub fn store(&self, data: Option<Arc<GameData>>) -> u64 {
        let mut slot = self.lock();
        *slot = data;
        self.bump()
    }

    /// Take a rebuild, unless the data it started from has since been
    /// replaced or unloaded; then the new generation.
    pub fn swap(&self, from: u64, data: Arc<GameData>) -> Option<u64> {
        let mut slot = self.lock();
        if slot.is_none() || self.generation() != from {
            return None;
        }
        *slot = Some(data);
        Some(self.bump())
    }

    fn lock(&self) -> MutexGuard<'_, Option<Arc<GameData>>> {
        relock(&self.data)
    }

    fn bump(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::Relaxed) + 1
    }
}

/// The on-disk PNG cache, created once for the app's lifetime.
pub struct TextureState(pub Textures);

/// The plugin's `Update` is the only thing that can install, and it does not cross
/// IPC, so it is parked here between the two update commands.
#[derive(Default)]
pub struct UpdateState(Mutex<Option<Update>>);

impl UpdateState {
    pub fn put(&self, update: Option<Update>) {
        *relock(&self.0) = update;
    }

    pub fn take(&self) -> Option<Update> {
        relock(&self.0).take()
    }
}

/// `mutex` locked, taking it back from a holder that panicked: every value kept here stays
/// whole between statements.
pub(crate) fn relock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}
