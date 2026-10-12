//! What the editor adds for a finished megastructure, from the real install's build chains:
//! the habitat a Habitat Central Complex leaves and the ring world quadrant by quadrant.
//! `megastructure_layouts_giga` adds Gigastructural Engineering's rings.

use crate::common;

use sgf_core::ops::{HabitatOrbital, NewHabitat, RingModifier, RingQuadrant, RingRow};
use sgf_core::views::OrbitPlacement;
use sgf_gamedata::construction::habitat::habitat;
use sgf_gamedata::construction::layout::{Plan, lay_out};
use sgf_gamedata::construction::ring_world::{self as added, RingStage};
use sgf_gamedata::registries::megastructures::{Placement, Unsupported};

/// The Habitat Central Complex and its restored version are added as the habitat their
/// completion leaves, the model in the owner's culture. The restored version also leaves a
/// major orbital at the habitat's body, named from the system. The ruin stays a row, and the
/// cosmogenesis world, which ties no habitat flag to its host, is no habitat.
#[test]
fn the_complex_and_its_restored_version_are_added_as_a_habitat() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let major = HabitatOrbital {
        kind: "habitat_major_orbital".to_owned(),
        owner: None,
        name: Some("TARGET_ORBITAL_NAME".to_owned()),
        system_name: Some("prevprev.GetName".to_owned()),
    };
    for (key, orbital) in [
        ("habitat_central_complex", None),
        ("habitat_central_complex_restored", Some(major)),
    ] {
        for (on_star, radius) in [(true, 19.798), (false, 9.899)] {
            let found = habitat(gd, key, on_star, Some("avian_01")).expect(key);
            assert_eq!(
                found,
                NewHabitat {
                    class: "pc_habitat".to_owned(),
                    size: 6,
                    at: OrbitPlacement {
                        radius,
                        angle: 315.0,
                    },
                    name: "HABITAT_PLANET_NAME".to_owned(),
                    system_name: Some("prev.solar_system.GetName".to_owned()),
                    model: Some("avian_01_habitat_phase_03_entity".to_owned()),
                    flags: ["megastructure", "habitat", "habitat_level_1"]
                        .map(str::to_owned)
                        .to_vec(),
                    orbital: orbital.clone(),
                },
                "{key}"
            );
        }
        let unowned = habitat(gd, key, true, None).expect(key);
        assert_eq!(unowned.model, None, "{key}: the class's own model");
    }
    for key in ["habitat_central_complex_ruined", "cosmogenesis_world_0"] {
        assert_eq!(habitat(gd, key, false, None), None, "{key}");
    }
}

/// The ring world the editor adds, quadrant by quadrant: A finished in the owner's culture,
/// B a frame row named and owned, C a ruined row with no name or culture and D damaged,
/// named as the game's initializers name a damaged segment. The flags the chain leaves are
/// the system's.
#[test]
fn the_ring_world_is_added_with_each_quadrant_at_its_stage() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    use RingStage::*;
    let stages = [Finished, Frame, Ruined, Damaged];
    let ring = added::ring_world(
        gd,
        "ring_world_2_intermediate",
        &stages,
        Some("avian_01"),
        &[],
    )
    .expect("the vanilla ring world");
    assert_eq!(ring.system_flags, ["ring_world_built", "ring_section_1"]);
    let [a, b, c, d] = &ring.quadrants[..] else {
        panic!("{:?}", ring.quadrants);
    };
    let RingQuadrant::Finished { segments } = a else {
        panic!("{a:?}");
    };
    let shown: Vec<_> = segments
        .iter()
        .map(|s| {
            (
                s.class.as_str(),
                s.at.angle,
                s.at.radius,
                s.name.as_str(),
                s.model.as_deref(),
                s.megastructure_icon,
            )
        })
        .collect();
    assert_eq!(
        shown,
        [
            (
                "pc_ringworld_tech",
                210.0,
                45.0,
                "NAME_Ring_Section",
                Some("avian_01_ringworld_tech_entity_01_entity"),
                false
            ),
            (
                "pc_ringworld_seam",
                180.0,
                45.0,
                "NAME_Ring_Section",
                Some("avian_01_ringworld_seam_entity_01_entity"),
                false
            ),
            (
                "pc_ringworld_habitable",
                150.0,
                45.0,
                "NAME_Habitable_Section_A",
                Some("avian_01_ringworld_habitable_entity_01_entity"),
                true
            ),
        ]
    );
    assert!(
        segments
            .iter()
            .all(|s| s.size == 10 && s.flags == ["megastructure"])
    );
    let row = |kind: &str, angle: f64, name: Option<&str>, culture: Option<&str>| RingRow {
        kind: kind.to_owned(),
        at: OrbitPlacement {
            radius: 45.0,
            angle,
        },
        name: name.map(str::to_owned),
        owned: true,
        culture: culture.map(str::to_owned),
    };
    assert_eq!(
        b,
        &RingQuadrant::Frame {
            row: row(
                "ring_world_2",
                270.0,
                Some("NAME_Ring_Section_B"),
                Some("avian_01")
            )
        }
    );
    assert_eq!(
        c,
        &RingQuadrant::Ruined {
            row: row("ring_world_ruined", 0.0, None, None)
        }
    );
    let RingQuadrant::Damaged { segments } = d else {
        panic!("{d:?}");
    };
    assert!(
        segments
            .iter()
            .all(|s| s.name == "NAME_Ring_Section" && s.model.is_none() && s.flags.is_empty()),
        "{segments:?}"
    );

    let unowned = added::ring_world(gd, "ring_world_2_intermediate", &[Finished; 4], None, &[])
        .expect("ring");
    assert!(unowned.quadrants.iter().all(|q| match q {
        RingQuadrant::Finished { segments } => segments.iter().all(|s| s.model.is_none()),
        _ => false,
    }));
    assert_eq!(unowned.system_flags, ["ring_world_built"]);
    assert!(
        unowned.star_flags.is_empty(),
        "the base game's chain flags no star"
    );
    for (key, stages) in [
        ("ring_world_2_intermediate", &[Finished; 3][..]),
        ("habitat_central_complex", &[Finished][..]),
    ] {
        assert_eq!(
            added::ring_world(gd, key, stages, None, &[]),
            Err(format!(
                "no stage of its chain lays out a ring world of {} quadrants",
                stages.len()
            )),
            "{key}"
        );
    }
}

/// A segment whose model hangs on a branch the walk cannot judge, here on a country flag of
/// the owner, is refused with what was left out, rather than written with no model. A plain
/// word that names no culture the install defines is no culture, a quoted one is, and `from`
/// after a link other than `root` or `prev` names nothing the walk knows.
#[test]
fn a_ring_the_walk_cannot_follow_is_refused_with_the_reason() {
    use RingStage::*;
    let (_dir, gd) = common::hand_written(&[(
        "common/megastructures/mod.txt",
        "mod_ring_frame = {
	on_build_complete = {
		spawn_megastructure = { type = mod_ring_2 orbit_angle = 0 orbit_distance = 50 owner = from graphical_culture = from init_effect = { set_graphical_culture = owner } }
		spawn_megastructure = { type = mod_ring_2 orbit_angle = 180 orbit_distance = 50 owner = fromfrom.from init_effect = { set_graphical_culture = \"mod_culture\" } }
		remove_megastructure = fromfrom
	}
}
mod_ring_2 = { }
mod_ring_3 = {
	upgrade_from = { mod_ring_2 }
	on_build_complete = {
		spawn_planet = {
			class = pc_mod_segment
			location = fromfrom
			size = 10
			init_effect = {
				save_event_target_as = mod_segment
				prev.from = {
					if = {
						limit = { has_country_flag = mod_shipset }
						event_target:mod_segment = { set_planet_entity = { entity = mod_a_entity } }
					}
					else = { event_target:mod_segment = { set_planet_entity = { entity = mod_b_entity } } }
				}
			}
		}
		remove_megastructure = fromfrom
	}
}
",
    )]);
    let frame = added::ring_world(
        &gd,
        "mod_ring_frame",
        &[Frame, Frame],
        Some("mod_owner"),
        &[],
    )
    .expect("two frame rows");
    let cultures: Vec<_> = frame
        .quadrants
        .iter()
        .map(|q| match q {
            RingQuadrant::Frame { row } => (row.owned, row.culture.clone()),
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(
        cultures,
        [
            (true, Some("mod_owner".to_owned())),
            (false, Some("mod_culture".to_owned()))
        ]
    );
    let plan = Plan {
        on_star: true,
        sections: Vec::new(),
        culture: None,
        held_flags: Vec::new(),
    };
    let laid = lay_out(&gd, "mod_ring_frame", &plan).expect("mod_ring_frame");
    for unfollowed in [
        "set_graphical_culture = owner",
        "with owner = fromfrom.from",
    ] {
        assert!(
            laid.unfollowed.iter().any(|line| line.contains(unfollowed)),
            "{unfollowed}: {:?}",
            laid.unfollowed
        );
    }

    let refused = added::ring_world(
        &gd,
        "mod_ring_2",
        &[Finished, Finished],
        Some("mod_owner"),
        &[],
    )
    .expect_err("a model behind a country flag");
    assert!(
        refused.starts_with("the model of its pc_mod_segment hangs on what Galaxy Forge cannot follow: mod_ring_3: a branch behind has_country_flag"),
        "{refused}"
    );
}

/// A mod's restored complex that picks the ruin's body by a carrier flag and spawns its
/// habitat without tying it to the host is still added as a habitat: the one its working
/// type leaves, with the orbital it spawns at the host.
#[test]
fn a_mod_restored_complex_falls_back_to_its_working_types_habitat() {
    let (_dir, gd) = common::hand_written(&[(
        "common/megastructures/mod.txt",
        r#"mod_complex = {
	on_build_complete = {
		spawn_planet = {
			class = pc_habitat location = fromfrom.planet orbit_location = yes
			orbit_angle_offset = 135 orbit_distance_offset = 9.899 size = 6
			init_effect = {
				set_name = { key = HABITAT_PLANET_NAME variable_string = "\[prev.solar_system.GetName]" }
				set_planet_flag = habitat
				fromfrom.planet = { set_planet_flag = habitat@PREV }
			}
		}
		fromfrom.solar_system = { set_star_flag = has_habitat }
		remove_megastructure = fromfrom
	}
}
mod_complex_ruined = { }
mod_complex_restored = {
	upgrade_from = { mod_complex_ruined }
	on_build_complete = {
		solar_system = {
			random_system_planet = {
				limit = { has_carrier_flag = mod_build_site }
				save_event_target_as = target_planet
			}
		}
		spawn_planet = {
			class = pc_habitat location = event_target:target_planet orbit_location = yes
			orbit_angle_offset = 135 orbit_distance_offset = 9.899 size = 6
			init_effect = {
				set_name = { key = HABITAT_PLANET_NAME variable_string = "\[prev.solar_system.GetName]" }
				set_planet_flag = habitat
			}
		}
		spawn_megastructure = {
			type = mod_orbital
			owner = from
			graphical_culture = from
			planet = event_target:target_planet
			coords_from = event_target:target_planet
		}
		fromfrom.solar_system = { set_star_flag = has_habitat }
		remove_megastructure = fromfrom
	}
}
mod_orbital = {
	on_build_complete = {
		fromfrom.planet = { set_carrier_flag = has_orbital }
	}
}
"#,
    )]);
    let complex = habitat(&gd, "mod_complex", false, None).expect("mod_complex");
    assert_eq!(complex.orbital, None);
    let restored = habitat(&gd, "mod_complex_restored", false, None).expect("the restored type");
    assert_eq!(
        restored,
        NewHabitat {
            orbital: Some(HabitatOrbital {
                kind: "mod_orbital".to_owned(),
                owner: None,
                name: None,
                system_name: None,
            }),
            ..complex
        }
    );
}

/// A ring world is told by what its chain spawns, not by its keys: a frame that spawns rows
/// a stage builds into ring world segments. Its site is added as a row and every other stage
/// whole, and a ruin whose key reads as the chain's without its underscores joins it. The
/// habitable sections are named on from the ladder flags the system holds, the frame rows
/// take the culture the spawn writes out, and a habitable section keeps its timed modifier.
/// A chain with no ruined type refuses a ruined quadrant, and one the install's ruin effect
/// leaves alone refuses a damaged one.
#[test]
fn a_ring_is_told_by_what_its_chain_spawns_and_names_on_from_the_systems_ladder() {
    use RingStage::*;
    let (_dir, gd) = common::hand_written(&[(
        "common/megastructures/mod.txt",
        r#"fxring_0 = { }
fxring_1 = {
	upgrade_from = { fxring_0 }
	on_build_complete = {
		spawn_megastructure = { name = "Ring Section E" type = fxring_section orbit_angle = 0 orbit_distance = 60 owner = from graphical_culture = "fx_culture" }
		spawn_megastructure = { name = "Ring Section F" type = fxring_section orbit_angle = 180 orbit_distance = 60 owner = from graphical_culture = "fx_culture" }
		remove_megastructure = fromfrom
	}
}
fxring_section = { upgrade_from = { fxring_1 } }
fxring_2 = {
	upgrade_from = { fxring_section }
	on_build_complete = {
		spawn_planet = { class = pc_ringworld_seam location = fromfrom size = 10 init_effect = { set_name = "Ring Section" } }
		spawn_planet = {
			class = pc_ringworld_habitable location = fromfrom orbit_angle_offset = -30 size = 20
			init_effect = {
				save_event_target_as = ring_section
				add_modifier = { modifier = "fx_housing" days = -1 }
			}
		}
		if = { limit = { NOT = { has_star_flag = ring_01 } } set_star_flag = ring_01 event_target:ring_section = { set_name = "Habitable Section A" } }
		else_if = { limit = { NOT = { has_star_flag = ring_02 } } set_star_flag = ring_02 event_target:ring_section = { set_name = "Habitable Section B" } }
		else_if = { limit = { NOT = { has_star_flag = ring_03 } } set_star_flag = ring_03 event_target:ring_section = { set_name = "Habitable Section C" } }
		else_if = { limit = { NOT = { has_star_flag = ring_04 } } set_star_flag = ring_04 event_target:ring_section = { set_name = "Habitable Section D" } }
		remove_megastructure = fromfrom
	}
}
fx_ring_ruined = { }
fx_ring_restored = { upgrade_from = { fx_ring_ruined } }
fy_frame = {
	on_build_complete = {
		spawn_megastructure = { type = fy_section orbit_angle = 0 orbit_distance = 60 }
		spawn_megastructure = { type = fy_section orbit_angle = 180 orbit_distance = 60 }
		remove_megastructure = fromfrom
	}
}
fy_section = { upgrade_from = { fy_frame } }
fy_built = {
	upgrade_from = { fy_section }
	on_build_complete = {
		spawn_planet = { class = pc_ringworld_seam location = fromfrom size = 10 init_effect = { set_name = "Ring Section" } }
		remove_megastructure = fromfrom
	}
}
fz_frame = {
	on_build_complete = {
		spawn_megastructure = { type = fz_section orbit_angle = 0 orbit_distance = 60 }
		spawn_megastructure = { type = fz_section orbit_angle = 180 orbit_distance = 60 }
		remove_megastructure = fromfrom
	}
}
fz_section = { upgrade_from = { fz_frame } }
fz_built = {
	upgrade_from = { fz_section }
	on_build_complete = {
		spawn_planet = { class = pc_alderson_slice location = fromfrom size = 10 }
		remove_megastructure = fromfrom
	}
}
"#,
    )]);
    let placement = |key: &str| gd.megastructures.get(key).expect(key).placement.clone();
    assert_eq!(placement("fxring_0"), Placement::Body { star_only: false });
    for key in [
        "fxring_1",
        "fxring_section",
        "fxring_2",
        "fx_ring_ruined",
        "fx_ring_restored",
    ] {
        assert_eq!(
            placement(key),
            Placement::Unsupported {
                why: Unsupported::RingWorld
            },
            "{key}"
        );
    }
    assert!(
        matches!(
            placement("fz_section"),
            Placement::Unsupported {
                why: Unsupported::WholeStructure { .. }
            }
        ),
        "a chain whose planets are no ring world segments stays a whole structure"
    );
    assert_eq!(
        gd.megastructures
            .get("fx_ring_ruined")
            .expect("the ruin")
            .variant_of
            .as_deref(),
        Some("fxring_0")
    );
    assert_eq!(added::quadrants(&gd, "fxring_section"), Some(2));

    let held = ["ring_01", "ring_02"].map(str::to_owned);
    let ring = added::ring_world(&gd, "fxring_0", &[Finished, Finished], None, &held)
        .expect("two finished quadrants");
    let habitable: Vec<_> = ring
        .quadrants
        .iter()
        .map(|q| match q {
            RingQuadrant::Finished { segments } => {
                let section = &segments[1];
                (
                    section.name.as_str(),
                    section.size,
                    section.modifiers.clone(),
                )
            }
            other => panic!("{other:?}"),
        })
        .collect();
    let housing = vec![RingModifier {
        modifier: "fx_housing".to_owned(),
        days: -1,
    }];
    assert_eq!(
        habitable,
        [
            ("Habitable Section C", 20, housing.clone()),
            ("Habitable Section D", 20, housing)
        ]
    );
    assert_eq!(ring.system_flags, ["ring_03", "ring_04"]);

    let begun = added::ring_world(&gd, "fxring_0", &[Frame, Ruined], Some("avian_01"), &[])
        .expect("a frame and a ruin");
    let rows: Vec<_> = begun
        .quadrants
        .iter()
        .map(|q| match q {
            RingQuadrant::Frame { row } | RingQuadrant::Ruined { row } => (
                row.kind.as_str(),
                row.name.as_deref(),
                row.culture.as_deref(),
            ),
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(
        rows,
        [
            ("fxring_section", Some("Ring Section E"), Some("fx_culture")),
            ("fx_ring_ruined", None, None)
        ]
    );
    assert_eq!(
        added::ring_world(&gd, "fy_frame", &[Finished, Ruined], None, &[]),
        Err("its chain has no ruined type to stand in place of its fy_section row".to_owned())
    );
    assert_eq!(
        added::ring_world(&gd, "fxring_0", &[Damaged, Frame], None, &[]),
        Err(
            "the game's set_ruined_megastructure leaves its fxring_section row as it is".to_owned()
        )
    );
}
