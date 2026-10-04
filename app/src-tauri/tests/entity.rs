//! Reading one system, entity or planet of the open document, and searching it, end to end
//! through the mock runtime on the real sample saves.
use serde_json::json;
use sgf_core::entity::PlanetPage;
use sgf_core::views::{ErrorKind, SearchHit, SearchKind, SearchResult};

use crate::common;
use common::{SAMPLE, SCENARIO, invoke, kind, open, opened, webview};

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
        json!({ "op": { "type": "MoveSystem", "system": 0, "x": -150.0, "y": 60.0 } }),
    )
    .expect("move");
    assert_eq!(
        moved["touched_entities"][0],
        json!({ "kind": "system", "id": 0 })
    );
}

/// A save body's page reads the planet with its colony; a scenario has no planet entities.
#[test]
fn a_planet_page_reads_a_save_body_and_is_not_found_elsewhere() {
    let w = webview();
    assert_eq!(
        kind(invoke::<PlanetPage>(
            &w,
            "get_planet_page",
            json!({ "id": 731 })
        )),
        ErrorKind::NoSession
    );

    open(&w, SAMPLE);
    let nekkar_i: PlanetPage =
        invoke(&w, "get_planet_page", json!({ "id": 731 })).expect("Nekkar I");
    assert_eq!(nekkar_i.class, "pc_tropical");
    assert_eq!(nekkar_i.parent, Some(730));
    assert_eq!(nekkar_i.deposits.len(), 11);
    let colony = nekkar_i.colony.expect("a colony");
    assert_eq!(colony.id, 29);
    assert_eq!(colony.pops, 1600);

    let nekkar_viii: PlanetPage =
        invoke(&w, "get_planet_page", json!({ "id": 744 })).expect("Nekkar VIII");
    assert_eq!(nekkar_viii.station, Some(498));
    assert_eq!(nekkar_viii.moons.len(), 2);

    assert_eq!(
        kind(invoke::<PlanetPage>(
            &w,
            "get_planet_page",
            json!({ "id": 999_999 })
        )),
        ErrorKind::NotFound
    );
    open(&w, SCENARIO);
    assert_eq!(
        kind(invoke::<PlanetPage>(
            &w,
            "get_planet_page",
            json!({ "id": 0 })
        )),
        ErrorKind::NotFound
    );
}

fn search(
    w: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    query: &str,
    limit: usize,
) -> SearchResult {
    invoke(w, "search", json!({ "query": query, "limit": limit })).expect("search")
}

/// A hit carries the localised name and matches on the special kinds only once game data is
/// loaded; the system's own key and its initializer match either way.
#[test]
fn a_search_reads_the_loaded_game_data() {
    let w = webview();
    assert_eq!(
        kind(invoke::<SearchResult>(
            &w,
            "search",
            json!({ "query": "sol", "limit": 5 })
        )),
        ErrorKind::NoSession
    );

    open(&w, SAMPLE);
    let hits = search(&w, "sol", 5).hits;
    assert_eq!(hits[0].id, 217, "{hits:?}");
    assert_eq!(hits[0].name_key, "NAME_Sol");
    let lairs = search(&w, "leviathan", 50).hits;
    assert!(
        lairs
            .iter()
            .all(|h| h.matched_on.as_deref() != Some("Leviathan")),
        "{lairs:?}"
    );

    let Some((w, _)) = common::with_game_data(SAMPLE) else {
        return;
    };
    let hits = search(&w, "sol", 5).hits;
    assert_eq!(hits[0].id, 217, "{hits:?}");
    let lairs = search(&w, "leviathan", 50).hits;
    assert!(
        lairs
            .iter()
            .any(|h| h.matched_on.as_deref() == Some("Leviathan")),
        "{lairs:?}"
    );
    // The Custodian Nexus is named in the localisation by words its key does not share.
    let hits = search(&w, "central processing", 5).hits;
    let systems: Vec<&SearchHit> = hits
        .iter()
        .filter(|h| h.kind == SearchKind::System)
        .collect();
    assert_eq!(systems.len(), 1, "{hits:?}");
    assert_eq!(systems[0].name_key, "NAME_Custodian_Nexus");
}
