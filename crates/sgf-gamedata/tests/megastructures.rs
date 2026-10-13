//! The megastructure types and the starbase station models, on the fixture install, with a
//! mod over it, and on the real install when this machine has one.

use crate::common;

use sgf_core::ops::{NewBypass, Op};
use sgf_gamedata::generate::{AddSpot, megastructure_fits, megastructure_op};
use sgf_gamedata::registries::megastructures::{BuildType, Linked, Placement, Unsupported};
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
    assert!(tank.rotate_to_center, "the default");
    assert_eq!(
        tank.produces,
        [
            ("physics_research".to_owned(), 300.0),
            ("society_research".to_owned(), 150.0)
        ],
        "the file's @variable, and no upkeep"
    );

    let ring = gd.megastructures.get("fixture_ring").expect("fixture_ring");
    assert_eq!(ring.entity, None, "an empty entity is none");
    assert!(ring.place_entity_on_planet_plane && ring.scales_with_planet);
    assert_eq!(ring.entity_offset, (0.0, 0.0));
    assert_eq!(ring.construction_scale, 1.0);
    assert_eq!(ring.build_type, BuildType::InsideGravityWell);
    assert!(!ring.rotate_to_center);
    assert!(ring.produces.is_empty());

    let relay = gd
        .megastructures
        .get("fixture_relay")
        .expect("fixture_relay");
    assert_eq!(relay.build_type, BuildType::OutsideGravityWell);
    assert_eq!(relay.bypass_type.as_deref(), Some("relay_bypass"));
}

const INLINE_MATHS: &str = "@local = 2
fx_maths = {
	resources = {
		produces = {
			energy = @[ 4 * mult * 1000 ]
			minerals = @[ ( 1 + local ) * -2 ]
			alloys = @[ -( mult + 0.25 ) / 4 ]
			influence = @[10/@local]
			food = @[ unknown * 2 ]
			unity = @[ 4 * ]
			exotic_gases = @[ 1 / 0 ]
			volatile_motes = 3
		}
	}
}
";

/// A number written as inline maths, `@[ … ]`, is worked out, its names read as `@variables`.
/// One with a name no file defines, or that does not parse, is left out.
#[test]
fn a_produced_amount_written_as_inline_maths_is_worked_out() {
    let (_dir, gd) = common::hand_written(&[
        ("common/megastructures/00_fx.txt", INLINE_MATHS),
        ("common/scripted_variables/00_fx.txt", "@mult = 0.75\n"),
    ]);
    let maths = gd.megastructures.get("fx_maths").expect("fx_maths");
    assert_eq!(
        maths.produces,
        [
            ("energy".to_owned(), 3000.0),
            ("minerals".to_owned(), -6.0),
            ("alloys".to_owned(), -0.25),
            ("influence".to_owned(), 5.0),
            ("volatile_motes".to_owned(), 3.0),
        ]
    );
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
             \tentity_offset = { x = 5 y = 6 }\n}\nmod_tower = {\n\tentity = \"tower_entity\"\n}\n",
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
    assert!(
        tank.source.is_some() && tank.base_game,
        "the mod changed a base game type"
    );
    let tower = gd.megastructures.get("mod_tower").expect("mod_tower");
    assert!(tower.source.is_some() && !tower.base_game);
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
    let produces = |key: &str| mega(key).produces.clone();
    assert_eq!(produces("dyson_sphere_5"), [("energy".to_owned(), 4000.0)]);
    assert_eq!(
        produces("matter_decompressor_4"),
        [("minerals".to_owned(), 2000.0)]
    );
    let nexus_output: Vec<f64> = produces("think_tank_3").iter().map(|(_, n)| *n).collect();
    assert_eq!(nexus_output, [300.0; 3], "the file's @variables");
    assert!(produces("ring_world_ruined").is_empty());
    assert!(produces("dyson_sphere_1").is_empty());
    assert!(mega("ring_world_ruined").rotate_to_center);
    assert!(!mega("dyson_swarm_1").rotate_to_center);

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

#[test]
fn a_fixture_type_is_placed_by_its_build_type() {
    let gd = common::cached_fixture();
    let placement = |key: &str| gd.megastructures.get(key).expect(key).placement.clone();
    assert_eq!(
        placement("fixture_tank"),
        Placement::Body { star_only: false }
    );
    assert_eq!(
        placement("fixture_ring"),
        Placement::Free {
            outside_gravity_well: false
        }
    );
    assert_eq!(
        placement("fixture_relay"),
        Placement::Free {
            outside_gravity_well: true
        }
    );
}

/// A type that asks only for a star class, as a crossing built on a black hole does, may stand
/// on that star; one that asks for a planet class may not stand on any star.
#[test]
fn a_rule_naming_a_star_class_keeps_its_type_on_stars() {
    let (_dir, gd) = common::hand_written(&[
        (
            "common/planet_classes/mod.txt",
            "pc_black_hole = {
	star = yes
}
pc_molten = {
	colonizable = no
}
",
        ),
        (
            "common/megastructures/mod.txt",
            "mod_crossing = {
	placement_rules = { planet_possible = { is_planet_class = pc_black_hole } }
}
             mod_forge = {
	placement_rules = { planet_possible = { is_planet_class = pc_molten } }
}
             mod_unknown = {
	placement_rules = { planet_possible = { is_planet_class = pc_nowhere } }
}
",
        ),
    ]);
    let planet_only = |key: &str| gd.megastructures.get(key).expect(key).planet_only;
    assert!(!planet_only("mod_crossing"), "a star class");
    assert!(planet_only("mod_forge"), "a planet class");
    assert!(
        !planet_only("mod_unknown"),
        "a class the install does not define"
    );
}

/// The types whose first stage the game never builds on a star, which the editor keeps off
/// stars: by `is_star = no`, or by one planet class, as the Arc Furnace asks for molten
/// worlds.
#[test]
fn the_installs_planet_types_are_kept_off_stars() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let planet_only = |key: &str| {
        gd.megastructures
            .get(key)
            .unwrap_or_else(|| panic!("{key}"))
            .planet_only
    };
    for key in [
        "think_tank_3",
        "strategic_coordination_center_3",
        "strategic_coordination_center_ruined",
        "orbital_arc_furnace_1",
        "orbital_arc_furnace_4",
        "orbital_arc_furnace_destroyed",
        "spy_orb_ruined",
        "grand_archive_0",
        "behemoth_egg",
    ] {
        assert!(planet_only(key), "{key}");
    }
    for key in [
        "dyson_sphere_5",
        "dyson_sphere_ruined",
        "dyson_swarm_1",
        "gateway_final",
        "hyper_relay",
        "orbital_ring_ruined",
    ] {
        assert!(!planet_only(key), "{key}");
    }
}

/// A type hides its planet as an Arc Furnace does when its build gives the planet the
/// furnace's model and flag, at every stage built over it too. The model alone, as Giga's
/// Macroengineering Test Site gives it, and any other model hide nothing.
#[test]
fn a_type_hides_its_planet_by_the_furnaces_model_and_flag() {
    let (_dir, gd) = common::hand_written(&[(
        "common/megastructures/fx.txt",
        "fx_furnace_1 = {
	on_build_complete = {
		fromfrom.planet = {
			set_planet_flag = has_arc_furnace
			set_planet_entity = { entity = invisible_turret_entity }
		}
	}
}
fx_furnace_2 = {
	upgrade_from = { fx_furnace_1 }
}
fx_test_site = {
	on_build_complete = {
		fromfrom.planet = { set_planet_entity = { entity = invisible_turret_entity } }
	}
}
fx_shredder = {
	on_build_complete = {
		fromfrom.planet = {
			set_planet_flag = has_arc_furnace
			set_planet_entity = { entity = fx_shredded_planet_entity }
		}
	}
}
",
    )]);
    let hides = |key: &str| {
        gd.megastructures
            .get(key)
            .expect(key)
            .hides_planet_as_furnace
    };
    assert!(hides("fx_furnace_1") && hides("fx_furnace_2"));
    assert!(!hides("fx_test_site") && !hides("fx_shredder"));
}

/// The Arc Furnace hides its planet at every stage; the other types kept off stars do not.
#[test]
fn the_installs_arc_furnace_hides_its_planet() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let hides = |key: &str| {
        gd.megastructures
            .get(key)
            .unwrap_or_else(|| panic!("{key}"))
            .hides_planet_as_furnace
    };
    for key in ["orbital_arc_furnace_1", "orbital_arc_furnace_4"] {
        assert!(hides(key), "{key}");
    }
    for key in [
        "think_tank_3",
        "strategic_coordination_center_3",
        "spy_orb_4",
        "dyson_sphere_5",
    ] {
        assert!(!hides(key), "{key}");
    }
}

/// Gigastructural Engineering's types that give their planet a model of their own, or the
/// furnace's model without its flag, hide nothing as a furnace does, so they stay off stars. Runs with `SGF_PLAYSET=1` when the enabled mods include
/// Giga.
#[test]
fn gigas_planet_models_hide_nothing() {
    let Some(gd) = common::giga() else {
        return;
    };
    for key in [
        "atmosphere_shredder_0",
        "atmosphere_shredder_1",
        "macro_test_site_0",
        "macro_test_site_1",
        "lunar_disco_ball_2",
        "orbital_artificial_eco_3",
    ] {
        let def = gd
            .megastructures
            .get(key)
            .unwrap_or_else(|| panic!("{key}"));
        assert!(!def.hides_planet_as_furnace, "{key}");
    }
    assert!(
        gd.megastructures
            .get("orbital_arc_furnace_4")
            .expect("the furnace")
            .hides_planet_as_furnace
    );
}

#[test]
fn the_installs_megastructure_types_are_placed_as_the_game_builds_them() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mega = |key: &str| {
        gd.megastructures
            .get(key)
            .unwrap_or_else(|| panic!("{key}"))
    };
    let star = Placement::Body { star_only: true };
    let any = Placement::Body { star_only: false };
    let outside = Placement::Free {
        outside_gravity_well: true,
    };
    let inside = Placement::Free {
        outside_gravity_well: false,
    };
    let starbase = Placement::Unsupported {
        why: Unsupported::BecomesStarbase,
    };
    let ring_world = Placement::Unsupported {
        why: Unsupported::RingWorld,
    };
    let pins = [
        ("dyson_sphere_0", &star),
        ("dyson_sphere_5", &star),
        ("dyson_swarm_1", &star),
        ("matter_decompressor_4", &star),
        ("mega_shipyard_3", &star),
        ("quantum_catapult_0", &star),
        ("think_tank_3", &any),
        ("strategic_coordination_center_3", &any),
        ("orbital_arc_furnace_3", &any),
        ("orbital_ring_ruined", &any),
        ("hyper_relay", &outside),
        ("gateway_0", &outside),
        ("gateway_ruined", &outside),
        ("gateway_final", &outside),
        ("gateway_restored", &outside),
        ("gateway_derelict", &outside),
        ("lgate_base", &outside),
        ("hyper_relay_ruined", &outside),
        ("hyper_relay_restored", &outside),
        ("shroud_seal", &inside),
        ("deep_space_citadel_0", &starbase),
        ("waystation_megastructure", &starbase),
        ("ring_world_1", &star),
        ("ring_world_2", &ring_world),
        ("ring_world_ruined", &ring_world),
        ("galactic_crucible_0", &star),
        ("dyson_gun_0", &star),
        ("habitat_central_complex", &any),
        ("grand_archive_0", &any),
        ("cosmogenesis_world_0", &any),
        ("behemoth_egg", &any),
        ("dyson_sphere_ruined", &star),
        ("dyson_sphere_restored", &star),
        ("dyson_sphere_permanently_ruined", &star),
        ("matter_decompressor_ruined", &star),
        ("matter_decompressor_permanently_ruined", &star),
        ("quantum_catapult_ruined", &star),
        ("spy_orb_ruined", &any),
        ("spy_orb_permanently_ruined", &any),
        ("orbital_arc_furnace_destroyed", &any),
    ];
    for (key, placement) in pins {
        assert_eq!(&mega(key).placement, placement, "{key}");
    }
    for key in [
        "quantum_catapult_1",
        "quantum_catapult_2",
        "quantum_catapult_3",
    ] {
        assert!(
            matches!(
                mega(key).placement,
                Placement::Unsupported {
                    why: Unsupported::Bypass { .. }
                }
            ),
            "{key}: {:?}",
            mega(key).placement
        );
    }
    for key in [
        "think_tank_3",
        "dyson_swarm_2",
        "orbital_arc_furnace_3",
        "grand_archive_0",
        "orbital_ring",
    ] {
        assert!(mega(key).sets_has_megastructure, "{key}");
    }
    for key in ["orbital_ring_ruined", "dyson_sphere_ruined", "hyper_relay"] {
        assert!(!mega(key).sets_has_megastructure, "{key}");
    }
    for key in ["gateway_final", "gateway_restored", "gateway_derelict"] {
        assert!(mega(key).activates_gateway, "{key}");
    }
    assert!(!mega("gateway_ruined").activates_gateway);
    let family = |key: &str| mega(key).family.clone().map(|f| (f.working, f.linked));
    assert_eq!(
        family("dyson_sphere_ruined"),
        Some(("dyson_sphere_0".to_owned(), Linked::Stem))
    );
    assert_eq!(
        family("matter_decompressor_ruined"),
        Some(("matter_decompressor_1".to_owned(), Linked::Files))
    );
    assert_eq!(
        family("orbital_ring_ruined"),
        None,
        "its family becomes a starbase"
    );
    assert!(mega("orbital_ring_ruined").ruined_orbital_ring);
    assert_eq!(
        mega("dyson_sphere_ruined").variant_of.as_deref(),
        Some("dyson_sphere_0")
    );
    assert_eq!(
        mega("gateway_restored").variant_of.as_deref(),
        Some("gateway_0")
    );
    assert_eq!(mega("dyson_sphere_5").variant_of, None);
    assert!(gd.megastructures.iter().all(|def| def.base_game));
    assert!(!mega("orbital_ring").ruined_orbital_ring);
}

/// A stage that puts its one planet in a body's orbit and always removes its row stands in
/// the planet's place, as Cosmogenesis World does. One that removes its row only on a
/// condition leaves the planet beside it, a structure of several parts.
#[test]
fn a_planet_stands_in_its_row_only_when_the_row_always_goes() {
    let spawn =
        "spawn_planet = { class = pc_mod_world location = fromfrom.planet orbit_location = yes }";
    let (_dir, gd) = common::hand_written(&[(
        "common/megastructures/mod.txt",
        &format!(
            "mod_world = {{ on_build_complete = {{ {spawn} remove_megastructure = fromfrom }} }}
mod_maybe_world = {{ on_build_complete = {{ {spawn} if = {{ limit = {{ always = yes }} remove_megastructure = fromfrom }} }} }}
"
        ),
    )]);
    let placement = |key: &str| gd.megastructures.get(key).expect(key).placement.clone();
    assert_eq!(placement("mod_world"), Placement::Body { star_only: false });
    assert_eq!(
        placement("mod_maybe_world"),
        Placement::Unsupported {
            why: Unsupported::WholeStructure { star_only: false }
        }
    );
}

/// An L-Gate added in empty space of the 4.5 sample's Xu Nur (1) stands just outside the inner
/// radius as a gateway does, and its bypass is closed, as the game's are.
#[test]
fn an_lgate_goes_in_empty_space_with_a_closed_bypass() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let session = common::open_4_5();
    let spot = AddSpot::Space { x: 0.0, y: -10.0 };
    let fits = megastructure_fits(gd, &session, 1, spot).expect("the fits");
    let fit = |key: &str| {
        fits.iter()
            .find(|fit| fit.kind == key)
            .unwrap_or_else(|| panic!("{key}"))
    };
    let (lgate, gateway) = (fit("lgate_base"), fit("gateway_final"));
    assert_eq!(lgate.refusal, None);
    assert_eq!(lgate.place, gateway.place);
    let planned =
        megastructure_op(gd, &session, 1, "lgate_base", lgate.place, false).expect("the L-Gate");
    let Op::AddMegastructure { spec, .. } = planned.op else {
        panic!("{:?}", planned.op);
    };
    assert_eq!(
        spec.bypass,
        Some(NewBypass {
            kind: "lgate".to_owned(),
            active: false,
        })
    );
}
