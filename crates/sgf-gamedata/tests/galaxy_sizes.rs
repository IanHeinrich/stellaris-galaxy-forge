//! The largest galaxy size `map/setup_scenarios` defines across the install and
//! the enabled mods, read from a throwaway install, then from the real Stellaris
//! install when this machine has one.

mod common;

use std::fs;
use std::path::Path;

use sgf_gamedata::views::{GalaxySizeView, GameDataSummary};
use sgf_gamedata::{GameData, LoadOptions};

fn load(install: &Path, user_dir: &Path, mods: &[&str]) -> GameData {
    let enabled: Vec<String> = mods.iter().map(|m| format!("\"mod/{m}.mod\"")).collect();
    fs::write(
        user_dir.join("dlc_load.json"),
        format!(
            "{{\"disabled_dlcs\":[],\"enabled_mods\":[{}]}}",
            enabled.join(",")
        ),
    )
    .unwrap();
    let opts = LoadOptions {
        install: Some(install.to_path_buf()),
        user_dir: Some(user_dir.to_path_buf()),
        language: "english".to_owned(),
        mods: true,
    };
    sgf_gamedata::load(&opts, &mut |_| {}).expect("the throwaway install loads")
}

fn largest(gd: &GameData) -> Option<GalaxySizeView> {
    GameDataSummary::from(gd).largest_galaxy
}

fn size(name: &str, num_stars: u32) -> String {
    format!(
        "setup_scenario = {{\n\tname = \"{name}\"\n\tpriority = 1\n\tnum_stars = {num_stars}\n\tradius = 450\n}}\n"
    )
}

fn scenarios(root: &Path) -> std::path::PathBuf {
    let dir = root.join("map").join("setup_scenarios");
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn add_mod(user_dir: &Path, name: &str) -> std::path::PathBuf {
    let root = user_dir.join("mod").join(name);
    fs::create_dir_all(&root).unwrap();
    fs::write(
        user_dir.join("mod").join(format!("{name}.mod")),
        format!("name=\"{name}\"\npath=\"mod/{name}\"\n"),
    )
    .unwrap();
    scenarios(&root)
}

#[test]
fn the_largest_size_follows_the_mods_that_add_and_override_sizes() {
    let dir = tempfile::tempdir().expect("temp dir");
    let install = dir.path().join("install");
    let user_dir = dir.path().join("user");
    fs::create_dir_all(install.join("common")).unwrap();
    let english = install.join("localisation").join("english");
    fs::create_dir_all(&english).unwrap();
    fs::write(
        english.join("sizes_l_english.yml"),
        "\u{feff}l_english:\n huge:0 \"Huge\"\n",
    )
    .unwrap();
    let vanilla = scenarios(&install);
    fs::write(vanilla.join("medium.txt"), size("medium", 600)).unwrap();
    fs::write(vanilla.join("huge.txt"), size("huge", 1000)).unwrap();
    let systems: String = (0..1500)
        .map(|i| format!("\tsystem = {{ id = \"{i}\" position = {{ x = 0 y = 0 }} }}\n"))
        .collect();
    fs::write(
        vanilla.join("static_example.txt"),
        format!("static_galaxy_scenario = {{\n\tname = \"Static\"\n{systems}}}\n"),
    )
    .unwrap();

    let bigger = add_mod(&user_dir, "bigger");
    fs::write(bigger.join("gargantuan.txt"), size("gargantuan", 2000)).unwrap();
    let emptied = add_mod(&user_dir, "emptied");
    fs::write(emptied.join("huge.txt"), "").unwrap();
    let shrunk = add_mod(&user_dir, "shrunk");
    fs::write(shrunk.join("huge.txt"), size("huge", 800)).unwrap();

    let huge = GalaxySizeView {
        name: "huge".to_owned(),
        label: "Huge".to_owned(),
        num_stars: 1000,
    };
    assert_eq!(largest(&load(&install, &user_dir, &[])), Some(huge.clone()));
    assert_eq!(
        largest(&load(&install, &user_dir, &["bigger"])),
        Some(GalaxySizeView {
            name: "gargantuan".to_owned(),
            label: "Gargantuan".to_owned(),
            num_stars: 2000,
        })
    );
    assert_eq!(
        largest(&load(&install, &user_dir, &["emptied"])),
        Some(GalaxySizeView {
            name: "medium".to_owned(),
            label: "Medium".to_owned(),
            num_stars: 600,
        })
    );
    assert_eq!(
        largest(&load(&install, &user_dir, &["emptied", "shrunk"])),
        Some(GalaxySizeView {
            num_stars: 800,
            ..huge
        })
    );

    fs::remove_dir_all(&vanilla).unwrap();
    assert_eq!(largest(&load(&install, &user_dir, &[])), None);
}

#[test]
fn the_real_install_s_largest_size_is_huge() {
    let Some(gd) = common::load_real() else {
        return;
    };
    assert_eq!(
        largest(&gd),
        Some(GalaxySizeView {
            name: "huge".to_owned(),
            label: "Huge".to_owned(),
            num_stars: 1000,
        })
    );
}
