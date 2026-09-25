//! Layering rules on the synthetic install: same key, same filename,
//! `replace_path`, missing mods and unparseable files, which layers hold
//! scenarios, and what counts as a file of the game data.

use crate::common;

use sgf_core::format::scenario::listings::{self, ScenarioSource};
use sgf_gamedata::Diagnostic;
use sgf_gamedata::LoadOptions;
use sgf_gamedata::install::mods::ModStatus;
use sgf_gamedata::install::scenarios::scenario_roots;
use sgf_gamedata::views::StarClassView;

use common::fixture;

#[test]
fn discovers_version_and_mods_in_load_order() {
    let gd = common::cached_fixture_with_mods();
    assert_eq!(gd.version.as_deref(), Some("v9.9.9"));
    assert_eq!(gd.layout.install, fixture("install"));

    let ids: Vec<&str> = gd.mods.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["one", "gone", "two"]);
    let statuses: Vec<ModStatus> = gd.mods.iter().map(|m| m.status).collect();
    assert_eq!(
        statuses,
        [ModStatus::Loaded, ModStatus::Missing, ModStatus::Loaded]
    );
    assert_eq!(gd.mods[0].name, "Mod One");
    assert_eq!(gd.mods[2].replace_paths, ["common/star_classes"]);

    let layers: Vec<&str> = gd.layout.layers.iter().map(|l| l.name.as_str()).collect();
    assert_eq!(layers, ["vanilla", "Mod One", "Mod Two"]);
    assert!(
        gd.diagnostics
            .iter()
            .any(|d| matches!(d, Diagnostic::ModMissing { id, .. } if id == "gone")),
        "{:?}",
        gd.diagnostics
    );
}

#[test]
fn same_key_in_a_later_file_wins_with_an_override_diagnostic() {
    let gd = common::cached_fixture_with_mods();
    let init = gd.initializers.get("basic_init_01").expect("basic_init_01");
    assert_eq!(init.class.as_deref(), Some("sc_ember"));
    assert_eq!(init.flags, ["modded"]);
    assert!(
        init.source.ends_with("zz_one.txt"),
        "{}",
        init.source.display()
    );
    assert_eq!(init.source.file_name().unwrap(), "zz_one.txt");
    assert!(gd.diagnostics.iter().any(|d| matches!(
        d,
        Diagnostic::Override { key, from, to }
            if key == "basic_init_01" && from.ends_with("00_a.txt") && to.ends_with("zz_one.txt")
    )));
    assert!(gd.initializers.get("mod_one_init").is_some());
}

#[test]
fn vanilla_only_load_ignores_mods() {
    let gd = common::cached_fixture();
    assert!(gd.mods.is_empty());
    assert_eq!(gd.layout.layers.len(), 1);
    let init = gd.initializers.get("basic_init_01").expect("basic_init_01");
    assert_eq!(init.class.as_deref(), Some("sc_sun"));
    assert!(gd.star_classes.get("sc_vanilla_only").is_some());
    assert!(gd.diagnostics.is_empty(), "{:?}", gd.diagnostics);
}

#[test]
fn replace_path_discards_the_vanilla_folder_and_same_filename_replaces() {
    let gd = common::cached_fixture_with_mods();
    assert!(gd.star_classes.get("sc_vanilla_only").is_none());
    assert!(gd.star_classes.get("sc_pit").is_none());
    let g = gd.star_classes.get("sc_sun").expect("sc_sun");
    assert_eq!(g.texture_icon(), "g_star_modded");
    assert_eq!(g.icon_scale, 1.5);
    assert_eq!(g.planet_keys, ["pc_sun_star"]);
    assert!(gd.star_classes.get("sc_two").is_some());
    assert_eq!(gd.star_classes.len(), 2);
    assert!(
        !gd.diagnostics
            .iter()
            .any(|d| matches!(d, Diagnostic::Override { key, .. } if key.starts_with("sc_")))
    );
}

#[test]
fn star_classes_read_hsv_colour_icon_scale_default_and_every_star_body() {
    let gd = common::cached_fixture();
    let k = gd.star_classes.get("sc_ember").expect("sc_ember");
    assert_eq!(k.class, "ember_star");
    assert_eq!(k.texture_icon(), "ember_star");
    assert_eq!(k.icon_scale, 1.0);
    let hole = gd.star_classes.get("sc_pit").expect("sc_pit");
    assert_eq!(hole.icon_scale, 2.0);
    assert_eq!(hole.planet_keys, ["pc_pit"]);
    let pair = gd.star_classes.get("sc_pair").expect("sc_pair");
    assert_eq!(pair.planet_keys, ["pc_sun_star", "pc_ember_star"]);
}

#[test]
fn star_classes_read_crisis_star_class_spawn_odds_and_localisation() {
    let gd = common::cached_fixture();
    let view = |key: &str| StarClassView::new(gd.star_classes.get(key).expect(key), &gd.loc);
    let sun = view("sc_sun");
    assert_eq!(sun.crisis_star_class.as_deref(), Some("sc_crisis_sun"));
    assert_eq!(sun.spawn_odds, 30.0);
    assert!(sun.localised);
    let crisis = view("sc_crisis_sun");
    assert_eq!(crisis.crisis_star_class, None);
    assert_eq!(crisis.spawn_odds, 0.0);
    assert!(!crisis.localised);
    assert_eq!(view("sc_by_variable").spawn_odds, 5.0);
}

#[test]
fn randomizer_lists_are_not_star_classes_but_a_placeholder_without_bodies_is() {
    let gd = common::cached_fixture();
    assert!(gd.star_classes.get("rl_pair_stars").is_none());
    let placeholder = gd
        .star_classes
        .get("sc_placeholder")
        .expect("sc_placeholder");
    assert!(placeholder.planet_keys.is_empty());
}

#[test]
fn a_file_with_a_syntax_error_is_skipped_with_a_diagnostic() {
    let gd = common::cached_fixture_with_mods();
    assert!(gd.initializers.get("broken_init").is_none());
    let error = gd
        .diagnostics
        .iter()
        .find(|d| matches!(d, Diagnostic::ParseError { .. }))
        .expect("parse error reported");
    let Diagnostic::ParseError { file, reason, .. } = error else {
        unreachable!()
    };
    assert!(file.ends_with("zz_broken.txt"), "{}", file.display());
    assert_eq!(reason, "unclosed '{'");
}

#[test]
fn a_file_in_a_subfolder_is_read_like_the_game_reads_it() {
    let gd = common::cached_fixture_with_mods();
    let nested = gd.initializers.get("nested_init").expect("nested_init");
    assert!(
        nested.source.ends_with("nested/nested_init.txt"),
        "{:?}",
        nested.source
    );
}

#[test]
fn initializers_read_flags_countries_spawns_and_ancestors() {
    let gd = common::cached_fixture();
    let lair = gd.initializers.get("lair_init").expect("lair_init");
    assert_eq!(lair.usage.as_deref(), Some("misc_system_init"));
    assert_eq!(lair.max_instances, Some(1));
    assert_eq!(lair.flags, ["guardian", "hostile_system"]);
    assert_eq!(lair.countries.len(), 1);
    let beast = &lair.countries[0];
    assert_eq!(beast.name_key, "NAME_Beast");
    assert_eq!(beast.country_type, "lurker_beast");
    let icon = beast.icon.as_ref().expect("icon");
    assert_eq!(icon.category, "synthetic");
    assert_eq!(icon.file, "flag_synthetic_1.dds");

    let traders = gd.initializers.get("trader_init").expect("trader_init");
    assert_eq!(traders.countries[0].name_key, "NAME_Traders");
    assert!(traders.countries[0].icon.is_none());

    let home = gd.initializers.get("fallen_home").expect("fallen_home");
    assert_eq!(home.spawns, ["fallen_colony"]);
    let colony = gd.initializers.get("fallen_colony").expect("fallen_colony");
    assert_eq!(colony.spawns, ["fallen_outpost"]);

    let ancestors: Vec<&str> = gd
        .initializers
        .ancestors("fallen_outpost")
        .iter()
        .map(|i| i.name.as_str())
        .collect();
    assert_eq!(ancestors, ["fallen_colony", "fallen_home"]);
    assert!(gd.initializers.ancestors("fallen_home").is_empty());

    let declared = gd.initializers.declared_flags();
    let flags: Vec<&str> = declared.iter().map(String::as_str).collect();
    assert_eq!(
        flags,
        [
            "ancient_wonders_system",
            "empire_home_system",
            "enclave",
            "fixture_region",
            "guardian",
            "hostile_system"
        ]
    );
}

#[test]
fn country_types_read_the_classifier_attributes() {
    let gd = common::cached_fixture_with_mods();
    let beast = gd.country_types.get("lurker_beast").expect("lurker_beast");
    assert!(beast.is_leviathan());
    let fauna = gd
        .country_types
        .get("roaming_fauna")
        .expect("roaming_fauna");
    assert!(fauna.space_creatures);
    assert!(!fauna.is_leviathan());
    assert!(gd.country_types.get("enclave").unwrap().is_enclave);
    assert!(gd.country_types.get("fallen_empire").unwrap().fallen_empire);
    assert!(gd.country_types.get("default").unwrap().playable);
    assert!(gd.country_types.get("mod_two_enclave").unwrap().is_enclave);
    assert!(gd.country_types.get("default").unwrap().generate_borders);
    assert!(fauna.generate_borders);
    let borderless = gd
        .country_types
        .get("borderless_fauna")
        .expect("borderless_fauna");
    assert!(!borderless.generate_borders);
    assert!(borderless.space_creatures);

    let views = gd.country_type_views();
    let names: Vec<&str> = views.iter().map(|v| v.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "borderless_fauna",
            "default",
            "enclave",
            "fallen_empire",
            "lurker_beast",
            "mod_two_enclave",
            "roaming_fauna"
        ]
    );
    let view = |name: &str| views.iter().find(|v| v.name == name).unwrap();
    assert!(!view("borderless_fauna").generate_borders);
    assert!(view("borderless_fauna").is_space_critter);
    assert!(view("lurker_beast").leviathan);
    assert!(!view("roaming_fauna").leviathan);
    assert!(view("default").playable && view("default").generate_borders);
}

#[test]
fn scenario_roots_rank_the_playset_and_carry_the_replace_path() {
    let gd = common::cached_fixture_with_mods();
    let roots = scenario_roots(Some(gd), None, None, &mut Vec::new());

    let listed: Vec<(&str, ScenarioSource, bool, Option<u32>, bool)> = roots
        .iter()
        .map(|r| {
            (
                r.mod_name.as_deref().unwrap_or("vanilla"),
                r.source,
                r.enabled,
                r.load_rank,
                r.replaces,
            )
        })
        .collect();
    assert_eq!(
        listed,
        [
            ("Mod One", ScenarioSource::UserMod, true, Some(1), true),
            ("Mod Three", ScenarioSource::UserMod, false, None, false),
            ("Mod Two", ScenarioSource::UserMod, true, Some(3), false),
            ("vanilla", ScenarioSource::Install, true, Some(0), false),
        ],
        "the missing mod holds rank 2, so the mod after it loads at 3"
    );
    assert_eq!(
        roots[0].dir,
        fixture("userdata/mod/one/map/setup_scenarios")
    );
    assert_eq!(roots[3].dir, fixture("install/map/setup_scenarios"));
}

#[test]
fn a_replace_path_hides_vanilla_and_the_last_mod_wins_a_shared_file_name() {
    let gd = common::cached_fixture_with_mods();
    let roots = scenario_roots(Some(gd), None, None, &mut Vec::new());
    let scenarios = listings::list_scenarios_in(&roots);

    let listed: Vec<(&str, u32, Option<&str>)> = scenarios
        .iter()
        .map(|s| (s.name.as_str(), s.systems, s.shadowed_by.as_deref()))
        .collect();
    assert_eq!(
        listed,
        [
            ("Fixture Shared One", 2, Some("Mod Two")),
            ("Fixture Three", 4, None),
            ("Fixture Shared Two", 3, None),
            ("Fixture Two Only", 1, None),
            ("Fixture Vanilla", 1, Some("Mod One")),
            ("Fixture Shared Vanilla", 1, Some("Mod One")),
        ]
    );
    assert!(
        scenarios.iter().all(|s| s.error.is_none()),
        "{scenarios:#?}"
    );
}

#[test]
fn scenario_roots_report_what_the_mod_descriptors_say() {
    let gd = common::cached_fixture_with_mods();
    let mut diagnostics = Vec::new();
    scenario_roots(Some(gd), None, None, &mut diagnostics);
    assert!(
        diagnostics
            .iter()
            .any(|d| matches!(d, Diagnostic::ModMissing { id, .. } if id == "gone")),
        "{diagnostics:?}"
    );
}

#[test]
fn a_sibling_whose_name_starts_with_the_install_is_not_game_data() {
    let gd = common::cached_fixture_with_mods();
    assert!(
        gd.layout
            .contains(&fixture("install/common/star_classes/00_star.txt"))
    );
    assert!(!gd.layout.contains(&fixture("install/nowhere.txt")));

    let tmp = tempfile::tempdir().expect("tempdir");
    let install = tmp.path().join("Stellaris");
    std::fs::create_dir_all(install.join("common")).expect("common");
    std::fs::create_dir_all(install.join("localisation")).expect("localisation");
    std::fs::write(install.join("common/00_fixture.txt"), "").expect("an install file");
    let sibling = tmp.path().join("Stellaris-evil");
    std::fs::create_dir_all(&sibling).expect("the sibling");
    std::fs::write(sibling.join("steal.txt"), "").expect("a file beside the install");

    let opts = LoadOptions {
        install: Some(install.clone()),
        user_dir: Some(tmp.path().join("user")),
        language: "english".to_owned(),
        mods: false,
    };
    let bare = sgf_gamedata::load(&opts, &mut |_| {}).expect("the bare install loads");
    assert!(bare.layout.contains(&install.join("common/00_fixture.txt")));
    assert!(!bare.layout.contains(&sibling.join("steal.txt")));
}
