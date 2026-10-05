//! The scenario IPC commands end to end, through the mock runtime: what the loaded scripts
//! say about a scenario's systems.

use serde_json::json;
use sgf_core::format::save::details::SystemDetails;
use sgf_core::views::{EditResult, ErrorKind};
use sgf_gamedata::scripts::{BypassSource, ScenarioBypasses, ScenarioOwners};
use sgf_gamedata::special::{SpecialKind, SpecialSystems};
use sgf_gamedata::views::{GameDataSummary, SystemRoll};

use crate::common;
use common::{
    PAINTED, SAMPLE, SCENARIO, have_install, invoke, kind, open, opened, webview, with_game_data,
};

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
    invoke::<Vec<sgf_core::validate::Issue>>(&w, "warm_details", json!({}))
        .expect("warming a scenario builds nothing");

    let set: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": {
            "type": "SetInitializer",
            "system": 16,
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
            "system": 9,
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
    assert!(!rich.planets.is_empty(), "Larionessi Refuge's bodies");
    assert!(
        !details[1].planets.is_empty(),
        "basic_init_02's bodies: {:?}",
        details[1].planets
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
        json!({ "op": { "type": "MoveSystem", "system": 16, "x": 1.0, "y": 2.0 } }),
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
            "system": 9,
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

/// A save's bodies stand where the save puts them, so its roll is empty; a scenario system
/// with no initializer shows the generator's planets inside the radius asked for.
#[test]
fn a_systems_example_roll_is_empty_on_a_save_and_shows_placeholders_where_the_game_rolls() {
    let saved = opened(SAMPLE);
    let roll: SystemRoll = invoke(
        &saved,
        "get_system_roll",
        json!({ "id": 1, "roll": 0, "within": 150.0 }),
    )
    .expect("a save's roll");
    assert_eq!(roll, SystemRoll::none(1, 0));

    let Some((w, _)) = common::with_game_data(SCENARIO) else {
        return;
    };
    let roll: SystemRoll = invoke(
        &w,
        "get_system_roll",
        json!({ "id": 111, "roll": 2, "within": 150.0 }),
    )
    .expect("system 111's roll");
    assert!(roll.rolls_planets, "111 has no initializer");
    assert!(roll.bodies.is_empty() && !roll.placeholders.is_empty());
    assert!(roll.placeholders.iter().all(|p| p.orbit <= 130.0));
    let again: SystemRoll = invoke(
        &w,
        "get_system_roll",
        json!({ "id": 111, "roll": 2, "within": 150.0 }),
    )
    .expect("the same roll again");
    assert_eq!(again, roll);
}

fn special_count(result: &SpecialSystems, kind: SpecialKind) -> u32 {
    result
        .counts
        .iter()
        .find(|c| c.kind == kind)
        .map_or(0, |c| c.count)
}

/// The special systems of the sample save are classified from its flags and initializers
/// whether or not game data is loaded, and the answer says which it was.
#[test]
fn special_systems_are_classified_with_and_without_game_data() {
    let w = webview();
    assert_eq!(
        kind(invoke::<SpecialSystems>(
            &w,
            "get_special_systems",
            json!({})
        )),
        ErrorKind::NoSession
    );
    open(&w, SAMPLE);
    let counts = |result: &SpecialSystems| {
        [
            SpecialKind::Leviathan,
            SpecialKind::Enclave,
            SpecialKind::Marauder,
            SpecialKind::Landmark,
        ]
        .map(|kind| special_count(result, kind))
    };
    let without: SpecialSystems =
        invoke(&w, "get_special_systems", json!({})).expect("special systems");
    assert!(!without.with_game_data);
    assert_eq!(counts(&without), [6, 14, 6, 11]);
    // A system named only by the country standing in it is named on the first call.
    let enclave = without
        .systems
        .iter()
        .find(|s| s.initializer == "shroudwalker_enclave_init_01")
        .expect("the shroudwalker enclave");
    assert_eq!(enclave.label, "Covenant of the Shroud");

    let Some((w, _)) = with_game_data(SAMPLE) else {
        return;
    };
    let with: SpecialSystems =
        invoke(&w, "get_special_systems", json!({})).expect("special systems");
    assert!(with.with_game_data);
    assert_eq!(counts(&with), counts(&without));
}

/// A save keeps its details itself, so they come with or without game data, and the answer
/// says which; an id that is no system is skipped.
#[test]
fn a_saves_system_details_come_with_and_without_game_data() {
    let w = webview();
    assert_eq!(
        kind(invoke::<Vec<SystemDetails>>(
            &w,
            "get_system_details",
            json!({ "ids": [217] })
        )),
        ErrorKind::NoSession
    );
    open(&w, SAMPLE);
    let details: Vec<SystemDetails> =
        invoke(&w, "get_system_details", json!({ "ids": [217, 9999] })).expect("details");
    assert_eq!(details.len(), 1, "unknown ids are skipped");
    assert_eq!(details[0].id, 217);
    assert!(!details[0].with_game_data);
    assert!(!details[0].planets.is_empty());

    let Some((w, _)) = with_game_data(SAMPLE) else {
        return;
    };
    let details: Vec<SystemDetails> =
        invoke(&w, "get_system_details", json!({ "ids": [217] })).expect("details");
    assert_eq!(details.len(), 1);
    assert!(details[0].with_game_data);
}
