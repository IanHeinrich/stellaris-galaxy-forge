//! A scenario Paint a Galaxy wrote, read and edited faithfully: what each scripted
//! spawn reads as and what the script op writes for each kind.

use sgf_core::ops::Op;
use sgf_core::projections::galaxy::PaintSpawnKind;

use crate::common;
use common::batch::spawn_scripts;
use common::diff::{plain_report, round_trip, snapshot_step};
use common::fixture::{GRAMMAR, PAINTED, from_scenario_text};
use common::paint::{player, reserved, script, seat, set};

#[test]
fn saving_an_untouched_painted_scenario_is_byte_identical() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("paint_a_galaxy.txt");
    let mut session = PAINTED.open();
    session.save_as(&path).expect("save_as");
    assert_eq!(std::fs::read(&path).unwrap(), PAINTED.bytes());
}

#[test]
fn each_scripted_spawn_reads_as_its_kind_and_random_value() {
    let session = PAINTED.open();
    let systems = &session.graph().systems;
    assert_eq!(systems[&0].spawn_script, script(PaintSpawnKind::Enabled, 3));
    assert_eq!(
        systems[&1].spawn_script,
        script(PaintSpawnKind::Preferred, 1)
    );
    assert_eq!(systems[&2].spawn_script, script(reserved("a"), 2));
    assert_eq!(systems[&3].spawn_script, script(PaintSpawnKind::Sol, 0));
    for id in 4..=13 {
        assert_eq!(systems[&id].spawn_script, None, "system {id}");
    }
    for id in 0..=3 {
        assert_eq!(systems[&id].spawn_weight, Some(0.0), "system {id}");
        assert!(systems[&id].spawn_modifiers.is_empty(), "system {id}");
    }
    assert_eq!(systems[&3].initializer, "sol_system_initializer");
    assert_eq!(systems[&5].initializer, "painted_galaxy_rl_basic");
    assert_eq!(session.graph().nebulae.len(), 2);
    assert_eq!(session.title(), "Painted Reach");

    let plain = GRAMMAR.open();
    assert!(
        plain
            .graph()
            .systems
            .values()
            .all(|system| system.spawn_script.is_none())
    );
    let save = common::open();
    assert!(
        save.graph()
            .systems
            .values()
            .all(|system| system.spawn_script.is_none())
    );
}

#[test]
fn each_kind_rewrites_the_weight_of_a_scripted_system_whole() {
    for (name, id, kind, random_value) in [
        ("script_0_preferred", 0, PaintSpawnKind::Preferred, 3),
        ("script_1_reserved_c", 1, reserved("c"), 1),
        ("script_2_sol", 2, PaintSpawnKind::Sol, 0),
        ("script_3_enabled", 3, PaintSpawnKind::Enabled, 9),
    ] {
        let mut session = PAINTED.open();
        let written = script(kind, random_value);
        snapshot_step(&mut session, name, set(id, written.clone()));
        assert_eq!(session.graph().systems[&id].spawn_script, written);
        assert_eq!(session.graph().systems[&id].spawn_weight, Some(0.0));
    }
    // A reserved seat varies over three values, so the value written is the residue.
    let mut session = PAINTED.open();
    session
        .apply(set(1, script(reserved("c"), 7)))
        .expect("reserve");
    assert_eq!(
        session.graph().systems[&1].spawn_script,
        script(reserved("c"), 1)
    );
}

/// The player's seat is the 1st Player script with the host's marker beside it: the
/// marker is the script's own text, so the seat is replaced and cleared whole like any
/// other.
#[test]
fn the_players_seat_carries_its_marker_and_is_rewritten_whole() {
    let mut session = PAINTED.open();
    snapshot_step(&mut session, "script_1_player", set(1, player(1)));
    assert_eq!(session.graph().systems[&1].spawn_script, player(1));
    assert_eq!(session.graph().systems[&1].spawn_weight, Some(0.0));

    session
        .apply(set(1, script(PaintSpawnKind::Enabled, 4)))
        .expect("replace the player's seat");
    assert_eq!(
        session.graph().systems[&1].spawn_script,
        script(PaintSpawnKind::Enabled, 4)
    );
    assert!(!common::text(&session).contains("100000"));
    session.undo().expect("undo").expect("an op to undo");
    session
        .apply(set(1, None))
        .expect("clear the player's seat");
    assert_eq!(session.graph().systems[&1].spawn_script, None);
    assert!(
        common::text(&session).contains("name = \"Beta\" initializer = random_empire_init_02 }")
    );
    session.undo().expect("undo").expect("an op to undo");

    let result = session
        .apply(Op::SetSpawnWeight {
            system: 1,
            base: None,
        })
        .expect("clear the weight of the player's seat");
    assert_eq!(session.graph().systems[&1].spawn_script, None);
    assert_eq!(session.graph().systems[&1].spawn_weight, None);
    assert_eq!(result.inverse, set(1, player(1)));
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(session.graph().systems[&1].spawn_script, player(1));
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), PAINTED.bytes());
}

/// The Sol seat's marker asks for the United Nations of Earth's flag and a reserved
/// letter's for the submod's trait, so each is the seat of its holder alone.
#[test]
fn the_sol_and_reserved_seats_carry_their_own_marker() {
    let mut session = PAINTED.open();
    snapshot_step(
        &mut session,
        "script_1_sol_player",
        set(1, seat(PaintSpawnKind::Sol, 0)),
    );
    assert_eq!(
        session.graph().systems[&1].spawn_script,
        seat(PaintSpawnKind::Sol, 0)
    );
    session
        .apply(set(1, script(PaintSpawnKind::Enabled, 4)))
        .expect("replace the Sol seat");
    assert!(!common::text(&session).contains("human_1"));
    session.undo().expect("undo").expect("an op to undo");
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), PAINTED.bytes());

    snapshot_step(
        &mut session,
        "script_1_reserved_a_player",
        set(1, seat(reserved("a"), 2)),
    );
    assert_eq!(
        session.graph().systems[&1].spawn_script,
        seat(reserved("a"), 2)
    );
    session
        .apply(set(1, None))
        .expect("clear the reserved seat");
    assert!(
        common::text(&session).contains("name = \"Beta\" initializer = random_empire_init_02 }")
    );
    session.undo().expect("undo").expect("an op to undo");
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), PAINTED.bytes());
}

#[test]
fn clearing_a_scripted_seat_on_a_system_without_an_initializer_is_undone_exactly() {
    let mut session = PAINTED.open_edited(&[(" initializer = random_empire_init_01", "")]);
    let original = common::current(&session);
    assert_eq!(session.graph().systems[&0].initializer, "");
    assert!(session.graph().systems[&0].spawn_script.is_some());

    let cleared = session
        .apply(Op::SetSpawnWeight {
            system: 0,
            base: None,
        })
        .expect("clear");
    assert_eq!(session.graph().systems[&0].spawn_script, None);

    session.apply_inverse(cleared.inverse).expect("the inverse");
    assert_eq!(common::current(&session), original);
    assert_eq!(session.graph().systems[&0].initializer, "");
}

#[test]
fn a_system_without_an_initializer_is_given_the_basic_one_before_its_weight() {
    let mut session = PAINTED.open();
    let result = session
        .apply(set(10, script(PaintSpawnKind::Enabled, 0)))
        .expect("script");
    let system = &session.graph().systems[&10];
    assert_eq!(system.initializer, "random_empire_init_03");
    assert_eq!(system.spawn_script, script(PaintSpawnKind::Enabled, 0));
    assert_eq!(result.details_stale, vec![10]);
    common::snapshot("script_10_no_initializer", &plain_report(&session, &result));

    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), PAINTED.bytes());
    assert_eq!(session.graph().systems[&10].initializer, "");
    round_trip(
        PAINTED.open(),
        set(11, script(PaintSpawnKind::Preferred, 1)),
    );

    // Written line by line, the two statements follow the name and stand before the
    // effect, whether or not a plain weight stood there already.
    let multi_line = "static_galaxy_scenario = {
	name = \"lines\"
	system = {
		id = \"7\"
		position = { x = 1 y = 2 }
		name = \"Seven\"
		effect = { log = \"x\" }
	}
	system = {
		id = \"8\"
		position = { x = 3 y = 4 }
		spawn_weight = { base = 1 }
		effect = { log = \"y\" }
	}
}
";
    let mut session = from_scenario_text(multi_line);
    session
        .apply(set(7, script(PaintSpawnKind::Enabled, 7)))
        .expect("script 7");
    session
        .apply(set(8, script(PaintSpawnKind::Preferred, 8)))
        .expect("script 8 over its plain weight");
    assert_eq!(
        common::text(&session),
        "static_galaxy_scenario = {
	name = \"lines\"
	system = {
		id = \"7\"
		position = { x = 1 y = 2 }
		name = \"Seven\"
		initializer = random_empire_init_05
		spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|7| }
		effect = { log = \"x\" }
	}
	system = {
		id = \"8\"
		position = { x = 3 y = 4 }
		initializer = random_empire_init_02
		spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|8| }
		effect = { log = \"y\" }
	}
}
"
    );
    session.undo().expect("undo").expect("an op to undo");
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::text(&session), multi_line);
}

#[test]
fn a_custom_initializer_and_the_effect_beside_it_are_kept() {
    let mut session = PAINTED.open();
    let effect = session.scenario_system_effect(4).expect("an effect");
    let result = session
        .apply(set(4, script(reserved("b"), 2)))
        .expect("script");
    let system = &session.graph().systems[&4];
    assert_eq!(system.initializer, "custom_starting_init_01");
    assert_eq!(system.spawn_script, script(reserved("b"), 2));
    assert_eq!(session.scenario_system_effect(4), Some(effect));
    common::snapshot(
        "script_4_custom_initializer",
        &plain_report(&session, &result),
    );

    let anchor = session.scenario_system_effect(9).expect("an effect");
    session
        .apply(set(9, script(PaintSpawnKind::Enabled, 4)))
        .expect("script the anchor");
    assert_eq!(session.scenario_system_effect(9), Some(anchor));
    assert_eq!(
        session.graph().systems[&9].initializer,
        "random_empire_init_06"
    );
    assert!(common::text(&session).contains(
        "name = \"Old Seat\" initializer = random_empire_init_06 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|4| } effect = { set_star_flag = painted_galaxy_fe_spawn"
    ));

    session.undo().expect("undo").expect("an op to undo");
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), PAINTED.bytes());
}

#[test]
fn clearing_removes_the_weight_statement_and_nothing_else() {
    let mut session = PAINTED.open();
    snapshot_step(&mut session, "clear_3", set(3, None));
    let system = &session.graph().systems[&3];
    assert_eq!(system.spawn_script, None);
    assert_eq!(system.spawn_weight, None);
    assert_eq!(system.initializer, "sol_system_initializer");

    session.apply(set(10, None)).expect("nothing to clear");
    assert_eq!(common::current(&session), {
        let mut session = PAINTED.open();
        session.apply(set(3, None)).expect("clear");
        common::current(&session)
    });
}

#[test]
fn several_scripts_are_one_undo_step() {
    let entries = vec![
        (0, None),
        (1, script(PaintSpawnKind::Enabled, 1)),
        (11, script(PaintSpawnKind::Sol, 0)),
    ];
    snapshot_step(
        &mut PAINTED.open(),
        "scripts",
        spawn_scripts(entries.clone()),
    );
}

#[test]
fn a_reserved_seat_takes_a_greek_name() {
    let mut session = PAINTED.open();
    let result = session
        .apply(set(1, seat(reserved("omega"), 2)))
        .expect("reserve omega");
    assert_eq!(
        result.entry.description,
        "Made Beta #1 a Paint a Galaxy spawn (reserved omega, the player's seat)"
    );
    assert_eq!(
        session.graph().systems[&1].spawn_script,
        seat(reserved("omega"), 2)
    );
    assert!(common::text(&session).contains(
        "name = \"Beta\" initializer = random_empire_init_02 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RESERVED|omega|RANDOM_MODULO|3|RANDOM_VALUE|2| modifier = { add = 100000 has_trait = trait_painted_galaxy_reserved_spawn_omega } } }"
    ));
    let reread = from_scenario_text(common::current(&session));
    assert_eq!(
        reread.graph().systems[&1].spawn_script,
        seat(reserved("omega"), 2)
    );
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), PAINTED.bytes());
}

/// A 1st Player marker without the host flag is still the player's seat. The file
/// saves unchanged, and only a rewrite of the seat writes the flag.
#[test]
fn a_first_player_marker_without_the_host_flag_is_still_the_players_seat() {
    let legacy = "PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|1| modifier = { add = 100000 } }";
    let mut session =
        PAINTED.open_edited(&[("PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|1| }", legacy)]);
    let original = common::current(&session);
    assert_eq!(session.graph().systems[&1].spawn_script, player(1));

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy.txt");
    session.save_as(&path).expect("save_as");
    assert_eq!(std::fs::read(&path).unwrap(), original);

    let result = session.apply(set(1, player(4))).expect("rewrite the seat");
    assert_eq!(result.inverse, set(1, player(1)));
    let text = common::text(&session);
    assert!(!text.contains(legacy));
    assert!(text.contains(
        "PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|4| modifier = { add = 100000 has_country_flag = painted_galaxy_host } }"
    ));
}
