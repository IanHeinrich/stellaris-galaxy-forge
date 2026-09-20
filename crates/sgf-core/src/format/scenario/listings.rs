//! What an Open screen lists besides saves: every static galaxy scenario the game could
//! read, from the install and from each mod's `map/setup_scenarios`.
//!
//! The caller supplies the roots, because finding the install and the mods is
//! `sgf-gamedata`'s job and this crate does not depend on it.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::format::scenario::index::{self, ScenarioIndex};

/// The layer name the install's own files are listed under, as `Layout` names it.
const VANILLA: &str = "vanilla";

/// Where a scenario file came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ScenarioSource {
    /// A mod the user keeps in the launcher's `mod/` directory.
    UserMod,
    /// An installed mod, enabled or not.
    Mod,
    /// The game's own files.
    Install,
}

/// One `map/setup_scenarios` directory, and what the game makes of the layer holding it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScenarioRoot {
    pub dir: PathBuf,
    pub source: ScenarioSource,
    /// The mod's name; `None` for the install.
    pub mod_name: Option<String>,
    /// In the launcher's enabled playset; the install always is.
    pub enabled: bool,
    /// Position in the load order: `0` is the install, a higher rank is loaded later and
    /// its file of a given name wins. `None` for a layer the game does not load, whose
    /// files neither shadow nor are shadowed.
    pub load_rank: Option<u32>,
    /// The mod declares `replace_path = "map/setup_scenarios"`, which hides every
    /// scenario the layers before it hold, whatever their names.
    pub replaces: bool,
}

/// One scenario file as the Open screen lists it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScenarioListing {
    pub path: String,
    /// The scenario's own `name`, or the file stem when it has none or could not be read.
    pub name: String,
    pub systems: u32,
    pub source: ScenarioSource,
    pub mod_name: Option<String>,
    pub enabled: bool,
    /// The layer whose file of this name the game reads instead of this one.
    pub shadowed_by: Option<String>,
    /// Last modification, seconds since the Unix epoch.
    #[ts(type = "number")]
    pub modified: i64,
    #[ts(type = "number")]
    pub size: u64,
    /// Why the file could not be read as a scenario; it is still listed.
    pub error: Option<String>,
}

/// What the Open screen lists, and what went wrong working out where to look. A mod
/// whose descriptor could not be read is named here rather than silently left out.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScenarioListings {
    pub scenarios: Vec<ScenarioListing>,
    pub diagnostics: Vec<String>,
}

/// Every static galaxy scenario `*.txt` under each of `roots`, roots in the order given
/// and files by name within each. A dynamic scenario is another kind of file and is left
/// out; a static one that could not be read carries its error rather than being left out.
pub fn list_scenarios_in(roots: &[ScenarioRoot]) -> Vec<ScenarioListing> {
    let winners = Winners::of(roots);
    let mut listings = Vec::new();
    for root in roots {
        listings.extend(
            txt_files(&root.dir)
                .iter()
                .filter_map(|path| listing(root, path, &winners)),
        );
    }
    listings
}

/// Which layer's copy the game actually reads, mirroring `Layout::files_in`.
struct Winners {
    /// File name → the rank whose copy wins.
    by_name: HashMap<String, u32>,
    /// The last layer that replaces the whole directory, with its rank: everything below
    /// that rank is hidden whatever it is called.
    replaces_below: Option<(u32, String)>,
    labels: HashMap<u32, String>,
}

impl Winners {
    fn of(roots: &[ScenarioRoot]) -> Self {
        let mut loaded: Vec<&ScenarioRoot> =
            roots.iter().filter(|r| r.load_rank.is_some()).collect();
        loaded.sort_by_key(|r| r.load_rank);
        let mut winners = Self {
            by_name: HashMap::new(),
            replaces_below: None,
            labels: HashMap::new(),
        };
        for root in loaded {
            let Some(rank) = root.load_rank else { continue };
            winners.labels.insert(rank, label(root));
            if root.replaces {
                winners.by_name.clear();
                winners.replaces_below = Some((rank, label(root)));
            }
            for path in txt_files(&root.dir) {
                winners.by_name.insert(file_name(&path), rank);
            }
        }
        winners
    }

    fn shadowed_by(&self, root: &ScenarioRoot, name: &str) -> Option<String> {
        let rank = root.load_rank?;
        if let Some((at, by)) = &self.replaces_below
            && rank < *at
        {
            return Some(by.clone());
        }
        let winner = *self.by_name.get(name)?;
        (winner != rank).then(|| self.labels.get(&winner).cloned())?
    }
}

fn listing(root: &ScenarioRoot, path: &Path, winners: &Winners) -> Option<ScenarioListing> {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let (name, systems, error) = read(path, &stem)?;
    let (modified, size) = stat(path);
    Some(ScenarioListing {
        path: path.to_string_lossy().into_owned(),
        name,
        systems,
        source: root.source,
        mod_name: root.mod_name.clone(),
        enabled: root.enabled,
        shadowed_by: winners.shadowed_by(root, &file_name(path)),
        modified,
        size,
        error,
    })
}

/// The scenario's name and system count, or the file stem and the reason it has neither;
/// `None` for a file that is not a static galaxy scenario at all.
fn read(path: &Path, stem: &str) -> Option<(String, u32, Option<String>)> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) => return Some((stem.to_owned(), 0, Some(e.to_string()))),
    };
    match ScenarioIndex::build(&bytes) {
        Ok(index) => {
            let name = match index.header.name.as_str() {
                "" => stem.to_owned(),
                name => name.to_owned(),
            };
            Some((name, crate::as_u32(index.systems().count()), None))
        }
        Err(index::Error::Dynamic | index::Error::NotAScenario) => None,
        Err(e) => Some((stem.to_owned(), 0, Some(e.to_string()))),
    }
}

fn stat(path: &Path) -> (i64, u64) {
    let Ok(md) = fs::metadata(path) else {
        return (0, 0);
    };
    let modified = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX));
    (modified, md.len())
}

fn label(root: &ScenarioRoot) -> String {
    root.mod_name.clone().unwrap_or_else(|| VANILLA.to_owned())
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn txt_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("txt")))
        .collect();
    files.sort();
    files
}
