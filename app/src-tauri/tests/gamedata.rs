//! Game-data IPC commands end to end, through the mock runtime, on the real sample save.
use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{Value, json};
use sgf_app_lib::state::GameDataState;
use sgf_app_lib::watch;
use sgf_core::format::save::details::SystemDetails;
use sgf_core::views::{ErrorKind, OpenResult, SearchHit, SearchKind};
use sgf_gamedata::install::layers::Layer;
use sgf_gamedata::special::{SpecialKind, SpecialSystem, SpecialSystems};
use sgf_gamedata::textures::TextureView;
use sgf_gamedata::views::{
    CountryTypeView, DepositView, GameDataSummary, InitializerView, MapColor, ResourceIcon,
    StarClassView,
};
use tauri::Manager;

mod common;
use common::{SAMPLE, have_install, invoke, kind, webview};

fn special_count(result: &SpecialSystems, kind: SpecialKind) -> u32 {
    result
        .counts
        .iter()
        .find(|c| c.kind == kind)
        .map(|c| c.count)
        .unwrap_or(0)
}

fn assert_sample_special_counts(result: &SpecialSystems) {
    let expected = [
        (SpecialKind::Leviathan, 6),
        (SpecialKind::Enclave, 14),
        (SpecialKind::Marauder, 6),
        (SpecialKind::Landmark, 11),
    ];
    for (kind, n) in expected {
        assert_eq!(special_count(result, kind), n, "{kind:?}");
    }
}

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

/// An enclave whose country an event spawns: no initializer creates one.
fn shroudwalker_enclave(result: &SpecialSystems) -> &SpecialSystem {
    result
        .systems
        .iter()
        .find(|s| s.initializer == "shroudwalker_enclave_init_01")
        .expect("the shroudwalker enclave")
}

fn resource(details: &SystemDetails, name: &str) -> Option<f64> {
    details
        .resources
        .iter()
        .find(|r| r.resource == name)
        .map(|r| r.amount)
}

#[test]
fn game_data_commands_degrade_without_an_install() {
    let w = webview();

    invoke::<Vec<String>>(&w, "save_dirs", json!({})).expect("save dirs");

    assert_eq!(
        kind(invoke::<SpecialSystems>(
            &w,
            "get_special_systems",
            json!({})
        )),
        ErrorKind::NoSession
    );
    assert_eq!(
        kind(invoke::<Vec<SystemDetails>>(
            &w,
            "get_system_details",
            json!({ "ids": [217] })
        )),
        ErrorKind::NoSession
    );

    invoke::<OpenResult>(&w, "open_save", json!({ "path": SAMPLE })).expect("open");

    let special: SpecialSystems =
        invoke(&w, "get_special_systems", json!({})).expect("special systems");
    assert!(!special.with_game_data);
    assert_sample_special_counts(&special);
    // The classifier builds the details projection itself, so a system named only by the
    // country standing in it is named on the first call.
    let shroudwalkers = shroudwalker_enclave(&special);
    assert_eq!(shroudwalkers.countries.len(), 1);
    assert_eq!(shroudwalkers.countries[0].country_type, "enclave");
    assert_eq!(shroudwalkers.label, "Covenant of the Shroud");

    invoke::<()>(&w, "warm_details", json!({})).expect("warm details");
    let special: SpecialSystems =
        invoke(&w, "get_special_systems", json!({})).expect("special systems");
    assert_sample_special_counts(&special);
    assert_eq!(
        shroudwalker_enclave(&special).label,
        "Covenant of the Shroud"
    );

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
    let star_classes: Vec<StarClassView> =
        invoke(&w, "get_star_classes", json!({})).expect("star classes");
    assert!(star_classes.is_empty());
    let deposits: Vec<DepositView> = invoke(&w, "get_deposits", json!({})).expect("deposits");
    assert!(deposits.is_empty());
    let initializers: Vec<InitializerView> =
        invoke(&w, "get_initializers", json!({})).expect("initializers");
    assert!(initializers.is_empty());
    let colors: Vec<MapColor> = invoke(&w, "get_map_colors", json!({})).expect("map colors");
    assert!(colors.is_empty());
    let country_types: Vec<CountryTypeView> =
        invoke(&w, "get_country_types", json!({})).expect("country types");
    assert!(country_types.is_empty());
    let icons: Vec<ResourceIcon> =
        invoke(&w, "get_resource_icons", json!({})).expect("resource icons");
    assert!(icons.is_empty());

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

    let details: Vec<SystemDetails> =
        invoke(&w, "get_system_details", json!({ "ids": [217, 9999] })).expect("details");
    assert_eq!(details.len(), 1, "unknown ids are skipped");
    let sol = &details[0];
    assert_eq!(sol.id, 217);
    assert!(!sol.with_game_data);
    assert_eq!(resource(sol, "energy"), Some(13.0));
    assert_eq!(resource(sol, "minerals"), Some(13.0));
    assert_eq!(resource(sol, "engineering"), Some(5.0));

    let hits: Vec<SearchHit> =
        invoke(&w, "search", json!({ "query": "sol", "limit": 5 })).expect("search");
    assert_eq!(hits[0].id, 217, "{hits:?}");
    assert_eq!(hits[0].name_key, "NAME_Sol");

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
fn game_data_commands_with_the_install() {
    if !have_install() {
        return;
    }
    let w = webview();
    invoke::<OpenResult>(&w, "open_save", json!({ "path": SAMPLE })).expect("open");

    let summary: GameDataSummary = invoke(&w, "load_game_data", json!({})).expect("load game data");
    assert_eq!(summary.version.as_deref(), Some("v4.4.6"));
    assert_eq!(summary.generation, 1, "the first load");
    assert!(
        summary.watch.watching >= 1,
        "the install, and a root per loaded mod"
    );
    assert_eq!(summary.watch.reason, None, "every root is watched");
    // A mod in the playset may shadow whole vanilla files, so only a floor is safe.
    assert!(summary.initializers >= 100, "{}", summary.initializers);
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

    let names: HashMap<String, String> = invoke(
        &w,
        "get_names",
        json!({ "keys": ["NAME_Sol", "NAME_Voidwyrm", "NAME_no_such_key"] }),
    )
    .expect("names");
    assert_eq!(names.get("NAME_Sol").map(String::as_str), Some("Sol"));
    assert_eq!(
        names.get("NAME_Voidwyrm").map(String::as_str),
        Some("Voidwyrm")
    );
    assert_eq!(names.len(), 2, "{names:?}");

    let sol_iii = json!({
        "key": "PLANET_NAME_FORMAT",
        "literal": false,
        "variables": [
            { "name": "PARENT", "value": { "key": "NAME_Sol", "literal": false, "variables": [] } },
            { "name": "NUMERAL", "value": { "key": "III", "literal": true, "variables": [] } },
        ],
    });
    let resolved: Vec<String> = invoke(
        &w,
        "resolve_names",
        json!({ "names": [sol_iii, cyggan_protectors()] }),
    )
    .expect("resolve names");
    assert_eq!(resolved, ["Sol III", "Cyggan Protectors"]);

    let star_classes: Vec<StarClassView> =
        invoke(&w, "get_star_classes", json!({})).expect("star classes");
    let black_hole = star_classes
        .iter()
        .find(|s| s.key == "sc_black_hole")
        .expect("sc_black_hole");
    assert_eq!(black_hole.texture_key, "star_class:black_hole");
    let deposits: Vec<DepositView> = invoke(&w, "get_deposits", json!({})).expect("deposits");
    let energy_3 = deposits
        .iter()
        .find(|d| d.key == "d_energy_3")
        .expect("d_energy_3");
    assert_eq!(energy_3.produces, vec![("energy".to_owned(), 3.0)]);
    let initializers: Vec<InitializerView> =
        invoke(&w, "get_initializers", json!({})).expect("initializers");
    assert_eq!(initializers.len(), summary.initializers as usize);
    let colors: Vec<MapColor> = invoke(&w, "get_map_colors", json!({})).expect("map colors");
    assert!(colors.iter().any(|c| c.name == "blue"), "{colors:?}");
    assert!(
        !invoke::<Vec<Value>>(&w, "get_planet_classes", json!({}))
            .expect("planet classes")
            .is_empty()
    );
    assert!(
        !invoke::<Vec<Value>>(&w, "get_starbase_levels", json!({}))
            .expect("starbase levels")
            .is_empty()
    );
    assert!(
        !invoke::<Vec<Value>>(&w, "get_ship_sizes", json!({}))
            .expect("ship sizes")
            .is_empty()
    );
    let country_types: Vec<CountryTypeView> =
        invoke(&w, "get_country_types", json!({})).expect("country types");
    assert!(
        country_types
            .windows(2)
            .all(|pair| pair[0].name < pair[1].name)
    );
    let country_type = |name: &str| {
        country_types
            .iter()
            .find(|c| c.name == name)
            .unwrap_or_else(|| panic!("no country type {name}"))
    };
    assert!(!country_type("enclave").generate_borders);
    assert!(country_type("dormant_marauders").generate_borders);
    assert!(country_type("default").playable);
    assert!(country_type("amoeba").is_space_critter);
    assert!(country_type("guardian_dragon").leviathan);
    let icons: Vec<ResourceIcon> =
        invoke(&w, "get_resource_icons", json!({})).expect("resource icons");
    let sprite = |resource: &str| {
        icons
            .iter()
            .find(|i| i.resource == resource)
            .map(|i| i.sprite.as_str())
    };
    assert_eq!(sprite("energy"), Some("GFX_resource_energy"));
    assert_eq!(sprite("physics_research"), Some("GFX_resource_physics"));
    assert!(sprite("sr_zro").is_some(), "{icons:?}");
    assert!(sprite("volatile_motes").is_some(), "{icons:?}");

    let textures: Vec<TextureView> = invoke(
        &w,
        "get_textures",
        json!({ "keys": ["star_class:g_star", "sprite:GFX_resource_energy", "nonsense"] }),
    )
    .expect("textures");
    assert_eq!(textures.len(), 3);
    assert_eq!(textures[0].error, None, "{:?}", textures[0].error);
    assert_eq!((textures[0].width, textures[0].height), (128, 128));
    assert!(
        textures[0]
            .png_base64
            .as_deref()
            .is_some_and(|b| b.starts_with("iVBORw0KGgo")),
        "base64 PNG"
    );
    assert_eq!(textures[1].error, None, "{:?}", textures[1].error);
    // A mod may ship its own icon at another size; vanilla's is 18 px square.
    assert!(textures[1].width > 0 && textures[1].width == textures[1].height);
    assert!(textures[2].error.is_some());

    let details: Vec<SystemDetails> =
        invoke(&w, "get_system_details", json!({ "ids": [217] })).expect("details");
    assert_eq!(details.len(), 1);
    let sol = &details[0];
    assert!(sol.with_game_data);
    assert_eq!(resource(sol, "energy"), Some(13.0), "{:?}", sol.resources);
    let earth = sol.planets.iter().find(|p| p.id == 3).expect("Earth");
    assert_eq!(earth.habitable, Some(true));

    // The dragon's system carries a random name, so the localised match is checked on
    // the Custodian Nexus, whose loc text shares no word with its key.
    let hits: Vec<SearchHit> = invoke(
        &w,
        "search",
        json!({ "query": "central processing", "limit": 5 }),
    )
    .expect("search");
    let systems: Vec<&SearchHit> = hits
        .iter()
        .filter(|h| matches!(h.kind, SearchKind::System))
        .collect();
    assert_eq!(systems.len(), 1, "{hits:?}");
    assert_eq!(systems[0].name_key, "NAME_Custodian_Nexus");
    let by_key: Vec<SearchHit> = invoke(
        &w,
        "search",
        json!({ "query": "custodian nexus", "limit": 5 }),
    )
    .expect("search");
    let by_key_systems: Vec<&SearchHit> = by_key
        .iter()
        .filter(|h| matches!(h.kind, SearchKind::System))
        .collect();
    assert_eq!(by_key_systems, systems, "the key still matches");
    let hits: Vec<SearchHit> =
        invoke(&w, "search", json!({ "query": "sol", "limit": 5 })).expect("search");
    assert_eq!(hits[0].id, 217);
    assert_eq!(hits[0].name_key, "NAME_Sol");

    let special: SpecialSystems =
        invoke(&w, "get_special_systems", json!({})).expect("special systems");
    assert!(special.with_game_data);
    assert_sample_special_counts(&special);
    let dragon = special
        .systems
        .iter()
        .find(|s| s.initializer == "guardians_init_dragon")
        .expect("the dragon's system");
    assert_eq!(dragon.primary, SpecialKind::Leviathan);
    assert_eq!(dragon.label, "Voidwyrm");

    // A mod may retune icon_scale, so vanilla's is read back from a mods-free load.
    let vanilla: GameDataSummary =
        invoke(&w, "load_game_data", json!({ "mods": false })).expect("vanilla load");
    assert_eq!(vanilla.version.as_deref(), Some("v4.4.6"));
    let star_classes: Vec<StarClassView> =
        invoke(&w, "get_star_classes", json!({})).expect("star classes");
    let black_hole = star_classes
        .iter()
        .find(|s| s.key == "sc_black_hole")
        .expect("sc_black_hole");
    assert_eq!(black_hole.icon_scale, 2.0);

    invoke::<()>(&w, "unload_game_data", json!({})).expect("unload");
    invoke::<()>(&w, "resume_auto_reload", json!({})).expect("resume with the watcher stopped");
    let summary: Option<GameDataSummary> =
        invoke(&w, "game_data_summary", json!({})).expect("summary");
    assert_eq!(summary, None);
    let names: HashMap<String, String> =
        invoke(&w, "get_names", json!({ "keys": ["NAME_Sol"] })).expect("names");
    assert!(names.is_empty());
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
