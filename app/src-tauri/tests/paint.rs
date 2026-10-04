//! Paint a Galaxy's commands end to end, through the mock runtime: the fallen empire zones and
//! their links, the header's empire counts, and the profile the scenario commands take.
use serde_json::json;
use sgf_core::format::scenario::FeLinkFlags;
use sgf_core::format::scenario::fe_zone::{self, FeZone};
use sgf_core::validate::IssueCode;
use sgf_core::views::{EditResult, ErrorKind, ExportResult, OpenResult};

use crate::common;
use common::{PAINTED, SAMPLE, invoke, invoke_raw, kind, open, webview};

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
        json!({ "op": {
            "type": "Batch",
            "description": "Set the fallen empire zone of 2 systems",
            "ops": entries
                .iter()
                .map(|(system, zone)| json!({ "type": "SetFeZone", "system": system, "zone": zone }))
                .collect::<Vec<_>>(),
        } }),
    )
    .expect("apply the entries");
    assert_eq!(
        edited.entry.description,
        "Set the fallen empire zone of 2 systems"
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
        "Linked 2 systems to the fallen empire zone at Old Seat #9"
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
            && text.starts_with(&format!(
                "#\u{200B} created by Stellaris Galaxy Forge {} (converted from save 4.4-early.sav)
",
                sgf_core::VERSION
            ))
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
