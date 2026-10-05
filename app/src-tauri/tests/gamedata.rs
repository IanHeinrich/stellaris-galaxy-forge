//! The game-data IPC commands end to end, through the mock runtime: each one answers empty
//! without game data and with data once the install is loaded. What the data says is the
//! gamedata crate's to test.
use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{Value, json};
use sgf_app_lib::state::GameDataState;
use sgf_app_lib::watch;
use sgf_core::views::{EditResult, ErrorKind};
use sgf_gamedata::install::layers::Layer;
use sgf_gamedata::textures::TextureView;
use sgf_gamedata::views::{FlagParts, GameDataSummary, InitializerView, PaintModView};
use tauri::Manager;

use crate::common;
use common::{SAMPLE, SAMPLE_45, have_install, install_version, invoke, kind, webview};

/// `%ADJECTIVE% Protectors` as the save writes it: a format key over two variables.
fn cyggan_protectors() -> Value {
    json!({
        "key": "%ADJECTIVE%",
        "literal": false,
        "variables": [
            {
                "name": "adjective",
                "value": { "key": "SPEC_Cyggan", "literal": false, "variables": [] },
            },
            {
                "name": "1",
                "value": { "key": "Protectors", "literal": true, "variables": [] },
            },
        ],
    })
}

/// The commands that answer with a list, with arguments that make the list non-empty once the
/// install is loaded.
fn list_commands() -> Vec<(&'static str, Value)> {
    vec![
        ("get_star_classes", json!({})),
        ("get_deposits", json!({})),
        (
            "get_deposit_choices",
            json!({ "class": "pc_arctic", "size": 15, "moon": false, "deposits": [] }),
        ),
        (
            "get_deposit_types",
            json!({ "keys": ["d_massive_glacier"] }),
        ),
        ("get_modifier_choices", json!({})),
        (
            "get_anomaly_choices",
            json!({ "class": "pc_asteroid", "size": 5, "moon": false }),
        ),
        ("get_dig_site_choices", json!({})),
        ("get_planet_models", json!({})),
        (
            "get_modifiers",
            json!({ "keys": ["pm_abundant_geothermal_activity"] }),
        ),
        ("get_colony_types", json!({ "keys": ["col_fe_colony"] })),
        ("get_bypasses", json!({})),
        ("get_initializers", json!({})),
        ("get_galaxy_shapes", json!({})),
        ("get_precursors", json!({})),
        ("get_map_colors", json!({})),
        ("get_planet_classes", json!({})),
        ("get_terraform_candidates", json!({})),
        ("get_starbase_levels", json!({})),
        ("get_ship_sizes", json!({})),
        ("get_country_types", json!({})),
        ("get_resource_icons", json!({})),
    ]
}

#[test]
fn game_data_commands_degrade_without_an_install() {
    let w = webview();
    common::open(&w, SAMPLE);

    for (command, args) in list_commands() {
        let list: Vec<Value> = invoke(&w, command, args)
            .unwrap_or_else(|e| panic!("{command} refused: {}", e.message));
        assert!(list.is_empty(), "{command}: {list:?}");
    }
    let lgate_mods: Vec<Value> =
        invoke(&w, "get_lgate_outcome_mods", json!({})).expect("lgate outcome mods");
    assert!(lgate_mods.is_empty());
    let flag_parts: FlagParts = invoke(&w, "get_flag_parts", json!({})).expect("flag parts");
    assert!(flag_parts.emblems.is_empty() && flag_parts.backgrounds.is_empty());
    let source: Option<String> =
        invoke(&w, "get_map_color_source", json!({})).expect("map colour source");
    assert_eq!(source, None);
    let font: Option<String> = invoke(&w, "get_map_font", json!({})).expect("map font");
    assert_eq!(font, None);

    let names: HashMap<String, String> =
        invoke(&w, "get_names", json!({ "keys": ["NAME_Sol"] })).expect("names");
    assert!(names.is_empty(), "{names:?}");
    let resolved: Vec<String> = invoke(
        &w,
        "resolve_names",
        json!({ "names": [cyggan_protectors()] }),
    )
    .expect("names resolve without game data");
    assert_eq!(resolved, ["SPEC_Cyggan Protectors"], "the save's stand-in");

    let textures: Vec<TextureView> = invoke(
        &w,
        "get_textures",
        json!({ "keys": ["star_class:g_star", "nonsense"] }),
    )
    .expect("textures never fail the call");
    assert_eq!(textures.len(), 2);
    for t in &textures {
        assert!(t.error.is_some(), "{t:?}");
        assert_eq!(t.png_base64, None);
    }
    assert_eq!(textures[0].key, "star_class:g_star");

    let paint: Option<PaintModView> =
        invoke(&w, "paint_mod", json!({})).expect("the launcher's files, or none");
    if let Some(dir) = paint.and_then(|p| p.scenarios_dir) {
        assert!(dir.ends_with("setup_scenarios"), "{dir}");
    }

    let summary: Option<GameDataSummary> =
        invoke(&w, "game_data_summary", json!({})).expect("summary");
    assert_eq!(summary, None);
    invoke::<()>(&w, "unload_game_data", json!({})).expect("unload with nothing loaded");
    invoke::<()>(&w, "resume_auto_reload", json!({})).expect("resume with nothing loaded");

    let err = invoke::<GameDataSummary>(
        &w,
        "load_game_data",
        json!({ "installPath": "no/such/install" }),
    )
    .expect_err("a directory without common/ is not an install");
    assert_eq!(err.kind, ErrorKind::NoInstall);
    assert!(err.message.contains("no/such/install"), "{}", err.message);
    let summary: Option<GameDataSummary> =
        invoke(&w, "game_data_summary", json!({})).expect("summary");
    assert_eq!(summary, None, "a failed load leaves nothing loaded");
}

#[test]
fn game_data_commands_answer_with_the_install() {
    let Some((w, _)) = common::with_game_data(SAMPLE) else {
        return;
    };

    for (command, args) in list_commands() {
        let list: Vec<Value> = invoke(&w, command, args)
            .unwrap_or_else(|e| panic!("{command} refused: {}", e.message));
        assert!(!list.is_empty(), "{command} answered empty");
    }
    invoke::<Vec<Value>>(&w, "get_lgate_outcome_mods", json!({})).expect("lgate outcome mods");
    let flag_parts: FlagParts = invoke(&w, "get_flag_parts", json!({})).expect("flag parts");
    assert!(!flag_parts.emblems.is_empty() && !flag_parts.backgrounds.is_empty());
    invoke::<Option<String>>(&w, "get_map_color_source", json!({})).expect("map colour source");
    let font: Option<String> = invoke(&w, "get_map_font", json!({})).expect("map font");
    assert!(
        font.is_some_and(|f| !f.is_empty()),
        "the install's map font"
    );

    let names: HashMap<String, String> = invoke(
        &w,
        "get_names",
        json!({ "keys": ["NAME_Sol", "NAME_no_such_key"] }),
    )
    .expect("names");
    assert_eq!(names.get("NAME_Sol").map(String::as_str), Some("Sol"));
    assert_eq!(names.len(), 1, "only the keys that resolved: {names:?}");
    let resolved: Vec<String> = invoke(
        &w,
        "resolve_names",
        json!({ "names": [cyggan_protectors()] }),
    )
    .expect("resolve names");
    assert_eq!(resolved, ["Cyggan Protectors"]);

    let textures: Vec<TextureView> = invoke(
        &w,
        "get_textures",
        json!({ "keys": ["star_class:g_star", "nonsense"] }),
    )
    .expect("textures");
    assert_eq!(textures.len(), 2);
    assert_eq!(textures[0].error, None, "{:?}", textures[0].error);
    assert!(textures[0].width > 0 && textures[0].height > 0);
    assert!(
        textures[0]
            .png_base64
            .as_deref()
            .is_some_and(|b| b.starts_with("iVBORw0KGgo")),
        "base64 PNG"
    );
    assert!(textures[1].error.is_some());
}

#[test]
fn game_data_loads_reports_unloads_and_survives_a_failed_load() {
    if !have_install() {
        return;
    }
    let w = webview();
    common::open(&w, SAMPLE);

    let summary: GameDataSummary =
        invoke(&w, "load_game_data", json!({ "mods": false })).expect("load game data");
    assert_eq!(summary.version, install_version());
    assert_eq!(summary.generation, 1, "the first load");
    assert!(
        summary.watch.watching >= 1,
        "the install, and a root per loaded mod"
    );
    assert_eq!(summary.watch.reason, None, "every root is watched");
    let initializers: Vec<InitializerView> =
        invoke(&w, "get_initializers", json!({})).expect("initializers");
    assert_eq!(initializers.len(), summary.initializers as usize);
    let again: Option<GameDataSummary> =
        invoke(&w, "game_data_summary", json!({})).expect("summary");
    assert_eq!(again.as_ref(), Some(&summary));

    let err = invoke::<GameDataSummary>(
        &w,
        "load_game_data",
        json!({ "installPath": "no/such/install" }),
    )
    .expect_err("a directory without common/ is not an install");
    assert_eq!(err.kind, ErrorKind::NoInstall);
    let after: Option<GameDataSummary> =
        invoke(&w, "game_data_summary", json!({})).expect("summary");
    assert_eq!(
        after.as_ref(),
        Some(&summary),
        "a failed load leaves the data loaded and the watcher running"
    );

    invoke::<()>(&w, "unload_game_data", json!({})).expect("unload");
    invoke::<()>(&w, "resume_auto_reload", json!({})).expect("resume with the watcher stopped");
    let summary: Option<GameDataSummary> =
        invoke(&w, "game_data_summary", json!({})).expect("summary");
    assert_eq!(summary, None);
    let names: HashMap<String, String> =
        invoke(&w, "get_names", json!({ "keys": ["NAME_Sol"] })).expect("names");
    assert!(names.is_empty());
}

/// The shell opens a link or a file only from the lists it holds, and refuses the rest before
/// anything is handed to the system.
#[test]
fn a_link_or_a_file_outside_the_apps_lists_is_not_opened() {
    let w = webview();
    assert_eq!(
        kind(invoke::<()>(
            &w,
            "open_url",
            json!({ "url": "https://example.com/" })
        )),
        ErrorKind::NotFound
    );
    assert_eq!(
        kind(invoke::<()>(
            &w,
            "open_script",
            json!({ "path": SAMPLE, "reveal": false })
        )),
        ErrorKind::Op,
        "no game data, no script index"
    );

    let Some((w, _)) = common::with_game_data(SAMPLE) else {
        return;
    };
    assert_eq!(
        kind(invoke::<()>(
            &w,
            "open_script",
            json!({ "path": SAMPLE, "reveal": false })
        )),
        ErrorKind::NotFound,
        "a save is not a file of the loaded game data"
    );
}

/// A root the watcher cannot hold is named in the summary instead of being counted out.
#[test]
fn a_root_that_cannot_be_watched_is_named_in_the_summary() {
    let dir = tempfile::tempdir().expect("tempdir");
    let install = dir.path().join("install");
    std::fs::create_dir_all(install.join("common")).expect("common");
    std::fs::create_dir_all(install.join("localisation")).expect("localisation");
    let w = webview();

    let summary: GameDataSummary = invoke(
        &w,
        "load_game_data",
        json!({ "installPath": install.to_string_lossy(), "mods": false }),
    )
    .expect("load the seeded install");
    assert_eq!(summary.watch.watching, 1, "the install's own root");
    assert_eq!(summary.watch.reason, None);

    let app = w.app_handle();
    let state = app.state::<GameDataState>();
    let mut degraded = (*state.loaded().expect("the loaded game data")).clone();
    degraded.layout.layers.push(Layer {
        name: "gone".to_owned(),
        root: dir.path().join("no-such-mod"),
        replace_paths: Vec::new(),
    });
    let degraded = Arc::new(degraded);
    state.store(Some(Arc::clone(&degraded)));
    watch::start(app, &degraded);

    let summary: Option<GameDataSummary> =
        invoke(&w, "game_data_summary", json!({})).expect("summary");
    let watched = summary.expect("game data is loaded").watch;
    assert_eq!(watched.watching, 1, "the install is watched as before");
    let reason = watched.reason.expect("the root that could not be watched");
    assert!(reason.contains("no-such-mod"), "{reason}");
}

/// An install whose defines put a system's inner radius 50 past its outermost belt: a belt
/// added far out grows the inner radius by that offset, whether the game data loaded after
/// the save opened or before.
#[test]
fn an_op_sizes_the_system_by_the_loaded_installs_defines() {
    let dir = tempfile::tempdir().expect("temp dir");
    let install = dir.path().join("install");
    for (rel, text) in [
        (
            "common/defines/00_defines.txt",
            "NGameplay = {\n\tSYSTEM_INNER_RADIUS_OFFSET = 50\n}\n",
        ),
        ("localisation/english/fx_l_english.yml", "l_english:\n"),
    ] {
        let file = install.join(rel);
        std::fs::create_dir_all(file.parent().expect("a directory")).expect("the install tree");
        std::fs::write(file, text).expect("an install file");
    }
    let far_belt = json!({ "op": {
        "type": "AddBelt", "system": 1, "kind": "rocky_asteroid_belt", "radius": 1000.0
    } });
    let grown = |w: &_| {
        let result: EditResult = invoke(w, "apply_op", far_belt.clone()).expect("the belt");
        result.entry.description
    };

    let w = common::opened(SAMPLE_45);
    invoke::<Value>(
        &w,
        "load_game_data",
        json!({ "installPath": install, "mods": false }),
    )
    .unwrap_or_else(|e| panic!("load game data: {}", e.message));
    let description = grown(&w);
    assert!(description.ends_with(" to 1050"), "{description}");

    common::open(&w, SAMPLE_45);
    let description = grown(&w);
    assert!(description.ends_with(" to 1050"), "{description}");
}
