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
    pub data: Mutex<Option<Arc<GameData>>>,
    pub generation: AtomicU64,
    owners: Mutex<Option<Cached<ScenarioOwners>>>,
    bypasses: Mutex<Option<Cached<ScenarioBypasses>>>,
    special_labels: Mutex<Option<Cached<SpecialLabels>>>,
}

/// Each special system's kinds, by the labels search matches them on.
pub type SpecialLabels = HashMap<u32, Vec<&'static str>>;

/// A whole-document pass last computed, with what it was computed from: the game-data
/// generation and a digest of the document's systems.
struct Cached<T> {
    generation: u64,
    digest: u64,
    value: Arc<T>,
}

impl<T> Cached<T> {
    fn get(slot: &Mutex<Option<Self>>, generation: u64, digest: u64) -> Option<Arc<T>> {
        let slot = slot.lock().unwrap_or_else(|e| e.into_inner());
        let cached = slot.as_ref()?;
        (cached.generation == generation && cached.digest == digest)
            .then(|| Arc::clone(&cached.value))
    }

    fn put(slot: &Mutex<Option<Self>>, generation: u64, digest: u64, value: Arc<T>) {
        let mut slot = slot.lock().unwrap_or_else(|e| e.into_inner());
        *slot = Some(Self {
            generation,
            digest,
            value,
        });
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

    /// The cached territories, when they were computed from this generation of the
    /// game data and this scenario.
    pub fn owners(&self, generation: u64, digest: u64) -> Option<Arc<ScenarioOwners>> {
        Cached::get(&self.owners, generation, digest)
    }

    pub fn store_owners(&self, generation: u64, digest: u64, owners: Arc<ScenarioOwners>) {
        Cached::put(&self.owners, generation, digest, owners);
    }

    /// The cached bypasses, on the same terms as the territories.
    pub fn bypasses(&self, generation: u64, digest: u64) -> Option<Arc<ScenarioBypasses>> {
        Cached::get(&self.bypasses, generation, digest)
    }

    pub fn store_bypasses(&self, generation: u64, digest: u64, bypasses: Arc<ScenarioBypasses>) {
        Cached::put(&self.bypasses, generation, digest, bypasses);
    }

    /// The cached search labels, when they were classified from this generation of the
    /// game data and this digest of the document's systems.
    pub fn special_labels(&self, generation: u64, digest: u64) -> Option<Arc<SpecialLabels>> {
        Cached::get(&self.special_labels, generation, digest)
    }

    pub fn store_special_labels(&self, generation: u64, digest: u64, labels: Arc<SpecialLabels>) {
        Cached::put(&self.special_labels, generation, digest, labels);
    }

    fn lock(&self) -> MutexGuard<'_, Option<Arc<GameData>>> {
        self.data.lock().unwrap_or_else(|e| e.into_inner())
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
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = update;
    }

    pub fn take(&self) -> Option<Update> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).take()
    }
}
