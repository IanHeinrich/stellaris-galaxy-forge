//! Rolling a system into a save, rolling it again, renaming and deleting it, end to end on the
//! real sample save.
use serde_json::json;
use sgf_core::projections::galaxy::SystemNode;
use sgf_core::views::details::SystemDetails;
use sgf_core::views::{EditResult, ErrorKind, GalaxyView, SystemDetail};
use sgf_gamedata::generate::ClusterRoll;
use sgf_gamedata::summary::{AddSystemPicks, ClusterPick, SpecialPick};

use crate::common;
use common::{SAMPLE, SAMPLE_45, SCENARIO, invoke, kind, open, webview, with_game_data};
use sgf_gamedata::picks::StarClassPick;

/// A point inside the galaxy at least `clear` from every system.
fn free_spot(galaxy: &GalaxyView, clear: f64) -> (f64, f64) {
    free_spot_beside(galaxy, clear, &[])
}

/// As [`free_spot`], clear of the points `taken` too.
fn free_spot_beside(galaxy: &GalaxyView, clear: f64, taken: &[(f64, f64)]) -> (f64, f64) {
    let radius = galaxy.galaxy_radius;
    let step = clear / 2.0;
    let mut y = -radius;
    while y <= radius {
        let mut x = -radius;
        while x <= radius {
            let inside = x.hypot(y) < radius - clear;
            let spaced = galaxy
                .systems
                .iter()
                .map(|s| (s.x, s.y))
                .chain(taken.iter().copied())
                .all(|(sx, sy)| (sx - x).hypot(sy - y) >= clear);
            if inside && spaced {
                return (x, y);
            }
            x += step;
        }
        y += step;
    }
    panic!("no free spot in the sample galaxy");
}

fn added(result: &EditResult) -> &SystemNode {
    result
        .delta
        .systems
        .iter()
        .find(|s| s.added)
        .expect("the delta carries the added system")
}

#[test]
fn adding_a_system_needs_game_data_and_a_save() {
    let w = webview();
    let args = json!({ "seed": 7, "x": 0.0, "y": 0.0, "starClass": null });
    let classes: Vec<StarClassPick> =
        invoke(&w, "get_generator_star_classes", json!({})).expect("star classes");
    assert!(classes.is_empty(), "no game data, no classes: {classes:?}");
    assert_eq!(
        kind(invoke::<EditResult>(&w, "add_random_system", args.clone())),
        ErrorKind::Op,
        "no game data"
    );
    open(&w, SAMPLE);
    let refused = invoke::<EditResult>(&w, "add_random_system", args).expect_err("no game data");
    assert!(refused.message.contains("game data"), "{}", refused.message);
}

#[test]
fn add_reroll_rename_delete_and_undo() {
    let Some((w, opened)) = with_game_data(SAMPLE) else {
        return;
    };

    let classes: Vec<StarClassPick> =
        invoke(&w, "get_generator_star_classes", json!({})).expect("star classes");
    let red = classes
        .iter()
        .find(|c| c.key == "sc_m")
        .expect("a red star is among the classes the layouts roll");
    assert_ne!(
        red.name, red.key,
        "the class is named from the localisation"
    );

    let (x, y) = free_spot(&opened.galaxy, 12.0);
    let (near, _) = opened
        .galaxy
        .systems
        .iter()
        .map(|s| (s.id, (s.x - x).hypot(s.y - y)))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .expect("a nearest system");
    let result: EditResult = invoke(
        &w,
        "add_random_system",
        json!({ "seed": 42, "x": x, "y": y, "starClass": "sc_g" }),
    )
    .expect("add a system");
    let system = added(&result).clone();
    assert_eq!(system.star_class, "sc_g");
    assert!(
        (system.x - x).abs() < 1e-4 && (system.y - y).abs() < 1e-4,
        "at the point asked for"
    );
    assert!(system.lanes.is_empty(), "a new system has no lanes");
    assert!(
        result.entry.description.starts_with("Added "),
        "{}",
        result.entry.description
    );
    assert_eq!(result.history.undo.len(), 1, "one step");
    invoke::<EditResult>(
        &w,
        "apply_op",
        json!({ "op": { "type": "AddLane", "a": system.id, "b": near, "bridge": false } }),
    )
    .expect("lane it to the nearest system");

    let rolled: EditResult = invoke(
        &w,
        "reroll_system",
        json!({ "system": system.id, "seed": 43, "starClass": "sc_m" }),
    )
    .expect("roll it again as a red star");
    let again = added(&rolled);
    assert_eq!(again.id, system.id, "the id stays");
    assert_eq!(again.star_class, "sc_m");
    assert_eq!(again.name, system.name, "the name stays");
    assert_eq!(
        again.lanes.iter().map(|l| l.to).collect::<Vec<_>>(),
        [near],
        "the lane stays"
    );
    assert_eq!(rolled.history.undo.len(), 3, "one more step");

    let renamed: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "RenameSystem", "system": system.id, "name": "Dorellion" } }),
    )
    .expect("rename it");
    assert_eq!(added(&renamed).name.key, "Dorellion");

    let deleted: EditResult = invoke(
        &w,
        "apply_op",
        json!({ "op": { "type": "RemoveSystem", "system": system.id } }),
    )
    .expect("delete it");
    assert_eq!(deleted.delta.removed, [system.id]);

    let undone: Option<EditResult> = invoke(&w, "undo", json!({})).expect("undo the delete");
    assert!(undone.is_some());
    let refused = invoke::<EditResult>(
        &w,
        "reroll_system",
        json!({ "system": 0, "seed": 1, "starClass": null }),
    )
    .expect_err("a system the file already held is refused");
    assert_eq!(refused.kind, ErrorKind::Op, "{}", refused.message);
}

fn name_at(w: &tauri::WebviewWindow<tauri::test::MockRuntime>, id: u32) -> String {
    let detail: SystemDetail =
        invoke(w, "get_system", json!({ "id": id })).unwrap_or_else(|e| panic!("{id}: {e:?}"));
    detail.system.name.key
}

#[test]
fn deleting_added_systems_in_bulk_skips_the_files_own_and_undoes_in_one_step() {
    let Some((w, opened)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let mut taken = Vec::new();
    let mut ids = Vec::new();
    let mut names = Vec::new();
    for seed in [21, 22, 23, 24] {
        let (x, y) = free_spot_beside(&opened.galaxy, 12.0, &taken);
        taken.push((x, y));
        let result: EditResult = invoke(
            &w,
            "add_random_system",
            json!({ "seed": seed, "x": x, "y": y, "starClass": null }),
        )
        .expect("add a system");
        ids.push(added(&result).id);
        names.push(added(&result).name.key.clone());
    }
    let [first, second, third, fourth] = ids[..] else {
        panic!("four systems added");
    };
    assert_eq!([second, third, fourth], [first + 1, first + 2, first + 3]);
    let own = opened.galaxy.systems[0].id;
    let own_name = name_at(&w, own);

    let refused = invoke::<EditResult>(&w, "remove_added_systems", json!({ "ids": [own] }))
        .expect_err("the file's own systems alone are refused");
    assert_eq!(refused.kind, ErrorKind::Op, "{}", refused.message);

    let deleted: EditResult = invoke(
        &w,
        "remove_added_systems",
        json!({ "ids": [fourth, own, second] }),
    )
    .expect("delete the second and the fourth");
    assert_eq!(
        deleted.delta.renumbered,
        [(second, None), (fourth, None), (third, Some(second))]
    );
    assert_eq!(deleted.delta.removed, [third, fourth]);
    assert_eq!(deleted.history.undo.len(), 5, "four adds and one delete");
    assert!(
        deleted.entry.description.starts_with("Removed 2 systems"),
        "{}",
        deleted.entry.description
    );
    let left = |w| {
        [first, second, own]
            .iter()
            .map(|&id| name_at(w, id))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        left(&w),
        [names[0].clone(), names[2].clone(), own_name.clone()],
        "the third takes the second's id and the file's own system stays"
    );
    for gone in [third, fourth] {
        let missing = invoke::<SystemDetail>(&w, "get_system", json!({ "id": gone }))
            .expect_err("no system past the renumbered third");
        assert_eq!(missing.kind, ErrorKind::NotFound, "{gone}");
    }

    let undone: EditResult = invoke::<Option<EditResult>>(&w, "undo", json!({}))
        .expect("undo")
        .expect("a step to undo");
    assert_eq!(
        undone.history.undo.len(),
        4,
        "one undo takes the whole delete back"
    );
    for (&id, name) in ids.iter().zip(&names) {
        assert_eq!(&name_at(&w, id), name, "{id} is back at its own id");
    }

    let redone: EditResult = invoke::<Option<EditResult>>(&w, "redo", json!({}))
        .expect("redo")
        .expect("a step to redo");
    assert_eq!(redone.delta.renumbered, deleted.delta.renumbered);
    assert_eq!(redone.delta.removed, deleted.delta.removed);
    assert_eq!(left(&w), [names[0].clone(), names[2].clone(), own_name]);
}

#[test]
fn a_scenario_takes_no_rolled_system() {
    let Some((w, _)) = with_game_data(SAMPLE) else {
        return;
    };
    open(&w, SCENARIO);
    let added = invoke::<EditResult>(
        &w,
        "add_random_system",
        json!({ "seed": 1, "x": 0.0, "y": 0.0, "starClass": null }),
    )
    .expect_err("a scenario is refused");
    let rolled = invoke::<EditResult>(
        &w,
        "reroll_system",
        json!({ "system": 0, "seed": 1, "starClass": null }),
    )
    .expect_err("a scenario is refused");
    let picks = invoke::<AddSystemPicks>(&w, "get_add_system_picks", json!({}))
        .expect_err("a scenario has no picks");
    for refused in [added, rolled, picks] {
        assert_eq!(refused.kind, ErrorKind::Op, "{}", refused.message);
        assert_eq!(refused.message, "this document takes no rolled system");
    }
    let removed = invoke::<EditResult>(&w, "remove_added_systems", json!({ "ids": [0] }))
        .expect_err("a scenario has no added systems");
    assert_eq!(removed.kind, ErrorKind::Op);
    assert_eq!(
        removed.message,
        "this document has no systems added this session"
    );
}

/// A scenario lists the Special menu's layouts and clusters as a save does, and takes each as
/// system statements naming their initializers: one for a layout, one per system and the
/// lanes between them for a cluster.
#[test]
fn a_scenario_takes_special_systems_and_clusters_as_statements() {
    let Some((w, opened)) = with_game_data(SCENARIO) else {
        return;
    };
    let layouts: Vec<SpecialPick> =
        invoke(&w, "get_special_layouts", json!({})).expect("the special layouts");
    assert!(
        layouts
            .iter()
            .any(|pick| pick.layout.key == "trappist_initializer")
    );
    let clusters: Vec<ClusterPick> =
        invoke(&w, "get_special_clusters", json!({})).expect("the clusters");
    let keys: Vec<&str> = clusters.iter().map(|c| c.cluster.key.as_str()).collect();
    assert_eq!(keys, ["junk_ratlings", "legendary_leader"]);

    let (x, y) = free_spot(&opened.galaxy, 12.0);
    let special: EditResult = invoke(
        &w,
        "add_special_system",
        json!({ "seed": 1, "x": x, "y": y, "layout": "trappist_initializer", "extras": true }),
    )
    .expect("a special system's statement");
    assert!(
        special
            .delta
            .systems
            .iter()
            .any(|s| s.initializer == "trappist_initializer")
    );

    let (x, y) = free_spot(&opened.galaxy, 30.0);
    let args = json!({ "seed": 3, "x": x, "y": y, "cluster": "legendary_leader" });
    let roll: ClusterRoll = invoke(&w, "roll_special_cluster", args).expect("the roll");
    assert_eq!(roll.members.len(), 4);
    assert_eq!(roll.lanes.len(), 3);
    let args = json!({ "seed": 3, "x": x, "y": y, "cluster": "legendary_leader", "extras": false });
    let cluster: EditResult = invoke(&w, "add_special_cluster", args).expect("the cluster");
    assert_eq!(
        cluster.entry.description,
        "Added the Legendary Leader's sites: 4 systems and 3 lanes"
    );
    let added: Vec<&str> = cluster
        .delta
        .systems
        .iter()
        .map(|s| s.initializer.as_str())
        .filter(|init| init.starts_with("legendary_leader"))
        .collect();
    assert_eq!(added.len(), 4, "{added:?}");
}

/// The picks the menu offers for the open save.
fn picks(w: &tauri::WebviewWindow<tauri::test::MockRuntime>) -> AddSystemPicks {
    invoke(w, "get_add_system_picks", json!({})).expect("the menu's picks")
}

fn history_step(w: &tauri::WebviewWindow<tauri::test::MockRuntime>, command: &str) -> EditResult {
    invoke::<Option<EditResult>>(w, command, json!({}))
        .expect(command)
        .expect("a step")
}

#[test]
fn a_capped_special_layout_the_galaxy_has_is_placed_rolled_again_and_undone() {
    let Some((w, opened)) = with_game_data(SAMPLE_45) else {
        return;
    };

    let before = picks(&w);
    assert!(!before.star_classes.is_empty());
    assert!(before.random.planets.max > 0, "{:?}", before.random);
    let keys: Vec<&str> = before
        .special
        .iter()
        .map(|p| p.layout.key.as_str())
        .collect();
    assert!(
        !keys.contains(&"special_init_09"),
        "the generic pulsar is the Pulsar star pick's: {keys:?}"
    );
    let layout = "wenkwort_initializer";
    let wenkwort = before
        .special
        .iter()
        .find(|p| p.layout.key == layout)
        .expect("Wenkwort is offered");
    assert!(wenkwort.layout.capped);
    assert!(
        !wenkwort.layout.unique,
        "a fixed name, but no unique_system flag"
    );
    let zevox = before
        .special
        .iter()
        .find(|p| p.layout.key == "unique_system_initializer_03")
        .expect("Zevox is offered");
    assert!(zevox.layout.unique);
    assert_eq!(wenkwort.layout.in_galaxy, 1, "the sample galaxy has one");
    assert_eq!(wenkwort.summary.in_galaxy, Some(1));
    let original = opened
        .galaxy
        .systems
        .iter()
        .find(|s| s.initializer == layout)
        .expect("the galaxy's own Wenkwort");

    let (x, y) = free_spot(&opened.galaxy, 12.0);
    let placed: EditResult = invoke(
        &w,
        "add_special_system",
        json!({ "seed": 5, "x": x, "y": y, "layout": layout, "extras": true }),
    )
    .expect("placed though the galaxy has one");
    let system = added(&placed).clone();
    assert_eq!(system.initializer, layout);
    assert_eq!(
        system.flags,
        ["wenkwort_system", "natural_spectacle_system"],
        "the layout's star flags"
    );
    assert_ne!(
        system.name.key, original.name.key,
        "the fixed name is taken, so the pool names it"
    );
    assert_eq!(placed.history.undo.len(), 1, "one step");
    let counted = picks(&w);
    let again = counted.special.iter().find(|p| p.layout.key == layout);
    assert_eq!(again.map(|p| p.layout.in_galaxy), Some(2));

    let rolled: EditResult = invoke(
        &w,
        "reroll_system",
        json!({ "system": system.id, "seed": 6, "starClass": system.star_class, "keepSpecial": true }),
    )
    .expect("roll it again");
    let rolled_node = added(&rolled);
    assert_eq!(rolled_node.id, system.id);
    assert_eq!(rolled_node.initializer, layout, "the same layout");
    assert_eq!(rolled_node.name, system.name, "the name stays");

    let changed: EditResult = invoke(
        &w,
        "reroll_system",
        json!({ "system": system.id, "seed": 7, "starClass": "sc_g", "keepSpecial": false }),
    )
    .expect("change the star");
    let changed_node = added(&changed);
    assert_eq!(changed_node.star_class, "sc_g");
    assert_ne!(
        changed_node.initializer, layout,
        "a new star rolls a regular system"
    );
    assert_eq!(changed_node.name, system.name);
    assert_eq!(changed.history.undo.len(), 3);

    let undone = history_step(&w, "undo");
    let back = undone.delta.systems.iter().find(|s| s.id == system.id);
    assert_eq!(back.map(|s| s.initializer.as_str()), Some(layout));
    history_step(&w, "undo");
    let gone = history_step(&w, "undo");
    assert_eq!(gone.delta.removed, [system.id], "the add is undone");
    let redone = history_step(&w, "redo");
    assert_eq!(added(&redone).initializer, layout, "and redone");

    let (x, y) = free_spot_beside(&opened.galaxy, 12.0, &[(x, y)]);
    let unique: EditResult = invoke(
        &w,
        "add_special_system",
        json!({ "seed": 8, "x": x, "y": y, "layout": "unique_system_initializer_03", "extras": true }),
    )
    .expect("place Zevox");
    assert_eq!(
        added_with(&unique, "unique_system_initializer_03").flags,
        ["unique_system"],
        "the flag the game's timeline reads"
    );
}

#[test]
fn a_special_system_comes_with_its_anomalies_and_dig_sites_only_when_asked() {
    let Some((w, opened)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let anomaly = "BREACHSEALER_CAT";
    let mut taken = Vec::new();
    for (seed, extras) in [(31, false), (32, true)] {
        let (x, y) = free_spot_beside(&opened.galaxy, 12.0, &taken);
        taken.push((x, y));
        let placed: EditResult = invoke(
            &w,
            "add_special_system",
            json!({ "seed": seed, "x": x, "y": y, "layout": "breachsealer_system", "extras": extras }),
        )
        .unwrap_or_else(|e| panic!("extras {extras}: {e:?}"));
        let system = added_with(&placed, "breachsealer_system");
        assert!(
            system.flags.iter().any(|f| f == "natural_spectacle_system"),
            "the star flags come whatever extras says: {:?}",
            system.flags
        );
        assert_eq!(placed.history.undo.len(), taken.len(), "one step per add");
        let details: Vec<SystemDetails> =
            invoke(&w, "get_system_details", json!({ "ids": [system.id] })).expect("details");
        let held = details[0]
            .planets
            .iter()
            .any(|p| p.anomaly.as_deref() == Some(anomaly));
        assert_eq!(held, extras, "the anomaly is written only with extras");
    }

    let (x, y) = free_spot_beside(&opened.galaxy, 12.0, &taken);
    let ort: EditResult = invoke(
        &w,
        "add_special_system",
        json!({ "seed": 33, "x": x, "y": y, "layout": "hostile_init_21", "extras": true }),
    )
    .expect("Tiyun Ort with extras");
    let system = added_with(&ort, "hostile_init_21");
    let details: Vec<SystemDetails> =
        invoke(&w, "get_system_details", json!({ "ids": [system.id] })).expect("details");
    assert!(!details[0].sites.is_empty(), "its dig site is written");
    let undone = history_step(&w, "undo");
    assert_eq!(
        undone.delta.removed,
        [system.id],
        "the system and what it came with undo as one step"
    );
}

fn added_with<'r>(result: &'r EditResult, initializer: &str) -> &'r SystemNode {
    result
        .delta
        .systems
        .iter()
        .find(|s| s.added && s.initializer == initializer)
        .expect("the delta carries the added system")
}

#[test]
fn adding_systems_together_names_them_apart_and_undoes_in_one_step() {
    let Some((w, opened)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let mut taken = Vec::new();
    let mut asks = Vec::new();
    for class in ["sc_g", "sc_m", "sc_k"] {
        let (x, y) = free_spot_beside(&opened.galaxy, 12.0, &taken);
        taken.push((x, y));
        asks.push(json!({ "x": x, "y": y, "star_class": class }));
    }
    let (x, y) = taken[0];
    let (near, _) = opened
        .galaxy
        .systems
        .iter()
        .map(|s| (s.id, (s.x - x).hypot(s.y - y)))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .expect("a nearest system");
    let new = |index| json!({ "kind": "new", "index": index });
    let args = json!({
        "seed": 5,
        "systems": asks,
        "lanes": [
            [new(0), new(1)],
            [{ "kind": "held", "system": near }, new(0)],
        ],
        "description": "Added 3 systems",
    });

    let result: EditResult =
        invoke(&w, "add_random_systems", args.clone()).expect("add three systems");
    let systems: Vec<&SystemNode> = result.delta.systems.iter().filter(|s| s.added).collect();
    assert_eq!(systems.len(), 3, "three systems added");
    let mut classes: Vec<&str> = systems.iter().map(|s| s.star_class.as_str()).collect();
    classes.sort_unstable();
    assert_eq!(classes, ["sc_g", "sc_k", "sc_m"]);
    let mut names: Vec<&str> = systems.iter().map(|s| s.name.key.as_str()).collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), 3, "no two share a name");
    assert_eq!(result.entry.description, "Added 3 systems");
    assert_eq!(result.history.undo.len(), 1, "one step");

    let first = systems.iter().min_by_key(|s| s.id).expect("a system").id;
    let rolled: EditResult = invoke(
        &w,
        "reroll_system",
        json!({ "system": first, "seed": 9, "starClass": "sc_f" }),
    )
    .expect("roll one of the new systems again");
    assert_eq!(added(&rolled).id, first);
    assert_eq!(added(&rolled).star_class, "sc_f");

    let undone = history_step(&w, "undo");
    assert_eq!(undone.history.undo.len(), 1, "the reroll is one step");
    let undone = history_step(&w, "undo");
    assert!(undone.history.undo.is_empty(), "one undo takes all three");
    assert_eq!(undone.delta.removed.len(), 3, "{:?}", undone.delta.removed);
}

#[test]
fn adding_systems_together_needs_a_save_and_game_data() {
    let w = webview();
    let args = json!({
        "seed": 1,
        "systems": [{ "x": 0.0, "y": 0.0, "star_class": "sc_g" }],
        "lanes": [],
        "description": "Added a system",
    });
    let refused =
        invoke::<EditResult>(&w, "add_random_systems", args.clone()).expect_err("no game data");
    assert_eq!(refused.kind, ErrorKind::Op);
    open(&w, SAMPLE);
    let refused =
        invoke::<EditResult>(&w, "add_random_systems", args.clone()).expect_err("no game data");
    assert!(refused.message.contains("game data"), "{}", refused.message);

    let Some((w, _)) = with_game_data(SAMPLE) else {
        return;
    };
    open(&w, SCENARIO);
    let refused =
        invoke::<EditResult>(&w, "add_random_systems", args).expect_err("a scenario is refused");
    assert_eq!(refused.kind, ErrorKind::Op, "{}", refused.message);
    assert_eq!(
        refused.message,
        "adding systems is not supported for a scenario document"
    );
}
