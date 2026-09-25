//! The scenario IPC commands end to end, through the mock runtime: what the loaded scripts
//! say about a scenario's systems.

use serde_json::json;
use sgf_core::format::save::details::SystemDetails;
use sgf_core::views::EditResult;
use sgf_gamedata::scripts::{BypassSource, ScenarioBypasses, ScenarioOwners};
use sgf_gamedata::views::GameDataSummary;

use crate::common;
use common::{PAINTED, SAMPLE, SCENARIO, have_install, invoke, open, opened, webview};

#[test]
fn a_painted_scenarios_wormhole_pairs_are_drawn_without_game_data_and_follow_the_op() {
    let w = opened(PAINTED);
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
    open(&w, SCENARIO);
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
    let w = opened(SCENARIO);
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
        invoke::<Option<serde_json::Value>>(&w, "get_system_scripts", json!({ "id": 999_999 }))
            .expect("unknown id")
            .is_none()
    );

    let owners: Option<serde_json::Value> =
        invoke(&w, "get_scenario_owners", json!({})).expect("owners");
    let owners = owners.expect("a scenario has an owners view");
    assert_eq!(owners["with_game_data"], true);
    assert!(owners["territories"].is_array());

    open(&w, SAMPLE);
    let on_save: Option<serde_json::Value> =
        invoke(&w, "get_scenario_owners", json!({})).expect("owners on a save");
    assert!(
        on_save.is_none(),
        "a save's owners come from the save itself"
    );
}

/// The bodies the scripts colonise name their territory in the system's details, which
/// takes every system at once, and asking again answers the same without reloading.
#[test]
fn a_scenario_systems_colonies_name_their_territory_and_asking_again_answers_the_same() {
    if !have_install() {
        return;
    }
    let w = opened(SCENARIO);
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
