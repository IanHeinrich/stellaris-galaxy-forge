//! Session lifecycle IPC commands end to end, through the mock runtime, on the real sample save.
use std::path::Path;

use serde_json::json;
use sgf_core::export::ExportReport;
use sgf_core::validate::IssueCode;
use sgf_core::views::{
    DocumentKind, EditResult, ErrorKind, ExportResult, OpenResult, SaveResult, SearchResult,
    SystemDetail,
};

use crate::common;
use common::{SAMPLE, SAMPLE_45, SCENARIO, invoke, kind, open, opened, webview};

#[test]
fn open_read_search_close() {
    let w = webview();

    assert_eq!(
        kind(invoke::<SystemDetail>(&w, "get_system", json!({ "id": 0 }))),
        ErrorKind::NoSession
    );
    assert_eq!(
        kind(invoke::<SearchResult>(
            &w,
            "search",
            json!({ "query": "gamma", "limit": 5 })
        )),
        ErrorKind::NoSession
    );

    let opened = open(&w, SAMPLE);
    assert_eq!(opened.path.as_deref(), Some(SAMPLE));
    assert_eq!(opened.kind, DocumentKind::Save);
    assert!(opened.capabilities.details && !opened.capabilities.create_systems);
    let meta = opened.meta.as_ref().expect("a save has a header");
    assert_eq!(meta.version, "Pegasus v4.4.6");
    assert_eq!(meta.date, "2206.11.16");
    assert_eq!(opened.galaxy.systems.len(), 791);
    // 789 rides the wormhole to 788, so only 790 stands apart.
    assert_eq!(opened.galaxy.components, 2);
    assert_eq!(opened.galaxy.nebulae.len(), 9);
    assert!((opened.galaxy.galaxy_radius - 499.9288).abs() < 1e-9);
    assert_eq!(opened.issues.len(), 3);

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

    let found: SearchResult =
        invoke(&w, "search", json!({ "query": "gamma", "limit": 5 })).expect("search");
    assert_eq!(found.hits[0].id, 0);
    assert!(found.hits.len() <= 5);
    assert!(found.systems.contains(&0));

    // A system is found by its initializer too, and every system the hits locate comes back.
    let salvagers: SearchResult =
        invoke(&w, "search", json!({ "query": "salvager", "limit": 1 })).expect("search");
    assert_eq!(salvagers.hits.len(), 1, "{:?}", salvagers.hits);
    assert_eq!(
        salvagers.hits[0].matched_on.as_deref(),
        Some("salvager_enclave_init_01")
    );
    assert_eq!(salvagers.systems, [17, 57, 90]);

    invoke::<()>(&w, "close_save", json!({})).expect("close");
    assert_eq!(
        kind(invoke::<SystemDetail>(&w, "get_system", json!({ "id": 0 }))),
        ErrorKind::NoSession
    );
    invoke::<()>(&w, "close_save", json!({})).expect("close again");
}

#[test]
fn open_replaces_the_session_and_rejects_a_missing_file() {
    let w = opened(SAMPLE);
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

    let opened = open(&w, &copy_path);
    assert!(!opened.cloud, "a temp dir is not Steam Cloud");
    let moved: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "MoveSystem", "system": 0, "x": -150.0, "y": 60.0 } }),
    )
    .expect("move system 0");
    assert!(moved.dirty, "move dirties the session");

    std::fs::copy(SAMPLE_45, &copy_path).expect("the game writes the file meanwhile");
    assert_eq!(
        kind(invoke::<SaveResult>(&w, "save", json!({}))),
        ErrorKind::ChangedOnDisk,
        "a file written since it was opened is not overwritten unasked"
    );
    let saved: SaveResult =
        invoke(&w, "save", json!({ "force": true })).expect("save in place over it");
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
    assert_eq!(
        std::fs::read(backup).expect("the backup reads"),
        std::fs::read(SAMPLE_45).expect("the sample reads"),
        "the backup is the file the game wrote"
    );

    let reopened = open(&w, &copy_path);
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

/// Several systems cross as one op each way; the refusals cross with their kinds.
#[test]
fn a_scenario_adds_and_removes_several_systems_through_apply_op() {
    let w = opened(SCENARIO);

    let added: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "AddSystems", "systems": [
            { "system": 4000, "x": 20.0, "y": -30.5, "name": "Alderaan", "initializer": null, "spawn_weight": null },
            { "system": 4001, "x": 30.0, "y": -40.0, "name": null, "initializer": null, "spawn_weight": 5.0 },
        ] } }),
    )
    .expect("add two systems");
    assert_eq!(added.history.undo.len(), 1);

    let removed: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "RemoveSystems", "systems": [1, 16, 4000] } }),
    )
    .expect("remove three systems");
    assert_eq!(removed.history.undo.len(), 2);

    assert_eq!(
        kind(invoke::<EditResult>(
            &w,
            "apply_op",
            json!({ "op": { "type": "RemoveSystems", "systems": [2, 2] } }),
        )),
        ErrorKind::Op,
        "an id listed twice"
    );
    assert_eq!(
        kind(invoke::<EditResult>(
            &w,
            "apply_op",
            json!({ "op": { "type": "RemoveSystems", "systems": [77] } }),
        )),
        ErrorKind::NotFound,
        "no system 77"
    );
}

#[test]
fn scenario_documents_open_start_and_export() {
    let w = webview();
    let dir = tempfile::tempdir().expect("tempdir");

    let opened = open(&w, SCENARIO);
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
    assert_eq!(as_scenario.title, "4.4-early");
    assert!(as_scenario.path.is_none());
    assert_eq!(as_scenario.galaxy.systems.len(), 791);
    let dropped = as_scenario
        .issues
        .iter()
        .filter(|i| i.code == IssueCode::ExportDropped)
        .count();
    assert_eq!(dropped, 1, "{:?}", as_scenario.issues);
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

    open(&w, SAMPLE);
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
    assert_eq!(exported.report.home_initializers.len(), 16);
    assert_eq!(
        preview, exported.report,
        "the preview is the report the write gives"
    );
    let paint = json!({ "profile": "paint_a_galaxy" });
    let painted_preview: ExportReport = invoke(&w, "preview_export", paint).expect("preview");
    let painted_out = dir
        .path()
        .join("painted.txt")
        .to_string_lossy()
        .into_owned();
    let painted: ExportResult = invoke(
        &w,
        "export_scenario",
        json!({ "path": painted_out, "profile": "paint_a_galaxy" }),
    )
    .expect("export for the mod");
    assert_eq!(
        painted_preview, painted.report,
        "the preview is the report the chosen profile's write gives"
    );
    assert_eq!(painted.report.home_initializers.len(), 4);
    let reopened = open(&w, out);
    assert_eq!(reopened.kind, DocumentKind::Scenario);
    assert_eq!(reopened.title, "exported");
    assert_eq!(reopened.galaxy.systems.len(), 791);
}

#[test]
fn a_save_opened_as_a_scenario_shows_the_issues_of_the_scenario_it_opened() {
    let w = webview();
    let dir = tempfile::tempdir().expect("tempdir");
    for (i, (sample, profile, dropped_kinds)) in [
        (SAMPLE, "plain", 1),
        (SAMPLE, "paint_a_galaxy", 0),
        (SAMPLE_45, "paint_a_galaxy", 0),
    ]
    .into_iter()
    .enumerate()
    {
        let as_scenario: OpenResult = invoke(
            &w,
            "open_as_scenario",
            json!({ "path": sample, "profile": profile }),
        )
        .expect("open as scenario");
        let path = dir
            .path()
            .join(format!("{i}.txt"))
            .to_string_lossy()
            .into_owned();
        invoke::<SaveResult>(&w, "save_as", json!({ "path": path })).expect("save as");
        let reopened = open(&w, &path);
        let (dropped, own): (Vec<_>, Vec<_>) = as_scenario
            .issues
            .into_iter()
            .partition(|i| i.code == IssueCode::ExportDropped);
        assert_eq!(own, reopened.issues, "{sample} as {profile}");
        assert!(
            !own.iter().any(|i| i.code == IssueCode::HomeInitializer),
            "{sample} as {profile}"
        );
        assert_eq!(dropped.len(), dropped_kinds, "{sample} as {profile}");
    }
}
