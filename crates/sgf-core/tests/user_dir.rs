//! Where the Stellaris user folder is: the one the player chose, the launcher's
//! `gameDataPath`, or the default, and which folders count as one.
use std::fs;
use std::path::{Path, PathBuf};

use sgf_core::library::{
    IgnoredGameDataPath, UserDir, UserDirSource, holds_playset, is_user_dir, resolve_user_dir,
};

/// A folder name no machine has, so a path ending in it names no folder.
const NOWHERE: &str = "sgf-no-such-user-folder-4f1c";

fn source(dir: &Option<UserDir>) -> Option<UserDirSource> {
    dir.as_ref().map(|d| d.source)
}

#[test]
fn a_chosen_folder_beats_the_launchers() {
    let chosen = tempfile::tempdir().expect("tempdir");
    let launcher = tempfile::tempdir().expect("tempdir");
    let lookup = resolve_user_dir(
        Some(chosen.path()),
        Some(&launcher.path().to_string_lossy()),
    );
    assert_eq!(
        lookup.dir,
        Some(UserDir {
            path: chosen.path().to_path_buf(),
            source: UserDirSource::Chosen,
        })
    );
    assert_eq!(lookup.ignored, None);
}

#[test]
fn a_game_data_path_that_names_a_folder_is_followed() {
    let launcher = tempfile::tempdir().expect("tempdir");
    let lookup = resolve_user_dir(None, Some(&launcher.path().to_string_lossy()));
    assert_eq!(
        lookup.dir,
        Some(UserDir {
            path: launcher.path().to_path_buf(),
            source: UserDirSource::LauncherSettings,
        })
    );
    assert_eq!(lookup.ignored, None);
}

#[test]
fn a_game_data_path_that_names_no_folder_falls_back_to_the_default() {
    let gone = tempfile::tempdir().expect("tempdir").path().join(NOWHERE);
    let value = gone.to_string_lossy().into_owned();
    let lookup = resolve_user_dir(None, Some(&value));
    assert_eq!(source(&lookup.dir), Some(UserDirSource::Default));
    assert_eq!(
        lookup.ignored,
        Some(IgnoredGameDataPath::Missing { value, path: gone })
    );
}

#[test]
fn the_launchers_tokens_stand_for_the_documents_and_data_folders() {
    for (value, base) in [
        (
            format!("%USER_DOCUMENTS%/{NOWHERE}/Stellaris"),
            dirs::document_dir(),
        ),
        (
            format!(r"$LINUX_DATA_HOME\{NOWHERE}\Stellaris"),
            dirs::data_dir(),
        ),
    ] {
        let Some(base) = base else { continue };
        let lookup = resolve_user_dir(None, Some(&value));
        assert_eq!(source(&lookup.dir), Some(UserDirSource::Default), "{value}");
        assert_eq!(
            lookup.ignored,
            Some(IgnoredGameDataPath::Missing {
                value: value.clone(),
                path: base.join(NOWHERE).join("Stellaris"),
            })
        );
    }
}

#[test]
fn an_unknown_token_falls_back_to_the_default() {
    for value in ["%STEAM_ROOT%/Stellaris", "$LINUX_DATA_HOMES/Stellaris"] {
        let lookup = resolve_user_dir(None, Some(value));
        assert_eq!(source(&lookup.dir), Some(UserDirSource::Default), "{value}");
        assert_eq!(
            lookup.ignored,
            Some(IgnoredGameDataPath::UnknownToken {
                value: value.to_owned()
            })
        );
    }
}

/// The value the launcher writes names the default folder, so the default is read without a
/// word whether or not that folder exists.
#[test]
fn the_stock_game_data_path_is_the_default_folder() {
    let stock = if cfg!(target_os = "linux") {
        "$LINUX_DATA_HOME/Paradox Interactive/Stellaris"
    } else {
        "%USER_DOCUMENTS%/Paradox Interactive/Stellaris"
    };
    let lookup = resolve_user_dir(None, Some(stock));
    assert_eq!(lookup, resolve_user_dir(None, None));
    assert_eq!(lookup.ignored, None);
    if lookup.dir.is_some() {
        assert_eq!(source(&lookup.dir), Some(UserDirSource::Default));
    }
}

#[test]
fn a_user_folder_holds_a_playset_mods_or_saves() {
    let dir = tempfile::tempdir().expect("tempdir");
    let folder = |name: &str| -> PathBuf {
        let path = dir.path().join(name);
        fs::create_dir_all(&path).expect("a folder");
        path
    };
    let empty = folder("empty");
    let playset = folder("playset");
    fs::write(playset.join("dlc_load.json"), "{}").expect("dlc_load.json");
    let mods = folder("mods");
    fs::create_dir(mods.join("mod")).expect("mod/");
    let saves = folder("saves");
    fs::create_dir(saves.join("save games")).expect("save games/");

    let judged = |path: &Path| (is_user_dir(path), holds_playset(path));
    assert_eq!(judged(&empty), (false, false));
    assert_eq!(judged(&dir.path().join(NOWHERE)), (false, false));
    assert_eq!(judged(&playset), (true, true));
    assert_eq!(judged(&mods), (true, true));
    assert_eq!(judged(&saves), (true, false));
}

#[test]
fn the_launchers_tokens_match_in_any_letter_case() {
    let Some(documents) = dirs::document_dir() else {
        return;
    };
    let value = format!("%user_documents%/{NOWHERE}");
    assert_eq!(
        resolve_user_dir(None, Some(&value)).ignored,
        Some(IgnoredGameDataPath::Missing {
            value: value.clone(),
            path: documents.join(NOWHERE),
        })
    );
}

/// Where letter case does not matter, the stock value in another case still names the
/// default folder, so nothing is said about it.
#[cfg(any(windows, target_os = "macos"))]
#[test]
fn the_stock_game_data_path_in_another_case_is_the_default_folder() {
    let lookup = resolve_user_dir(None, Some("%User_Documents%/paradox interactive/STELLARIS"));
    assert_eq!(lookup, resolve_user_dir(None, None));
}

#[test]
fn an_empty_game_data_path_is_none() {
    for value in ["", "  "] {
        assert_eq!(
            resolve_user_dir(None, Some(value)),
            resolve_user_dir(None, None),
            "{value:?}"
        );
    }
}

#[test]
fn a_relative_game_data_path_falls_back_to_the_default() {
    let value = "Paradox Interactive/Stellaris";
    let lookup = resolve_user_dir(None, Some(value));
    assert_eq!(source(&lookup.dir), Some(UserDirSource::Default));
    assert_eq!(
        lookup.ignored,
        Some(IgnoredGameDataPath::Relative {
            value: value.to_owned()
        })
    );
}
