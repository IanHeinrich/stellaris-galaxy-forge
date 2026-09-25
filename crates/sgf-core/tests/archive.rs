//! The save listing on the committed save, and Steam Cloud detection on a synthetic
//! Steam layout.
use std::path::{Path, PathBuf};

use sgf_core::archive;
use sgf_core::library::{
    cloud_dirs_under, is_cloud_save_in, list_campaign_saves_in, list_campaigns_in,
};
use sgf_core::session::Session;

use crate::common;

use common::{SAMPLE, SAMPLE_4_5};

/// The folder the committed save sits in, and its parent.
const TESTDATA: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata");
const REPO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");

#[test]
fn each_samples_header_reads_its_revision_dlcs_portrait_and_flag() {
    for (name, path) in [("meta_4_4", SAMPLE), ("meta_4_5", SAMPLE_4_5)] {
        let meta = archive::read_meta_only(path).expect("read the header");
        common::snapshot(name, &format!("{meta:#?}"));
    }
}

#[test]
fn each_samples_galaxy_settings_are_read_without_loading_the_save() {
    for (name, path) in [("galaxy_4_4", SAMPLE), ("galaxy_4_5", SAMPLE_4_5)] {
        let settings = archive::read_galaxy_settings(path).expect("read the galaxy block");
        let session = Session::open(path).expect("open the sample");
        let setup = session.graph.setup.clone().expect("a setup");
        assert_eq!(settings.template.as_deref(), Some(setup.template.as_str()));
        assert_eq!(settings.num_empires, Some(setup.num_empires));
        assert_eq!(settings.num_hyperlanes, Some(setup.num_hyperlanes));
        common::snapshot(name, &format!("{settings:#?}"));
    }
}

#[test]
fn a_gamestate_without_a_top_level_galaxy_block_reads_as_no_settings() {
    let raw = archive::read_sav(SAMPLE).expect("read the sample save");
    let gamestate = String::from_utf8(raw.gamestate).expect("ASCII gamestate");
    let start = gamestate.find("\ngalaxy=\n{").expect("the galaxy block") + 1;
    let end = start + gamestate[start..].find("\n}\n").expect("its closing brace") + 3;
    // Only a nested `galaxy` and one in a quoted brace are left for the reader to pass over.
    let edited = format!(
        "{}x={{ galaxy={{ template=\"inner\" }} }}\ny=\"}} galaxy={{\"\n{}",
        &gamestate[..start],
        &gamestate[end..]
    );
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("no-galaxy.sav");
    archive::write_sav(&path, std::iter::once(edited.as_bytes()), &raw.meta).expect("write");
    let settings = archive::read_galaxy_settings(&path).expect("read");
    assert_eq!(settings, archive::GalaxySettings::default());
}

#[test]
fn the_committed_saves_header_reads_every_field() {
    let meta = archive::read_sav(format!("{TESTDATA}/4.4-early.sav"))
        .expect("read the sample save")
        .meta;
    let meta = archive::parse_meta(&meta).expect("parse the header");
    assert_eq!(meta.name, "United Nations of Earth 2");
    assert_eq!(meta.date, "2206.11.16");
    assert_eq!(meta.version, "Pegasus v4.4.6");
    assert!(!meta.ironman, "the sample save carries no `ironman=yes`");
    assert_eq!(meta.planets, Some(1));
    assert_eq!(meta.fleets, Some(15));
    assert_eq!(meta.color.as_deref(), Some("blue"));
}

#[test]
fn a_campaign_folder_lists_its_saves_and_groups_under_its_parent() {
    let saves = list_campaign_saves_in(Path::new(TESTDATA), false);
    // Every `.sav` in the folder and nothing else, counted from the folder so that adding
    // a fixture does not fail a test about listing.
    let on_disk = std::fs::read_dir(TESTDATA)
        .expect("read testdata")
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == "sav"))
        .count();
    assert_eq!(saves.len(), on_disk, "{saves:#?}");
    assert!(
        saves.windows(2).all(|p| p[0].modified >= p[1].modified),
        "newest first: {saves:#?}"
    );
    for save in &saves {
        assert_eq!(save.campaign, "testdata");
        assert!(!save.cloud);
        assert!(save.size > 0 && save.modified > 0);
    }
    let save = saves
        .iter()
        .find(|s| s.file_name == "4.4-early.sav")
        .unwrap_or_else(|| panic!("no 4.4 sample in {saves:#?}"));
    let meta = save.meta.as_ref().expect("the sample save has a header");
    assert_eq!(meta.name, "United Nations of Earth 2");
    assert_eq!(meta.date, "2206.11.16");
    assert_eq!(meta.version, "Pegasus v4.4.6");
    assert_eq!((meta.planets, meta.fleets), (Some(1), Some(15)));
    let cygnus = saves
        .iter()
        .find(|s| s.file_name == "4.5-day-one.sav")
        .unwrap_or_else(|| panic!("no 4.5 sample in {saves:#?}"));
    let meta = cygnus.meta.as_ref().expect("the 4.5 sample has a header");
    assert_eq!(meta.name, "Test Empire");
    assert_eq!(meta.version, "Cygnus v4.5.0");

    // The checkout decides which sample is the newer file, so the campaign is checked
    // against whichever save the listing put first.
    let campaigns = list_campaigns_in(&[(PathBuf::from(REPO), false)]);
    let testdata = campaigns
        .iter()
        .find(|c| c.name == "testdata")
        .unwrap_or_else(|| panic!("no testdata campaign in {campaigns:#?}"));
    let newest = &saves[0];
    assert_eq!(testdata.files as usize, on_disk);
    assert_eq!(testdata.newest, newest.modified);
    assert_eq!(
        testdata.empire.as_deref(),
        newest.meta.as_ref().map(|m| m.name.as_str())
    );
    assert_eq!(testdata.meta.as_ref(), newest.meta.as_ref());
    assert!(!testdata.cloud);
}

#[test]
fn cloud_dirs_are_found_per_account_and_paths_under_them_detected() {
    let steam = tempfile::tempdir().unwrap();
    let cloud = steam.path().join("userdata/123/281990/remote/save games");
    std::fs::create_dir_all(cloud.join("empire_1")).unwrap();
    std::fs::create_dir_all(steam.path().join("userdata/456/570/remote")).unwrap();
    let elsewhere = tempfile::tempdir().unwrap();

    let roots = [steam.path().to_path_buf(), elsewhere.path().to_path_buf()];
    let dirs = cloud_dirs_under(&roots);
    assert_eq!(dirs, vec![cloud.clone()]);
    assert!(cloud_dirs_under(&[]).is_empty());

    let existing = cloud.join("empire_1/2206.11.16.sav");
    std::fs::write(&existing, b"").unwrap();
    assert!(is_cloud_save_in(&existing, &dirs));
    assert!(
        is_cloud_save_in(&cloud.join("empire_1/not-yet-written.sav"), &dirs),
        "a file about to be written counts by its parent"
    );
    assert!(!is_cloud_save_in(
        &elsewhere.path().join("2206.11.16.sav"),
        &dirs
    ));
    assert!(!is_cloud_save_in(
        Path::new("nowhere/2206.11.16.sav"),
        &dirs
    ));
    assert!(!is_cloud_save_in(&existing, &[PathBuf::from("nowhere")]));
}
