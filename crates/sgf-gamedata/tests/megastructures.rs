//! The megastructure types and the starbase station models, on the fixture install, with a
//! mod over it, and on the real install when this machine has one.

use crate::common;

use sgf_gamedata::registries::megastructures::BuildType;
use sgf_gamedata::views::StarbaseLevelView;
use sgf_gamedata::{Diagnostic, RegistryKind};

#[test]
fn a_megastructure_type_names_its_models_offset_and_placement() {
    let gd = common::cached_fixture();
    let tank = gd.megastructures.get("fixture_tank").expect("fixture_tank");
    assert_eq!(tank.entity.as_deref(), Some("fixture_tank_entity"));
    assert_eq!(
        tank.construction_entity.as_deref(),
        Some("fixture_platform_entity")
    );
    assert_eq!(tank.entity_offset, (0.0, -20.0), "the file's @variable");
    assert_eq!(tank.construction_scale, 1.02);
    assert!(!tank.place_entity_on_planet_plane && !tank.scales_with_planet);
    assert_eq!(tank.build_type, BuildType::AroundPlanet, "the default");
    assert_eq!(tank.upgrade_from, ["fixture_tank_0"]);
    assert_eq!(tank.bypass_type, None);

    let ring = gd.megastructures.get("fixture_ring").expect("fixture_ring");
    assert_eq!(ring.entity, None, "an empty entity is none");
    assert!(ring.place_entity_on_planet_plane && ring.scales_with_planet);
    assert_eq!(ring.entity_offset, (0.0, 0.0));
    assert_eq!(ring.construction_scale, 1.0);
    assert_eq!(ring.build_type, BuildType::InsideGravityWell);

    let relay = gd
        .megastructures
        .get("fixture_relay")
        .expect("fixture_relay");
    assert_eq!(relay.build_type, BuildType::OutsideGravityWell);
    assert_eq!(relay.bypass_type.as_deref(), Some("relay_bypass"));
}

#[test]
fn a_starbase_level_names_the_model_of_its_sizes_first_section_slot() {
    let gd = common::cached_fixture();
    let hut = gd
        .starbase_levels
        .get("starbase_level_hut")
        .expect("starbase_level_hut");
    assert_eq!(
        hut.station_entity.as_deref(),
        Some("fixture_hut_section_entity"),
        "the core slot's template, not the module's"
    );
    assert_eq!(
        StarbaseLevelView::from(hut).station_entity.as_deref(),
        Some("fixture_hut_section_entity")
    );
    let roamer = gd
        .starbase_levels
        .get("starbase_level_roamer")
        .expect("starbase_level_roamer");
    assert_eq!(roamer.station_entity, None, "its size has no section slots");
    assert!(
        StarbaseLevelView::from(roamer).scales_with_planet,
        "its size's"
    );
    assert!(!hut.scales_with_planet);
}

#[test]
fn a_mod_overrides_a_megastructure_type_and_a_section_template_by_key() {
    let (_dir, gd) = common::scripts::install_with_mod(&[
        (
            "common/megastructures/zz_tank.txt",
            "fixture_tank = {\n\tentity = \"mod_tank_entity\"\n\
             \tentity_offset = { x = 5 y = 6 }\n}\n",
        ),
        (
            "common/section_templates/zz_hut.txt",
            "ship_section_template = {\n\tkey = \"HUT_CORE\"\n\tship_size = starbase_hut\n\
             \tfits_on_slot = \"core\"\n\tentity = \"mod_hut_section_entity\"\n}\n",
        ),
    ]);
    let tank = gd.megastructures.get("fixture_tank").expect("fixture_tank");
    assert_eq!(tank.entity.as_deref(), Some("mod_tank_entity"));
    assert_eq!(tank.entity_offset, (5.0, 6.0));
    assert!(gd.megastructures.get("fixture_relay").is_some());
    let hut = gd
        .starbase_levels
        .get("starbase_level_hut")
        .expect("starbase_level_hut");
    assert_eq!(
        hut.station_entity.as_deref(),
        Some("mod_hut_section_entity")
    );
    let overridden = gd.diagnostics.iter().find_map(|d| match d {
        Diagnostic::Override { key, from, to } if key == "HUT_CORE" => Some((from, to)),
        _ => None,
    });
    let (from, to) = overridden.expect("the mod's HUT_CORE is reported");
    assert!(from.ends_with("00_fixture.txt") && to.ends_with("zz_hut.txt"));
    assert_eq!(
        RegistryKind::classify(&gd.layout, to),
        Some(RegistryKind::Definitions),
        "a change to the mod's file rereads the templates"
    );
}

/// A key sorting before the fixture's `HUT_CORE` and one sorting after it both win, so the
/// choice follows load order rather than the key.
#[test]
fn the_template_latest_in_load_order_names_the_station_whatever_its_key() {
    for key in ["AAA_HUT_CORE", "ZZZ_HUT_CORE"] {
        let template = format!(
            "ship_section_template = {{\n\tkey = \"{key}\"\n\tship_size = starbase_hut\n\
             \tfits_on_slot = \"core\"\n\tentity = \"mod_hut_section_entity\"\n}}\n"
        );
        let (_dir, gd) = common::scripts::install_with_mod(&[(
            "common/section_templates/zz_hut.txt",
            &template,
        )]);
        assert!(gd.section_templates.get("HUT_CORE").is_some());
        let hut = gd
            .starbase_levels
            .get("starbase_level_hut")
            .expect("starbase_level_hut");
        assert_eq!(
            hut.station_entity.as_deref(),
            Some("mod_hut_section_entity"),
            "{key}"
        );
    }
}

#[test]
fn the_installs_megastructure_types_and_station_models() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mega = |key: &str| {
        gd.megastructures
            .get(key)
            .unwrap_or_else(|| panic!("{key}"))
    };
    let nexus = mega("think_tank_3");
    assert_eq!(nexus.entity_offset, (0.0, -20.0));
    assert_eq!(nexus.entity.as_deref(), Some("thinktank_phase_03_entity"));
    assert_eq!(nexus.upgrade_from, ["think_tank_2"]);
    let ring = mega("orbital_ring");
    assert!(ring.scales_with_planet && ring.place_entity_on_planet_plane);
    assert_eq!(ring.entity, None);
    for key in ["hyper_relay", "gateway_0"] {
        assert_eq!(mega(key).build_type, BuildType::OutsideGravityWell, "{key}");
    }
    assert_eq!(
        mega("hyper_relay").bypass_type.as_deref(),
        Some("relay_bypass")
    );
    assert_eq!(
        mega("dyson_sphere_5").entity.as_deref(),
        Some("dyson_sphere_phase_05_entity")
    );

    let station = |level: &str| {
        gd.starbase_levels
            .get(level)
            .unwrap_or_else(|| panic!("{level}"))
            .station_entity
            .as_deref()
    };
    assert_eq!(
        station("starbase_level_outpost"),
        Some("starbase_outpost_section_entity")
    );
    assert_eq!(
        station("starbase_level_citadel"),
        Some("starbase_citadel_section_entity")
    );
}
