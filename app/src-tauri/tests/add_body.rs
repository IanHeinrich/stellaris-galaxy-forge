//! Rolling a planet or moon into a system of the real sample save, end to end.
use serde_json::json;
use sgf_app_lib::views::AddedBody;
use sgf_core::views::{EditResult, ErrorKind};
use sgf_gamedata::picks::BodyClassPick;

use crate::common;
use common::{SAMPLE_45, invoke, open, webview, with_game_data};

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
    let refused = invoke::<AddedBody>(&w, "add_body", args).expect_err("refused");
    assert_eq!(refused.kind, ErrorKind::Op);
    assert_eq!(refused.message, "load game data to add a planet");
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
            .starts_with(&format!("Added planet #{} to Meissa #408", planet.planet)),
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
            "Added moon #{} of planet #138 in Meissa #408 (pc_desert, size 8)",
            moon.planet
        )),
        "{}",
        moon.edit.entry.description
    );
    assert_eq!(moon.edit.history.undo.len(), 2);

    let undone: EditResult = invoke(&w, "undo", json!({})).expect("undo");
    assert_eq!(undone.history.undo.len(), 1);
}

/// `pc_gray_goo` and `pc_nanotech` are both "Nanite World" in the install, and `pc_barren` and
/// `pc_barren_cold` both "Barren World": each row of the class menu has a name of its own.
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
        let goo = |key: &str| {
            classes
                .iter()
                .find(|c| c.key == key)
                .map(|c| c.name.as_str())
        };
        assert_eq!(goo("pc_gray_goo"), Some("Nanite World (pc_gray_goo)"));
        assert_eq!(goo("pc_nanotech"), Some("Nanite World (pc_nanotech)"));
        assert_eq!(
            goo("pc_desert"),
            Some("Desert World"),
            "unshared names stay"
        );
        assert!(goo("pc_ark").is_none());
    }
}
