//! Where the game is: an explicit path, else every Steam library's
//! `steamapps/common/Stellaris`.

use std::fs;
use std::path::{Path, PathBuf};

use sgf_core::library::{self, UserDir, UserDirLookup};

use crate::{GameData, LoadError};

const STELLARIS: [&str; 3] = ["steamapps", "common", "Stellaris"];

/// The launcher's settings file in the game root.
pub const LAUNCHER_SETTINGS: &str = "launcher-settings.json";

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
    launcher_setting(install, "rawVersion")
}

/// `"gameDataPath"` from `launcher-settings.json` in the game root, as written: where the
/// launcher keeps the user folder.
pub fn game_data_path(install: &Path) -> Option<String> {
    launcher_setting(install, "gameDataPath")
}

/// The string `key` of `launcher-settings.json` in the game root.
fn launcher_setting(install: &Path, key: &str) -> Option<String> {
    let text = fs::read_to_string(install.join(LAUNCHER_SETTINGS)).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    json.get(key)?.as_str().map(str::to_owned)
}

/// The user folder: `chosen`, else the one the launcher settings of `install` name, else
/// the default ([`library::resolve_user_dir`]).
pub fn resolve_user_dir(chosen: Option<&Path>, install: Option<&Path>) -> UserDirLookup {
    let game_data_path = match chosen {
        Some(_) => None,
        None => install.and_then(game_data_path),
    };
    library::resolve_user_dir(chosen, game_data_path.as_deref())
}

/// The user folder a listing reads: `chosen`, else the loaded game data's, else the one the
/// launcher settings of `install` (discovered through Steam when `None`) name.
pub fn user_dir(
    gd: Option<&GameData>,
    chosen: Option<&Path>,
    install: Option<&Path>,
) -> Option<UserDir> {
    if let (None, Some(gd)) = (chosen, gd) {
        return gd.layout.user_dir.clone();
    }
    let found = match (chosen, install) {
        (None, None) => find_install(None).ok(),
        _ => None,
    };
    resolve_user_dir(chosen, install.or(found.as_deref())).dir
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
