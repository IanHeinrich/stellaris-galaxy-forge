//! The megastructure types and the starbase station models, on the fixture install, with a
//! mod over it, and on the real install when this machine has one.

use crate::common;

use sgf_core::format::save::site::{ConstructionSite, SiteBody};
use sgf_core::ops::{
    ConstructionDeposit, ConstructionModifier, MegastructureConstruction, MegastructureDismantle,
    ModifierHost, VariableDrop, VariableRaise,
};
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
    let bypass = |kind: &str| Placement::Unsupported {
        why: Unsupported::Bypass {
            bypass: kind.to_owned(),
        },
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
        ("shroud_seal", &inside),
        ("deep_space_citadel_0", &starbase),
        ("waystation_megastructure", &starbase),
        ("ring_world_1", &ring_world),
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
    assert_eq!(mega("lgate_base").placement, bypass("lgate"));
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
    assert!(!mega("orbital_ring").ruined_orbital_ring);
}

/// What each vanilla type's dismantle takes back, followed through the scripted effects it
/// calls: an Arc Furnace its stage modifiers, deposits and counter, a Dyson Swarm its star's
/// modifier and counter, the Shroud Seal its system's modifier. A type the game cannot
/// dismantle takes back nothing.
#[test]
fn the_install_says_what_a_dismantle_takes_back() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let dismantle = |key: &str| {
        gd.megastructures
            .get(key)
            .unwrap_or_else(|| panic!("{key}"))
            .dismantle
            .clone()
    };
    let lowers = |variable: &str| {
        vec![VariableDrop {
            variable: variable.to_owned(),
            by: 1,
        }]
    };
    let furnace = MegastructureDismantle {
        modifiers: (1..=4)
            .map(|n| format!("orbital_arc_furnace_{n}_mod"))
            .collect(),
        deposits: (1..=4).map(|n| format!("d_arc_furnace_{n}")).collect(),
        variables: lowers("arc_furnace_counter"),
    };
    for stage in 1..=4 {
        assert_eq!(dismantle(&format!("orbital_arc_furnace_{stage}")), furnace);
    }
    for stage in 1..=3 {
        assert_eq!(
            dismantle(&format!("dyson_swarm_{stage}")),
            MegastructureDismantle {
                modifiers: vec![format!("dyson_swarm_{stage}_mod")],
                deposits: Vec::new(),
                variables: lowers("dyson_swarm_counter"),
            }
        );
    }
    assert_eq!(
        dismantle("shroud_seal"),
        MegastructureDismantle {
            modifiers: vec!["shroud_seal_modifier".to_owned()],
            ..MegastructureDismantle::default()
        },
        "through the scripted effect it calls"
    );
    for kept in [
        "dyson_sphere_5",
        "think_tank_3",
        "hyper_relay",
        "gateway_final",
    ] {
        assert!(dismantle(kept).is_empty(), "{kept}");
    }
}

/// A mod's dismantle is read the same way: a scripted effect's parameters are filled in from
/// the call, and `subtract_variable` on the owner lowers it as `change_variable` does.
#[test]
fn a_dismantle_follows_the_parameters_it_passes() {
    let (_dir, gd) = common::hand_written(&[
        (
            "common/megastructures/mod.txt",
            "mod_furnace = {\n\ton_dismantle_complete = {\n\t\tevery_system_planet = {\n\t\t\tlimit = { remove_modifier = in_a_limit }\n\t\t\tmod_take_back = { STAGE = 2 }\n\t\t}\n\t\tfrom = {\n\t\t\tsubtract_variable = { which = mod_furnaces value = 2 }\n\t\t\tremove_modifier = on_the_owner\n\t\t}\n\t}\n}\n",
        ),
        (
            "common/scripted_effects/mod.txt",
            "mod_take_back = {\n\tremove_modifier = mod_furnace_$STAGE$_mod\n\tremove_deposit = d_mod_furnace_$STAGE$\n}\n",
        ),
    ]);
    let furnace = gd.megastructures.get("mod_furnace").expect("mod_furnace");
    assert_eq!(
        furnace.dismantle,
        MegastructureDismantle {
            modifiers: vec!["mod_furnace_2_mod".to_owned()],
            deposits: vec!["d_mod_furnace_2".to_owned()],
            variables: vec![VariableDrop {
                variable: "mod_furnaces".to_owned(),
                by: 2,
            }],
        }
    );
}

fn body(id: u32, class: &str, deposits: &[&str]) -> SiteBody {
    SiteBody {
        id,
        class: class.to_owned(),
        deposits: deposits.iter().map(|d| (*d).to_owned()).collect(),
        ..SiteBody::default()
    }
}

/// A system laid out like Soyun in a late 4.5 game: a star, a barren world whose society
/// deposit a research station works, the molten world the structure stands at, a gas
/// giant with a mineral deposit and a colonised continental world.
fn soyun() -> ConstructionSite {
    ConstructionSite {
        system: 582,
        bodies: vec![
            SiteBody {
                star: true,
                ..body(6138, "pc_m_giant_star", &["d_energy_2"])
            },
            body(6139, "pc_barren", &["d_society_3"]),
            body(6141, "pc_molten", &[]),
            body(6146, "pc_gas_giant", &["d_minerals_2"]),
            SiteBody {
                colony: true,
                ..body(6152, "pc_continental", &[])
            },
        ],
        ..ConstructionSite::default()
    }
}

/// An Arc Furnace's stages replayed from the first: only the last stage's modifier and
/// deposit stay, on the planets its event picks. A Dyson Swarm leaves its last stage's
/// modifier on its star, the Shroud Seal its modifier on the system, and a Dyson Sphere, a
/// Science Nexus and a Hyper Relay nothing.
#[test]
fn the_installs_construction_is_replayed_on_a_system() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let site = soyun();
    let replay = |key: &str, host: Option<u32>| {
        gd.megastructures
            .get(key)
            .unwrap_or_else(|| panic!("{key}"))
            .construction
            .replay(gd, &site, host, true)
            .construction
    };
    let furnace = |stage: u32| MegastructureConstruction {
        modifiers: [6141, 6146]
            .into_iter()
            .map(|body| ConstructionModifier {
                on: ModifierHost::Body { body },
                modifier: format!("orbital_arc_furnace_{stage}_mod"),
                days: -1,
            })
            .collect(),
        deposits: [6141, 6146]
            .into_iter()
            .map(|body| ConstructionDeposit {
                body,
                kind: format!("d_arc_furnace_{stage}"),
            })
            .collect(),
        variables: vec![VariableRaise {
            variable: "arc_furnace_counter".to_owned(),
            by: 1,
        }],
    };
    assert_eq!(replay("orbital_arc_furnace_1", Some(6141)), furnace(1));
    assert_eq!(replay("orbital_arc_furnace_4", Some(6141)), furnace(4));
    assert_eq!(
        replay("dyson_swarm_3", Some(6138)),
        MegastructureConstruction {
            modifiers: vec![ConstructionModifier {
                on: ModifierHost::Body { body: 6138 },
                modifier: "dyson_swarm_3_mod".to_owned(),
                days: -1,
            }],
            deposits: Vec::new(),
            variables: vec![VariableRaise {
                variable: "dyson_swarm_counter".to_owned(),
                by: 1,
            }],
        }
    );
    assert_eq!(
        replay("shroud_seal", None),
        MegastructureConstruction {
            modifiers: vec![ConstructionModifier {
                on: ModifierHost::System,
                modifier: "shroud_seal_modifier".to_owned(),
                days: -1,
            }],
            ..MegastructureConstruction::default()
        }
    );
    for (key, host) in [
        ("dyson_sphere_5", Some(6138)),
        ("think_tank_3", Some(6146)),
        ("hyper_relay", None),
    ] {
        assert!(replay(key, host).is_empty(), "{key}");
    }
    let unowned = gd
        .megastructures
        .get("orbital_arc_furnace_4")
        .expect("orbital_arc_furnace_4")
        .construction
        .replay(gd, &site, Some(6141), false);
    assert!(unowned.construction.variables.is_empty());
}

/// A mod's construction is read the same way: a scripted effect's parameters filled in,
/// an event it fires followed, and a limit the editor cannot judge left out and said so.
#[test]
fn a_construction_follows_effects_and_events_and_says_what_it_cannot() {
    let (_dir, gd) = common::hand_written(&[
        (
            "common/megastructures/mod.txt",
            "mod_forge = {
	on_build_start = {
		from = { change_variable = { which = mod_forges value = 2 } }
	}
	on_build_complete = {
		fromfrom.planet = { mod_mark = { LEVEL = 3 } }
		from = { country_event = { id = modforge.1 } }
		random_system_planet = { add_modifier = { modifier = mod_random days = -1 } }
	}
}
",
        ),
        (
            "common/scripted_effects/mod.txt",
            "mod_mark = {
	add_modifier = { modifier = mod_forge_$LEVEL$_mod days = 360 }
}
",
        ),
        (
            "events/mod.txt",
            "namespace = modforge
country_event = {
	id = modforge.1
	is_triggered_only = yes
	immediate = {
		fromfromfrom = {
			solar_system = {
				every_system_planet = {
					limit = { is_star = no }
					add_deposit = d_mod_forge
				}
				every_system_planet = {
					limit = { has_owner = yes }
					add_deposit = d_mod_owned
				}
			}
		}
	}
}
",
        ),
    ]);
    let forge = &gd
        .megastructures
        .get("mod_forge")
        .expect("mod_forge")
        .construction;
    let site = ConstructionSite {
        system: 1,
        bodies: vec![
            SiteBody {
                star: true,
                ..body(10, "pc_g_star", &[])
            },
            body(11, "pc_molten", &[]),
        ],
        ..ConstructionSite::default()
    };
    let built = forge.replay(&gd, &site, Some(11), true);
    assert_eq!(
        built.construction,
        MegastructureConstruction {
            modifiers: vec![ConstructionModifier {
                on: ModifierHost::Body { body: 11 },
                modifier: "mod_forge_3_mod".to_owned(),
                days: 360,
            }],
            deposits: vec![ConstructionDeposit {
                body: 11,
                kind: "d_mod_forge".to_owned(),
            }],
            variables: vec![VariableRaise {
                variable: "mod_forges".to_owned(),
                by: 2,
            }],
        }
    );
    assert_eq!(built.skipped.len(), 3, "{:?}", built.skipped);
    assert!(
        built.skipped[0].contains("random_system_planet"),
        "{:?}",
        built.skipped
    );
    assert!(
        built.skipped[1].contains("planet 10: cannot judge has_owner"),
        "{:?}",
        built.skipped
    );
}

/// A mod's ruin takes the placement of the type a scripted effect spawns it in place of,
/// though their keys share no stem.
#[test]
fn a_ruin_a_scripted_effect_spawns_takes_its_working_types_placement() {
    let (_dir, gd) = common::hand_written(&[
        (
            "common/megastructures/mod.txt",
            "mod_beacon_1 = {\n\tplacement_rules = { planet_possible = { is_star = yes } }\n}\nmod_wreck = {\n\tentity = \"wreck_entity\"\n}\n",
        ),
        (
            "common/scripted_effects/mod.txt",
            "mod_ruin_it = {\n\tif = {\n\t\tlimit = { is_megastructure_type = mod_beacon_1 }\n\t\tsolar_system = { spawn_megastructure = { type = \"mod_wreck\" coords_from = prev } }\n\t}\n}\n",
        ),
    ]);
    let wreck = gd.megastructures.get("mod_wreck").expect("mod_wreck");
    assert_eq!(
        wreck.placement,
        Placement::Body { star_only: false },
        "no variant suffix"
    );
    let (_dir, gd) = common::hand_written(&[
        (
            "common/megastructures/mod.txt",
            "mod_beacon_1 = {\n\tplacement_rules = { planet_possible = { is_star = yes } }\n}\nmod_tower_ruined = {\n\tentity = \"wreck_entity\"\n}\n",
        ),
        (
            "common/scripted_effects/mod.txt",
            "mod_ruin_it = {\n\tif = {\n\t\tlimit = { is_megastructure_type = mod_beacon_1 }\n\t\tsolar_system = { spawn_megastructure = { type = \"mod_tower_ruined\" coords_from = prev } }\n\t}\n}\n",
        ),
    ]);
    let ruin = gd
        .megastructures
        .get("mod_tower_ruined")
        .expect("mod_tower_ruined");
    assert_eq!(ruin.placement, Placement::Body { star_only: true });
    assert_eq!(
        ruin.family.clone().map(|f| (f.working, f.linked)),
        Some(("mod_beacon_1".to_owned(), Linked::Files))
    );
}
