//! A scenario Paint a Galaxy wrote, read and edited faithfully: what each scripted
//! spawn reads as, what the script op writes for each kind, and that the plain ops keep
//! their hands off a scripted weight.

use sgf_core::export::{self, ScenarioProfile};
use sgf_core::format::scenario::is_painted;
use sgf_core::ops::{Op, OpError};
use sgf_core::projections::galaxy::{PaintSpawnKind, SpawnScript};

use crate::common;
use common::diff::{plain_report, round_trip, snapshot_step};
use common::fixture::{EXPORTED, GRAMMAR, PAINTED, from_scenario_text};

fn script(kind: PaintSpawnKind, random_value: u8) -> Option<SpawnScript> {
    Some(SpawnScript::PaintAGalaxy {
        kind,
        random_value,
        player: false,
    })
}

fn player(random_value: u8) -> Option<SpawnScript> {
    seat(PaintSpawnKind::Preferred, random_value)
}

fn seat(kind: PaintSpawnKind, random_value: u8) -> Option<SpawnScript> {
    Some(SpawnScript::PaintAGalaxy {
        kind,
        random_value,
        player: true,
    })
}

fn reserved(letter: &str) -> PaintSpawnKind {
    PaintSpawnKind::Reserved(letter.to_owned())
}

fn set(id: u32, script: Option<SpawnScript>) -> Op {
    Op::SetSpawnScript { id, script }
}

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
    let systems = &session.graph.systems;
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
    assert_eq!(session.graph.nebulae.len(), 2);
    assert_eq!(session.title(), "Painted Reach");

    let plain = GRAMMAR.open();
    assert!(
        plain
            .graph
            .systems
            .values()
            .all(|system| system.spawn_script.is_none())
    );
    let save = common::open();
    assert!(
        save.graph
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
        assert_eq!(session.graph.systems[&id].spawn_script, written);
        assert_eq!(session.graph.systems[&id].spawn_weight, Some(0.0));
    }
    // A reserved seat varies over three values, so the value written is the residue.
    let mut session = PAINTED.open();
    session
        .apply(set(1, script(reserved("c"), 7)))
        .expect("reserve");
    assert_eq!(
        session.graph.systems[&1].spawn_script,
        script(reserved("c"), 1)
    );
}

/// The player's seat is the preferred script with `modifier = { add = 100000 }` beside
/// it: the marker is the script's own text, so the seat is replaced and cleared whole
/// like any other.
#[test]
fn the_players_seat_carries_its_marker_and_is_rewritten_whole() {
    let mut session = PAINTED.open();
    snapshot_step(&mut session, "script_1_player", set(1, player(1)));
    assert_eq!(session.graph.systems[&1].spawn_script, player(1));
    assert_eq!(session.graph.systems[&1].spawn_weight, Some(0.0));
    assert!(common::text(&session).contains(
        "name = \"Beta\" initializer = random_empire_init_02 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|1| modifier = { add = 100000 } } }"
    ));

    session
        .apply(set(1, script(PaintSpawnKind::Enabled, 4)))
        .expect("replace the player's seat");
    assert_eq!(
        session.graph.systems[&1].spawn_script,
        script(PaintSpawnKind::Enabled, 4)
    );
    assert!(!common::text(&session).contains("100000"));
    session.undo().expect("undo").expect("an op to undo");
    session
        .apply(set(1, None))
        .expect("clear the player's seat");
    assert_eq!(session.graph.systems[&1].spawn_script, None);
    assert!(
        common::text(&session).contains("name = \"Beta\" initializer = random_empire_init_02 }")
    );
    session.undo().expect("undo").expect("an op to undo");

    let result = session
        .apply(Op::SetSpawnWeight { id: 1, base: None })
        .expect("clear the weight of the player's seat");
    assert_eq!(session.graph.systems[&1].spawn_script, None);
    assert_eq!(session.graph.systems[&1].spawn_weight, None);
    assert_eq!(result.inverse, set(1, player(1)));
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(session.graph.systems[&1].spawn_script, player(1));
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), PAINTED.bytes());
}

/// The Sol seat's marker asks for the United Nations of Earth's flag and a reserved
/// letter's for the submod's trait, so each is the seat of its holder alone. An
/// enabled seat has no marker to carry.
#[test]
fn the_sol_and_reserved_seats_carry_their_own_marker_and_an_enabled_one_has_none() {
    let mut session = PAINTED.open();
    snapshot_step(
        &mut session,
        "script_1_sol_player",
        set(1, seat(PaintSpawnKind::Sol, 0)),
    );
    assert_eq!(
        session.graph.systems[&1].spawn_script,
        seat(PaintSpawnKind::Sol, 0)
    );
    assert!(common::text(&session).contains(
        "name = \"Beta\" initializer = random_empire_init_02 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|SOL|yes|RANDOM_MODULO|1|RANDOM_VALUE|0| modifier = { add = 100000 has_country_flag = human_1 } } }"
    ));
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
        session.graph.systems[&1].spawn_script,
        seat(reserved("a"), 2)
    );
    assert!(common::text(&session).contains(
        "name = \"Beta\" initializer = random_empire_init_02 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RESERVED|a|RANDOM_MODULO|3|RANDOM_VALUE|2| modifier = { add = 100000 has_trait = trait_painted_galaxy_reserved_spawn_a } } }"
    ));
    session
        .apply(set(1, None))
        .expect("clear the reserved seat");
    assert!(
        common::text(&session).contains("name = \"Beta\" initializer = random_empire_init_02 }")
    );
    session.undo().expect("undo").expect("an op to undo");
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), PAINTED.bytes());

    let error = session
        .apply(set(1, seat(PaintSpawnKind::Enabled, 4)))
        .expect_err("an enabled seat is nobody's");
    assert!(matches!(error, OpError::EnabledSeatPlayer), "{error}");
    assert_eq!(
        error.to_string(),
        "an enabled seat has no marker to make it the player's; choose a preferred, Sol or reserved seat"
    );
    let error = session
        .apply(Op::SetSpawnScripts {
            entries: vec![
                (10, script(PaintSpawnKind::Sol, 0)),
                (1, seat(PaintSpawnKind::Enabled, 4)),
            ],
        })
        .expect_err("an enabled seat is nobody's");
    assert!(matches!(error, OpError::EnabledSeatPlayer), "{error}");
    assert!(!session.is_dirty());
}

#[test]
fn a_system_without_an_initializer_is_given_the_basic_one_before_its_weight() {
    let mut session = PAINTED.open();
    let result = session
        .apply(set(10, script(PaintSpawnKind::Enabled, 0)))
        .expect("script");
    let system = &session.graph.systems[&10];
    assert_eq!(system.initializer, "random_empire_init_05");
    assert_eq!(system.spawn_script, script(PaintSpawnKind::Enabled, 0));
    assert!(common::text(&session).contains(
        "position = { x = 150 y = -30 } name = \"Void\" initializer = random_empire_init_05 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|0| } }"
    ));
    assert_eq!(result.details_stale, vec![10]);
    common::snapshot("script_10_no_initializer", &plain_report(&session, &result));

    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), PAINTED.bytes());
    assert_eq!(session.graph.systems[&10].initializer, "");
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
		initializer = random_empire_init_02
		spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|7| }
		effect = { log = \"x\" }
	}
	system = {
		id = \"8\"
		position = { x = 3 y = 4 }
		initializer = random_empire_init_03
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
    let system = &session.graph.systems[&4];
    assert_eq!(system.initializer, "custom_starting_init_01");
    assert_eq!(system.spawn_script, script(reserved("b"), 2));
    assert_eq!(session.scenario_system_effect(4), Some(effect));
    assert!(common::text(&session).contains(
        "initializer = custom_starting_init_01 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RESERVED|b|RANDOM_MODULO|3|RANDOM_VALUE|2| } effect = { set_star_flag = painted_galaxy_custom_initializer } }"
    ));
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
        session.graph.systems[&9].initializer,
        "random_empire_init_04"
    );
    assert!(common::text(&session).contains(
        "name = \"Old Seat\" initializer = random_empire_init_04 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|4| } effect = { set_star_flag = painted_galaxy_fe_spawn"
    ));

    session.undo().expect("undo").expect("an op to undo");
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), PAINTED.bytes());
}

#[test]
fn clearing_removes_the_weight_statement_and_nothing_else() {
    let mut session = PAINTED.open();
    snapshot_step(&mut session, "clear_3", set(3, None));
    let system = &session.graph.systems[&3];
    assert_eq!(system.spawn_script, None);
    assert_eq!(system.spawn_weight, None);
    assert_eq!(system.initializer, "sol_system_initializer");
    assert!(
        common::text(&session).contains("name = \"Sol\" initializer = sol_system_initializer }")
    );

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
        Op::SetSpawnScripts {
            entries: entries.clone(),
        },
    );
}

#[test]
fn a_plain_weight_is_refused_on_a_scripted_system() {
    let mut session = PAINTED.open();
    for op in [
        Op::SetSpawnWeight {
            id: 1,
            base: Some(1.0),
        },
        Op::SetSpawnWeights {
            entries: vec![(10, Some(1.0)), (1, Some(1.0))],
        },
    ] {
        let name = op.name();
        let error = session.apply(op).expect_err(name);
        assert!(
            matches!(error, OpError::ScriptedSpawn(1)),
            "{name}: {error}"
        );
        assert_eq!(
            error.to_string(),
            "system 1's spawn weight is script; change its spawn kind instead"
        );
    }
    for letter in ["ab", "A"] {
        let error = session
            .apply(set(10, script(reserved(letter), 0)))
            .expect_err(letter);
        assert!(matches!(error, OpError::InvalidSeatLetter(_)), "{error}");
    }
    assert!(!session.is_dirty());
}

/// System 2 of the grammar fixture carries a `has_country_flag` modifier: script this
/// editor keeps byte for byte, so a seat is neither written over it nor cleared with it.
#[test]
fn a_block_of_modifiers_is_neither_written_over_nor_cleared() {
    let mut session = GRAMMAR.open();
    for script in [script(PaintSpawnKind::Enabled, 2), None] {
        let error = session.apply(set(2, script)).expect_err("modifiers");
        assert!(matches!(error, OpError::Parse { system: 2, .. }), "{error}");
        assert!(
            error.to_string().contains(
                "spawn_weight carries modifiers this editor does not rewrite; edit the block by hand"
            ),
            "{error}"
        );
    }
    assert!(!session.is_dirty());
}

/// A script's own `add` is rewritten whole, but a `modifier` beside it is script this
/// editor keeps byte for byte, so the seat is neither cleared nor written over.
#[test]
fn a_scripted_seat_with_a_modifier_beside_it_is_neither_cleared_nor_written_over() {
    let text = "static_galaxy_scenario = {
	name = \"modifiers\"
	system = {
		id = \"7\"
		position = { x = 1 y = 2 }
		initializer = random_empire_init_01
		spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|7| modifier = { factor = 0 has_country_flag = keep_out } }
	}
}
";
    let mut session = from_scenario_text(text);
    assert_eq!(
        session.graph.systems[&7].spawn_script,
        script(PaintSpawnKind::Enabled, 7)
    );
    let error = session.apply(set(7, None)).expect_err("clear");
    assert!(matches!(error, OpError::Parse { system: 7, .. }), "{error}");
    common::snapshot("clear_7_modifier_refused", &error.to_string());
    let error = session
        .apply(set(7, script(PaintSpawnKind::Preferred, 1)))
        .expect_err("replace");
    assert!(matches!(error, OpError::Parse { system: 7, .. }), "{error}");
    assert_eq!(common::current(&session), text.as_bytes());

    // Taking the base alone would leave `add` and the modifier, a block no op puts back.
    let error = session
        .apply(Op::SetSpawnWeight { id: 7, base: None })
        .expect_err("clear the base");
    assert!(matches!(error, OpError::Parse { system: 7, .. }), "{error}");
    assert_eq!(common::current(&session), text.as_bytes());
}

/// A plain weight beside the marker's shape is not the player's seat: without the
/// dialect's value the modifier is script this editor keeps, so the block is refused.
#[test]
fn a_plain_weight_with_the_markers_shape_is_still_a_block_of_modifiers() {
    let text = "static_galaxy_scenario = {
	name = \"modifiers\"
	system = {
		id = \"7\"
		position = { x = 1 y = 2 }
		initializer = random_empire_init_01
		spawn_weight = { base = 10 modifier = { add = 100000 } }
	}
}
";
    let mut session = from_scenario_text(text);
    assert_eq!(session.graph.systems[&7].spawn_script, None);
    assert_eq!(session.graph.systems[&7].spawn_weight, Some(10.0));
    let error = session.apply(set(7, player(7))).expect_err("seat");
    assert!(matches!(error, OpError::Parse { system: 7, .. }), "{error}");
    assert_eq!(common::current(&session), text.as_bytes());

    // The base alone is the editor's to clear, and the modifier stays.
    let result = session
        .apply(Op::SetSpawnWeight { id: 7, base: None })
        .expect("clear the base");
    assert!(
        common::current(&session)
            .windows(b"modifier = { add = 100000 }".len())
            .any(|w| w == b"modifier = { add = 100000 }")
    );
    session.apply(result.inverse).expect("apply the inverse");
    assert_eq!(common::current(&session), text.as_bytes());
}

/// A marker of another kind's shape is no marker: the block is script and the seat
/// reads as its kind alone.
#[test]
fn a_marker_of_another_kinds_shape_is_neither_read_nor_rewritten() {
    let text = "static_galaxy_scenario = {
	name = \"modifiers\"
	system = {
		id = \"7\"
		position = { x = 1 y = 2 }
		initializer = random_empire_init_01
		spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|SOL|yes|RANDOM_MODULO|1|RANDOM_VALUE|0| modifier = { add = 100000 } }
	}
}
";
    let mut session = from_scenario_text(text);
    assert_eq!(
        session.graph.systems[&7].spawn_script,
        script(PaintSpawnKind::Sol, 0)
    );
    for op in [
        set(7, None),
        set(7, seat(PaintSpawnKind::Sol, 0)),
        Op::SetSpawnWeight { id: 7, base: None },
    ] {
        let name = op.name();
        let error = session.apply(op).expect_err(name);
        assert!(
            matches!(error, OpError::Parse { system: 7, .. }),
            "{name}: {error}"
        );
    }
    assert_eq!(common::current(&session), text.as_bytes());
}

/// The player's marker beside a foreign modifier is no marker: the block is script and
/// the seat reads as a plain preferred one.
#[test]
fn the_players_marker_beside_a_foreign_modifier_is_neither_read_nor_rewritten() {
    let text = "static_galaxy_scenario = {
	name = \"modifiers\"
	system = {
		id = \"7\"
		position = { x = 1 y = 2 }
		initializer = random_empire_init_01
		spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|7| modifier = { add = 100000 } modifier = { factor = 0 has_country_flag = keep_out } }
	}
}
";
    let mut session = from_scenario_text(text);
    assert_eq!(
        session.graph.systems[&7].spawn_script,
        script(PaintSpawnKind::Preferred, 7)
    );
    for op in [
        set(7, None),
        set(7, player(7)),
        Op::SetSpawnWeight { id: 7, base: None },
    ] {
        let name = op.name();
        let error = session.apply(op).expect_err(name);
        assert!(
            matches!(error, OpError::Parse { system: 7, .. }),
            "{name}: {error}"
        );
    }
    assert_eq!(common::current(&session), text.as_bytes());
}

#[test]
fn clearing_the_plain_weight_of_a_scripted_system_removes_its_block() {
    let mut session = PAINTED.open();
    let result = snapshot_step(
        &mut session,
        "clear_weight_2",
        Op::SetSpawnWeight { id: 2, base: None },
    );
    let system = &session.graph.systems[&2];
    assert_eq!(system.spawn_script, None);
    assert_eq!(system.spawn_weight, None);

    // The inverse puts the script back, not a bare weight of 0.
    let inverse = result.inverse.clone();
    assert_eq!(inverse, set(2, script(reserved("a"), 2)));
    session.apply(inverse).expect("apply the inverse");
    assert_eq!(
        session.graph.systems[&2].spawn_script,
        script(reserved("a"), 2)
    );
    assert_eq!(common::current(&session), PAINTED.bytes());

    let mut session = PAINTED.open();
    let result = session
        .apply(Op::SetSpawnWeight { id: 10, base: None })
        .expect("nothing to clear");
    assert_eq!(result.inverse, Op::SetSpawnWeight { id: 10, base: None });
}

/// Clearing a scripted seat among plain weights inverts to a batch: the script comes
/// back as a script, the plain base as a base.
#[test]
fn clearing_a_scripted_seat_among_plain_weights_inverts_each_its_own_way() {
    let entries = vec![(2, None), (10, Some(1.0))];
    let mut session = PAINTED.open();
    let result = snapshot_step(
        &mut session,
        "clear_weights_2_and_10",
        Op::SetSpawnWeights { entries },
    );
    assert_eq!(session.graph.systems[&2].spawn_script, None);
    assert_eq!(session.graph.systems[&10].spawn_weight, Some(1.0));
    assert_eq!(
        result.inverse,
        Op::Batch {
            description: "Set the spawn weight of 2 systems".to_owned(),
            ops: vec![
                set(2, script(reserved("a"), 2)),
                Op::SetSpawnWeight { id: 10, base: None },
            ],
        }
    );
    session
        .apply(result.inverse.clone())
        .expect("apply the inverse");
    assert_eq!(common::current(&session), PAINTED.bytes());
}

/// A member whose own inverse is a batch joins the batch's inverse op by op, so the
/// inverse is one batch that applies.
#[test]
fn a_scripted_seat_cleared_inside_a_batch_inverts_to_one_flat_batch() {
    let mut session = PAINTED.open();
    let result = session
        .apply(Op::Batch {
            description: "Clear and weigh".to_owned(),
            ops: vec![
                Op::SetSpawnWeights {
                    entries: vec![(2, None)],
                },
                Op::SetSpawnWeight {
                    id: 10,
                    base: Some(1.0),
                },
            ],
        })
        .expect("apply the batch");
    assert_eq!(
        result.inverse,
        Op::Batch {
            description: "Clear and weigh".to_owned(),
            ops: vec![
                Op::SetSpawnWeight { id: 10, base: None },
                set(2, script(reserved("a"), 2)),
            ],
        }
    );
    session.apply(result.inverse).expect("apply the inverse");
    assert_eq!(
        session.graph.systems[&2].spawn_script,
        script(reserved("a"), 2)
    );
    assert_eq!(common::current(&session), PAINTED.bytes());
}

/// No seat is drawn from more than ten values, so a random value of 37 is refused rather
/// than written beside a modulo of 10.
#[test]
fn a_random_value_no_seat_is_drawn_from_is_refused() {
    let mut session = PAINTED.open();
    for kind in [
        PaintSpawnKind::Enabled,
        PaintSpawnKind::Preferred,
        reserved("a"),
    ] {
        let error = session
            .apply(set(10, script(kind, 37)))
            .expect_err("a random value of 37");
        assert!(
            matches!(error, OpError::RandomValueOutOfRange(37, 10)),
            "{error}"
        );
    }
    assert!(!session.is_dirty());
    session
        .apply(set(10, script(reserved("a"), 5)))
        .expect("a reserved seat takes 5 modulo its own 3");
    assert!(common::text(&session).contains("RESERVED|a|RANDOM_MODULO|3|RANDOM_VALUE|2|"));
}

/// 3 is a scripted seat, 7 a wormhole end and 12 a fallen empire zone with a wormhole
/// of its own; all three have lanes.
#[test]
fn removing_painted_systems_inverts_to_their_statements_and_lanes() {
    common::diff::assert_removal_inverts_exactly(PAINTED.open(), &[3, 7, 12]);
}

#[test]
fn a_system_added_with_a_script_is_seated_on_the_basic_initializer() {
    let add = |spawn_weight, spawn_script| Op::AddSystem {
        id: None,
        x: 60.0,
        y: 10.0,
        name: Some("New Seat".to_owned()),
        initializer: None,
        spawn_weight,
        spawn_script,
    };
    let mut session = PAINTED.open();
    let result = snapshot_step(
        &mut session,
        "add_system_scripted",
        add(None, script(PaintSpawnKind::Enabled, 5)),
    );
    let system = &session.graph.systems[&14];
    assert_eq!(system.initializer, "random_empire_init_03");
    assert_eq!(system.spawn_script, script(PaintSpawnKind::Enabled, 5));
    assert_eq!(system.spawn_weight, Some(0.0));
    assert!(common::text(&session).contains(
        "system = { id = \"14\" name = \"New Seat\" position = { x = 60 y = 10 } initializer = random_empire_init_03 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|5| } }"
    ));
    assert_eq!(result.details_stale, vec![14]);

    let removed = session
        .apply(Op::RemoveSystem { id: 14 })
        .expect("remove the seat");
    session.apply(removed.inverse).expect("put the seat back");
    assert_eq!(
        session.graph.systems[&14].spawn_script,
        script(PaintSpawnKind::Enabled, 5)
    );

    let mut session = PAINTED.open();
    let error = session
        .apply(add(Some(1.0), script(PaintSpawnKind::Enabled, 5)))
        .expect_err("a weight and a script");
    assert!(matches!(error, OpError::WeightAndScript), "{error}");
    let error = session
        .apply(add(None, script(reserved("ab"), 0)))
        .expect_err("two letters");
    assert!(matches!(error, OpError::InvalidSeatLetter(_)), "{error}");
    assert!(!session.is_dirty());
}

/// The plain path is unchanged: on the grammar fixture a weight is still `base = N`,
/// and a script written there takes the shape of the statement it joins.
#[test]
fn the_grammar_fixture_still_takes_a_plain_base_and_a_script_on_its_own_line() {
    let mut session = GRAMMAR.open();
    session
        .apply(Op::SetSpawnWeight {
            id: 1,
            base: Some(2.0),
        })
        .expect("plain weight");
    let text = String::from_utf8(common::current(&session)).expect("utf-8");
    assert!(text.contains("initializer = misc_system_init_01 spawn_weight = { base = 2 } }"));
    assert!(!text.contains("painted_galaxy"));
    assert_eq!(session.graph.systems[&1].spawn_script, None);

    snapshot_step(
        &mut GRAMMAR.open(),
        "grammar_script_3018",
        set(3018, script(PaintSpawnKind::Enabled, 8)),
    );
    snapshot_step(
        &mut GRAMMAR.open(),
        "grammar_script_16",
        set(16, script(reserved("z"), 4)),
    );
}

#[test]
fn a_file_is_painted_by_the_mods_names_or_forges_header_for_it() {
    assert!(is_painted(&PAINTED.bytes()));
    assert!(!is_painted(&EXPORTED.bytes()));

    let empty = |profile| {
        let session = export::new_scenario("sgf_new", 0.0, profile).expect("new scenario");
        common::current(&session)
    };
    assert!(is_painted(&empty(ScenarioProfile::PaintAGalaxy)));
    assert!(!is_painted(&empty(ScenarioProfile::Plain)));
}
