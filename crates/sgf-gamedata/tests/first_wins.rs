//! A key defined in files of different names across the install and two mods: the game
//! keeps the first definition in `common/solar_system_initializers` and
//! `common/scripted_variables`, and the last everywhere else.

use crate::common;

use std::fs;
use std::path::Path;

use sgf_gamedata::{Diagnostic, GameData};

fn initializer(class: &str) -> String {
    format!("fx_home = {{\n\tclass = {class}\n\tusage = misc_system_init\n}}\n")
}

fn star(class: &str) -> String {
    format!("sc_fx = {{\n\tclass = {class}\n\tplanet = {{ key = pc_fx_star }}\n}}\n")
}

fn variable(value: u32) -> String {
    format!("@fx_count = {value}\n")
}

/// Vanilla's files, then mod `early`'s, which sort first, then mod `late`'s, which sort last.
fn layered() -> (tempfile::TempDir, GameData) {
    let dir = tempfile::tempdir().expect("temp dir");
    let install = dir.path().join("install");
    let user_dir = dir.path().join("user");
    let write = |root: &Path, rel: &str, text: &str| {
        let file = root.join(rel);
        fs::create_dir_all(file.parent().expect("a directory")).expect("the install tree");
        fs::write(file, text).expect("an install file");
    };
    write(
        &install,
        "localisation/english/fx_l_english.yml",
        "l_english:\n",
    );
    write(
        &install,
        "common/solar_system_initializers/fx_home.txt",
        &initializer("sc_vanilla"),
    );
    write(
        &install,
        "common/star_classes/fx_stars.txt",
        &star("vanilla_star"),
    );
    write(
        &install,
        "common/scripted_variables/fx_vars.txt",
        &variable(1),
    );
    common::add_mod(
        &user_dir,
        "early",
        &[
            (
                "common/solar_system_initializers/!fx_home_ow.txt",
                &initializer("sc_early"),
            ),
            ("common/star_classes/!fx_stars_ow.txt", &star("early_star")),
            ("common/scripted_variables/!fx_vars_ow.txt", &variable(2)),
        ],
    );
    common::add_mod(
        &user_dir,
        "late",
        &[
            (
                "common/solar_system_initializers/zz_fx_home.txt",
                &initializer("sc_late"),
            ),
            ("common/star_classes/zz_fx_stars.txt", &star("late_star")),
            ("common/scripted_variables/zz_fx_vars.txt", &variable(3)),
        ],
    );
    common::enable(&user_dir, &["early", "late"]);
    let gd = common::load_tree(&install, Some(&user_dir), true);
    (dir, gd)
}

/// The override reports for `key`, each as the losing and the winning file's name.
fn overrides(gd: &GameData, key: &str) -> Vec<(String, String)> {
    let name = |file: &Path| file.file_name().unwrap().to_string_lossy().into_owned();
    gd.diagnostics
        .iter()
        .filter_map(|d| match d {
            Diagnostic::Override { key: k, from, to } if k == key => Some((name(from), name(to))),
            _ => None,
        })
        .collect()
}

#[test]
fn the_first_initializer_and_variable_win_and_the_last_star_class() {
    let (_dir, gd) = layered();

    let home = gd.initializers.get("fx_home").expect("fx_home");
    assert_eq!(home.class.as_deref(), Some("sc_early"));
    assert_eq!(home.source.file_name().unwrap(), "!fx_home_ow.txt");
    assert_eq!(
        overrides(&gd, "fx_home"),
        [
            ("fx_home.txt".to_owned(), "!fx_home_ow.txt".to_owned()),
            ("zz_fx_home.txt".to_owned(), "!fx_home_ow.txt".to_owned()),
        ],
        "each later definition is reported against the one the game keeps"
    );

    assert_eq!(gd.variables.get("fx_count"), Some("2"));

    let star = gd.star_classes.get("sc_fx").expect("sc_fx");
    assert_eq!(star.class, "late_star");
    assert_eq!(
        overrides(&gd, "sc_fx"),
        [
            ("!fx_stars_ow.txt".to_owned(), "fx_stars.txt".to_owned()),
            ("fx_stars.txt".to_owned(), "zz_fx_stars.txt".to_owned()),
        ]
    );
}
