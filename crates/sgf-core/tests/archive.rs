//! The save listing on the committed save, and Steam Cloud detection on a synthetic
//! Steam layout.
use std::path::{Path, PathBuf};

use sgf_core::archive;
use sgf_core::library::{
    cloud_dirs_under, is_cloud_save_in, list_campaign_saves_in, list_campaigns_in,
};

/// The folder the committed save sits in, and its parent.
const TESTDATA: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata");
const REPO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");

#[test]
fn the_committed_saves_header_reads_every_field() {
    let meta = archive::read_sav(format!("{TESTDATA}/2206.11.16.sav"))
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
    assert_eq!(saves.len(), 2, "{saves:#?}");
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
        .find(|s| s.file_name == "2206.11.16.sav")
        .unwrap_or_else(|| panic!("no 4.4 sample in {saves:#?}"));
    let meta = save.meta.as_ref().expect("the sample save has a header");
    assert_eq!(meta.name, "United Nations of Earth 2");
    assert_eq!(meta.date, "2206.11.16");
    assert_eq!(meta.version, "Pegasus v4.4.6");
    assert_eq!((meta.planets, meta.fleets), (Some(1), Some(15)));
    let cygnus = saves
        .iter()
        .find(|s| s.file_name == "2201.03.25.sav")
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
    assert_eq!(testdata.files, 2);
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
