//! Which user folder a load reads its playset from: the one the player chose, the one the
//! install's `launcher-settings.json` names in `gameDataPath`, or the default, and what the
//! load says when that folder holds no playset or `gameDataPath` cannot be followed.

use crate::common;

use std::fs;
use std::path::{Path, PathBuf};

use sgf_core::library::{IgnoredGameDataPath, UserDir, UserDirSource};
use sgf_gamedata::views::GameDataSummary;
use sgf_gamedata::{Diagnostic, GameData};

/// An install under `root` whose launcher settings give `game_data_path`.
fn install_pointing_at(root: &Path, game_data_path: &str) -> PathBuf {
    let install = root.join("install");
    fs::create_dir_all(install.join("common")).expect("the install tree");
    fs::create_dir_all(install.join("localisation/english")).expect("the install tree");
    fs::write(
        install.join("localisation/english/fx_l_english.yml"),
        "l_english:\n",
    )
    .expect("the localisation stub");
    let settings = serde_json::json!({ "rawVersion": "v4.5.2", "gameDataPath": game_data_path });
    fs::write(install.join("launcher-settings.json"), settings.to_string())
        .expect("launcher-settings.json");
    install
}

/// A user folder under `root` whose playset enables the one mod `name`.
fn user_folder(root: &Path, folder: &str, name: &str) -> PathBuf {
    let dir = root.join(folder);
    common::playset(&dir, &[(name, &[])]);
    dir
}

fn mod_names(gd: &GameData) -> Vec<&str> {
    gd.mods.iter().map(|m| m.name.as_str()).collect()
}

fn user_dir_of(gd: &GameData) -> Option<UserDir> {
    let summary = GameDataSummary::from(gd);
    assert_eq!(
        summary.user_dir, gd.layout.user_dir,
        "the summary says so too"
    );
    summary.user_dir
}

/// The user-folder diagnostics a load raised.
fn user_dir_diagnostics(gd: &GameData) -> Vec<&Diagnostic> {
    gd.diagnostics
        .iter()
        .filter(|d| matches!(d.kind(), "no_playset" | "game_data_path_ignored"))
        .collect()
}

#[test]
fn a_game_data_path_that_names_a_folder_is_where_the_playset_is_read() {
    let dir = tempfile::tempdir().expect("temp dir");
    let moved = user_folder(dir.path(), "moved", "moved_mod");
    let install = install_pointing_at(dir.path(), &moved.to_string_lossy());

    let gd = common::load_tree(&install, None, true);
    assert_eq!(mod_names(&gd), ["moved_mod"]);
    assert_eq!(
        user_dir_of(&gd),
        Some(UserDir {
            path: moved,
            source: UserDirSource::LauncherSettings,
        })
    );
    assert_eq!(user_dir_diagnostics(&gd), Vec::<&Diagnostic>::new());
}

#[test]
fn a_chosen_folder_beats_the_launchers() {
    let dir = tempfile::tempdir().expect("temp dir");
    let moved = user_folder(dir.path(), "moved", "moved_mod");
    let chosen = user_folder(dir.path(), "chosen", "chosen_mod");
    let install = install_pointing_at(dir.path(), &moved.to_string_lossy());

    let gd = common::load_tree(&install, Some(&chosen), true);
    assert_eq!(mod_names(&gd), ["chosen_mod"]);
    assert_eq!(
        user_dir_of(&gd),
        Some(UserDir {
            path: chosen,
            source: UserDirSource::Chosen,
        })
    );
    assert_eq!(user_dir_diagnostics(&gd), Vec::<&Diagnostic>::new());
}

/// Mods stay off, so the default folder this machine has is named but not read.
#[test]
fn a_game_data_path_that_cannot_be_followed_falls_back_to_the_default_and_says_so() {
    let dir = tempfile::tempdir().expect("temp dir");
    let gone = dir.path().join("gone");
    for (value, ignored) in [
        (
            "%STEAM_ROOT%/Stellaris".to_owned(),
            IgnoredGameDataPath::UnknownToken {
                value: "%STEAM_ROOT%/Stellaris".to_owned(),
            },
        ),
        (
            gone.to_string_lossy().into_owned(),
            IgnoredGameDataPath::Missing {
                value: gone.to_string_lossy().into_owned(),
                path: gone.clone(),
            },
        ),
    ] {
        let install = install_pointing_at(dir.path(), &value);
        let gd = common::load_tree(&install, None, false);
        assert_eq!(
            user_dir_of(&gd).map(|d| d.source),
            Some(UserDirSource::Default),
            "{value}"
        );
        assert_eq!(
            user_dir_diagnostics(&gd),
            [&Diagnostic::GameDataPathIgnored {
                file: install.join("launcher-settings.json"),
                ignored,
            }]
        );
    }
}

#[test]
fn a_user_folder_without_a_playset_says_so() {
    let dir = tempfile::tempdir().expect("temp dir");
    let empty = dir.path().join("empty");
    fs::create_dir_all(&empty).expect("an empty folder");
    let install = install_pointing_at(dir.path(), "%USER_DOCUMENTS%/Paradox Interactive/Stellaris");

    for chosen in [empty, dir.path().join("missing")] {
        let gd = common::load_tree(&install, Some(&chosen), true);
        assert_eq!(
            user_dir_diagnostics(&gd),
            [&Diagnostic::NoPlayset {
                dir: chosen.clone()
            }]
        );
        let summary = GameDataSummary::from(&gd);
        let view = summary
            .diagnostics
            .iter()
            .find(|d| d.kind == "no_playset")
            .expect("the summary lists it");
        assert!(
            view.message.starts_with("No playset or mods found in "),
            "{}",
            view.message
        );
        assert!(mod_names(&gd).is_empty());
    }

    let gd = common::load_tree(&install, Some(&dir.path().join("missing")), false);
    assert_eq!(
        user_dir_diagnostics(&gd),
        Vec::<&Diagnostic>::new(),
        "only a load with mods looks for a playset"
    );
}
