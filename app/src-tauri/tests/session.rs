//! Session lifecycle IPC commands end to end, through the mock runtime, on the real sample save.
use std::path::Path;

use serde_json::json;
use sgf_core::export::ExportReport;
use sgf_core::format::scenario::FeLinkFlags;
use sgf_core::format::scenario::fe_zone::{self, FeZone};
use sgf_core::validate::IssueCode;
use sgf_core::views::{
    DocumentKind, EditResult, ErrorKind, ExportResult, OpenResult, SaveResult, SearchHit,
    SystemDetail,
};

mod common;
use common::{PAINTED, SAMPLE, SCENARIO, invoke, invoke_raw, kind, open, opened, webview};

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

#[test]
fn a_scenario_adds_and_removes_several_systems_as_one_step_each() {
    let w = opened(SCENARIO);

    let added: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "AddSystems", "systems": [
            { "id": 4000, "x": 20.0, "y": -30.5, "name": "Alderaan", "initializer": null, "spawn_weight": null },
            { "id": 4001, "x": 30.0, "y": -40.0, "name": null, "initializer": null, "spawn_weight": 5.0 },
        ] } }),
    )
    .expect("add two systems");
    assert_eq!(added.entry.description, "Added 2 systems");
    let mut ids: Vec<u32> = added.delta.systems.iter().map(|s| s.id).collect();
    ids.sort_unstable();
    assert_eq!(ids, [4000, 4001]);
    assert_eq!(added.history.undo.len(), 1);

    let removed: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "RemoveSystems", "ids": [1, 16, 4000] } }),
    )
    .expect("remove three systems");
    assert_eq!(removed.entry.description, "Removed 3 systems (5 lanes)");
    let mut gone = removed.delta.removed.clone();
    gone.sort_unstable();
    assert_eq!(gone, [1, 16, 4000]);
    assert_eq!(removed.history.undo.len(), 2);

    assert_eq!(
        kind(invoke::<EditResult>(
            &w,
            "apply_op",
            json!({ "op": { "type": "RemoveSystems", "ids": [2, 2] } }),
        )),
        ErrorKind::Op,
        "an id listed twice"
    );
    assert_eq!(
        kind(invoke::<EditResult>(
            &w,
            "apply_op",
            json!({ "op": { "type": "RemoveSystems", "ids": [77] } }),
        )),
        ErrorKind::NotFound,
        "no system 77"
    );

    let undone = invoke::<Option<EditResult>>(&w, "undo", json!({}))
        .expect("undo")
        .expect("the removal to undo");
    let mut back: Vec<u32> = undone.delta.systems.iter().map(|s| s.id).collect();
    back.sort_unstable();
    assert!([1, 16, 4000].iter().all(|id| back.contains(id)), "{back:?}");
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
    assert_eq!(exported.report.home_initializers.len(), 4);
    assert_eq!(
        preview, exported.report,
        "the preview is the report the write gives"
    );
    let reopened = open(&w, out);
    assert_eq!(reopened.kind, DocumentKind::Scenario);
    assert_eq!(reopened.title, "exported");
    assert_eq!(reopened.galaxy.systems.len(), 791);
}

#[test]
fn fe_zone_fit_keeps_the_placed_zones_and_spreads_the_count_asked_for() {
    let w = webview();
    assert_eq!(
        kind(invoke::<Vec<(u32, Option<FeZone>)>>(
            &w,
            "fe_zone_fit",
            json!({ "count": 2 })
        )),
        ErrorKind::NoSession
    );
    assert_eq!(
        kind(invoke::<usize>(&w, "fe_zone_candidate_count", json!({}))),
        ErrorKind::NoSession
    );
    open(&w, SAMPLE);
    assert_eq!(
        kind(invoke::<Vec<(u32, Option<FeZone>)>>(
            &w,
            "fe_zone_fit",
            json!({ "count": 2 })
        )),
        ErrorKind::Op,
        "a save has no zones"
    );
    assert_eq!(
        kind(invoke::<usize>(&w, "fe_zone_candidate_count", json!({}))),
        ErrorKind::Op
    );

    let opened = open(&w, PAINTED);
    assert!(opened.painted);
    let count: usize = invoke(&w, "fe_zone_candidate_count", json!({})).expect("count");
    assert_eq!(count, 9);
    let entries: Vec<(u32, Option<FeZone>)> =
        invoke(&w, "fe_zone_fit", json!({ "count": 2 })).expect("fit two");
    assert_eq!(entries.len(), 2, "{entries:?}");
    assert!(
        entries
            .iter()
            .all(|(id, zone)| *id != 9 && *id != 12 && zone.is_some()),
        "{entries:?}"
    );
    let centres: Vec<(f64, f64)> = entries
        .iter()
        .map(|(id, zone)| {
            let system = opened
                .galaxy
                .systems
                .iter()
                .find(|system| system.id == *id)
                .expect("the anchor");
            fe_zone::centre((system.x, system.y), zone.as_ref().unwrap())
        })
        .collect();
    let apart = (centres[0].0 - centres[1].0).hypot(centres[0].1 - centres[1].1);
    assert!(apart > 60.0, "{entries:?} lie {apart} apart");
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
        invoke(&w, "fe_zone_fit", json!({ "count": 2 })).expect("fit two again");
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
    open(&w, SAMPLE);
    assert_eq!(
        kind(invoke::<Vec<(String, String)>>(
            &w,
            "header_empire_counts",
            json!({})
        )),
        ErrorKind::Op,
        "a save has no header"
    );

    let opened = open(&w, PAINTED);
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
            ("fallen_empire_max".to_owned(), "2".to_owned()),
            ("fallen_empire_default".to_owned(), "2".to_owned()),
            ("marauder_empire_default".to_owned(), "0".to_owned()),
            ("marauder_empire_max".to_owned(), "0".to_owned()),
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
fn set_fe_links_writes_the_connection_flags_as_one_step_and_undo_takes_them_back() {
    let w = webview();
    assert_eq!(
        kind(invoke::<EditResult>(
            &w,
            "set_fe_links",
            json!({ "anchor": 9, "linked": [3, 2] })
        )),
        ErrorKind::NoSession
    );
    open(&w, PAINTED);
    let links = |result: &EditResult| -> Vec<(u32, FeLinkFlags)> {
        result
            .delta
            .systems
            .iter()
            .map(|system| (system.id, system.fe_link.clone()))
            .collect()
    };
    let link = |custom: bool, id: Option<u8>, to: Vec<u8>| FeLinkFlags { custom, id, to };
    let edited: EditResult = invoke(&w, "set_fe_links", json!({ "anchor": 9, "linked": [3, 2] }))
        .expect("link Sol and Gamma to Old Seat");
    assert_eq!(
        edited.entry.description,
        "Link 2 systems to the fallen empire zone at Old Seat"
    );
    assert!(edited.dirty);
    assert!(!edited.reclassifies);
    assert_eq!(
        links(&edited),
        [
            (2, link(false, None, vec![0])),
            (3, link(false, None, vec![0])),
            (9, link(true, Some(0), Vec::new())),
        ]
    );
    assert!(
        edited
            .issues
            .iter()
            .all(|issue| issue.code != IssueCode::FeLinkIsolated),
        "{:?}",
        edited.issues
    );
    let refused = invoke::<EditResult>(&w, "set_fe_links", json!({ "anchor": 10, "linked": [3] }));
    assert_eq!(kind(refused), ErrorKind::Op, "Void anchors no zone");

    let undone: EditResult = invoke::<Option<EditResult>>(&w, "undo", json!({}))
        .expect("undo")
        .expect("something to undo");
    assert_eq!(
        links(&undone),
        [
            (2, FeLinkFlags::default()),
            (3, FeLinkFlags::default()),
            (9, FeLinkFlags::default()),
        ]
    );
    assert!(!undone.dirty);
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
    // 791 systems, less the three fallen empires' clusters, plus their three anchors.
    assert_eq!(as_scenario.galaxy.systems.len(), 765);
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

    let save = open(&w, SAMPLE);
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

    let reopened = open(&w, painted);
    assert!(reopened.painted);
    let reopened = open(&w, exported);
    assert!(!reopened.painted);
}

/// Any entity of the save reads one level at a time; an op names the entities it touched.
#[test]
fn an_entity_reads_by_address_and_an_op_names_what_it_touched() {
    let w = opened(SAMPLE);
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
