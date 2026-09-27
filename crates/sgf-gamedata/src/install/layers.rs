//! Vanilla plus the loaded mods, in load order, and the file-level
//! override rules (`docs/game-data-notes.md`, "Override semantics").

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::install::mods::{ModInfo, ModStatus};

/// The name of the base game's layer, the first of every [`Layout`].
pub const VANILLA: &str = "vanilla";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layer {
    pub name: String,
    pub root: PathBuf,
    pub replace_paths: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Layout {
    pub install: PathBuf,
    pub user_dir: Option<PathBuf>,
    /// Vanilla first, then every `Loaded` mod in load order.
    pub layers: Vec<Layer>,
}

impl Layout {
    pub(crate) fn new(install: PathBuf, user_dir: Option<PathBuf>, mods: &[ModInfo]) -> Self {
        let vanilla = Layer {
            name: VANILLA.to_owned(),
            root: install.clone(),
            replace_paths: Vec::new(),
        };
        let loaded = mods.iter().filter_map(|m| match (&m.dir, m.status) {
            (Some(dir), ModStatus::Loaded) => Some(Layer {
                name: m.name.clone(),
                root: dir.clone(),
                replace_paths: m.replace_paths.iter().map(|p| normalize(p)).collect(),
            }),
            _ => None,
        });
        let layers = std::iter::once(vanilla).chain(loaded).collect();
        Self {
            install,
            user_dir,
            layers,
        }
    }

    /// Whether `file` lies under one of the roots these layers were read from:
    /// the install, the user directory, or a loaded mod. Both sides are
    /// canonicalised, so a sibling whose name merely starts with a root's
    /// (`Stellaris-evil` beside `Stellaris`) is not under it.
    pub fn contains(&self, file: &Path) -> bool {
        let Ok(file) = file.canonicalize() else {
            return false;
        };
        let roots = std::iter::once(&self.install)
            .chain(self.user_dir.iter())
            .chain(self.layers.iter().map(|l| &l.root));
        roots
            .filter_map(|root| root.canonicalize().ok())
            .any(|root| file.starts_with(root))
    }

    /// The layer `path` was read from, and the path below its root with forward slashes:
    /// the deepest root that holds it, case aside, and the later layer of two alike.
    pub fn layer_of(&self, path: &Path) -> Option<(&Layer, String)> {
        let path = path.to_string_lossy().replace('\\', "/");
        let lower = path.to_ascii_lowercase();
        self.layers
            .iter()
            .rev()
            .filter_map(|layer| {
                let root = layer.root.to_string_lossy().replace('\\', "/");
                let root = root.trim_end_matches('/').to_ascii_lowercase();
                let rest = lower.strip_prefix(&root)?.strip_prefix('/')?;
                Some((layer, path[path.len() - rest.len()..].to_owned()))
            })
            .min_by_key(|(_, rel)| rel.len())
    }

    /// The winning `.txt` file per filename directly under `rel_dir`
    /// (`common/star_classes`), sorted by filename. A later layer's file of
    /// the same name replaces an earlier one; a layer whose `replace_path`
    /// names `rel_dir` discards everything before it.
    pub fn files_in(&self, rel_dir: &str) -> Vec<PathBuf> {
        let rel_dir = normalize(rel_dir);
        let mut winners: BTreeMap<String, PathBuf> = BTreeMap::new();
        for layer in &self.layers {
            if layer.replace_paths.contains(&rel_dir) {
                winners.clear();
            }
            let dir = rel_dir
                .split('/')
                .fold(layer.root.clone(), |p, part| p.join(part));
            for path in txt_files(&dir) {
                if let Ok(rel) = path.strip_prefix(&dir) {
                    winners.insert(normalize(&rel.to_string_lossy()), path);
                }
            }
        }
        winners.into_values().collect()
    }

    /// The winning file of extension `ext` per filename directly under
    /// `rel_dir` (`flags/aquatic`; subfolders not walked, so a category's
    /// own `small/` and `map/` size variants are left out), with the layer
    /// it came from (`None` for vanilla's). Same override rules as
    /// [`Layout::files_in`].
    pub fn files_with_ext_in(&self, rel_dir: &str, ext: &str) -> Vec<(PathBuf, Option<String>)> {
        let rel_dir = normalize(rel_dir);
        let mut winners: BTreeMap<String, (PathBuf, Option<String>)> = BTreeMap::new();
        for layer in &self.layers {
            if layer.replace_paths.contains(&rel_dir) {
                winners.clear();
            }
            let dir = rel_dir
                .split('/')
                .fold(layer.root.clone(), |p, part| p.join(part));
            let source = (layer.name != VANILLA).then(|| layer.name.clone());
            for path in direct_files(&dir, ext) {
                if let Some(name) = path.file_name() {
                    winners.insert(name.to_string_lossy().into_owned(), (path, source.clone()));
                }
            }
        }
        winners.into_values().collect()
    }

    /// The subdirectory names directly under `rel_dir` (`flags`), across
    /// every layer. Same override rules as [`Layout::files_in`]: a layer
    /// whose `replace_path` names `rel_dir` discards the subdirectories
    /// seen before it.
    pub fn subdirs_in(&self, rel_dir: &str) -> Vec<String> {
        let rel_dir = normalize(rel_dir);
        let mut names: BTreeSet<String> = BTreeSet::new();
        for layer in &self.layers {
            if layer.replace_paths.contains(&rel_dir) {
                names.clear();
            }
            let dir = rel_dir
                .split('/')
                .fold(layer.root.clone(), |p, part| p.join(part));
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                if entry.file_type().is_ok_and(|t| t.is_dir()) {
                    names.insert(entry.file_name().to_string_lossy().into_owned());
                }
            }
        }
        names.into_iter().collect()
    }

    /// The winning file called `name` directly under `rel_dir`
    /// (`common/defines/00_defines.txt`).
    pub fn file_in(&self, rel_dir: &str, name: &str) -> Option<PathBuf> {
        self.files_in(rel_dir)
            .into_iter()
            .find(|p| p.file_name().is_some_and(|f| f == name))
    }

    /// The last layer's copy of `rel` (`gfx/map/star_classes/g_star.dds`).
    pub fn resolve_file(&self, rel: &str) -> Option<PathBuf> {
        let rel = normalize(rel);
        self.layers
            .iter()
            .rev()
            .map(|layer| {
                rel.split('/')
                    .fold(layer.root.clone(), |p, part| p.join(part))
            })
            .find(|path| path.is_file())
    }

    /// Every `.yml` under each layer's `localisation/` whose header names
    /// `lang` (`l_<lang>:`; the `_l_<lang>.yml` file name is only a
    /// convention mods break), in layer order then path order: those outside
    /// a `replace` folder first, those inside one second (applied last,
    /// winning over everything).
    pub fn localisation_files(&self, lang: &str) -> (Vec<PathBuf>, Vec<PathBuf>) {
        let header = format!("l_{lang}:");
        let (mut normal, mut replace) = (Vec::new(), Vec::new());
        for layer in &self.layers {
            let base = layer.root.join("localisation");
            for path in yml_files(&base, &header) {
                if under_replace(&base, &path) {
                    replace.push(path);
                } else {
                    normal.push(path);
                }
            }
        }
        (normal, replace)
    }
}

fn normalize(rel: &str) -> String {
    rel.replace('\\', "/").trim_matches('/').to_owned()
}

/// Every `.txt` below `dir`, subfolders included: the game reads a definition folder as a tree.
fn txt_files(dir: &Path) -> Vec<PathBuf> {
    WalkDir::new(dir)
        .sort_by_file_name()
        .into_iter()
        .flatten()
        .map(|e| e.into_path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|e| e == "txt"))
        .collect()
}

/// Every file directly under `dir` (subfolders not walked) with extension `ext`.
fn direct_files(dir: &Path, ext: &str) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|e| e == ext))
        .collect();
    files.sort();
    files
}

fn yml_files(base: &Path, header: &str) -> Vec<PathBuf> {
    let lang = header.trim_end_matches(':');
    WalkDir::new(base)
        .sort_by_file_name()
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| p.extension().is_some_and(|e| e == "yml"))
        .filter(|p| match name_language(p) {
            Some(named) => named == lang,
            None => has_header(p, header),
        })
        .collect()
}

/// The `l_<lang>` a file name ends with, when it follows the convention; opening thousands
/// of files to read their header is slow, so only unconventional names are opened.
fn name_language(path: &Path) -> Option<&str> {
    let stem = path.file_stem()?.to_str()?;
    let at = stem.rfind("_l_")?;
    let lang = &stem[at + 1..];
    lang[2..]
        .chars()
        .all(|c| c.is_ascii_lowercase() || c == '_')
        .then_some(lang)
}

/// Whether the file's first line, past any BOM, is `header`.
fn has_header(path: &Path, header: &str) -> bool {
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut head = [0u8; 64];
    let Ok(n) = file.read(&mut head) else {
        return false;
    };
    let text = String::from_utf8_lossy(&head[..n]);
    text.trim_start_matches('\u{feff}')
        .lines()
        .next()
        .is_some_and(|line| line.trim() == header)
}

fn under_replace(base: &Path, path: &Path) -> bool {
    path.strip_prefix(base)
        .map(|rel| rel.components().any(|c| c.as_os_str() == "replace"))
        .unwrap_or(false)
}
