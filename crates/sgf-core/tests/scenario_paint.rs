//! A scenario Paint a Galaxy wrote, read and edited faithfully: what each scripted
//! spawn reads as, what the script op writes for each kind, and that the plain ops keep
//! their hands off a scripted weight.

use sgf_core::document::Document;
use sgf_core::ops::{Op, OpError};
use sgf_core::projections::galaxy::{PaintSpawnKind, SpawnReservationPreset, SpawnScript};
use sgf_core::session::Session;

mod common;
use common::diff::{plain_report, plain_snapshot, round_trip};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/paint_a_galaxy.txt"
);

fn open() -> Session {
    Session::open(FIXTURE).expect("open the painted fixture")
}

fn bytes() -> Vec<u8> {
    std::fs::read(FIXTURE).expect("read the fixture")
}

fn text(session: &Session) -> String {
    String::from_utf8(common::current(session)).expect("utf-8")
}

fn script(kind: PaintSpawnKind, random_value: u8) -> Option<SpawnScript> {
    Some(SpawnScript::PaintAGalaxy { kind, random_value })
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
    let mut session = open();
    session.save_as(&path).expect("save_as");
    assert_eq!(std::fs::read(&path).unwrap(), bytes());
}

#[test]
fn each_scripted_spawn_reads_as_its_kind_and_random_value() {
    let session = open();
    let systems = &session.graph.systems;
    assert_eq!(systems[&0].spawn_script, script(PaintSpawnKind::Enabled, 3));
    assert_eq!(
        systems[&1].spawn_script,
        script(PaintSpawnKind::Preferred, 1)
    );
    assert_eq!(systems[&2].spawn_script, script(reserved("a"), 2));
    assert_eq!(systems[&3].spawn_script, script(PaintSpawnKind::Sol, 0));
    for id in 4..=11 {
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

    let plain = common::scenario::open();
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
        let mut session = open();
        let result = session
            .apply(set(id, script(kind.clone(), random_value)))
            .expect(name);
        let written = script(kind, random_value);
        assert_eq!(session.graph.systems[&id].spawn_script, written);
        assert_eq!(session.graph.systems[&id].spawn_weight, Some(0.0));
        common::snapshot(name, &plain_report(&session, &result));
        round_trip(open(), set(id, written));
    }
    // A reserved seat varies over three values, so the value written is the residue.
    let mut session = open();
    session
        .apply(set(1, script(reserved("c"), 7)))
        .expect("reserve");
    assert_eq!(
        session.graph.systems[&1].spawn_script,
        script(reserved("c"), 1)
    );
}

#[test]
fn a_system_without_an_initializer_is_given_the_basic_one_before_its_weight() {
    let mut session = open();
    let result = session
        .apply(set(10, script(PaintSpawnKind::Enabled, 0)))
        .expect("script");
    let system = &session.graph.systems[&10];
    assert_eq!(system.initializer, "random_empire_init_05");
    assert_eq!(system.spawn_script, script(PaintSpawnKind::Enabled, 0));
    assert!(text(&session).contains(
        "position = { x = 150 y = -30 } name = \"Void\" initializer = random_empire_init_05 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|0| } }"
    ));
    assert_eq!(result.details_stale, vec![10]);
    common::snapshot("script_10_no_initializer", &plain_report(&session, &result));

    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), bytes());
    assert_eq!(session.graph.systems[&10].initializer, "");
    round_trip(open(), set(11, script(PaintSpawnKind::Preferred, 1)));

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
    let doc = Document::from_scenario_bytes(multi_line.as_bytes().to_vec()).expect("index");
    let mut session = Session::from_document(None, doc).expect("open");
    session
        .apply(set(7, script(PaintSpawnKind::Enabled, 7)))
        .expect("script 7");
    session
        .apply(set(8, script(PaintSpawnKind::Preferred, 8)))
        .expect("script 8 over its plain weight");
    assert_eq!(
        text(&session),
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
    assert_eq!(text(&session), multi_line);
}

#[test]
fn a_custom_initializer_and_the_effect_beside_it_are_kept() {
    let mut session = open();
    let effect = session.scenario_system_effect(4).expect("an effect");
    let result = session
        .apply(set(4, script(reserved("b"), 2)))
        .expect("script");
    let system = &session.graph.systems[&4];
    assert_eq!(system.initializer, "custom_starting_init_01");
    assert_eq!(system.spawn_script, script(reserved("b"), 2));
    assert_eq!(session.scenario_system_effect(4), Some(effect));
    assert!(text(&session).contains(
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
    assert!(text(&session).contains(
        "name = \"Old Seat\" initializer = random_empire_init_04 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|4| } effect = { set_star_flag = painted_galaxy_fe_spawn"
    ));

    session.undo().expect("undo").expect("an op to undo");
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), bytes());
}

#[test]
fn clearing_removes_the_weight_statement_and_nothing_else() {
    let mut session = open();
    let result = session.apply(set(3, None)).expect("clear");
    let system = &session.graph.systems[&3];
    assert_eq!(system.spawn_script, None);
    assert_eq!(system.spawn_weight, None);
    assert_eq!(system.initializer, "sol_system_initializer");
    assert!(text(&session).contains("name = \"Sol\" initializer = sol_system_initializer }"));
    common::snapshot("clear_3", &plain_report(&session, &result));
    round_trip(open(), set(3, None));

    session.apply(set(10, None)).expect("nothing to clear");
    assert_eq!(common::current(&session), {
        let mut session = open();
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
    plain_snapshot(
        "scripts",
        open(),
        Op::SetSpawnScripts {
            entries: entries.clone(),
        },
    );
    round_trip(open(), Op::SetSpawnScripts { entries });
}

#[test]
fn a_plain_weight_or_reservation_is_refused_on_a_scripted_system() {
    let mut session = open();
    for op in [
        Op::SetSpawnWeight {
            id: 1,
            base: Some(1.0),
        },
        Op::SetSpawnWeights {
            entries: vec![(10, Some(1.0)), (1, Some(1.0))],
        },
        Op::SetSpawnReservation {
            id: 1,
            reserve: Some(SpawnReservationPreset::Human),
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
    let mut session = common::scenario::open();
    for script in [script(PaintSpawnKind::Enabled, 2), None] {
        let error = session.apply(set(2, script)).expect_err("modifiers");
        assert!(matches!(error, OpError::Parse { system: 2, .. }), "{error}");
        assert!(
            error.to_string().contains(
                "spawn_weight carries modifiers this editor does not rewrite; clear its spawn weight first"
            ),
            "{error}"
        );
    }
    assert!(!session.is_dirty());
}

#[test]
fn clearing_the_plain_weight_of_a_scripted_system_removes_its_block() {
    let mut session = open();
    let result = session
        .apply(Op::SetSpawnWeight { id: 2, base: None })
        .expect("clear");
    let system = &session.graph.systems[&2];
    assert_eq!(system.spawn_script, None);
    assert_eq!(system.spawn_weight, None);
    common::snapshot("clear_weight_2", &plain_report(&session, &result));
    round_trip(open(), Op::SetSpawnWeight { id: 2, base: None });

    session
        .apply(Op::SetSpawnReservation {
            id: 2,
            reserve: None,
        })
        .expect("nothing to release");
}

/// The plain path is unchanged: on the grammar fixture a weight is still `base = N`,
/// and a script written there takes the shape of the statement it joins.
#[test]
fn the_grammar_fixture_still_takes_a_plain_base_and_a_script_on_its_own_line() {
    let mut session = common::scenario::open();
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

    plain_snapshot(
        "grammar_script_3018",
        common::scenario::open(),
        set(3018, script(PaintSpawnKind::Enabled, 8)),
    );
    round_trip(
        common::scenario::open(),
        set(3018, script(PaintSpawnKind::Enabled, 8)),
    );
    plain_snapshot(
        "grammar_script_16",
        common::scenario::open(),
        set(16, script(reserved("z"), 4)),
    );
    round_trip(common::scenario::open(), set(16, script(reserved("z"), 4)));
}
