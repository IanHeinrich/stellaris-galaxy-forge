//! What a scenario system's details say only an initializer states: each body's spawn and the
//! system's, on a hand-written install for what the game's files lack, and pinned by snapshot
//! under `snapshots/details_spawn` on the real install.

use crate::common;

use sgf_core::format::save::details::{
    AmbientObject, AnomalyPrevention, ClassPool, CountRange, DepositReplacement, DepositStep,
    ListMember, PlanetSummary, SpawnClass, SpawnStar, SystemDetails, UnknownClass, UsageOdds,
    VariableUse,
};

use sgf_gamedata::layouts::{self, Eligibility, Unsupported};
use sgf_gamedata::scripts::chain;
use sgf_gamedata::views::InitializerView;

use common::{INSTALL, fixed};

const STARS: &str = "sc_sun = {
	class = sun_star
	planet = { key = pc_sun_star }
	spawn_odds = 30
}
sc_ember = {
	class = ember_star
	planet = { key = pc_ember_star }
	spawn_odds = 10
}
rl_fx_stars = {
	stars = { sc_sun sc_ember }
}
";

const PLANETS: &str = "pc_sun_star = { star = yes planet_size = { min = 20 max = 30 } }
pc_ember_star = { star = yes planet_size = { min = 15 max = 25 } }
pc_rock = { planet_size = { min = 10 max = 20 } moon_size = { min = 5 max = 8 } }
pc_rubble = { asteroid = yes planet_size = 5 }
random_list = {
	name = \"rl_rocks\"
	planets = { pc_rock pc_rubble }
}
";

const DEPOSITS: &str = "d_fx_gold_2 = {
	category = fx_mining
	resources = {
		category = fx_mining
		produces = { minerals = 2 }
	}
}
";

/// Every shape the reader models, and some it keeps as written: a spacer, a key it does not
/// know, an `@variable`, an effect under an `if`, a dig site on the system and none of the
/// game's own files' line endings.
const READER: &str = "fx_reader = {
	class = rl_fx_stars
	usage = misc_system_init
	usage_odds = { base = 5 modifier = { factor = 0 has_fx = no } }
	namelist = \"fx_names\"
	prevent_anomalies = yes
	mandatory_neighbors = yes
	fx_unknown_key = { a = 1 }
	neighbor_system = { initializer = fx_scripted distance = { min = 10 max = 20 } }
	planet = { class = star orbit_distance = 0 }
	planet = { class = none orbit_distance = 40 }
	planet = {
		class = pc_rock
		orbit_distance = 10
		size = @fx_size
		count = { min = 1 max = 2 }
		satellite_naming_policy = fx_policy
		modifiers = none
		deposit_blockers = none
		flags = { fx_planet }
		anomaly = \"FX_CAT\"
		init_effect = {
			clear_deposits = yes
			add_deposit = d_fx_gold_2
			set_deposit = d_fx_gold_2
			add_modifier = { modifier = fx_mod days = -1 }
			set_name = \"FX_NAME\"
			set_planet_flag = fx_flag
			prevent_anomaly = yes
			create_ambient_object = { type = fx_object location = this }
			create_archaeological_site = { type = fx_block_site }
			if = {
				limit = { has_fx = yes }
				add_deposit = d_fx_gold_2
				change_pc = pc_rubble
			}
			save_event_target_as = fx_target
		}
		moon = { class = rl_rocks orbit_distance = 5 count = { min = 0 max = 1 } }
	}
	planet = { class = ideal_planet_class orbit_distance = 10 }
	planet = { class = random_asteroid orbit_distance = 10 }
	planet = { class = pc_mystery orbit_distance = 10 }
	init_effect = {
		create_archaeological_site = fx_site
		create_archaeological_site = { type = fx_block_site }
		if = { limit = { has_fx = yes } create_archaeological_site = fx_if_site }
		random_system_planet = { create_archaeological_site = fx_scoped_site }
		set_star_flag = fx_star_flag
		create_ambient_object = { type = fx_system_object }
		create_ambient_object = { location = this }
		spawn_megastructure = { type = fx_gate }
		spawn_megastructure = { owner = fx_owner }
		create_starbase = { size = fx_base }
		create_starbase = { size = fx_second }
		save_global_event_target_as = fx_system
	}
}
fx_sizeless = {
	class = sc_sun
	usage_odds = @fx_no_such
	init_effect = { create_starbase = { module = shipyard } }
}
fx_scripted = {
	inline_script = { script = fx/worlds SIZE = 12 NAME = \"Two Words\" }
}
fx_scripted_moon = {
	inline_script = { script = fx/worlds SIZE = 12 MOON = yes }
}
fx_scripted_effect = {
	class = sc_sun
	usage = misc_system_init
	usage_odds = 1
	planet = { class = star orbit_distance = 0 }
	inline_script = fx/effects
}
";

/// Bodies under conditions: the named rock's name, and either the rubble or a second rock,
/// whose moon comes with a name.
const WORLDS: &str = "class = sc_sun
planet = { class = star orbit_distance = 0 }
planet = { class = pc_rock orbit_distance = 30 size = $SIZE$ [[NAME] name = $NAME$ ] }
[[!MOON] planet = { class = pc_rubble orbit_distance = 10 } ]
[[MOON]
planet = {
	class = pc_rock
	orbit_distance = 10
	[[NAME] moon = { class = pc_rock orbit_distance = 5 } ]
}
]
";

/// What a system's own block calls for: a primitive system, and script add-system cannot drop.
const EFFECTS: &str = "primitive_system = yes
init_effect = {
	set_star_flag = fx_script_flag
	fx_unknown_effect = yes
}
";

fn reader_install() -> (tempfile::TempDir, sgf_gamedata::GameData) {
    let crlf = READER.replace('\n', "\r\n");
    common::hand_written(&[
        ("common/star_classes/00_stars.txt", STARS),
        ("common/planet_classes/00_planets.txt", PLANETS),
        ("common/deposits/00_fx.txt", DEPOSITS),
        ("common/scripted_variables/00_fx.txt", "@fx_size = 14\n"),
        ("common/inline_scripts/fx/worlds.txt", WORLDS),
        ("common/inline_scripts/fx/effects.txt", EFFECTS),
        ("common/solar_system_initializers/00_fx.txt", &crlf),
    ])
}

fn class_of(planet: &PlanetSummary) -> &SpawnClass {
    &planet
        .spawn
        .as_ref()
        .expect("a scenario body's spawn")
        .class
}

#[test]
fn a_scenario_bodys_spawn_says_what_its_block_states() {
    let (_dir, gd) = reader_install();
    let details = gd
        .initializer_details(3, "fx_reader", None)
        .expect("fx_reader");
    let written: Vec<&str> = details.planets.iter().map(|p| p.class.as_str()).collect();
    assert_eq!(
        written,
        [
            "star",
            "pc_rock",
            "rl_rocks",
            "pc_rock",
            "rl_rocks",
            "ideal_planet_class",
            "random_asteroid",
            "pc_mystery",
        ],
        "a star of a random list stands in as sc_g's, which this install lacks; the spacer is \
         no body; a count of one to two lists two, each with its moon"
    );
    let rock = &details.planets[1];
    assert_eq!(
        rock.layout.as_ref().and_then(|l| l.orbit),
        Some(fixed(50.0)),
        "the spacer moves the running orbit out by its 40"
    );
    assert_eq!(rock.size, Some(14), "@fx_size from scripted_variables");

    let spawns: Vec<(bool, u32, CountRange)> = details
        .planets
        .iter()
        .map(|p| {
            let spawn = p.spawn.as_ref().expect("a spawn");
            (spawn.always, spawn.copy, spawn.count)
        })
        .collect();
    let one = CountRange { min: 1, max: 1 };
    assert_eq!(
        spawns,
        [
            (true, 1, one),
            (true, 1, CountRange { min: 1, max: 2 }),
            (false, 1, CountRange { min: 0, max: 1 }),
            (false, 2, CountRange { min: 1, max: 2 }),
            (false, 1, CountRange { min: 0, max: 1 }),
            (true, 1, one),
            (true, 1, one),
            (true, 1, one),
        ],
        "a copy past the low end of a count may not spawn, and nor may the moons around it"
    );

    assert_eq!(
        class_of(&details.planets[0]),
        &SpawnClass::Rolled {
            pool: ClassPool::StarList {
                list: "rl_fx_stars".to_owned()
            }
        }
    );
    assert_eq!(
        class_of(rock),
        &SpawnClass::Unknown {
            written: "pc_rock".to_owned(),
            reason: UnknownClass::Script,
        },
        "a change_pc under an if"
    );
    assert_eq!(
        class_of(&details.planets[2]),
        &SpawnClass::Rolled {
            pool: ClassPool::PlanetList {
                list: "rl_rocks".to_owned(),
                members: ["pc_rock", "pc_rubble"]
                    .map(|key| ListMember {
                        key: key.to_owned(),
                        weight: None,
                    })
                    .to_vec(),
            }
        }
    );
    assert_eq!(
        class_of(&details.planets[5]),
        &SpawnClass::Unknown {
            written: "ideal_planet_class".to_owned(),
            reason: UnknownClass::Ideal,
        }
    );
    assert_eq!(
        class_of(&details.planets[6]),
        &SpawnClass::Rolled {
            pool: ClassPool::Random {
                draw: "random_asteroid".to_owned()
            }
        }
    );
    assert_eq!(
        class_of(&details.planets[7]),
        &SpawnClass::Unknown {
            written: "pc_mystery".to_owned(),
            reason: UnknownClass::Undefined,
        }
    );

    let spawn = rock.spawn.as_ref().expect("the rock's spawn");
    assert_eq!(
        spawn.deposits,
        [
            DepositStep::Clear { category: None },
            DepositStep::Add {
                deposit: "d_fx_gold_2".to_owned()
            },
            DepositStep::Set {
                deposit: "d_fx_gold_2".to_owned(),
                category: Some("fx_mining".to_owned()),
                replaces: DepositReplacement::Unknown,
            },
        ]
    );
    let keys: Vec<(&str, u32)> = rock
        .deposit_keys
        .iter()
        .map(|d| (d.key.as_str(), d.count))
        .collect();
    assert_eq!(
        keys,
        [("d_fx_gold_2", 2)],
        "the add and the set_deposit, which replaces no stated deposit it is known to; the \
         if's is left to its check"
    );
    assert!(spawn.no_blockers && spawn.features.none);
    assert_eq!(spawn.features.added.len(), 1);
    assert_eq!(spawn.features.added[0].modifier, "fx_mod");
    assert_eq!(spawn.features.added[0].days, Some(-1.0));
    assert_eq!(spawn.anomalies.categories, ["FX_CAT"]);
    assert_eq!(spawn.anomalies.prevented, Some(AnomalyPrevention::Body));
    assert_eq!(spawn.name.as_deref(), Some("FX_NAME"));
    assert_eq!(spawn.flags, ["fx_planet", "fx_flag"]);
    assert_eq!(
        spawn.variables,
        [VariableUse {
            key: "size".to_owned(),
            variable: "@fx_size".to_owned(),
        }]
    );
    let other: Vec<&str> = spawn.other_keys.iter().map(|s| s.key.as_str()).collect();
    assert_eq!(other, ["satellite_naming_policy"]);
    let script: Vec<(&str, u32)> = spawn
        .script
        .iter()
        .map(|s| (s.key.as_str(), s.modelled))
        .collect();
    assert_eq!(
        script,
        [
            ("create_archaeological_site", 0),
            ("if", 2),
            ("save_event_target_as", 0)
        ],
        "a dig site written as a block is not one the reader takes; the if holds an \
         add_deposit and a change_pc"
    );
    assert!(
        spawn.script[1].text.contains("\r\n"),
        "kept as the file writes it"
    );
    assert_eq!(
        details.planets[5]
            .spawn
            .as_ref()
            .and_then(|s| s.anomalies.prevented),
        Some(AnomalyPrevention::System)
    );
}

#[test]
fn a_scenario_systems_spawn_says_what_its_initializer_states() {
    let (_dir, gd) = reader_install();
    let details = gd
        .initializer_details(3, "fx_reader", None)
        .expect("fx_reader");
    assert!(
        details.sites.is_empty(),
        "the system's dig site is on no body"
    );
    let spawn = details.spawn.as_ref().expect("a scenario system's spawn");
    assert_eq!(
        spawn.star,
        SpawnStar::Rolled {
            list: "rl_fx_stars".to_owned(),
            members: vec![
                ListMember {
                    key: "sc_sun".to_owned(),
                    weight: Some(30.0),
                },
                ListMember {
                    key: "sc_ember".to_owned(),
                    weight: Some(10.0),
                },
            ],
        }
    );
    assert_eq!(spawn.planets, Some(CountRange { min: 3, max: 4 }));
    assert_eq!(spawn.moons, Some(CountRange { min: 0, max: 2 }));
    assert_eq!(spawn.asteroids, Some(CountRange { min: 1, max: 1 }));
    assert_eq!(
        spawn.sites,
        ["fx_site"],
        "only a site written directly in the system's own effect"
    );
    assert_eq!(spawn.flags, ["fx_star_flag"]);
    let rocks = [details.planets[1].id, details.planets[3].id];
    assert_eq!(
        spawn.ambient_objects,
        [
            AmbientObject {
                kind: "fx_system_object".to_owned(),
                body: None,
            },
            AmbientObject {
                kind: "fx_object".to_owned(),
                body: Some(rocks[0]),
            },
            AmbientObject {
                kind: "fx_object".to_owned(),
                body: Some(rocks[1]),
            },
        ]
    );
    assert_eq!(spawn.namelist.as_deref(), Some("fx_names"));
    assert!(spawn.prevent_anomalies && !spawn.primitive_system);
    assert_eq!(spawn.usage.as_deref(), Some("misc_system_init"));
    match &spawn.usage_odds {
        Some(UsageOdds::Script { text, base }) => {
            assert_eq!(*base, Some(5.0));
            assert!(text.starts_with("usage_odds = {"), "{text}");
        }
        other => panic!("odds written as a block: {other:?}"),
    }
    assert_eq!(spawn.neighbors.len(), 1);
    assert_eq!(spawn.neighbors[0].initializer, "fx_scripted");
    assert_eq!(spawn.neighbors[0].distance, Some(common::range(10.0, 20.0)));
    let other: Vec<&str> = spawn.other_keys.iter().map(|s| s.key.as_str()).collect();
    assert_eq!(other, ["mandatory_neighbors", "fx_unknown_key"]);
    let script: Vec<(&str, u32)> = spawn
        .script
        .iter()
        .map(|s| (s.key.as_str(), s.modelled))
        .collect();
    assert_eq!(
        script,
        [
            ("create_archaeological_site", 0),
            ("if", 1),
            ("random_system_planet", 0),
            ("create_ambient_object", 0),
            ("spawn_megastructure", 0),
            ("create_starbase", 0),
            ("save_global_event_target_as", 0),
        ],
        "each statement in a shape the reader does not take: a site as a block, under an if \
         or in another scope, an ambient object or megastructure with no type, and a second \
         starbase"
    );
    let megastructures: Vec<&str> = details
        .megastructures
        .iter()
        .map(|m| m.kind.as_str())
        .collect();
    assert_eq!(megastructures, ["fx_gate"]);
    let starbase = details
        .starbase
        .as_ref()
        .expect("the first create_starbase");
    assert_eq!(starbase.level, "fx_base");
    assert!(spawn.from_script.is_none() && spawn.inline_scripts.is_empty());

    let view = InitializerView::new(gd.initializers.get("fx_reader").expect("fx_reader"), &gd);
    let listed: Vec<&str> = view.planets.iter().map(|p| p.class.as_str()).collect();
    assert_eq!(
        listed,
        [
            "star",
            "pc_rock",
            "ideal_planet_class",
            "random_asteroid",
            "pc_mystery"
        ],
        "the browser lists no spacer"
    );
}

#[test]
fn a_statement_in_a_shape_the_reader_does_not_take_is_kept_as_written() {
    let (_dir, gd) = reader_install();
    let details = gd
        .initializer_details(4, "fx_sizeless", None)
        .expect("fx_sizeless");
    assert!(details.starbase.is_none(), "a starbase with no size");
    let spawn = details.spawn.as_ref().expect("a spawn");
    let script: Vec<&str> = spawn.script.iter().map(|s| s.key.as_str()).collect();
    assert_eq!(script, ["create_starbase"]);
    assert_eq!(
        spawn.usage_odds,
        Some(UsageOdds::Unknown {
            written: "@fx_no_such".to_owned()
        }),
        "an @variable no file defines"
    );
}

#[test]
fn an_inline_script_is_read_in_place_of_its_call() {
    let (_dir, gd) = reader_install();
    let details = gd
        .initializer_details(5, "fx_scripted", None)
        .expect("fx_scripted");
    let bodies = |details: &SystemDetails| -> Vec<(String, Option<u32>, String, bool)> {
        details
            .planets
            .iter()
            .map(|p| (p.class.clone(), p.size, p.name_key.clone(), p.moon))
            .collect()
    };
    let body = |class: &str, size: Option<u32>, name: &str, moon: bool| {
        (class.to_owned(), size, name.to_owned(), moon)
    };
    assert_eq!(
        bodies(&details),
        [
            body("pc_sun_star", None, "", false),
            body("pc_rock", Some(12), "Two Words", false),
            body("pc_rubble", Some(5), "", false),
        ],
        "$SIZE$ is the call's SIZE; NAME is given, as one quoted token; MOON is not"
    );
    let moon = gd
        .initializer_details(6, "fx_scripted_moon", None)
        .expect("fx_scripted_moon");
    assert_eq!(
        bodies(&moon),
        [
            body("pc_sun_star", None, "", false),
            body("pc_rock", Some(12), "", false),
            body("pc_rock", None, "", false),
        ],
        "MOON is given and NAME is not, so the nested moon is dropped with it"
    );
    let spawn = details.spawn.as_ref().expect("a spawn");
    assert_eq!(
        spawn.star,
        SpawnStar::Fixed {
            class: "sc_sun".to_owned()
        }
    );
    assert_eq!(spawn.from_script.as_deref(), Some("fx/worlds"));
    assert_eq!(spawn.inline_scripts.len(), 1);
    assert_eq!(spawn.inline_scripts[0].keys, ["class", "planet"]);
    assert_eq!(gd.scenario_star_class("fx_scripted"), "sc_sun");
    assert!(!gd.rolls_planets("fx_scripted"));
}

/// What a system-level inline script supplies is read wherever the initializer's block is:
/// by add-system's layout rules, by Prepare for a new game and by the script walk.
#[test]
fn an_inline_scripts_block_is_read_by_every_reader_of_the_initializer() {
    let (_dir, gd) = reader_install();
    let init = gd
        .initializers
        .get("fx_scripted_effect")
        .expect("fx_scripted_effect");
    assert_eq!(
        layouts::eligibility(&gd, init),
        Eligibility::Unsupported(Unsupported::Effect("fx_unknown_effect".to_owned())),
        "the script's init_effect runs an effect add-system cannot drop"
    );
    let spliced = gd
        .initializers
        .spliced("fx_scripted_effect")
        .expect("the block as the game reads it");
    assert!(spliced.flag("primitive_system"));
    assert!(
        gd.initializers
            .def("fx_scripted_effect")
            .is_some_and(|def| !def.flag("primitive_system")),
        "the block as written calls the script"
    );
    let chain = chain::walk(&gd.scripts, &gd.initializers, "fx_scripted_effect");
    assert!(
        chain.star_flags.iter().any(|f| f == "fx_script_flag"),
        "{:?}",
        chain.star_flags
    );
    let spawn = gd
        .initializer_details(7, "fx_scripted_effect", None)
        .and_then(|d| d.spawn)
        .expect("a spawn");
    assert!(spawn.primitive_system);
}

/// `details` as the snapshot `key` under `snapshots/details_spawn`, as the app receives it:
/// the system's fields, then each body as one line.
fn pinned(key: &str, details: &SystemDetails) {
    let mut system = serde_json::to_value(details).expect("details serialise");
    system["planets"] = serde_json::Value::Null;
    let mut out = serde_json::to_string_pretty(&system).expect("the system serialises");
    for planet in &details.planets {
        out.push('\n');
        out.push_str(&serde_json::to_string(planet).expect("a body serialises"));
    }
    insta::with_settings!({snapshot_path => "snapshots/details_spawn", prepend_module_to_snapshot => false}, {
        insta::assert_snapshot!(key, out);
    });
}

/// One vanilla initializer per shape the reader handles: Sol; a trinary with planets around
/// its companion stars; a basic layout of ranged counts on a random star list, with an
/// `@variable`; a void worm system, read through its inline script; ambient objects beside a
/// megastructure; an empire start with `ideal_planet_class`; and moons of moons. No vanilla
/// initializer digs a site from the system's own effects, so the fixture above covers that.
#[test]
fn the_real_installs_scenario_details_are_pinned() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    for key in [
        "sol_system_initializer",
        "trinary_init_02",
        "basic_init_01",
        "voidworms_spawn_system_tiny",
        "dyson_sphere_init_01",
        "random_empire_init_05",
        "fallen_hive_control_3",
    ] {
        let details = gd
            .initializer_details(1, key, None)
            .unwrap_or_else(|| panic!("{key}'s details"));
        pinned(key, &details);
    }
}
