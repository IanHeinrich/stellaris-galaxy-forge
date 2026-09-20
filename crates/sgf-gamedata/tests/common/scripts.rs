//! The fixture scenario and the readers the script test binaries share.

use std::fs;

use sgf_gamedata::scripts::{
    ScenarioOwners, ScenarioSystem, ScriptRow, ScriptRowKind, ScriptSite, SystemScripts,
};
use sgf_gamedata::{GameData, LoadOptions};

/// The scenario the fixture describes: a two-system mod empire, a vanilla
/// fallen empire, a system whose owner is a scope, and a plain one.
pub const SCENARIO: [ScenarioSystem<'static>; 5] = [
    sys(1, "empire_capital_init"),
    sys(2, "empire_colony_init"),
    sys(3, "fallen_home"),
    sys(4, "scoped_owner_init"),
    sys(5, "basic_init_01"),
];

/// A scenario system that names an initializer and carries no effect.
pub const fn sys(id: u32, initializer: &str) -> ScenarioSystem<'_> {
    ScenarioSystem {
        id,
        initializer: Some(initializer),
        effect: None,
    }
}

pub fn owners(gd: &GameData) -> ScenarioOwners {
    gd.scenario_owners(&SCENARIO)
}

pub fn capital_scripts(gd: &GameData) -> SystemScripts {
    gd.system_scripts(1, Some("empire_capital_init"), None)
}

pub fn row<'a>(scripts: &'a SystemScripts, kind: ScriptRowKind, name: &str) -> &'a ScriptRow {
    scripts
        .rows
        .iter()
        .find(|r| r.kind == kind && r.name == name)
        .unwrap_or_else(|| panic!("no {kind:?} row {name}: {:#?}", scripts.rows))
}

/// The site a one-site row is all about, or the first of several.
pub fn site(row: &ScriptRow) -> &ScriptSite {
    row.sites.first().expect("every row has a site")
}

pub fn names(scripts: &SystemScripts) -> Vec<&str> {
    scripts.rows.iter().map(|r| r.name.as_str()).collect()
}

/// The fixture install plus one mod carrying `files`, each a path under the
/// mod root and the text to write there.
pub fn install_with_mod(files: &[(&str, &str)]) -> (tempfile::TempDir, GameData) {
    let user_dir = tempfile::tempdir().expect("temp dir");
    let root = user_dir.path();
    fs::create_dir_all(root.join("mod/many")).expect("mod tree");
    fs::write(
        root.join("dlc_load.json"),
        br#"{"disabled_dlcs":[],"enabled_mods":["mod/many.mod"]}"#,
    )
    .expect("dlc_load");
    fs::write(
        root.join("mod/many.mod"),
        b"name=\"Many\"\npath=\"mod/many\"\nsupported_version=\"v9.9.*\"\n",
    )
    .expect("descriptor");
    for (rel, text) in files {
        let file = root.join("mod/many").join(rel);
        fs::create_dir_all(file.parent().expect("a directory")).expect("mod tree");
        fs::write(file, text).expect("mod file");
    }

    let opts = LoadOptions {
        install: Some(super::fixture("install")),
        user_dir: Some(root.to_path_buf()),
        language: "english".to_owned(),
        mods: true,
    };
    let gd = sgf_gamedata::load(&opts, &mut |_| {}).expect("loads");
    (user_dir, gd)
}
