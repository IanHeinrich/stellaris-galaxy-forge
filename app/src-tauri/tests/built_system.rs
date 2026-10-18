//! Binary and trinary systems built star by star, and random ones, end to end on the 4.5
//! sample: the builder's lists, filing, adding, rerolling and undoing, and a scenario's refusal.
use serde_json::json;
use sgf_core::projections::galaxy::SystemNode;
use sgf_core::views::{EditResult, ErrorKind};
use sgf_gamedata::multi_star::{Arrangement, StarType};
use sgf_gamedata::views::StarClassView;

use crate::common;
use common::{SAMPLE_45, SCENARIO, invoke, invoke_raw, kind, with_game_data};

type Webview = tauri::WebviewWindow<tauri::test::MockRuntime>;

fn added(result: &EditResult) -> &SystemNode {
    result
        .delta
        .systems
        .iter()
        .find(|s| s.added)
        .expect("the delta carries the added system")
}

fn step(w: &Webview, command: &str, args: serde_json::Value) -> EditResult {
    invoke(w, command, args).unwrap_or_else(|e| panic!("{command}: {e:?}"))
}

/// The builder lists its arrangements and star types, files stars, adds a built system with a
/// lane, rolls it again with other stars and as a random trinary, and each step undoes alone.
#[test]
fn a_built_system_is_added_rolled_again_and_undone() {
    let Some((w, opened)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let arrangements: Vec<Arrangement> =
        invoke(&w, "get_star_arrangements", json!({})).expect("arrangements");
    let layouts: Vec<&str> = arrangements.iter().map(|a| a.layout.as_str()).collect();
    assert_eq!(
        layouts,
        [
            "binary_init_01",
            "binary_init_02",
            "trinary_init_01",
            "trinary_init_02"
        ]
    );
    let types: Vec<StarType> = invoke(&w, "get_star_types", json!({})).expect("star types");
    assert!(types.first().is_some_and(|t| t.usual));
    assert!(types.iter().any(|t| t.key == "pc_black_hole"));
    let class: String = invoke(
        &w,
        "file_star_class",
        json!({ "stars": ["pc_neutron_star", "pc_b_star"] }),
    )
    .expect("filed");
    assert_eq!(class, "sc_binary_2");
    let refused = invoke::<String>(&w, "file_star_class", json!({ "stars": ["pc_arid"] }));
    assert_eq!(kind(refused), ErrorKind::Op, "not a star");

    let near = opened.galaxy.systems[0].id;
    let (x, y) = (opened.galaxy.galaxy_radius + 40.0, 0.0);
    let built = step(
        &w,
        "add_built_system",
        json!({
            "seed": 4,
            "x": x,
            "y": y,
            "layout": "binary_init_02",
            "stars": ["pc_black_hole", "pc_t_star"],
            "starClass": null,
            "planets": true,
            "links": [near],
        }),
    );
    let system = added(&built);
    assert_eq!(system.star_class, "sc_black_hole");
    assert_eq!(system.initializer, "binary_init_02");
    assert!(system.lanes.iter().any(|lane| lane.to == near));
    assert_eq!(built.history.undo.len(), 1, "one step");
    let id = system.id;
    let kept = |rolled: &SystemNode| {
        assert_eq!(rolled.id, id);
        assert_eq!(rolled.name, system.name, "the name stays");
        assert_eq!(
            (rolled.x, rolled.y),
            (system.x, system.y),
            "the place stays"
        );
        let to = |node: &SystemNode| node.lanes.iter().map(|l| l.to).collect::<Vec<u32>>();
        assert_eq!(to(rolled), to(system), "the lanes stay");
    };

    let built = |layout: &str, stars: [&str; 2], star_class: Option<&str>, planets: bool| {
        json!({
            "kind": "built",
            "layout": layout,
            "stars": stars,
            "star_class": star_class,
            "planets": planets,
        })
    };
    let rerolled = step(
        &w,
        "reroll_system",
        json!({
            "system": id,
            "seed": 6,
            "pick": built("binary_init_02", ["pc_g_star", "pc_g_star"], None, true),
        }),
    );
    kept(added(&rerolled));
    assert_eq!(added(&rerolled).star_class, "sc_binary_8", "filed as G + F");
    assert_eq!(added(&rerolled).initializer, "binary_init_02");

    let chosen = step(
        &w,
        "reroll_system",
        json!({
            "system": id,
            "seed": 6,
            "pick": built("binary_init_01", ["pc_g_star", "pc_g_star"], Some("sc_g"), false),
        }),
    );
    kept(added(&chosen));
    assert_eq!(added(&chosen).star_class, "sc_g", "the class chosen");
    assert_eq!(added(&chosen).initializer, "binary_init_01");

    let trinary = step(
        &w,
        "reroll_system",
        json!({ "system": id, "seed": 6, "pick": { "kind": "stars", "count": 3 } }),
    );
    kept(added(&trinary));
    assert!(added(&trinary).initializer.starts_with("trinary_init_"));
    assert_eq!(trinary.history.undo.len(), 4);

    let four = invoke_raw(
        &w,
        "reroll_system",
        json!({ "system": id, "seed": 6, "pick": { "kind": "stars", "count": 4 } }),
    )
    .expect_err("a random system has 2 or 3 stars");
    assert!(four.to_string().contains("2 or 3 stars, not 4"), "{four}");

    for _ in 0..3 {
        invoke::<Option<EditResult>>(&w, "undo", json!({})).expect("undo a reroll");
    }
    let gone = invoke::<Option<EditResult>>(&w, "undo", json!({}))
        .expect("undo the add")
        .expect("a step");
    assert_eq!(gone.delta.removed, [id]);
}

/// Add system's random binary and trinary draw only layouts of that many stars.
#[test]
fn a_random_binary_or_trinary_has_that_many_stars() {
    let Some((w, opened)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let radius = opened.galaxy.galaxy_radius;
    for (count, prefix, y) in [(2, "binary_init_", 0.0), (3, "trinary_init_", 60.0)] {
        let result = step(
            &w,
            "add_random_system",
            json!({
                "seed": 3,
                "x": radius + 40.0,
                "y": y,
                "pick": { "kind": "stars", "count": count },
            }),
        );
        let system = added(&result);
        assert!(
            system.initializer.starts_with(prefix),
            "{count} stars: {}",
            system.initializer
        );
    }
}

/// A built system with planets off goes in as one step and undoes.
#[test]
fn a_built_system_without_planets_adds_and_undoes() {
    let Some((w, opened)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let result = step(
        &w,
        "add_built_system",
        json!({
            "seed": 2,
            "x": opened.galaxy.galaxy_radius + 40.0,
            "y": 0.0,
            "layout": "trinary_init_02",
            "stars": ["pc_pulsar", "pc_g_star", "pc_m_star"],
            "planets": false,
            "links": [],
        }),
    );
    let system = added(&result);
    assert_eq!(system.star_class, "sc_pulsar");
    let id = system.id;
    let gone = invoke::<Option<EditResult>>(&w, "undo", json!({}))
        .expect("undo the add")
        .expect("a step");
    assert_eq!(gone.delta.removed, [id]);
}

/// A scenario's systems name their initializers, so it takes no built system.
#[test]
fn a_scenario_takes_no_built_system() {
    let Some((w, _)) = with_game_data(SCENARIO) else {
        return;
    };
    let message = |r: Result<serde_json::Value, sgf_core::views::SgfError>| {
        let e = r.expect_err("refused");
        assert_eq!(e.kind, ErrorKind::Op);
        e.message
    };
    for (command, args) in [
        ("get_star_arrangements", json!({})),
        ("get_star_types", json!({})),
        ("file_star_class", json!({ "stars": ["pc_g_star"] })),
        (
            "add_built_system",
            json!({
                "seed": 1, "x": 0.0, "y": 0.0, "layout": "binary_init_01",
                "stars": ["pc_g_star", "pc_k_star"], "planets": true, "links": [],
            }),
        ),
    ] {
        let said = message(invoke(&w, command, args));
        assert!(said.contains("binary or trinary"), "{command}: {said}");
    }
}

/// The class list names each modifier a class with effects puts on its systems.
#[test]
fn the_star_class_list_names_each_class_effect() {
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let classes: Vec<StarClassView> =
        invoke(&w, "get_star_classes", json!({})).expect("star classes");
    let pulsar = classes
        .iter()
        .find(|c| c.key == "sc_pulsar")
        .expect("sc_pulsar");
    let modifiers = pulsar.modifiers.as_ref().expect("a pulsar's effects");
    assert!(modifiers.iter().any(|m| m.key == "ship_shield_reduction"));
    assert!(modifiers.iter().all(|m| !m.name.is_empty()));
    let g = classes.iter().find(|c| c.key == "sc_g").expect("sc_g");
    assert_eq!(g.modifiers, None);
}
