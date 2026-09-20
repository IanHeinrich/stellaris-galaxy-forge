//! Which directories hold static galaxy scenarios, and what the launcher makes
//! of the layer each one is in: load rank, and the `replace_path` that hides the
//! layers below (`docs/game-data-notes.md`, "Override semantics").
//!
//! Reading the files is [`sgf_core::format::scenario::listings`]'s job; this decides which roots
//! it is given.

use std::path::{Path, PathBuf};

use sgf_core::format::scenario::listings::{ScenarioRoot, ScenarioSource};
use sgf_core::library;

use crate::install::discovery;
use crate::install::mods::{self, ModInfo};
use crate::{Diagnostic, GameData};

/// Where a layer keeps its scenarios, and the `replace_path` that hides the layers below.
const SCENARIO_DIR: [&str; 2] = ["map", "setup_scenarios"];

/// Every layer that may hold scenarios, in the order the Open screen lists them. A
/// directory already listed is not listed again, so a user mod the playset enables
/// appears once, among the user's mods.
///
/// Without game data only the user's mods and the install are known; `install_override`
/// and `user_dir_override` say where those are looked for.
pub fn scenario_roots(
    gd: Option<&GameData>,
    install_override: Option<PathBuf>,
    user_dir_override: Option<PathBuf>,
    diagnostics: &mut Vec<Diagnostic>,
) -> Vec<ScenarioRoot> {
    let user_dir = user_dir_override
        .or_else(|| gd.and_then(|gd| gd.layout.user_dir.clone()))
        .or_else(library::paradox_user_dir);
    let install = install_override
        .or_else(|| gd.map(|gd| gd.layout.install.clone()))
        .or_else(|| discovery::find_install(None).ok());
    let enabled: &[ModInfo] = gd.map_or(&[], |gd| gd.mods.as_slice());
    let installed = match (gd, &user_dir) {
        (Some(_), Some(dir)) => {
            mods::installed_mods(dir, &discovery::steam_libraries(), diagnostics)
        }
        _ => Vec::new(),
    };

    let mut roots = Vec::new();
    let mut taken: Vec<PathBuf> = Vec::new();
    let user_mods = user_dir
        .iter()
        .flat_map(|dir| subdirs(&dir.join("mod")))
        .map(|dir| (dir, ScenarioSource::UserMod));
    let others = installed
        .iter()
        .filter_map(|m| m.dir.clone())
        .map(|dir| (dir, ScenarioSource::Mod));
    let playset = enabled
        .iter()
        .filter_map(|m| m.dir.clone())
        .map(|dir| (dir, ScenarioSource::Mod));
    for (dir, source) in user_mods.chain(playset).chain(others) {
        if taken.contains(&dir) {
            continue;
        }
        roots.push(mod_root(&dir, source, &installed, enabled));
        taken.push(dir);
    }
    roots.extend(install.map(|install| ScenarioRoot {
        dir: SCENARIO_DIR.iter().fold(install, |p, part| p.join(part)),
        source: ScenarioSource::Install,
        mod_name: None,
        enabled: true,
        load_rank: Some(0),
        replaces: false,
    }));
    roots.retain(|root| root.dir.is_dir());
    roots
}

/// One mod's root, carrying the playset's verdict on it: an enabled mod loads at its
/// position in the playset, one the launcher leaves out never loads at all.
fn mod_root(
    dir: &Path,
    source: ScenarioSource,
    installed: &[ModInfo],
    enabled: &[ModInfo],
) -> ScenarioRoot {
    let at = enabled.iter().position(|m| m.dir.as_deref() == Some(dir));
    let named = installed
        .iter()
        .chain(enabled)
        .find(|m| m.dir.as_deref() == Some(dir))
        .map(|m| m.name.clone());
    let replace_path = SCENARIO_DIR.join("/");
    ScenarioRoot {
        dir: SCENARIO_DIR
            .iter()
            .fold(dir.to_path_buf(), |p, part| p.join(part)),
        source,
        mod_name: named.or_else(|| dir.file_name().map(|n| n.to_string_lossy().into_owned())),
        enabled: at.is_some(),
        // Rank 0 is the install, so the playset starts at 1.
        load_rank: at.map(|i| u32::try_from(i + 1).unwrap_or(u32::MAX)),
        replaces: at.is_some_and(|i| {
            enabled[i]
                .replace_paths
                .iter()
                .any(|p| p.replace('\\', "/").trim_matches('/') == replace_path)
        }),
    }
}

fn subdirs(dir: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    dirs
}
