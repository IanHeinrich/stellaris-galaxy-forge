//! Where the game is: an explicit path, else every Steam library's
//! `steamapps/common/Stellaris`.

use std::fs;
use std::path::{Path, PathBuf};

use crate::LoadError;

const STELLARIS: [&str; 3] = ["steamapps", "common", "Stellaris"];

/// The game root: `override_`, which must hold `common/` and
/// `localisation/`, else the first Steam library holding one.
pub fn find_install(override_: Option<&Path>) -> Result<PathBuf, LoadError> {
    if let Some(path) = override_ {
        return if is_install(path) {
            Ok(path.to_path_buf())
        } else {
            Err(LoadError::NoInstall {
                searched: vec![path.to_path_buf()],
            })
        };
    }
    let mut searched = Vec::new();
    for library in steam_libraries() {
        let candidate = STELLARIS.iter().fold(library, |p, part| p.join(part));
        if is_install(&candidate) {
            return Ok(candidate);
        }
        searched.push(candidate);
    }
    Err(LoadError::NoInstall { searched })
}

/// `"rawVersion": "v4.4.6"` from `launcher-settings.json` in the game root.
pub fn install_version(install: &Path) -> Option<String> {
    let text = fs::read_to_string(install.join("launcher-settings.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    json.get("rawVersion")?.as_str().map(str::to_owned)
}

/// Every Steam library root: the Steam installs themselves plus each `path`
/// their `libraryfolders.vdf` lists, deduplicated, existing ones only.
pub fn steam_libraries() -> Vec<PathBuf> {
    let mut libraries = Vec::new();
    for root in sgf_core::library::steam_roots() {
        push_unique(&mut libraries, root.clone());
        if let Ok(vdf) = fs::read_to_string(root.join("steamapps/libraryfolders.vdf")) {
            for path in vdf_paths(&vdf) {
                push_unique(&mut libraries, PathBuf::from(path));
            }
        }
    }
    libraries.retain(|p| p.is_dir());
    libraries
}

fn is_install(path: &Path) -> bool {
    path.join("common").is_dir() && path.join("localisation").is_dir()
}

/// Values of every `"path" "…"` line, with `\\` unescaped.
fn vdf_paths(vdf: &str) -> Vec<String> {
    vdf.lines()
        .filter_map(|line| {
            let rest = line.trim_start().strip_prefix("\"path\"")?;
            let value = rest.trim().strip_prefix('"')?.strip_suffix('"')?;
            Some(value.replace("\\\\", "\\"))
        })
        .collect()
}

fn push_unique(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.contains(&path) {
        paths.push(path);
    }
}
