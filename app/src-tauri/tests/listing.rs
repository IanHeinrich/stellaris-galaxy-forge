//! The listing IPC commands end to end, through the mock runtime: saves, campaigns and
//! scenarios on disk, read without a session.

use serde_json::json;
use sgf_core::archive::GalaxySettings;
use sgf_core::format::scenario::listings::{ScenarioListings, ScenarioSource};
use sgf_core::library::CampaignListing;
use sgf_core::views::{DocumentKind, ErrorKind, SaveFile, SystemDetail};

use crate::common;
use common::{PAINTED, SAMPLE, SCENARIO, invoke, kind, webview};

/// A file's kind is read from its bytes; one that cannot be read, or is too short to tell,
/// gets an error, so the app goes by the name instead.
#[test]
fn a_documents_kind_is_read_from_its_bytes() {
    let w = webview();
    let kind_of = |path: &str| invoke::<DocumentKind>(&w, "document_kind", json!({ "path": path }));
    assert_eq!(kind_of(SAMPLE).expect("a save"), DocumentKind::Save);
    assert_eq!(
        kind_of(SCENARIO).expect("a scenario"),
        DocumentKind::Scenario
    );
    let dir = tempfile::tempdir().expect("tempdir");
    let missing = dir.path().join("gone.sav");
    assert_eq!(kind(kind_of(&missing.to_string_lossy())), ErrorKind::Io);
    let short = dir.path().join("short.sav");
    std::fs::write(&short, b"PK").expect("write");
    assert_eq!(kind(kind_of(&short.to_string_lossy())), ErrorKind::Io);
}

#[test]
fn campaigns_saves_and_scenarios_are_listed_on_a_seeded_root() {
    let w = webview();
    let dir = tempfile::tempdir().expect("tempdir");
    let campaign = dir.path().join("empire_1");
    std::fs::create_dir_all(&campaign).expect("campaign folder");
    std::fs::copy(SAMPLE, campaign.join("2206.11.16.sav")).expect("copy sample");

    let campaigns: Vec<CampaignListing> = invoke(
        &w,
        "list_campaigns",
        json!({ "dirs": [dir.path().to_string_lossy()] }),
    )
    .expect("list campaigns");
    assert_eq!(campaigns.len(), 1, "{campaigns:#?}");
    let listed = &campaigns[0];
    assert_eq!(listed.name, "empire_1");
    assert_eq!(listed.file_names, ["2206.11.16.sav"]);
    assert!(!listed.cloud);
    assert_eq!(listed.empire.as_deref(), Some("United Nations of Earth 2"));
    let meta = listed.meta.as_ref().expect("the newest save's header");
    assert_eq!(meta.date, "2206.11.16");
    assert_eq!((meta.planets, meta.fleets), (Some(1), Some(15)));
    assert_eq!(meta.color.as_deref(), Some("blue"));
    assert!(!meta.ironman);

    let saves: Vec<SaveFile> =
        invoke(&w, "list_campaign_saves", json!({ "dir": listed.dir })).expect("list saves");
    assert_eq!(saves.len(), 1, "{saves:#?}");
    assert_eq!(saves[0].file_name, "2206.11.16.sav");
    assert_eq!(saves[0].campaign, "empire_1");
    assert_eq!(saves[0].meta.as_ref(), listed.meta.as_ref());

    let scenarios = dir.path().join("install/map/setup_scenarios");
    std::fs::create_dir_all(&scenarios).expect("scenario folder");
    std::fs::copy(SCENARIO, scenarios.join("grammar.txt")).expect("copy the fixture");
    let listed: ScenarioListings = invoke(
        &w,
        "list_scenarios",
        json!({
            "installPath": dir.path().join("install").to_string_lossy(),
            "userDir": dir.path().join("user").to_string_lossy(),
        }),
    )
    .expect("list scenarios");
    assert_eq!(listed.diagnostics, Vec::<String>::new());
    let listings = listed.scenarios;
    assert_eq!(listings.len(), 1, "{listings:#?}");
    assert_eq!(listings[0].name, "sgf_grammar");
    assert_eq!(listings[0].systems, 8);
    assert_eq!(listings[0].source, ScenarioSource::Install);
    assert_eq!(listings[0].error, None);
    assert_eq!(listings[0].shadowed_by, None);
}

#[test]
fn save_details_reads_the_setup_screen_without_opening_the_save() {
    let w = webview();
    let settings: GalaxySettings =
        invoke(&w, "save_details", json!({ "path": SAMPLE })).expect("save details");
    assert_eq!(settings.template.as_deref(), Some("large"));
    assert_eq!(settings.shape.as_deref(), Some("elliptical"));
    assert_eq!(settings.num_empires, Some(13));
    assert_eq!(settings.num_hyperlanes, Some(0.75));
    assert_eq!(settings.crises, Some(5.0));
    assert_eq!(settings.ironman, Some(false));
    assert_eq!(
        kind(invoke::<SystemDetail>(&w, "get_system", json!({ "id": 0 }))),
        ErrorKind::NoSession
    );
    assert_eq!(
        kind(invoke::<GalaxySettings>(
            &w,
            "save_details",
            json!({ "path": "no/such/file.sav" })
        )),
        ErrorKind::NotFound
    );
}

#[test]
fn missing_paths_returns_only_the_paths_that_are_not_files() {
    let w = webview();
    let gone = "no/such/file.sav";
    let folder = env!("CARGO_MANIFEST_DIR");
    let missing: Vec<String> = invoke(
        &w,
        "missing_paths",
        json!({ "paths": [SAMPLE, gone, folder] }),
    )
    .expect("missing paths");
    assert_eq!(missing, [gone, folder]);
}

#[test]
fn the_scenarios_beside_a_file_are_listed_without_a_session() {
    let w = webview();
    let dir = tempfile::tempdir().expect("tempdir");
    let mine = dir.path().join("mine.txt");
    std::fs::copy(PAINTED, &mine).expect("copy the painted fixture");
    std::fs::copy(SCENARIO, dir.path().join("grammar.txt")).expect("copy the grammar fixture");
    std::fs::write(dir.path().join("notes.txt"), "not a scenario").expect("write");
    let names: Vec<(String, String)> = invoke(
        &w,
        "sibling_scenario_names",
        json!({ "path": mine.to_string_lossy() }),
    )
    .expect("siblings");
    assert_eq!(
        names,
        [("grammar.txt".to_owned(), "sgf_grammar".to_owned())]
    );
}

#[test]
fn one_scenario_file_says_whether_it_is_for_paint_a_galaxy() {
    let w = webview();
    let painted = |path: &str| invoke::<bool>(&w, "scenario_painted", json!({ "path": path }));
    assert_eq!(painted(PAINTED), Ok(true));
    assert_eq!(painted(SCENARIO), Ok(false));
    assert_eq!(kind(painted("no/such/file.txt")), ErrorKind::Io);
}

/// The campaigns of `listed` that lie in `user`, by name.
fn campaigns_in(listed: &[CampaignListing], user: &std::path::Path) -> Vec<String> {
    listed
        .iter()
        .filter(|c| std::path::Path::new(&c.dir).starts_with(user))
        .map(|c| c.name.clone())
        .collect()
}

/// A listing reads the user folder it is given, else the one the loaded game data read.
#[test]
fn saves_are_listed_from_the_chosen_user_folder() {
    let w = webview();
    let (_dir, install, user) = common::user_folder_tree();
    let user_dir = user.to_string_lossy();
    let save_games = user.join("save games").to_string_lossy().into_owned();

    let listed: Vec<CampaignListing> =
        invoke(&w, "list_campaigns", json!({ "userDir": user_dir })).expect("list campaigns");
    assert_eq!(campaigns_in(&listed, &user), ["empire_1"]);
    let dirs: Vec<String> =
        invoke(&w, "save_dirs", json!({ "userDir": user_dir })).expect("save dirs");
    assert_eq!(dirs, [save_games.as_str()]);

    invoke::<serde_json::Value>(
        &w,
        "load_game_data",
        json!({ "installPath": install.to_string_lossy(), "userDir": user_dir }),
    )
    .unwrap_or_else(|e| panic!("load game data: {}", e.message));
    let listed: Vec<CampaignListing> =
        invoke(&w, "list_campaigns", json!({})).expect("list campaigns");
    assert_eq!(campaigns_in(&listed, &user), ["empire_1"]);
    let dirs: Vec<String> = invoke(&w, "save_dirs", json!({})).expect("save dirs");
    assert_eq!(dirs, [save_games.as_str()]);
}

#[test]
fn a_user_folder_is_one_with_mods_a_playset_or_saves() {
    let w = webview();
    let (dir, _install, user) = common::user_folder_tree();
    let is_user_dir = |path: &std::path::Path| {
        invoke::<bool>(&w, "is_user_dir", json!({ "path": path.to_string_lossy() }))
            .expect("is_user_dir")
    };
    assert!(is_user_dir(&user));
    assert!(!is_user_dir(dir.path()));
    assert!(!is_user_dir(&dir.path().join("missing")));
}

/// Before game data loads, a listing reads the user folder the given install's launcher
/// settings name.
#[test]
fn saves_are_listed_from_the_user_folder_the_install_names() {
    let w = webview();
    let (_dir, install, user) = common::user_folder_tree();
    common::launcher_points_at(&install, &user);
    let install_path = install.to_string_lossy();

    let listed: Vec<CampaignListing> =
        invoke(&w, "list_campaigns", json!({ "installPath": install_path }))
            .expect("list campaigns");
    assert_eq!(campaigns_in(&listed, &user), ["empire_1"]);
    let dirs: Vec<String> =
        invoke(&w, "save_dirs", json!({ "installPath": install_path })).expect("save dirs");
    assert_eq!(
        dirs,
        [user.join("save games").to_string_lossy().into_owned()]
    );
}
