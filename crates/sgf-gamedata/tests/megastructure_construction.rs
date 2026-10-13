//! What building and dismantling a megastructure writes, from the real install's scripts and
//! from hand-written ones.

use crate::common;

use sgf_core::format::save::site::{ConstructionSite, SiteBody};
use sgf_core::ops::{
    ConstructionDeposit, ConstructionModifier, MegastructureConstruction, MegastructureDismantle,
    ModifierHost, TimedModifier, VariableStep,
};
use sgf_gamedata::registries::megastructures::{Linked, Placement};

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
        vec![VariableStep {
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
            variables: vec![VariableStep {
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
/// Science Nexus and a Hyper Relay nothing. With no owner the furnace adds nothing: its
/// events fire from its owner's scope.
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
                timed: TimedModifier {
                    modifier: format!("orbital_arc_furnace_{stage}_mod"),
                    days: None,
                },
            })
            .collect(),
        deposits: [6141, 6146]
            .into_iter()
            .map(|body| ConstructionDeposit {
                body,
                kind: format!("d_arc_furnace_{stage}"),
            })
            .collect(),
        variables: vec![VariableStep {
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
                timed: TimedModifier {
                    modifier: "dyson_swarm_3_mod".to_owned(),
                    days: None,
                },
            }],
            deposits: Vec::new(),
            variables: vec![VariableStep {
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
                timed: TimedModifier {
                    modifier: "shroud_seal_modifier".to_owned(),
                    days: None,
                },
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
    assert!(
        unowned.construction.is_empty(),
        "{:?}",
        unowned.construction
    );
}

/// A mod's construction is read the same way: a scripted effect's parameters filled in,
/// an event it fires followed, a planet's owner judged from the save, and an effect the
/// editor cannot place left out and said so.
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
            SiteBody {
                colony: true,
                ..body(12, "pc_continental", &[])
            },
        ],
        ..ConstructionSite::default()
    };
    let built = forge.replay(&gd, &site, Some(11), true);
    assert_eq!(
        built.construction,
        MegastructureConstruction {
            modifiers: vec![ConstructionModifier {
                on: ModifierHost::Body { body: 11 },
                timed: TimedModifier {
                    modifier: "mod_forge_3_mod".to_owned(),
                    days: Some(360),
                },
            }],
            deposits: vec![
                ConstructionDeposit {
                    body: 11,
                    kind: "d_mod_forge".to_owned(),
                },
                ConstructionDeposit {
                    body: 12,
                    kind: "d_mod_forge".to_owned(),
                },
                ConstructionDeposit {
                    body: 12,
                    kind: "d_mod_owned".to_owned(),
                },
            ],
            variables: vec![VariableStep {
                variable: "mod_forges".to_owned(),
                by: 2,
            }],
        }
    );
    assert_eq!(built.unsure.len(), 1, "{:?}", built.unsure);
    assert!(
        built.unsure[0].contains("random_system_planet"),
        "{:?}",
        built.unsure
    );
    assert!(built.unwritten.is_empty(), "{:?}", built.unwritten);
}

/// A modifier and a deposit the construction takes off its planet apply but are not
/// written, apart from what the editor cannot tell. An effect the walk cannot follow both
/// in the owner's scope and outside it is listed once, and still listed with no owner.
#[test]
fn a_construction_says_what_it_does_not_write_apart_from_what_it_cannot_tell() {
    let (_dir, gd) = common::hand_written(&[(
        "common/megastructures/mod.txt",
        "mod_drain = {
	on_build_complete = {
		fromfrom.planet = {
			remove_modifier = mod_old
			remove_deposit = d_old
			add_modifier = { modifier = mod_odd days = -2 }
		}
		fire_on_action = { on_action = on_mod_drain }
		from = { fire_on_action = { on_action = on_mod_drain } }
	}
}
",
    )]);
    let drain = &gd
        .megastructures
        .get("mod_drain")
        .expect("mod_drain")
        .construction;
    let site = ConstructionSite {
        system: 1,
        bodies: vec![SiteBody {
            modifiers: vec!["mod_old".to_owned()],
            ..body(11, "pc_molten", &["d_old"])
        }],
        ..ConstructionSite::default()
    };
    for owned in [true, false] {
        let built = drain.replay(&gd, &site, Some(11), owned);
        assert!(built.construction.is_empty(), "{:?}", built.construction);
        assert_eq!(
            built.unsure,
            ["mod_drain: fire_on_action"],
            "owned: {owned}"
        );
        assert_eq!(
            built.unwritten,
            [
                "adds modifier mod_odd to planet 11 for -2 days, which Galaxy Forge does not write",
                "removes modifier mod_old from planet 11",
                "removes deposit d_old from planet 11"
            ]
        );
    }
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

/// A scripted effect's `[[PARAM] … ]` block runs only when its call passes the parameter,
/// and its `[[!PARAM] … ]` block only when the call does not, in a construction and in a
/// dismantle alike, its closing bracket on a line of its own or at the end of a value.
#[test]
fn a_parameter_block_runs_only_on_the_arm_its_call_takes() {
    let (_dir, gd) = common::hand_written(&[
        (
            "common/megastructures/mod.txt",
            "mod_furnace = {
	on_build_complete = {
		fromfrom.planet = { mod_mark = { HOT = yes } }
	}
	on_dismantle_complete = {
		every_system_planet = { mod_unmark = { HOT = yes } }
	}
}
",
        ),
        (
            "common/scripted_effects/mod.txt",
            "mod_mark = {
	[[HOT]
	add_deposit = d_mod_hot
	]
	[[!HOT]
	add_deposit = d_mod_cold
	]
	[[HOT] add_deposit = d_mod_glued]
	[[!HOT] add_deposit = d_mod_wrong]
}
mod_unmark = {
	[[HOT]
	remove_deposit = d_mod_hot
	]
	[[!HOT]
	remove_deposit = d_mod_cold
	]
}
",
        ),
    ]);
    let furnace = gd.megastructures.get("mod_furnace").expect("mod_furnace");
    let site = ConstructionSite {
        system: 1,
        bodies: vec![body(11, "pc_molten", &[])],
        ..ConstructionSite::default()
    };
    let built = furnace.construction.replay(&gd, &site, Some(11), true);
    assert_eq!(
        built.construction.deposits,
        [
            ConstructionDeposit {
                body: 11,
                kind: "d_mod_hot".to_owned(),
            },
            ConstructionDeposit {
                body: 11,
                kind: "d_mod_glued".to_owned(),
            }
        ]
    );
    assert_eq!(furnace.dismantle.deposits, ["d_mod_hot"]);
}

/// A parameter written `$NAME|default$` takes the value its call passes, and its default
/// when the call passes none, in a construction and in a dismantle alike.
#[test]
fn a_parameter_left_out_takes_its_default() {
    let (_dir, gd) = common::hand_written(&[
        (
            "common/megastructures/mod.txt",
            "mod_forge = {
	on_build_complete = {
		fromfrom.planet = { mod_mark = { LEVEL = 3 } }
		from = { mod_count = yes }
	}
	on_dismantle_complete = {
		every_system_planet = { mod_unmark = yes }
		from = { mod_uncount = yes }
	}
}
",
        ),
        (
            "common/scripted_effects/mod.txt",
            "mod_mark = {
	add_modifier = { modifier = mod_forge_$LEVEL|1$_mod days = 360 }
	add_deposit = d_mod_$KIND|plain$
}
mod_unmark = {
	remove_modifier = mod_forge_$LEVEL|1$_mod
}
mod_count = {
	change_variable = { which = mod_forges value = $COUNT|2$ }
}
mod_uncount = {
	subtract_variable = { which = mod_forges value = $COUNT|2$ }
}
",
        ),
    ]);
    let forge = gd.megastructures.get("mod_forge").expect("mod_forge");
    let site = ConstructionSite {
        system: 1,
        bodies: vec![body(11, "pc_molten", &[])],
        ..ConstructionSite::default()
    };
    let built = forge.construction.replay(&gd, &site, Some(11), true);
    assert_eq!(
        built.construction,
        MegastructureConstruction {
            modifiers: vec![ConstructionModifier {
                on: ModifierHost::Body { body: 11 },
                timed: TimedModifier {
                    modifier: "mod_forge_3_mod".to_owned(),
                    days: Some(360),
                },
            }],
            deposits: vec![ConstructionDeposit {
                body: 11,
                kind: "d_mod_plain".to_owned(),
            }],
            variables: vec![VariableStep {
                variable: "mod_forges".to_owned(),
                by: 2,
            }],
        }
    );
    assert!(built.unsure.is_empty(), "{:?}", built.unsure);
    assert_eq!(
        forge.dismantle,
        MegastructureDismantle {
            modifiers: vec!["mod_forge_1_mod".to_owned()],
            deposits: Vec::new(),
            variables: vec![VariableStep {
                variable: "mod_forges".to_owned(),
                by: 2,
            }],
        }
    );
}
