//! Naming a new nebula: from the save's pool of unused nebula names first, then from the
//! install's lists less the names the document's nebulae hold, then from no one. On a
//! hand-written install, the real one and the 4.5 sample save and a scenario.

use crate::common;

use std::fs;
use std::sync::Arc;

use sgf_core::archive;
use sgf_core::document::Document;
use sgf_core::ops::free_nebula_names;
use sgf_core::session::Session;
use sgf_gamedata::GameData;
use sgf_gamedata::naming::{pick_nebula_name, pick_pooled_nebula_name};

const SAMPLE_4_5: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/2201.03.25.sav");
const SCENARIO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/2206.11.16.scenario.txt"
);
/// A nebula of the 4.5 sample, and of the scenario, which is the 4.4 sample's galaxy.
const HELD_4_5: &str = "Demons_Eye_Nebula";
const HELD_SCENARIO: &str = "Phantom_Streak_Miasma";
const FREE: &str = "Fx_Cloud";

/// An install whose only files are two `common/random_names` files.
fn install_naming(nebulae: &[&str]) -> (tempfile::TempDir, GameData) {
    let dir = tempfile::tempdir().expect("temp dir");
    let install = dir.path().join("install");
    let names = install.join("common/random_names");
    fs::create_dir_all(names.join("base")).unwrap();
    let list: String = nebulae.iter().map(|n| format!("\t\"{n}\"\n")).collect();
    fs::write(
        names.join("base/00_names.txt"),
        format!("star_names = {{\n\tFx_Star\n}}\nnebula_names = {{\n{list}}}\n"),
    )
    .unwrap();
    fs::write(
        names.join("01_more.txt"),
        format!("nebula_names = {{\n{list}\tFx_Mist\n}}\n"),
    )
    .unwrap();
    fs::create_dir_all(install.join("localisation/english")).unwrap();
    fs::write(
        install.join("localisation/english/fx_l_english.yml"),
        "l_english:\n",
    )
    .unwrap();
    let opts = sgf_gamedata::LoadOptions {
        install: Some(install),
        user_dir: Some(dir.path().join("user")),
        language: "english".to_owned(),
        mods: false,
    };
    let gd = sgf_gamedata::load(&opts, &mut |_| {}).expect("the hand-written install loads");
    (dir, gd)
}

/// The 4.5 sample with its pool of unused nebula names emptied.
fn without_pool() -> Session {
    let raw = archive::read_sav(SAMPLE_4_5).expect("read the 4.5 sample");
    let mut text = String::from_utf8(raw.gamestate).expect("utf-8");
    let head = "\tnebula_names=\n\t{\n";
    let start = text.find(head).expect("the pool") + head.len();
    let end = start + text[start..].find("\t}\n").expect("its end");
    text.replace_range(start..end, "");
    let doc = Document::from_bytes(text.into_bytes(), raw.meta).expect("index the gamestate");
    Session::from_document(None, doc).expect("project the gamestate")
}

#[test]
fn a_hand_written_install_lists_its_nebula_names_once_each_in_file_order() {
    let (_dir, gd) = install_naming(&[FREE, HELD_4_5]);
    assert_eq!(*gd.nebula_names, [FREE, HELD_4_5, "Fx_Mist"]);
    assert_eq!(*gd.star_names, ["Fx_Star"]);
}

#[test]
fn a_save_names_a_nebula_from_its_pool_first() {
    let (_dir, gd) = install_naming(&[FREE]);
    let session = Session::open(SAMPLE_4_5).expect("open the 4.5 sample");
    let pool = free_nebula_names(&session.doc);
    for seed in 0..20 {
        let name = pick_nebula_name(&session, &gd, seed).expect("a name");
        assert_eq!(pick_pooled_nebula_name(&session, seed), Some(name.clone()));
        assert!(pool.contains(&name), "seed {seed}: {name}");
    }
}

#[test]
fn a_spent_pool_falls_back_on_the_install_less_the_names_in_use_then_on_none() {
    let (_dir, gd) = install_naming(&[HELD_4_5, FREE]);
    let session = without_pool();
    assert!(free_nebula_names(&session.doc).is_empty());
    assert_eq!(pick_pooled_nebula_name(&session, 3), None);
    assert!(session.graph.nebulae.iter().any(|n| n.name.key == HELD_4_5));
    for seed in 0..20 {
        let name = pick_nebula_name(&session, &gd, seed).expect("a name from the install");
        assert!(name == FREE || name == "Fx_Mist", "seed {seed}: {name}");
    }

    let mut spent = gd.clone();
    spent.nebula_names = Arc::new(vec![HELD_4_5.to_owned()]);
    assert_eq!(pick_nebula_name(&session, &spent, 3), None);
}

#[test]
fn a_scenario_draws_from_the_install_less_its_own_nebulae() {
    let (_dir, gd) = install_naming(&[HELD_SCENARIO]);
    let doc = Document::load(SCENARIO).expect("load the scenario");
    let session = Session::from_document(None, doc).expect("open the scenario");
    for seed in 0..20 {
        assert_eq!(
            pick_nebula_name(&session, &gd, seed).as_deref(),
            Some("Fx_Mist"),
            "seed {seed}"
        );
    }
    let mut spent = gd.clone();
    spent.nebula_names = Arc::new(vec![HELD_SCENARIO.to_owned()]);
    assert_eq!(pick_nebula_name(&session, &spent, 3), None);
}

#[test]
fn the_real_install_lists_every_name_the_sample_pool_holds() {
    let Some(gd) = common::load_real() else {
        return;
    };
    let session = Session::open(SAMPLE_4_5).expect("open the 4.5 sample");
    let pool = free_nebula_names(&session.doc);
    assert_eq!(
        pool.len() + session.graph.nebulae.len(),
        gd.nebula_names.len()
    );
    for name in pool
        .iter()
        .chain(session.graph.nebulae.iter().map(|n| &n.name.key))
    {
        assert!(gd.nebula_names.contains(name), "{name}");
    }
}
