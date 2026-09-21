//! Session lifecycle IPC commands end to end, through the mock runtime, on the real sample save.
use std::path::Path;

use serde_json::json;
use sgf_core::export::ExportReport;
use sgf_core::format::save::details::SystemDetails;
use sgf_core::format::scenario::FeZone;
use sgf_core::format::scenario::listings::{ScenarioListings, ScenarioSource};
use sgf_core::library::CampaignListing;
use sgf_core::validate::IssueCode;
use sgf_core::views::{
    DocumentKind, EditResult, ErrorKind, ExportResult, OpenResult, SaveFile, SaveResult, SearchHit,
    SystemDetail,
};
use sgf_gamedata::scripts::{BypassSource, ScenarioBypasses, ScenarioOwners};
use sgf_gamedata::views::GameDataSummary;

mod common;
use common::{SAMPLE, have_install, invoke, invoke_raw, kind, webview};

const GRAMMAR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/scenario_grammar.txt"
);

#[test]
fn open_read_search_close() {
    let w = webview();

    assert_eq!(
        kind(invoke::<SystemDetail>(&w, "get_system", json!({ "id": 0 }))),
        ErrorKind::NoSession
    );
    assert_eq!(
        kind(invoke::<Vec<SearchHit>>(
            &w,
            "search",
            json!({ "query": "gamma", "limit": 5 })
        )),
        ErrorKind::NoSession
    );

    let opened: OpenResult = invoke(&w, "open_save", json!({ "path": SAMPLE })).expect("open");
    assert_eq!(opened.path.as_deref(), Some(SAMPLE));
    assert_eq!(opened.kind, DocumentKind::Save);
    assert!(opened.capabilities.details && !opened.capabilities.create_systems);
    let meta = opened.meta.as_ref().expect("a save has a header");
    assert_eq!(meta.version, "Pegasus v4.4.6");
    assert_eq!(meta.date, "2206.11.16");
    assert_eq!(opened.galaxy.systems.len(), 791);
    assert_eq!(opened.galaxy.components, 3);
    assert_eq!(opened.galaxy.nebulae.len(), 9);
    assert!((opened.galaxy.galaxy_radius - 499.9288).abs() < 1e-9);
    assert_eq!(opened.issues.len(), 6);

    let detail: SystemDetail = invoke(&w, "get_system", json!({ "id": 0 })).expect("system 0");
    assert_eq!(detail.system.name.key, "NAME_Gamma_Refuge");
    assert_eq!(detail.neighbours.len(), 5);
    assert_eq!(detail.neighbours[0].id, 752);
    assert_eq!(detail.neighbours[0].length, 33.0);
    for n in &detail.neighbours {
        assert!(!n.name_key.is_empty(), "{n:?}");
        let distance = n.distance.expect("endpoint exists");
        assert!(
            (distance - n.length).abs() < 1.0,
            "lane 0 -> {}: length {} distance {}",
            n.id,
            n.length,
            distance
        );
    }
    assert_eq!(
        kind(invoke::<SystemDetail>(
            &w,
            "get_system",
            json!({ "id": 999999 })
        )),
        ErrorKind::NotFound
    );

    let hits: Vec<SearchHit> =
        invoke(&w, "search", json!({ "query": "gamma", "limit": 5 })).expect("search");
    assert_eq!(hits[0].id, 0);
    assert!(hits.len() <= 5);

    invoke::<()>(&w, "close_save", json!({})).expect("close");
    assert_eq!(
        kind(invoke::<SystemDetail>(&w, "get_system", json!({ "id": 0 }))),
        ErrorKind::NoSession
    );
    invoke::<()>(&w, "close_save", json!({})).expect("close again");
}

#[test]
fn open_replaces_the_session_and_rejects_a_missing_file() {
    let w = webview();
    invoke::<OpenResult>(&w, "open_save", json!({ "path": SAMPLE })).expect("open");
    let err = invoke::<OpenResult>(&w, "open_save", json!({ "path": "no/such/file.sav" }))
        .expect_err("missing file");
    assert_eq!(err.kind, ErrorKind::NotFound);
    assert!(err.message.contains("file.sav"), "{}", err.message);
    let err = invoke::<OpenResult>(&w, "open_save", json!({ "path": "no/such/scenario.txt" }))
        .expect_err("missing scenario");
    assert_eq!(err.kind, ErrorKind::NotFound);
    // A failed open leaves the previous session in place.
    invoke::<SystemDetail>(&w, "get_system", json!({ "id": 0 })).expect("still open");
}

#[test]
fn list_saves_succeeds_on_any_machine() {
    let w = webview();
    let saves: Vec<SaveFile> = invoke(&w, "list_saves", json!({})).expect("list");
    for s in &saves {
        assert!(s.path.ends_with(&s.file_name), "{s:?}");
    }
    assert!(saves.windows(2).all(|p| p[0].modified >= p[1].modified));
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
    assert_eq!(listed.files, 1);
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
    std::fs::copy(GRAMMAR, scenarios.join("grammar.txt")).expect("copy the fixture");
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
fn save_and_save_as() {
    let w = webview();

    assert_eq!(
        kind(invoke::<SaveResult>(&w, "save", json!({}))),
        ErrorKind::NoSession,
        "save before any open"
    );

    let dir = tempfile::tempdir().expect("tempdir");
    let copy_path = dir.path().join("2206.11.16.sav");
    std::fs::copy(SAMPLE, &copy_path).expect("copy sample");
    let copy_path = copy_path.to_string_lossy().into_owned();

    let opened: OpenResult =
        invoke(&w, "open_save", json!({ "path": copy_path })).expect("open the copy");
    assert!(!opened.cloud, "a temp dir is not Steam Cloud");
    let moved: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "MoveSystem", "id": 0, "x": -150.0, "y": 60.0 } }),
    )
    .expect("move system 0");
    assert!(moved.dirty, "move dirties the session");

    let saved: SaveResult = invoke(&w, "save", json!({})).expect("save in place");
    assert_eq!(saved.path, copy_path, "save writes to the session's path");
    assert!(!saved.dirty, "save clears dirty");
    assert!(!saved.cloud, "a temp dir is not Steam Cloud");
    let backup = saved
        .backup_path
        .as_ref()
        .expect("the file that was there is backed up");
    let backup_name = Path::new(backup)
        .file_name()
        .expect("backup has a file name")
        .to_string_lossy()
        .into_owned();
    let copy_name = Path::new(&copy_path)
        .file_name()
        .expect("copy has a file name")
        .to_string_lossy()
        .into_owned();
    assert!(
        backup_name.starts_with(&copy_name) && backup_name.contains(".bak-"),
        "backup name: {backup_name}"
    );
    assert!(Path::new(backup).exists(), "backup file exists");

    let reopened: OpenResult =
        invoke(&w, "open_save", json!({ "path": copy_path })).expect("reopen the saved copy");
    let system0 = reopened
        .galaxy
        .systems
        .iter()
        .find(|s| s.id == 0)
        .expect("system 0 in the reopened galaxy");
    assert_eq!(system0.x, -150.0, "the move persisted");
    assert_eq!(system0.y, 60.0, "the move persisted");

    let second_path = dir.path().join("moved-elsewhere.sav");
    let second_path = second_path.to_string_lossy().into_owned();
    let saved_as: SaveResult =
        invoke(&w, "save_as", json!({ "path": second_path })).expect("save_as a fresh path");
    assert_eq!(saved_as.path, second_path, "save_as writes to the new path");
    assert_eq!(
        saved_as.backup_path, None,
        "nothing was at the new path to back up"
    );
    assert!(Path::new(&second_path).exists(), "new file exists");
    assert!(!saved_as.cloud, "a temp dir is not Steam Cloud");
    let cloud: bool =
        invoke(&w, "is_cloud_save", json!({ "path": second_path })).expect("is_cloud_save");
    assert!(!cloud, "a temp dir is not Steam Cloud");
}

const SCENARIO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/scenario_grammar.txt"
);

#[test]
fn scenario_documents_open_start_and_export() {
    let w = webview();
    let dir = tempfile::tempdir().expect("tempdir");

    let opened: OpenResult =
        invoke(&w, "open_save", json!({ "path": SCENARIO })).expect("open the scenario");
    assert_eq!(opened.kind, DocumentKind::Scenario);
    assert_eq!(opened.title, "sgf_grammar");
    assert!(opened.meta.is_none(), "a scenario has no save header");
    assert!(opened.capabilities.create_systems && !opened.capabilities.details);
    assert_eq!(opened.galaxy.systems.len(), 8);

    let fresh: OpenResult = invoke(
        &w,
        "new_scenario",
        json!({ "name": "sgf_test", "radius": 300.0, "coreRadius": 75.0 }),
    )
    .expect("new scenario");
    assert!((fresh.galaxy.core_radius - 75.0).abs() < 1e-9);
    assert_eq!(fresh.kind, DocumentKind::Scenario);
    assert_eq!(fresh.title, "sgf_test");
    assert!(fresh.path.is_none(), "never saved");
    assert!(fresh.galaxy.systems.is_empty());
    assert!((fresh.galaxy.galaxy_radius - 300.0).abs() < 1e-9);
    assert_eq!(
        kind(invoke::<SaveResult>(&w, "save", json!({}))),
        ErrorKind::Io,
        "a pathless session cannot save in place"
    );
    let fresh_path = dir
        .path()
        .join("sgf_test.txt")
        .to_string_lossy()
        .into_owned();
    let saved: SaveResult = invoke(&w, "save_as", json!({ "path": fresh_path })).expect("save as");
    assert_eq!(saved.path, fresh_path);
    assert!(!saved.dirty);

    let as_scenario: OpenResult =
        invoke(&w, "open_as_scenario", json!({ "path": SAMPLE })).expect("open as scenario");
    assert_eq!(as_scenario.kind, DocumentKind::Scenario);
    assert_eq!(as_scenario.title, "2206.11.16");
    assert!(as_scenario.path.is_none());
    assert_eq!(as_scenario.galaxy.systems.len(), 791);
    let coded = |code: IssueCode| as_scenario.issues.iter().filter(|i| i.code == code).count();
    assert_eq!(
        coded(IssueCode::ExportDropped),
        1,
        "{:?}",
        as_scenario.issues
    );
    assert_eq!(
        coded(IssueCode::HomeInitializer),
        4,
        "{:?}",
        as_scenario.issues
    );
    assert_eq!(
        kind(invoke::<ExportResult>(
            &w,
            "export_scenario",
            json!({ "path": dir.path().join("x.txt").to_string_lossy() })
        )),
        ErrorKind::Op,
        "only a save exports"
    );
    assert_eq!(
        kind(invoke::<ExportReport>(&w, "preview_export", json!({}))),
        ErrorKind::Op,
        "only a save previews an export"
    );

    invoke::<OpenResult>(&w, "open_save", json!({ "path": SAMPLE })).expect("open the save");
    let preview: ExportReport = invoke(&w, "preview_export", json!({})).expect("preview");
    let out = dir
        .path()
        .join("exported.txt")
        .to_string_lossy()
        .into_owned();
    let exported: ExportResult =
        invoke(&w, "export_scenario", json!({ "path": out })).expect("export");
    assert_eq!(exported.save.path, out);
    assert!(exported.save.backup_path.is_none());
    assert!(!exported.save.dirty, "export leaves the save session clean");
    assert_eq!(exported.report.seats, 17);
    assert_eq!(exported.report.dropped.wormhole_pairs, 6);
    assert_eq!(exported.report.home_initializers.len(), 4);
    assert_eq!(
        preview, exported.report,
        "the preview is the report the write gives"
    );
    let reopened: OpenResult =
        invoke(&w, "open_save", json!({ "path": out })).expect("open the export");
    assert_eq!(reopened.kind, DocumentKind::Scenario);
    assert_eq!(reopened.title, "exported");
    assert_eq!(reopened.galaxy.systems.len(), 791);
}

const PAINTED: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/paint_a_galaxy.txt"
);

#[test]
fn fe_zone_recompute_keeps_the_placed_zones_and_offers_the_rest() {
    let w = webview();
    assert_eq!(
        kind(invoke::<Vec<(u32, Option<FeZone>)>>(
            &w,
            "fe_zone_recompute",
            json!({})
        )),
        ErrorKind::NoSession
    );
    invoke::<OpenResult>(&w, "open_save", json!({ "path": SAMPLE })).expect("open the save");
    assert_eq!(
        kind(invoke::<Vec<(u32, Option<FeZone>)>>(
            &w,
            "fe_zone_recompute",
            json!({})
        )),
        ErrorKind::Op,
        "a save has no zones"
    );

    let opened: OpenResult =
        invoke(&w, "open_save", json!({ "path": PAINTED })).expect("open the painted fixture");
    assert!(opened.painted);
    let entries: Vec<(u32, Option<FeZone>)> =
        invoke(&w, "fe_zone_recompute", json!({})).expect("recompute");
    assert!(!entries.is_empty());
    assert!(
        entries
            .iter()
            .all(|(id, zone)| *id != 9 && *id != 12 && zone.is_some()),
        "{entries:?}"
    );
    let edited: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "SetFeZones", "entries": entries } }),
    )
    .expect("apply the entries");
    assert_eq!(
        edited.entry.description,
        "Recompute automatic fallen empire zones"
    );
    assert!(edited.dirty);
    let again: Vec<(u32, Option<FeZone>)> =
        invoke(&w, "fe_zone_recompute", json!({})).expect("recompute again");
    assert!(
        again.is_empty(),
        "a second pass has nothing to change: {again:?}"
    );
}

#[test]
fn header_empire_counts_sizes_the_keys_by_the_seats_and_the_app_applies_them_as_one_step() {
    let w = webview();
    assert_eq!(
        kind(invoke::<Vec<(String, String)>>(
            &w,
            "header_empire_counts",
            json!({})
        )),
        ErrorKind::NoSession
    );
    invoke::<OpenResult>(&w, "open_save", json!({ "path": SAMPLE })).expect("open the save");
    assert_eq!(
        kind(invoke::<Vec<(String, String)>>(
            &w,
            "header_empire_counts",
            json!({})
        )),
        ErrorKind::Op,
        "a save has no header"
    );

    let opened: OpenResult =
        invoke(&w, "open_save", json!({ "path": PAINTED })).expect("open the painted fixture");
    assert!(
        opened
            .issues
            .iter()
            .any(|issue| issue.code == IssueCode::HeaderEmpireCount),
        "{:?}",
        opened.issues
    );
    let entries: Vec<(String, String)> =
        invoke(&w, "header_empire_counts", json!({})).expect("counts");
    assert_eq!(
        entries,
        [
            ("num_empires".to_owned(), "{ min = 0 max = 3 }".to_owned()),
            ("num_empire_default".to_owned(), "1".to_owned()),
            ("advanced_empire_default".to_owned(), "0".to_owned()),
            ("nomad_empire_default".to_owned(), "0".to_owned()),
            ("nomad_empire_max".to_owned(), "3".to_owned()),
        ]
    );
    let edited: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "SetHeaderKeys", "entries": entries } }),
    )
    .expect("apply the counts");
    assert_eq!(edited.entry.description, "Update empire counts");
    assert!(edited.dirty);
    assert!(
        edited
            .issues
            .iter()
            .all(|issue| issue.code != IssueCode::HeaderEmpireCount),
        "{:?}",
        edited.issues
    );
    assert_eq!(edited.history.undo.len(), 1);
}

#[test]
fn the_scenarios_beside_a_file_are_listed_without_a_session() {
    let w = webview();
    let dir = tempfile::tempdir().expect("tempdir");
    let mine = dir.path().join("mine.txt");
    std::fs::copy(PAINTED, &mine).expect("copy the painted fixture");
    std::fs::copy(GRAMMAR, dir.path().join("grammar.txt")).expect("copy the grammar fixture");
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
fn a_painted_scenarios_wormhole_pairs_are_drawn_without_game_data_and_follow_the_op() {
    let w = webview();
    invoke::<OpenResult>(&w, "open_save", json!({ "path": PAINTED })).expect("open");
    let pairs = |w: &_| -> Vec<(u32, Option<u32>)> {
        let placed: Option<ScenarioBypasses> =
            invoke(w, "get_scenario_bypasses", json!({})).expect("bypasses");
        placed
            .expect("a scenario lists its flagged pairs")
            .bypasses
            .iter()
            .filter(|end| {
                end.source
                    == BypassSource::DayOne {
                        event: "painted_galaxy_wormhole.1".to_owned(),
                    }
            })
            .map(|end| (end.system, end.partner))
            .collect()
    };
    assert_eq!(
        pairs(&w),
        [(7, Some(8)), (8, Some(7)), (12, Some(13)), (13, Some(12))]
    );
    let edited: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "SetWormholePair", "a": 12, "b": 13, "pair": null } }),
    )
    .expect("remove a pair");
    assert!(edited.reclassifies, "the app re-reads the bypasses");
    assert_eq!(pairs(&w), [(7, Some(8)), (8, Some(7))]);
}

#[test]
fn the_paint_a_galaxy_profile_is_an_optional_argument_of_the_scenario_commands() {
    let w = webview();
    let dir = tempfile::tempdir().expect("tempdir");
    let idiom = "value:painted_galaxy_spawn_weight";

    let fresh: OpenResult = invoke(
        &w,
        "new_scenario",
        json!({ "name": "sgf_painted", "radius": 300.0, "coreRadius": 75.0, "profile": "paint_a_galaxy" }),
    )
    .expect("new scenario");
    assert_eq!(fresh.title, "sgf_painted");
    assert!(fresh.painted, "the header names the mod");
    assert!(
        fresh
            .galaxy
            .header
            .iter()
            .any(|f| f.key == "priority" && f.value == "10"),
        "{:?}",
        fresh.galaxy.header
    );
    assert!(
        fresh
            .galaxy
            .header
            .iter()
            .any(|f| f.key == "nomad_empire_max" && f.value == "0"),
        "{:?}",
        fresh.galaxy.header
    );

    let as_scenario: OpenResult = invoke(
        &w,
        "open_as_scenario",
        json!({ "path": SAMPLE, "profile": "paint_a_galaxy" }),
    )
    .expect("open as scenario");
    assert_eq!(as_scenario.galaxy.systems.len(), 791);
    assert!(as_scenario.painted);
    let seated = as_scenario
        .galaxy
        .systems
        .iter()
        .filter(|s| s.spawn_script.is_some())
        .count();
    assert!(seated > 1, "{seated}");
    let refused = invoke_raw(
        &w,
        "open_as_scenario",
        json!({ "path": SAMPLE, "profile": "crayon" }),
    )
    .expect_err("an unknown profile is refused, not read as plain");
    assert!(
        refused.to_string().contains("unknown variant `crayon`"),
        "{refused}"
    );
    let plain: OpenResult =
        invoke(&w, "open_as_scenario", json!({ "path": SAMPLE })).expect("open as scenario");
    assert!(
        plain
            .galaxy
            .systems
            .iter()
            .all(|s| s.spawn_script.is_none())
    );
    assert!(!plain.painted);
    let unpainted: OpenResult = invoke(
        &w,
        "new_scenario",
        json!({ "name": "sgf_plain", "radius": 300.0, "coreRadius": 75.0 }),
    )
    .expect("new scenario");
    assert!(!unpainted.painted);

    let save: OpenResult =
        invoke(&w, "open_save", json!({ "path": SAMPLE })).expect("open the save");
    assert!(!save.painted, "a save is never scanned");
    let painted = dir
        .path()
        .join("painted.txt")
        .to_string_lossy()
        .into_owned();
    invoke::<ExportResult>(
        &w,
        "export_scenario",
        json!({ "path": painted, "profile": "paint_a_galaxy" }),
    )
    .expect("export");
    let text = std::fs::read_to_string(&painted).unwrap();
    assert!(
        text.contains(idiom) && text.contains("painted_galaxy_wormhole_1"),
        "{}",
        &text[..300]
    );
    let exported = dir.path().join("plain.txt").to_string_lossy().into_owned();
    invoke::<ExportResult>(&w, "export_scenario", json!({ "path": exported })).expect("export");
    let text = std::fs::read_to_string(&exported).unwrap();
    assert!(
        !text.contains(idiom)
            && text.starts_with(
                "# Exported by Stellaris Galaxy Forge from 2206.11.16.sav
"
            )
            && text.contains(
                "
static_galaxy_scenario = {
"
            ),
        "{}",
        &text[..300]
    );

    let reopened: OpenResult =
        invoke(&w, "open_save", json!({ "path": painted })).expect("open the painted export");
    assert!(reopened.painted);
    let reopened: OpenResult =
        invoke(&w, "open_save", json!({ "path": exported })).expect("open the plain export");
    assert!(!reopened.painted);
}

/// A scenario has no details sections: a system's planets and resources are what its
/// initializer defines, so this needs the install's definitions.
#[test]
fn a_scenario_systems_details_come_from_its_initializer() {
    if !have_install() {
        return;
    }
    let w = webview();
    // Vanilla only: a mod in the playset may shadow the file that defines the initializer.
    invoke::<GameDataSummary>(&w, "load_game_data", json!({ "mods": false }))
        .expect("load game data");
    invoke::<OpenResult>(&w, "open_save", json!({ "path": SCENARIO })).expect("open the scenario");
    invoke::<()>(&w, "warm_details", json!({})).expect("warming a scenario does nothing");

    let set: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": {
            "type": "SetInitializer",
            "id": 16,
            "initializer": "unique_system_initializer_02",
            "spawn_weight": null,
        } }),
    )
    .expect("set the initializer of system 16");
    assert_eq!(set.details_stale, [16], "the app refetches system 16");

    let plain: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": {
            "type": "SetInitializer",
            "id": 9,
            "initializer": "basic_init_02",
            "spawn_weight": null,
        } }),
    )
    .expect("set the initializer of system 9");
    assert_eq!(plain.details_stale, [9]);

    let details: Vec<SystemDetails> =
        invoke(&w, "get_system_details", json!({ "ids": [16, 9, 1, 111] })).expect("details");
    let ids: Vec<u32> = details.iter().map(|d| d.id).collect();
    assert_eq!(
        ids,
        [16, 9],
        "1's initializer is not vanilla and 111 has none"
    );

    let rich = &details[0];
    assert!(rich.with_game_data);
    assert_eq!(
        rich.resources
            .iter()
            .map(|r| (r.resource.as_str(), r.amount))
            .collect::<Vec<_>>(),
        [
            ("physics_research", 5.0),
            ("minerals", 11.0),
            ("alloys", 4.0),
        ]
    );
    assert_eq!(rich.planets.len(), 7);
    assert_eq!(rich.sites.len(), 1, "the Larion dig site");
    assert!(rich.fleets_present.is_empty() && rich.starbase.is_none());

    let generated = &details[1];
    assert!(
        generated.resources.is_empty(),
        "basic_init_02 spawns no deposits"
    );
    assert!(
        !generated.planets.is_empty(),
        "but it does spawn bodies: {:?}",
        generated.planets
    );

    let undone: EditResult = invoke::<Option<EditResult>>(&w, "undo", json!({}))
        .expect("undo")
        .expect("something to undo");
    assert_eq!(undone.details_stale, [9], "undo stales it again");
    let redone: EditResult = invoke::<Option<EditResult>>(&w, "redo", json!({}))
        .expect("redo")
        .expect("something to redo");
    assert_eq!(redone.details_stale, [9]);

    let moved: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "MoveSystem", "id": 16, "x": 1.0, "y": 2.0 } }),
    )
    .expect("move system 16");
    assert!(
        moved.details_stale.is_empty(),
        "a move leaves the initializer alone"
    );

    invoke::<()>(&w, "unload_game_data", json!({})).expect("unload");
    let without: Vec<SystemDetails> =
        invoke(&w, "get_system_details", json!({ "ids": [16] })).expect("details");
    assert!(
        without.is_empty(),
        "without the install there is nothing to resolve an initializer against"
    );
}

/// A scenario system's scripts and territories come from the loaded game data; a save has none.
#[test]
fn a_scenario_systems_scripts_and_owners_are_read_from_game_data() {
    if !have_install() {
        return;
    }
    let w = webview();
    invoke::<OpenResult>(&w, "open_save", json!({ "path": SCENARIO })).expect("open the scenario");
    let none: Option<serde_json::Value> =
        invoke(&w, "get_system_scripts", json!({ "id": 3018 })).expect("without game data");
    assert!(none.is_none(), "no game data, no scripts");

    invoke::<GameDataSummary>(&w, "load_game_data", json!({ "mods": false }))
        .expect("load game data");
    let scripts: Option<serde_json::Value> =
        invoke(&w, "get_system_scripts", json!({ "id": 3018 })).expect("scripts");
    let scripts = scripts.expect("a scenario system has a script list");
    assert_eq!(scripts["system"], 3018);
    assert!(
        scripts["initializer"]["file"].is_string(),
        "random_empire_init_01 is a vanilla initializer: {}",
        scripts["initializer"]
    );
    let kinds: Vec<&str> = scripts["rows"]
        .as_array()
        .expect("rows")
        .iter()
        .filter_map(|r| r["kind"].as_str())
        .collect();
    assert!(
        kinds.contains(&"scenario_effect"),
        "Iridonia's own effect block: {kinds:?}"
    );
    assert!(
        scripts["owner"].is_null() || !scripts["owner"]["territory"].is_null(),
        "the owner's territory is joined before it crosses IPC: {}",
        scripts["owner"]
    );
    assert!(
        invoke::<Option<serde_json::Value>>(&w, "get_system_scripts", json!({ "id": 999_999 }))
            .expect("unknown id")
            .is_none()
    );

    let owners: Option<serde_json::Value> =
        invoke(&w, "get_scenario_owners", json!({})).expect("owners");
    let owners = owners.expect("a scenario has an owners view");
    assert_eq!(owners["with_game_data"], true);
    assert!(owners["territories"].is_array());

    invoke::<OpenResult>(&w, "open_save", json!({ "path": SAMPLE })).expect("open the save");
    let on_save: Option<serde_json::Value> =
        invoke(&w, "get_scenario_owners", json!({})).expect("owners on a save");
    assert!(
        on_save.is_none(),
        "a save's owners come from the save itself"
    );
}

/// The bodies the scripts colonise name their territory in the system's details, which
/// takes every system at once: the owners are computed once and kept until the game data
/// or the scenario changes.
#[test]
fn a_scenario_systems_colonies_name_their_territory_and_the_owners_are_kept() {
    if !have_install() {
        return;
    }
    let w = webview();
    invoke::<OpenResult>(&w, "open_save", json!({ "path": SCENARIO })).expect("open the scenario");
    let loaded: GameDataSummary =
        invoke(&w, "load_game_data", json!({ "mods": false })).expect("load game data");

    let before: Option<ScenarioOwners> =
        invoke(&w, "get_scenario_owners", json!({})).expect("owners");
    let before = before.expect("a scenario has an owners view");
    assert!(
        before.colonies.iter().all(|c| c.system != 9),
        "system 9 has no initializer yet"
    );

    invoke::<EditResult>(
        &w,
        "apply_op",
        json!({ "op": {
            "type": "SetInitializer",
            "id": 9,
            "initializer": "com_sol_system",
            "spawn_weight": null,
        } }),
    )
    .expect("set the initializer of system 9");

    let owners: Option<ScenarioOwners> =
        invoke(&w, "get_scenario_owners", json!({})).expect("owners after the edit");
    let owners = owners.expect("a scenario has an owners view");
    let colony = owners
        .colonies
        .iter()
        .find(|c| c.system == 9)
        .expect("com_sol_system colonises Earth");

    let details: Vec<SystemDetails> =
        invoke(&w, "get_system_details", json!({ "ids": [9] })).expect("details");
    let planet = &details[0].planets[colony.planet_index as usize];
    assert!(planet.colonised, "the body the scripts colonise");
    assert_eq!(planet.owner, Some(colony.territory));
    assert!(
        details[0]
            .planets
            .iter()
            .filter(|p| p.owner.is_some())
            .all(|p| p.colonised),
        "only a colony names an owner"
    );

    let again: Option<ScenarioOwners> =
        invoke(&w, "get_scenario_owners", json!({})).expect("owners again");
    assert_eq!(
        again.as_ref(),
        Some(&owners),
        "the second call answers with what the first computed"
    );
    let same: Vec<SystemDetails> =
        invoke(&w, "get_system_details", json!({ "ids": [9] })).expect("details again");
    assert_eq!(same, details);
    let summary: Option<GameDataSummary> =
        invoke(&w, "game_data_summary", json!({})).expect("summary");
    assert_eq!(
        summary.expect("loaded").generation,
        loaded.generation,
        "reading the owners never reloads the game data"
    );
}

/// Any entity of the save reads one level at a time; an op names the entities it touched.
#[test]
fn an_entity_reads_by_address_and_an_op_names_what_it_touched() {
    let w = webview();
    invoke::<OpenResult>(&w, "open_save", json!({ "path": SAMPLE })).expect("open");
    let planet: serde_json::Value = invoke(
        &w,
        "get_entity",
        json!({ "addr": { "kind": "planet", "id": 0 }, "path": [] }),
    )
    .expect("read planet 0");
    assert_eq!(planet["addr"]["id"], 0);
    assert!(!planet["nodes"].as_array().expect("nodes").is_empty());
    let source: serde_json::Value = invoke(
        &w,
        "get_entity_source",
        json!({ "addr": { "kind": "planet", "id": 0 } }),
    )
    .expect("read its source");
    assert!(source["text"].as_str().expect("text").starts_with("0="));
    let schema: serde_json::Value =
        invoke(&w, "get_entity_schema", json!({ "kind": "planet" })).expect("schema");
    assert!(!schema["fields"].as_array().expect("fields").is_empty());

    let moved: serde_json::Value = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "MoveSystem", "id": 0, "x": -150.0, "y": 60.0 } }),
    )
    .expect("move");
    assert_eq!(
        moved["touched_entities"][0],
        json!({ "kind": "system", "id": 0 })
    );
}
