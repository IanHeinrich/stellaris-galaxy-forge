//! Initializers on the grammar fixture: what setting and clearing one writes into the file,
//! how undo and redo restore it, and which texts are refused before any write.

use crate::common::batch::initializers;
use sgf_core::document::Document;
use sgf_core::ops::{NewSystem, Op, OpError};
use sgf_core::session::Session;

use crate::common;
use common::current;
use common::diff::{round_trip, snapshot};
use common::fixture::GRAMMAR;

#[test]
fn set_initializer_adds_one_to_a_system_that_had_none() {
    snapshot(
        "set_initializer_16",
        GRAMMAR.open(),
        Op::SetInitializer {
            system: 16,
            initializer: Some("random_empire_init_01".to_owned()),
        },
    );
}

#[test]
fn set_initializer_leaves_the_spawn_weight_beside_it_alone() {
    snapshot(
        "set_initializer_2",
        GRAMMAR.open(),
        Op::SetInitializer {
            system: 2,
            initializer: Some("misc_system_init_01".to_owned()),
        },
    );
}

/// One that already names an initializer, one that names none, and one cleared.
fn three_entries() -> Vec<(u32, Option<String>)> {
    vec![
        (1, Some("sol_system_initializer".to_owned())),
        (16, Some("random_empire_init_01".to_owned())),
        (3018, None),
    ]
}

#[test]
fn set_initializers_writes_three_systems_at_once() {
    snapshot(
        "set_initializers_1_16_3018",
        GRAMMAR.open(),
        initializers(three_entries()),
    );
}

#[test]
fn set_initializers_is_one_history_entry_and_stales_every_system() {
    let mut session = GRAMMAR.open();
    let result = session
        .apply(initializers(three_entries()))
        .expect("set three initializers");
    assert_eq!(result.entry.description, "Set initializer of 3 systems");
    assert_eq!(result.details_stale, [1, 16, 3018]);
    let history = session.history();
    assert_eq!(history.undo.len(), 1, "three systems, one undo step");
    assert!(history.redo.is_empty());
}

#[test]
fn set_initializers_undo_and_redo_are_byte_identical() {
    round_trip(GRAMMAR.open(), initializers(three_entries()));
}

#[test]
fn clearing_an_initializer_leaves_the_spawn_weight_standing() {
    snapshot(
        "clear_initializer_3018",
        GRAMMAR.open(),
        Op::SetInitializer {
            system: 3018,
            initializer: None,
        },
    );
}

#[test]
fn clearing_an_initializer_keeps_the_comment_that_follows_it() {
    let text = String::from_utf8(GRAMMAR.bytes()).unwrap().replacen(
        "\t\tinitializer = random_empire_init_01\n",
        "\t\tinitializer = random_empire_init_01 # the seat\n",
        1,
    );
    let doc = Document::from_scenario_bytes(text.into_bytes()).expect("index the bytes");
    let mut session = Session::from_document(None, doc).expect("project the bytes");
    session
        .apply(Op::SetInitializer {
            system: 3018,
            initializer: None,
        })
        .expect("clear the initializer");
    let edited = String::from_utf8(current(&session)).unwrap();
    assert!(!edited.contains("random_empire_init_01"), "{edited}");
    assert!(edited.contains("# the seat\n"), "{edited}");
}

#[test]
fn an_initializer_that_is_not_one_bare_key_is_refused_before_any_write() {
    let bare = |id| NewSystem {
        system: id,
        x: 20.0,
        y: -30.5,
        name: None,
        initializer: Some("misc_system_init_01".to_owned()),
        spawn_weight: None,
        spawn_script: None,
        statement: None,
    };
    for text in ["misc system", "misc{", "a = b", "{ }"] {
        let bad = Some(text.to_owned());
        let ops = [
            Op::AddSystem {
                system: Some(4000),
                x: 20.0,
                y: -30.5,
                name: None,
                initializer: bad.clone(),
                spawn_weight: None,
                spawn_script: None,
            },
            Op::AddSystems {
                systems: vec![
                    bare(4000),
                    NewSystem {
                        initializer: bad.clone(),
                        ..bare(4001)
                    },
                ],
            },
            Op::SetInitializer {
                system: 16,
                initializer: bad.clone(),
            },
            initializers(vec![
                (16, Some("misc_system_init_01".to_owned())),
                (1, bad.clone()),
            ]),
        ];
        for op in ops {
            let mut session = GRAMMAR.open();
            let name = op.name();
            let error = session.apply(op).expect_err(name);
            assert!(
                matches!(&error, OpError::InvalidText { text: t, .. } if t == text),
                "{name} with {text:?}: {error}"
            );
            assert_eq!(current(&session), GRAMMAR.bytes(), "{name} with {text:?}");
        }
    }
}

/// Seats on the game's ordinary systems on a plain map: one whose effect stands on one
/// line, one whose effect spans several, and one with no effect.
const SEATS: &str = "static_galaxy_scenario = {
	name = \"seats\"
	system = { id = \"1\" position = { x = 1 y = 2 } initializer = basic_init_01 spawn_weight = { base = 1 } effect = { log = \"x\" } }
	system = {
		id = \"2\"
		position = { x = 3 y = 4 }
		initializer = basic_init_02
		spawn_weight = { base = 1 }
		effect = {
			log = \"y\"
		}
	}
	system = { id = \"3\" position = { x = 5 y = 6 } initializer = basic_init_03 spawn_weight = { base = 1 } }
}
";

fn home_systems(home: bool) -> Op {
    Op::Batch {
        description: "home systems".to_owned(),
        ops: [1, 2, 3]
            .map(|system| Op::SetHomeSystem { system, home })
            .to_vec(),
    }
}

#[test]
fn the_home_system_effect_goes_after_what_the_effect_holds_and_comes_out_alone() {
    let mut session = common::fixture::from_scenario_text(SEATS);
    session.apply(home_systems(true)).expect("mark the homes");
    assert_eq!(
        common::text(&session),
        "static_galaxy_scenario = {
	name = \"seats\"
	system = { id = \"1\" position = { x = 1 y = 2 } initializer = basic_init_01 spawn_weight = { base = 1 } effect = { log = \"x\" set_star_flag = empire_home_system if = { limit = { NOT = { any_system_planet = { has_planet_flag = starting_deposit } } } generate_home_system_resources = yes every_system_planet = { limit = { is_capital = yes planet_size < 18 NOT = { is_planet_class = pc_habitat } owner = { NOT = { has_origin = origin_void_dwellers has_origin = origin_toxic_knights has_origin = origin_arc_welders } } } set_planet_size = 20 } } } }
	system = {
		id = \"2\"
		position = { x = 3 y = 4 }
		initializer = basic_init_02
		spawn_weight = { base = 1 }
		effect = {
			log = \"y\"
			set_star_flag = empire_home_system
			if = { limit = { NOT = { any_system_planet = { has_planet_flag = starting_deposit } } } generate_home_system_resources = yes every_system_planet = { limit = { is_capital = yes planet_size < 18 NOT = { is_planet_class = pc_habitat } owner = { NOT = { has_origin = origin_void_dwellers has_origin = origin_toxic_knights has_origin = origin_arc_welders } } } set_planet_size = 20 } }
		}
	}
	system = { id = \"3\" position = { x = 5 y = 6 } initializer = basic_init_03 spawn_weight = { base = 1 } effect = { set_star_flag = empire_home_system if = { limit = { NOT = { any_system_planet = { has_planet_flag = starting_deposit } } } generate_home_system_resources = yes every_system_planet = { limit = { is_capital = yes planet_size < 18 NOT = { is_planet_class = pc_habitat } owner = { NOT = { has_origin = origin_void_dwellers has_origin = origin_toxic_knights has_origin = origin_arc_welders } } } set_planet_size = 20 } } } }
}
"
    );
    assert!(session.graph().systems.values().all(|s| s.home_system));
    let again = session.apply(Op::SetHomeSystem {
        system: 1,
        home: true,
    });
    assert!(matches!(again, Err(OpError::Unchanged { .. })), "{again:?}");

    session
        .apply(home_systems(false))
        .expect("take the marks off");
    assert_eq!(common::text(&session), SEATS);
    assert!(session.graph().systems.values().all(|s| !s.home_system));
    session.undo().expect("undo").expect("an edit to undo");
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(common::text(&session), SEATS);
}

/// A seat written compactly with the whole effect, and one whose effect holds only the flag.
const MARKED: &str = "static_galaxy_scenario = {
	name = \"marked\"
	system = { id = \"4\" position = { x = 1 y = 2 } initializer = basic_init_01 spawn_weight = { base = 1 } effect={set_star_flag=empire_home_system if={limit={NOT={any_system_planet={has_planet_flag=starting_deposit}}}generate_home_system_resources=yes every_system_planet={limit={is_capital=yes planet_size<18 NOT={is_planet_class=pc_habitat}owner={NOT={has_origin=origin_void_dwellers has_origin=origin_toxic_knights has_origin=origin_arc_welders}}}set_planet_size=20}}} }
	system = { id = \"5\" position = { x = 3 y = 4 } initializer = basic_init_02 spawn_weight = { base = 1 } effect = { set_star_flag = empire_home_system } }
}
";

#[test]
fn the_home_system_effect_is_read_by_its_tokens_and_a_flag_alone_is_written_whole() {
    let mut session = common::fixture::from_scenario_text(MARKED);
    assert!(
        session.graph().systems[&4].home_system,
        "compact spacing reads the same"
    );
    assert!(
        !session.graph().systems[&5].home_system,
        "the flag alone is half the effect"
    );
    let again = session.apply(Op::SetHomeSystem {
        system: 4,
        home: true,
    });
    assert!(matches!(again, Err(OpError::Unchanged { .. })), "{again:?}");

    session
        .apply(Op::SetHomeSystem {
            system: 4,
            home: false,
        })
        .expect("take the compact effect out");
    let marked = session
        .apply(Op::SetHomeSystem {
            system: 5,
            home: true,
        })
        .expect("write the half-marked effect whole");
    assert_eq!(
        common::text(&session),
        "static_galaxy_scenario = {
	name = \"marked\"
	system = { id = \"4\" position = { x = 1 y = 2 } initializer = basic_init_01 spawn_weight = { base = 1 } }
	system = { id = \"5\" position = { x = 3 y = 4 } initializer = basic_init_02 spawn_weight = { base = 1 } effect = { set_star_flag = empire_home_system if = { limit = { NOT = { any_system_planet = { has_planet_flag = starting_deposit } } } generate_home_system_resources = yes every_system_planet = { limit = { is_capital = yes planet_size < 18 NOT = { is_planet_class = pc_habitat } owner = { NOT = { has_origin = origin_void_dwellers has_origin = origin_toxic_knights has_origin = origin_arc_welders } } } set_planet_size = 20 } } } }
}
"
    );
    assert_eq!(
        marked.inverse,
        Op::SetHomeSystem {
            system: 5,
            home: false,
        },
        "the inverse takes out both statements"
    );
    session.undo().expect("undo").expect("an edit to undo");
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(
        common::text(&session),
        MARKED,
        "undo puts the flag alone back"
    );
}

/// A seat marked with an earlier form of the effect, whose `if` shares the guard but not
/// the body.
const MARKED_BEFORE: &str = "static_galaxy_scenario = {
	name = \"marked before\"
	system = { id = \"6\" position = { x = 1 y = 2 } initializer = basic_init_01 spawn_weight = { base = 1 } effect = { log = \"x\" set_star_flag = empire_home_system if = { limit = { NOT = { any_system_planet = { has_planet_flag = starting_deposit } } } generate_home_system_resources = yes } } }
}
";

#[test]
fn an_earlier_form_of_the_home_system_effect_is_replaced_whole() {
    let random_list = MARKED_BEFORE.replace(
        "generate_home_system_resources = yes }",
        "generate_home_system_resources = yes every_system_planet = { limit = { is_capital = yes planet_size < 18 NOT = { is_planet_class = pc_habitat } owner = { NOT = { has_origin = origin_void_dwellers has_origin = origin_toxic_knights has_origin = origin_arc_welders } } } random_list = { 25 = { set_planet_size = 18 } 25 = { set_planet_size = 19 } 25 = { set_planet_size = 20 } 25 = { set_planet_size = 21 } } } }",
    );
    assert_ne!(random_list, MARKED_BEFORE);
    for before in [MARKED_BEFORE, random_list.as_str()] {
        let mut session = common::fixture::from_scenario_text(before);
        assert!(
            !session.graph().systems[&6].home_system,
            "the earlier form is not this one"
        );
        session
            .apply(Op::SetHomeSystem {
                system: 6,
                home: true,
            })
            .expect("write the effect over its earlier form");
        assert_eq!(
            common::text(&session),
            "static_galaxy_scenario = {
	name = \"marked before\"
	system = { id = \"6\" position = { x = 1 y = 2 } initializer = basic_init_01 spawn_weight = { base = 1 } effect = { log = \"x\" set_star_flag = empire_home_system if = { limit = { NOT = { any_system_planet = { has_planet_flag = starting_deposit } } } generate_home_system_resources = yes every_system_planet = { limit = { is_capital = yes planet_size < 18 NOT = { is_planet_class = pc_habitat } owner = { NOT = { has_origin = origin_void_dwellers has_origin = origin_toxic_knights has_origin = origin_arc_welders } } } set_planet_size = 20 } } } }
}
"
        );
        assert!(session.graph().systems[&6].home_system);
    }
}
