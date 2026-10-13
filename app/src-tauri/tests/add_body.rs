//! Rolling a planet or moon into a system of the real sample save, end to end.
use serde_json::json;
use sgf_app_lib::views::Added;
use sgf_core::entity::{EntityAddr, EntityKind};
use sgf_core::views::{EditResult, ErrorKind};
use sgf_gamedata::picks::BodyClassPick;

use crate::common;
use common::{SAMPLE_34, SAMPLE_45, SCENARIO, invoke, open, opened, webview, with_game_data};

#[test]
fn adding_a_body_needs_game_data() {
    let w = webview();
    let classes: Vec<BodyClassPick> =
        invoke(&w, "get_body_classes", json!({ "moon": false })).expect("classes");
    assert!(classes.is_empty(), "no game data, no classes");
    open(&w, SAMPLE_45);
    let args = json!({
        "system": 408, "parent": null, "class": null, "size": null,
        "radius": 170.0, "angle": 200.0, "seed": 7
    });
    let refused = invoke::<Added>(&w, "add_body", args).expect_err("refused");
    assert_eq!(refused.kind, ErrorKind::Op);
    assert!(refused.message.contains("game data"), "{}", refused.message);
}

/// Meissa (408): a random planet, then a desert moon of Meissa IV (138), each one edit that
/// names the body it added in its answer; undo takes the moon out again.
#[test]
fn a_planet_and_a_moon_are_rolled_into_a_system() {
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let planets: Vec<BodyClassPick> =
        invoke(&w, "get_body_classes", json!({ "moon": false })).expect("planet classes");
    assert!(
        planets.iter().any(|c| c.key == "pc_desert"),
        "a desert world is among the classes"
    );
    let moons: Vec<BodyClassPick> =
        invoke(&w, "get_body_classes", json!({ "moon": true })).expect("moon classes");
    assert!(!moons.is_empty());
    let names_its_body = |added: &Added| {
        added
            .edit
            .touched_entities
            .contains(&EntityAddr::new(EntityKind::Planet, added.planets[0]))
    };

    let planet: Added = invoke(
        &w,
        "add_body",
        json!({
            "system": 408, "parent": null, "class": null, "size": null,
            "radius": 170.0, "angle": 200.0, "seed": 7
        }),
    )
    .expect("a random planet");
    assert!(
        names_its_body(&planet),
        "{:?}",
        planet.edit.touched_entities
    );
    assert_eq!(planet.edit.details_stale, [408]);

    let moon: Added = invoke(
        &w,
        "add_body",
        json!({
            "system": 408, "parent": 138, "class": "pc_desert", "size": 8,
            "radius": 15.0, "angle": 90.0, "seed": 8
        }),
    )
    .expect("a desert moon");
    assert_ne!(moon.planets, planet.planets);
    assert!(names_its_body(&moon), "{:?}", moon.edit.touched_entities);
    assert_eq!(moon.edit.history.undo.len(), 2);

    let undone: EditResult = invoke(&w, "undo", json!({})).expect("undo");
    assert_eq!(undone.history.undo.len(), 1);
}

/// Classes the install names alike are told apart: each row of the class menu has a name of
/// its own.
#[test]
fn no_two_classes_in_the_menu_share_a_name() {
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    for moon in [false, true] {
        let classes: Vec<BodyClassPick> =
            invoke(&w, "get_body_classes", json!({ "moon": moon })).expect("classes");
        let mut names: Vec<&str> = classes.iter().map(|c| c.name.as_str()).collect();
        names.sort_unstable();
        let before = names.len();
        names.dedup();
        assert_eq!(before, names.len(), "moon {moon}: {names:?}");
    }
}

/// A scenario and a 3.4 save have none of the capabilities that add bodies and megastructures,
/// so each add command refuses them through the capability it asks, with no game data loaded.
#[test]
fn a_document_without_the_capability_is_refused_every_add() {
    let refusals = [
        (
            "add_body",
            json!({
                "system": 0, "parent": null, "class": null, "size": null,
                "radius": 170.0, "angle": 200.0, "seed": 7
            }),
            "this document takes no added planet",
        ),
        (
            "add_habitat",
            json!({ "system": 0, "body": 0, "kind": "habitat_central_complex" }),
            "this document takes no added habitat",
        ),
        (
            "add_ring_world",
            json!({ "system": 0, "kind": "ring_world_1", "stages": [], "clear": false }),
            "this document takes no added ring world",
        ),
        (
            "get_ring_world_clearing",
            json!({ "system": 0 }),
            "this document takes no added ring world",
        ),
        (
            "add_megastructure",
            json!({
                "system": 0, "kind": "hyper_relay",
                "place": { "place": "free", "x": 0.0, "y": 0.0 },
                "keepPlanet": false, "moons": "remove"
            }),
            "this document takes no added megastructure",
        ),
    ];
    for document in [SCENARIO, SAMPLE_34] {
        let w = opened(document);
        for (command, args, message) in &refusals {
            let refused =
                invoke::<serde_json::Value>(&w, command, args.clone()).expect_err(command);
            assert_eq!(
                refused.kind,
                ErrorKind::Op,
                "{command}: {}",
                refused.message
            );
            assert_eq!(&refused.message, message, "{command} on {document}");
        }
    }
}
