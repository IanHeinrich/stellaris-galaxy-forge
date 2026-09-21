//! The enabled mod set in load order, from the launcher's files under the
//! user data dir (`docs/game-data-notes.md`, "Where mods are registered").

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use sgf_core::cst::{self, Node};

use crate::Diagnostic;

/// Where Steam unpacks workshop items for Stellaris (app id 281990).
const WORKSHOP_CONTENT: &str = "steamapps/workshop/content/281990";
/// Paint a Galaxy's Steam Workshop item.
pub const PAINT_MOD_WORKSHOP_ID: &str = "3532904115";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModInfo {
    /// The `.mod` file's stem, `ugc_1121692237`.
    pub id: String,
    pub name: String,
    /// The mod's content directory, `None` when it exists nowhere.
    pub dir: Option<PathBuf>,
    pub replace_paths: Vec<String>,
    pub status: ModStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModStatus {
    Loaded,
    Missing,
}

impl ModStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Loaded => "loaded",
            Self::Missing => "missing",
        }
    }
}

/// Where Paint a Galaxy is on this machine and whether the playset loads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaintMod {
    /// The mod's content directory, `None` when the launcher lists it but its files are gone.
    pub dir: Option<PathBuf>,
    pub enabled: bool,
}

/// Paint a Galaxy among `enabled` and `installed`: the Workshop item by id, or a copy
/// of any provenance by name. Steam unpacks a new subscription into a library before
/// the launcher has registered it, so the Workshop folder counts as installed too.
/// `None` when neither knows of a copy.
pub fn find_paint_mod(
    installed: &[ModInfo],
    enabled: &[ModInfo],
    libraries: &[PathBuf],
) -> Option<PaintMod> {
    let in_playset = enabled.iter().any(is_paint_mod);
    let mut copies = enabled.iter().chain(installed).filter(|m| is_paint_mod(m));
    let downloaded = || {
        libraries
            .iter()
            .map(|lib| lib.join(WORKSHOP_CONTENT).join(PAINT_MOD_WORKSHOP_ID))
            .find(|p| p.is_dir())
    };
    match copies.next() {
        Some(first) => Some(PaintMod {
            dir: first
                .dir
                .clone()
                .or_else(|| copies.find_map(|m| m.dir.clone()))
                .or_else(downloaded),
            enabled: in_playset,
        }),
        None => downloaded().map(|dir| PaintMod {
            dir: Some(dir),
            enabled: false,
        }),
    }
}

fn is_paint_mod(m: &ModInfo) -> bool {
    m.id.strip_prefix("ugc_") == Some(PAINT_MOD_WORKSHOP_ID)
        || m.name.to_lowercase().contains("paint a galaxy")
}

#[derive(Deserialize)]
struct DlcLoad {
    #[serde(default)]
    enabled_mods: Vec<String>,
}

#[derive(Deserialize)]
struct RegistryEntry {
    #[serde(default, rename = "dirPath")]
    dir_path: Option<String>,
    #[serde(default, rename = "gameRegistryId")]
    game_registry_id: Option<String>,
}

#[derive(Default)]
struct Descriptor {
    name: Option<String>,
    path: Option<String>,
    remote_file_id: Option<String>,
    replace_paths: Vec<String>,
}

/// `dlc_load.json`'s `enabled_mods` in order, each resolved to a directory
/// through its descriptor, then `mods_registry.json`, then the Workshop
/// folder of every Steam library in `libraries`.
pub fn enabled_mods(
    user_dir: &Path,
    libraries: &[PathBuf],
    diagnostics: &mut Vec<Diagnostic>,
) -> Vec<ModInfo> {
    let entries = enabled_entries(user_dir, diagnostics);
    if entries.is_empty() {
        return Vec::new();
    }
    let registry = registry_dirs(user_dir, diagnostics);
    entries
        .iter()
        .map(|entry| resolve(user_dir, entry, &registry, libraries, diagnostics))
        .collect()
}

/// Every mod registered under `user_dir/mod`, enabled or not, by descriptor file name.
/// The launcher writes one `.mod` there per installed mod; `enabled_mods` is the subset
/// `dlc_load.json` names, in load order.
pub fn installed_mods(
    user_dir: &Path,
    libraries: &[PathBuf],
    diagnostics: &mut Vec<Diagnostic>,
) -> Vec<ModInfo> {
    let mut entries: Vec<String> = fs::read_dir(user_dir.join("mod"))
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|e| e == "mod"))
        .filter_map(|p| Some(format!("mod/{}", p.file_name()?.to_str()?)))
        .collect();
    entries.sort();
    let registry = registry_dirs(user_dir, diagnostics);
    entries
        .iter()
        .map(|entry| resolve(user_dir, entry, &registry, libraries, diagnostics))
        .collect()
}

fn enabled_entries(user_dir: &Path, diagnostics: &mut Vec<Diagnostic>) -> Vec<String> {
    let file = user_dir.join("dlc_load.json");
    let text = match fs::read_to_string(&file) {
        Ok(text) => text,
        Err(_) => return Vec::new(),
    };
    match serde_json::from_str::<DlcLoad>(&text) {
        Ok(load) => load.enabled_mods,
        Err(e) => {
            diagnostics.push(Diagnostic::Unreadable {
                file,
                reason: e.to_string(),
            });
            Vec::new()
        }
    }
}

/// `gameRegistryId → dirPath` from `mods_registry.json`, empty when absent.
fn registry_dirs(user_dir: &Path, diagnostics: &mut Vec<Diagnostic>) -> Vec<(String, PathBuf)> {
    let file = user_dir.join("mods_registry.json");
    let text = match fs::read_to_string(&file) {
        Ok(text) => text,
        Err(_) => return Vec::new(),
    };
    match serde_json::from_str::<std::collections::HashMap<String, RegistryEntry>>(&text) {
        Ok(entries) => entries
            .into_values()
            .filter_map(|e| Some((e.game_registry_id?, PathBuf::from(e.dir_path?))))
            .collect(),
        Err(e) => {
            diagnostics.push(Diagnostic::Unreadable {
                file,
                reason: e.to_string(),
            });
            Vec::new()
        }
    }
}

fn resolve(
    user_dir: &Path,
    entry: &str,
    registry: &[(String, PathBuf)],
    libraries: &[PathBuf],
    diagnostics: &mut Vec<Diagnostic>,
) -> ModInfo {
    let file = user_dir.join(entry);
    let id = file
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| entry.to_owned());
    let descriptor = read_descriptor(&file, diagnostics);
    let name = descriptor.name.clone().unwrap_or_else(|| id.clone());
    let candidates = descriptor
        .path
        .iter()
        .map(|p| user_dir.join(p))
        .chain(
            registry
                .iter()
                .filter(|(registry_id, _)| registry_id == entry)
                .map(|(_, dir)| dir.clone()),
        )
        .chain(descriptor.remote_file_id.iter().flat_map(|remote| {
            libraries
                .iter()
                .map(move |lib| lib.join(WORKSHOP_CONTENT).join(remote))
        }));
    let dir = candidates.into_iter().find(|p| p.is_dir());
    let status = if dir.is_some() {
        ModStatus::Loaded
    } else {
        diagnostics.push(Diagnostic::ModMissing {
            id: id.clone(),
            name: name.clone(),
        });
        ModStatus::Missing
    };
    ModInfo {
        id,
        name,
        dir,
        replace_paths: descriptor.replace_paths,
        status,
    }
}

fn read_descriptor(file: &Path, diagnostics: &mut Vec<Diagnostic>) -> Descriptor {
    let bytes = match fs::read(file) {
        Ok(bytes) => bytes,
        Err(e) => {
            diagnostics.push(Diagnostic::Unreadable {
                file: file.to_path_buf(),
                reason: e.to_string(),
            });
            return Descriptor::default();
        }
    };
    match cst::parse_script(&bytes, 0) {
        Ok(root) => descriptor_fields(&root, &bytes),
        Err(e) => {
            diagnostics.push(Diagnostic::ParseError {
                file: file.to_path_buf(),
                offset: e.offset,
                reason: e.reason.to_owned(),
            });
            Descriptor::default()
        }
    }
}

fn descriptor_fields(root: &Node, src: &[u8]) -> Descriptor {
    let scalar = |key: &str| root.find(key, src)?.scalar_str(src).map(str::to_owned);
    Descriptor {
        name: scalar("name"),
        path: scalar("path"),
        remote_file_id: scalar("remote_file_id"),
        replace_paths: root
            .find_all("replace_path", src)
            .filter_map(|n| n.scalar_str(src))
            .map(str::to_owned)
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(id: &str, name: &str, dir: Option<&str>) -> ModInfo {
        ModInfo {
            id: id.to_owned(),
            name: name.to_owned(),
            dir: dir.map(PathBuf::from),
            replace_paths: Vec::new(),
            status: if dir.is_some() {
                ModStatus::Loaded
            } else {
                ModStatus::Missing
            },
        }
    }

    #[test]
    fn paint_a_galaxy_is_found_by_workshop_id_or_name_and_the_playset_says_enabled() {
        let other = info("ugc_1121692237", "UI Overhaul Dynamic", Some("/mods/ui"));
        let workshop = info("ugc_3532904115", "PaG", Some("/workshop/3532904115"));
        let local = info("local_pag", "Paint A Galaxy (dev copy)", Some("/mods/pag"));
        let found = |dir: &str, enabled: bool| {
            Some(PaintMod {
                dir: Some(PathBuf::from(dir)),
                enabled,
            })
        };

        assert_eq!(find_paint_mod(std::slice::from_ref(&other), &[], &[]), None);
        let installed = [other.clone(), workshop.clone()];
        assert_eq!(
            find_paint_mod(&installed, std::slice::from_ref(&other), &[]),
            found("/workshop/3532904115", false)
        );
        assert_eq!(
            find_paint_mod(&installed, std::slice::from_ref(&workshop), &[]),
            found("/workshop/3532904115", true)
        );
        assert_eq!(
            find_paint_mod(std::slice::from_ref(&local), &[], &[]),
            found("/mods/pag", false)
        );

        let missing = info("ugc_3532904115", "Paint a Galaxy", None);
        assert_eq!(
            find_paint_mod(
                std::slice::from_ref(&missing),
                std::slice::from_ref(&missing),
                &[]
            ),
            Some(PaintMod {
                dir: None,
                enabled: true,
            })
        );
    }

    #[test]
    fn a_fresh_workshop_download_counts_as_installed_before_the_launcher_lists_it() {
        let library = tempfile::tempdir().unwrap();
        let unpacked = library
            .path()
            .join(WORKSHOP_CONTENT)
            .join(PAINT_MOD_WORKSHOP_ID);
        let libraries = [library.path().to_path_buf()];

        assert_eq!(find_paint_mod(&[], &[], &libraries), None);

        fs::create_dir_all(&unpacked).unwrap();
        assert_eq!(
            find_paint_mod(&[], &[], &libraries),
            Some(PaintMod {
                dir: Some(unpacked.clone()),
                enabled: false,
            })
        );

        let listed = info("ugc_3532904115", "Paint a Galaxy", None);
        assert_eq!(
            find_paint_mod(
                std::slice::from_ref(&listed),
                std::slice::from_ref(&listed),
                &libraries
            ),
            Some(PaintMod {
                dir: Some(unpacked),
                enabled: true,
            })
        );
    }
}
