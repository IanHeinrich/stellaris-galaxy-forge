//! Rolling a planet or moon into a system of the real sample save, end to end.
use serde_json::json;
use sgf_app_lib::views::{AddedBody, BodyClassPick};
use sgf_core::views::{EditResult, ErrorKind};

use crate::common;
use common::{SAMPLE_45, invoke, kind, open, webview, with_game_data};

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
    assert_eq!(
        kind(invoke::<AddedBody>(&w, "add_body", args)),
        ErrorKind::Op
    );
}

/// Meissa (408): a random planet, then a desert moon of Meissa IV (138), each one edit that
/// names the body it added; undo takes the moon out again.
#[test]
fn a_planet_and_a_moon_are_rolled_into_a_system() {
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let planets: Vec<BodyClassPick> =
        invoke(&w, "get_body_classes", json!({ "moon": false })).expect("planet classes");
    let desert = planets
        .iter()
        .find(|c| c.key == "pc_desert")
        .expect("a desert world is among the classes");
    assert_ne!(desert.name, desert.key, "named from the localisation");
    assert!(desert.min_size <= desert.max_size);
    let moons: Vec<BodyClassPick> =
        invoke(&w, "get_body_classes", json!({ "moon": true })).expect("moon classes");
    assert!(!moons.is_empty());

    let planet: AddedBody = invoke(
        &w,
        "add_body",
        json!({
            "system": 408, "parent": null, "class": null, "size": null,
            "radius": 170.0, "angle": 200.0, "seed": 7
        }),
    )
    .expect("a random planet");
    assert!(
        planet
            .edit
            .entry
            .description
            .starts_with(&format!("Added planet #{} to system #408", planet.planet)),
        "{}",
        planet.edit.entry.description
    );
    assert_eq!(planet.edit.details_stale, [408]);

    let moon: AddedBody = invoke(
        &w,
        "add_body",
        json!({
            "system": 408, "parent": 138, "class": "pc_desert", "size": 8,
            "radius": 15.0, "angle": 90.0, "seed": 8
        }),
    )
    .expect("a desert moon");
    assert_ne!(moon.planet, planet.planet);
    assert!(
        moon.edit.entry.description.starts_with(&format!(
            "Added moon #{} of planet #138 in system #408 (pc_desert, size 8)",
            moon.planet
        )),
        "{}",
        moon.edit.entry.description
    );
    assert_eq!(moon.edit.history.undo.len(), 2);

    let undone: EditResult = invoke(&w, "undo", json!({})).expect("undo");
    assert_eq!(undone.history.undo.len(), 1);
}
