//! A scenario Paint a Galaxy wrote, read and edited faithfully: what each scripted
//! spawn reads as, what the script op writes for each kind, that the plain ops keep
//! their hands off a scripted weight, and what a fallen empire zone reads and writes as.

use sgf_core::document::Document;
use sgf_core::export::{self, ScenarioProfile};
use sgf_core::format::scenario::fe_link::{self, FeLinkFlags};
use sgf_core::format::scenario::fe_zone::{self, FE_ZONE_DISTANCES, FeDirection, FeKind, FeZone};
use sgf_core::format::scenario::is_painted;
use sgf_core::ops::{Op, OpError};
use sgf_core::projections::galaxy::{PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;

mod common;
use common::diff::{plain_report, plain_snapshot, round_trip};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/paint_a_galaxy.txt"
);
const PLAIN: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/2206.11.16.scenario.txt"
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
    Some(SpawnScript::PaintAGalaxy {
        kind,
        random_value,
        player: false,
    })
}

fn player(random_value: u8) -> Option<SpawnScript> {
    Some(SpawnScript::PaintAGalaxy {
        kind: PaintSpawnKind::Preferred,
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

fn zone(direction: FeDirection, kind: FeKind, distance: u16) -> FeZone {
    FeZone {
        direction,
        kind,
        distance,
        preferred: true,
        fallback: false,
    }
}

fn set_zone(id: u32, zone: Option<FeZone>) -> Op {
    Op::SetFeZone { id, zone }
}

fn rounded((x, y): (f64, f64)) -> (f64, f64) {
    ((x * 1e5).round() / 1e5, (y * 1e5).round() / 1e5)
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

/// The player's seat is the preferred script with `modifier = { add = 100000 }` beside
/// it: the marker is the script's own text, so the seat is replaced and cleared whole
/// like any other.
#[test]
fn the_players_seat_carries_its_marker_and_is_rewritten_whole() {
    let mut session = open();
    let result = session.apply(set(1, player(1))).expect("player");
    assert_eq!(session.graph.systems[&1].spawn_script, player(1));
    assert_eq!(session.graph.systems[&1].spawn_weight, Some(0.0));
    assert!(text(&session).contains(
        "name = \"Beta\" initializer = random_empire_init_02 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|1| modifier = { add = 100000 } } }"
    ));
    common::snapshot("script_1_player", &plain_report(&session, &result));
    round_trip(open(), set(1, player(1)));

    session
        .apply(set(1, script(PaintSpawnKind::Enabled, 4)))
        .expect("replace the player's seat");
    assert_eq!(
        session.graph.systems[&1].spawn_script,
        script(PaintSpawnKind::Enabled, 4)
    );
    assert!(!text(&session).contains("100000"));
    session.undo().expect("undo").expect("an op to undo");
    session
        .apply(set(1, None))
        .expect("clear the player's seat");
    assert_eq!(session.graph.systems[&1].spawn_script, None);
    assert!(text(&session).contains("name = \"Beta\" initializer = random_empire_init_02 }"));
    session.undo().expect("undo").expect("an op to undo");

    let result = session
        .apply(Op::SetSpawnWeight { id: 1, base: None })
        .expect("clear the weight of the player's seat");
    assert_eq!(session.graph.systems[&1].spawn_script, None);
    assert_eq!(session.graph.systems[&1].spawn_weight, None);
    assert_eq!(result.entry.inverse, set(1, player(1)));
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(session.graph.systems[&1].spawn_script, player(1));
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), bytes());
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
fn a_plain_weight_is_refused_on_a_scripted_system() {
    let mut session = open();
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
    let mut session = common::scenario::open();
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
    let doc = Document::from_scenario_bytes(text.as_bytes().to_vec()).expect("index");
    let mut session = Session::from_document(None, doc).expect("open");
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
    let doc = Document::from_scenario_bytes(text.as_bytes().to_vec()).expect("index");
    let mut session = Session::from_document(None, doc).expect("open");
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
    session
        .apply(result.entry.inverse)
        .expect("apply the inverse");
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
    let doc = Document::from_scenario_bytes(text.as_bytes().to_vec()).expect("index");
    let mut session = Session::from_document(None, doc).expect("open");
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
    let mut session = open();
    let result = session
        .apply(Op::SetSpawnWeight { id: 2, base: None })
        .expect("clear");
    let system = &session.graph.systems[&2];
    assert_eq!(system.spawn_script, None);
    assert_eq!(system.spawn_weight, None);
    common::snapshot("clear_weight_2", &plain_report(&session, &result));
    round_trip(open(), Op::SetSpawnWeight { id: 2, base: None });

    // The inverse puts the script back, not a bare weight of 0.
    let inverse = result.entry.inverse.clone();
    assert_eq!(inverse, set(2, script(reserved("a"), 2)));
    session.apply(inverse).expect("apply the inverse");
    assert_eq!(
        session.graph.systems[&2].spawn_script,
        script(reserved("a"), 2)
    );
    assert_eq!(common::current(&session), bytes());

    let mut session = open();
    let result = session
        .apply(Op::SetSpawnWeight { id: 10, base: None })
        .expect("nothing to clear");
    assert_eq!(
        result.entry.inverse,
        Op::SetSpawnWeight { id: 10, base: None }
    );
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
    let mut session = open();
    let result = session
        .apply(add(None, script(PaintSpawnKind::Enabled, 5)))
        .expect("add");
    let system = &session.graph.systems[&14];
    assert_eq!(system.initializer, "random_empire_init_03");
    assert_eq!(system.spawn_script, script(PaintSpawnKind::Enabled, 5));
    assert_eq!(system.spawn_weight, Some(0.0));
    assert!(text(&session).contains(
        "system = { id = \"14\" name = \"New Seat\" position = { x = 60 y = 10 } initializer = random_empire_init_03 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|5| } }"
    ));
    assert_eq!(result.details_stale, vec![14]);
    common::snapshot("add_system_scripted", &plain_report(&session, &result));
    round_trip(open(), add(None, script(PaintSpawnKind::Enabled, 5)));

    let removed = session
        .apply(Op::RemoveSystem { id: 14 })
        .expect("remove the seat");
    assert_eq!(
        removed.entry.inverse,
        Op::AddSystem {
            id: Some(14),
            x: 60.0,
            y: 10.0,
            name: Some("New Seat".to_owned()),
            initializer: Some("random_empire_init_03".to_owned()),
            spawn_weight: None,
            spawn_script: script(PaintSpawnKind::Enabled, 5),
        }
    );

    let mut session = open();
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

#[test]
fn a_file_is_painted_by_the_mods_names_or_forges_header_for_it() {
    assert!(is_painted(&bytes()));
    assert!(!is_painted(
        &std::fs::read(PLAIN).expect("read the plain fixture")
    ));

    let empty = |profile| {
        let session = export::new_scenario("sgf_new", 0.0, profile).expect("new scenario");
        common::current(&session)
    };
    assert!(is_painted(&empty(ScenarioProfile::PaintAGalaxy)));
    assert!(!is_painted(&empty(ScenarioProfile::Plain)));
}

#[test]
fn each_zone_reads_back_with_its_centre() {
    let session = open();
    let systems = &session.graph.systems;
    let old_seat = zone(FeDirection::N, FeKind::Random, 40);
    assert_eq!(systems[&9].fe_zone, Some(old_seat.clone()));
    let high_seat = FeZone {
        fallback: true,
        ..zone(FeDirection::Se, FeKind::Materialist, 60)
    };
    assert_eq!(systems[&12].fe_zone, Some(high_seat.clone()));
    for id in (0..=8).chain([10, 11, 13]) {
        assert_eq!(systems[&id].fe_zone, None, "system {id}");
    }
    let anchor = |id: u32| (systems[&id].x, systems[&id].y);
    assert_eq!(
        rounded(fe_zone::centre(anchor(9), &old_seat)),
        (0.0, -220.0)
    );
    assert_eq!(
        rounded(fe_zone::centre(anchor(12), &high_seat)),
        (77.57359, 192.42641)
    );

    let save = common::open();
    assert!(save.graph.systems.values().all(|s| s.fe_zone.is_none()));
    let error = common::open()
        .apply(set_zone(0, Some(old_seat)))
        .expect_err("a save has no zones");
    assert!(matches!(error, OpError::Unsupported { .. }), "{error}");
}

#[test]
fn a_zone_is_written_at_the_end_of_the_effect_and_the_other_flags_stay() {
    let cases: [(&str, u32, Option<FeZone>, &str); 5] = [
        (
            "zone_10_no_effect",
            10,
            Some(zone(FeDirection::W, FeKind::Hive, 80)),
            "name = \"Void\" effect = { set_star_flag = painted_galaxy_fe_spawn set_star_flag = painted_galaxy_fe_spawn_w set_star_flag = painted_galaxy_fe_spawn_hive set_star_flag = painted_galaxy_fe_spawn_distance_80 set_star_flag = painted_galaxy_fe_spawn_preferred } }",
        ),
        (
            "zone_7_beside_wormhole",
            7,
            Some(zone(FeDirection::E, FeKind::Random, 30)),
            "effect = { set_star_flag = painted_galaxy_wormhole_1 set_star_flag = empire_cluster set_star_flag = painted_galaxy_fe_spawn set_star_flag = painted_galaxy_fe_spawn_e set_star_flag = painted_galaxy_fe_spawn_random set_star_flag = painted_galaxy_fe_spawn_distance_30 set_star_flag = painted_galaxy_fe_spawn_preferred } }",
        ),
        (
            "zone_12_change",
            12,
            Some(FeZone {
                fallback: true,
                ..zone(FeDirection::Se, FeKind::Machine, 100)
            }),
            "effect = { set_star_flag = painted_galaxy_automatic_initializer set_star_flag = painted_galaxy_wormhole_2 set_star_flag = empire_cluster set_star_flag = painted_galaxy_fe_spawn set_star_flag = painted_galaxy_fe_spawn_se set_star_flag = painted_galaxy_fe_spawn_machine set_star_flag = painted_galaxy_fe_spawn_distance_100 set_star_flag = painted_galaxy_fe_spawn_preferred set_star_flag = painted_galaxy_fe_spawn_fallback } }",
        ),
        (
            "zone_12_remove",
            12,
            None,
            "effect = { set_star_flag = painted_galaxy_automatic_initializer set_star_flag = painted_galaxy_wormhole_2 set_star_flag = empire_cluster } }",
        ),
        ("zone_9_remove", 9, None, "name = \"Old Seat\" }"),
    ];
    for (name, id, zone, written) in cases {
        let mut session = open();
        let result = session.apply(set_zone(id, zone.clone())).expect(name);
        assert_eq!(session.graph.systems[&id].fe_zone, zone, "{name}");
        assert!(
            text(&session).contains(written),
            "{name}: {}",
            text(&session)
        );
        common::snapshot(name, &plain_report(&session, &result));
        session.undo().expect("undo").expect("an op to undo");
        assert_eq!(common::current(&session), bytes(), "{name}");
        round_trip(open(), set_zone(id, zone));
    }

    let mut session = open();
    session
        .apply(set_zone(10, None))
        .expect("nothing to remove");
    assert_eq!(common::current(&session), bytes());
    let error = session
        .apply(set_zone(99, None))
        .expect_err("no such system");
    assert!(matches!(error, OpError::UnknownSystem(99)), "{error}");
}

#[test]
fn several_zones_are_one_undo_step() {
    let entries = vec![
        (9, None),
        (11, Some(zone(FeDirection::Nw, FeKind::Spiritualist, 160))),
        (
            12,
            Some(FeZone {
                preferred: false,
                ..zone(FeDirection::Ne, FeKind::Xenophobe, 200)
            }),
        ),
    ];
    plain_snapshot(
        "zones",
        open(),
        Op::SetFeZones {
            entries: entries.clone(),
        },
    );
    round_trip(open(), Op::SetFeZones { entries });

    let mut session = open();
    for (entries, name) in [
        (vec![], "Empty"),
        (vec![(9, None), (9, None)], "DuplicateSystem"),
    ] {
        let error = session.apply(Op::SetFeZones { entries }).expect_err(name);
        assert!(
            matches!(error, OpError::Empty | OpError::DuplicateSystem(9)),
            "{name}: {error}"
        );
    }
    assert!(!session.is_dirty());
}

#[test]
fn every_zone_round_trips_through_its_flags_and_the_defaults_fill_the_rest() {
    for direction in FeDirection::ALL {
        for kind in FeKind::ALL {
            for distance in FE_ZONE_DISTANCES {
                for (preferred, fallback) in [(false, false), (true, false), (true, true)] {
                    let zone = FeZone {
                        direction,
                        kind,
                        distance,
                        preferred,
                        fallback,
                    };
                    let flags = fe_zone::flags(&zone);
                    assert!(flags.iter().all(|f| fe_zone::is_zone_flag(f)), "{flags:?}");
                    assert_eq!(
                        fe_zone::parse(flags.iter().map(String::as_str)),
                        Some(zone.clone()),
                        "{flags:?}"
                    );
                }
            }
        }
    }
    assert_eq!(
        fe_zone::flags(&zone(FeDirection::Sw, FeKind::Xenophile, 70)),
        [
            "painted_galaxy_fe_spawn",
            "painted_galaxy_fe_spawn_sw",
            "painted_galaxy_fe_spawn_xenophile",
            "painted_galaxy_fe_spawn_distance_70",
            "painted_galaxy_fe_spawn_preferred",
        ]
    );

    let parsed = |flags: &[&str]| fe_zone::parse(flags.iter().copied());
    assert_eq!(
        parsed(&["painted_galaxy_fe_spawn"]),
        Some(FeZone {
            direction: FeDirection::E,
            kind: FeKind::Random,
            distance: 40,
            preferred: false,
            fallback: false,
        })
    );
    assert_eq!(
        parsed(&[
            "empire_cluster",
            "painted_galaxy_fe_spawn_distance_1",
            "painted_galaxy_fe_spawn_north",
            "painted_galaxy_fe_spawn_s",
            "painted_galaxy_fe_spawn",
            "painted_galaxy_fe_custom_connection_id_0",
        ]),
        Some(FeZone {
            direction: FeDirection::S,
            kind: FeKind::Random,
            distance: 40,
            preferred: false,
            fallback: false,
        })
    );
    assert_eq!(
        parsed(&[
            "painted_galaxy_fe_spawn_n",
            "painted_galaxy_fe_spawn_preferred"
        ]),
        None
    );
    for flag in [
        "painted_galaxy_fe_custom_connections",
        "painted_galaxy_fe_custom_connection_id_0",
        "painted_galaxy_fe_custom_connection_to_0",
        "painted_galaxy_wormhole_1",
        "empire_cluster",
    ] {
        assert!(!fe_zone::is_zone_flag(flag), "{flag}");
    }
    let linked = |flags: &[&str]| fe_link::parse(flags.iter().copied());
    assert_eq!(
        linked(&[
            "empire_cluster",
            "painted_galaxy_fe_spawn",
            "painted_galaxy_fe_custom_connection_to_2",
            "painted_galaxy_fe_custom_connections",
            "painted_galaxy_fe_custom_connection_id_0",
            "painted_galaxy_fe_custom_connection_id_1",
            "painted_galaxy_fe_custom_connection_to_0",
        ]),
        FeLinkFlags {
            custom: true,
            id: Some(0),
            to: vec![0, 2],
        }
    );
    assert_eq!(
        linked(&["painted_galaxy_fe_spawn", "painted_galaxy_wormhole_1"]),
        FeLinkFlags::default()
    );
    assert_eq!(
        linked(&["painted_galaxy_fe_custom_connection_id_x"]),
        FeLinkFlags::default()
    );
}

#[test]
fn a_custom_connection_flag_survives_a_removal_on_its_own_line() {
    let multi_line = "static_galaxy_scenario = {
	name = \"lines\"
	system = {
		id = \"7\"
		position = { x = 1 y = 2 }
		effect = {
			set_star_flag = painted_galaxy_fe_custom_connections
			set_star_flag = painted_galaxy_fe_spawn
			set_star_flag = painted_galaxy_fe_spawn_w
			set_star_flag = painted_galaxy_fe_custom_connection_id_0
			set_star_flag = painted_galaxy_fe_spawn_distance_50
		}
	}
	system = {
		id = \"8\"
		position = { x = 3 y = 4 }
	}
}
";
    let doc = Document::from_scenario_bytes(multi_line.as_bytes().to_vec()).expect("index");
    let mut session = Session::from_document(None, doc).expect("open");
    assert_eq!(
        session.graph.systems[&7].fe_zone,
        Some(FeZone {
            preferred: false,
            ..zone(FeDirection::W, FeKind::Random, 50)
        })
    );
    session.apply(set_zone(7, None)).expect("remove 7");
    session
        .apply(set_zone(8, Some(zone(FeDirection::N, FeKind::Hive, 40))))
        .expect("add 8");
    assert_eq!(
        text(&session),
        "static_galaxy_scenario = {
	name = \"lines\"
	system = {
		id = \"7\"
		position = { x = 1 y = 2 }
		effect = {
			set_star_flag = painted_galaxy_fe_custom_connections
			set_star_flag = painted_galaxy_fe_custom_connection_id_0
		}
	}
	system = {
		id = \"8\"
		position = { x = 3 y = 4 }
		effect = { set_star_flag = painted_galaxy_fe_spawn set_star_flag = painted_galaxy_fe_spawn_n set_star_flag = painted_galaxy_fe_spawn_hive set_star_flag = painted_galaxy_fe_spawn_distance_40 set_star_flag = painted_galaxy_fe_spawn_preferred }
	}
}
"
    );
    session
        .apply(set_zone(7, Some(zone(FeDirection::S, FeKind::Machine, 40))))
        .expect("add 7 back on its own lines");
    assert!(text(&session).contains(
        "			set_star_flag = painted_galaxy_fe_custom_connection_id_0
			set_star_flag = painted_galaxy_fe_spawn
			set_star_flag = painted_galaxy_fe_spawn_s
			set_star_flag = painted_galaxy_fe_spawn_machine
			set_star_flag = painted_galaxy_fe_spawn_distance_40
			set_star_flag = painted_galaxy_fe_spawn_preferred
		}"
    ));
    for _ in 0..3 {
        session.undo().expect("undo").expect("an op to undo");
    }
    assert_eq!(text(&session), multi_line);
}
