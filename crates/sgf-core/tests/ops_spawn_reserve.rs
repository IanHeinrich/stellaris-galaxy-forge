//! Holding a system for the player or the AI on the grammar fixture: the modifier each
//! preset writes, and what the two presets do to one another.

use sgf_core::ops::Op;
use sgf_core::projections::galaxy::{SpawnReservation, SpawnReservationPreset};
use sgf_core::session::Session;

mod common;
use common::diff::{plain_report, plain_snapshot, round_trip};
use common::scenario::{bytes, current, open};

const HUMAN: Option<SpawnReservationPreset> = Some(SpawnReservationPreset::Human);
const AI: Option<SpawnReservationPreset> = Some(SpawnReservationPreset::Ai);

#[test]
fn reserving_3018_appends_the_modifier_to_its_block() {
    let mut session = open();
    let result = session
        .apply(Op::SetSpawnReservation {
            id: 3018,
            reserve: HUMAN,
        })
        .expect("reserve");
    assert_eq!(
        session.graph.systems[&3018].spawn_modifiers[0].reservation,
        Some(SpawnReservation::Human)
    );
    common::snapshot("reserve_3018", &plain_report(&session, &result));
    round_trip(
        open(),
        Op::SetSpawnReservation {
            id: 3018,
            reserve: HUMAN,
        },
    );
}

#[test]
fn reserving_9_writes_the_block_it_has_not_got() {
    let mut session = open();
    let result = session
        .apply(Op::SetSpawnReservation {
            id: 9,
            reserve: HUMAN,
        })
        .expect("reserve");
    assert_eq!(session.graph.systems[&9].spawn_weight, Some(1.0));
    assert_eq!(
        session.graph.systems[&9].spawn_modifiers[0].reservation,
        Some(SpawnReservation::Human)
    );
    common::snapshot("reserve_9", &plain_report(&session, &result));
    round_trip(
        open(),
        Op::SetSpawnReservation {
            id: 9,
            reserve: HUMAN,
        },
    );
}

#[test]
fn reserving_512_leaves_the_country_flag_modifier_alone() {
    plain_snapshot(
        "reserve_512",
        open(),
        Op::SetSpawnReservation {
            id: 512,
            reserve: HUMAN,
        },
    );
    round_trip(
        open(),
        Op::SetSpawnReservation {
            id: 512,
            reserve: HUMAN,
        },
    );
}

#[test]
fn releasing_888_takes_back_the_modifier_and_leaves_the_base() {
    let mut session = open();
    let result = session
        .apply(Op::SetSpawnReservation {
            id: 888,
            reserve: None,
        })
        .expect("release");
    assert_eq!(session.graph.systems[&888].spawn_weight, Some(1.0));
    assert!(session.graph.systems[&888].spawn_modifiers.is_empty());
    assert_eq!(
        result.entry.inverse,
        Op::SetSpawnReservation {
            id: 888,
            reserve: HUMAN
        }
    );
    common::snapshot("release_888", &plain_report(&session, &result));
    round_trip(
        open(),
        Op::SetSpawnReservation {
            id: 888,
            reserve: None,
        },
    );
}

#[test]
fn reserving_3018_for_the_ai_bars_the_player_instead() {
    let mut session = open();
    let result = session
        .apply(Op::SetSpawnReservation {
            id: 3018,
            reserve: AI,
        })
        .expect("reserve");
    assert_eq!(
        session.graph.systems[&3018].spawn_modifiers[0].reservation,
        Some(SpawnReservation::Ai)
    );
    common::snapshot("reserve_ai_3018", &plain_report(&session, &result));
    round_trip(
        open(),
        Op::SetSpawnReservation {
            id: 3018,
            reserve: AI,
        },
    );
}

/// The two presets are exclusive: the one standing is rewritten, never joined.
#[test]
fn reserving_888_for_the_ai_takes_the_human_reservation_back() {
    let mut session = open();
    let result = session
        .apply(Op::SetSpawnReservation {
            id: 888,
            reserve: AI,
        })
        .expect("switch");
    let modifiers = &session.graph.systems[&888].spawn_modifiers;
    assert_eq!(
        modifiers.len(),
        1,
        "a second reservation was written beside"
    );
    assert_eq!(modifiers[0].reservation, Some(SpawnReservation::Ai));
    assert_eq!(
        result.entry.inverse,
        Op::SetSpawnReservation {
            id: 888,
            reserve: HUMAN
        }
    );
    common::snapshot("reserve_ai_888", &plain_report(&session, &result));
    round_trip(
        open(),
        Op::SetSpawnReservation {
            id: 888,
            reserve: AI,
        },
    );
}

#[test]
fn releasing_a_system_held_from_the_player_takes_the_ai_preset_back() {
    let (_dir, path) = scenario_of(
        "system = { id = \"1\" name = \"AI only\" position = { x = 0 y = 0 }          initializer = custom_starting_init_01          spawn_weight = { base = 1 modifier = { factor = 0 is_ai = no } } }",
    );
    let mut session = Session::open(&path).expect("open the scenario");
    assert_eq!(
        session.graph.systems[&1].spawn_modifiers[0].reservation,
        Some(SpawnReservation::Ai)
    );

    let result = session
        .apply(Op::SetSpawnReservation {
            id: 1,
            reserve: None,
        })
        .expect("release");
    assert!(session.graph.systems[&1].spawn_modifiers.is_empty());
    assert_eq!(session.graph.systems[&1].spawn_weight, Some(1.0));
    assert_eq!(
        result.entry.inverse,
        Op::SetSpawnReservation { id: 1, reserve: AI }
    );
    common::snapshot("release_ai", &plain_report(&session, &result));

    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), std::fs::read(&path).unwrap());
}

/// The weight holds the reservation, so clearing the weight clears it too.
#[test]
fn clearing_the_weight_of_888_takes_its_reservation_with_it() {
    let mut session = open();
    let result = session
        .apply(Op::SetSpawnWeight {
            id: 888,
            base: None,
        })
        .expect("clear");
    assert_eq!(session.graph.systems[&888].spawn_weight, None);
    assert!(session.graph.systems[&888].spawn_modifiers.is_empty());
    common::snapshot("clear_weight_888", &plain_report(&session, &result));
    round_trip(
        open(),
        Op::SetSpawnWeight {
            id: 888,
            base: None,
        },
    );
}

#[test]
fn a_reservation_that_already_stands_and_one_that_never_stood_write_nothing() {
    let fixture = bytes();
    let mut session = open();
    let again = session
        .apply(Op::SetSpawnReservation {
            id: 888,
            reserve: HUMAN,
        })
        .expect("a second reservation is no error");
    assert_eq!(current(&session), fixture);
    assert_eq!(
        again.entry.inverse,
        Op::SetSpawnReservation {
            id: 888,
            reserve: HUMAN
        },
        "the inverse of writing nothing writes nothing"
    );

    session
        .apply(Op::SetSpawnReservation {
            id: 2,
            reserve: None,
        })
        .expect("releasing a system that holds none is no error");
    assert_eq!(current(&session), fixture);
    assert_eq!(session.graph.systems[&2].spawn_modifiers.len(), 1);
}

/// One scenario written to a temporary file, for shapes the shared fixture has not got.
fn scenario_of(statement: &str) -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("scenario.txt");
    std::fs::write(
        &path,
        format!(
            "static_galaxy_scenario = {{
	name = \"sgf_shapes\"
	{statement}
}}
"
        ),
    )
    .expect("write the scenario");
    (dir, path)
}

#[test]
fn a_base_the_reader_cannot_read_is_rewritten_whole_and_inverts_to_none() {
    let (_dir, path) = scenario_of(
        "system = { id = \"1\" name = \"Ranged\" position = { x = 0 y = 0 }          initializer = custom_starting_init_01          spawn_weight = { base = { min = 1 max = 2 } } }",
    );
    let mut session = Session::open(&path).expect("open the scenario");
    assert_eq!(session.graph.systems[&1].spawn_weight, None);

    let result = session
        .apply(Op::SetSpawnWeight {
            id: 1,
            base: Some(3.0),
        })
        .expect("the range is replaced by the number");
    let text = String::from_utf8(current(&session)).expect("utf-8");
    assert!(
        text.contains("spawn_weight = { base = 3 }"),
        "the range was left standing: {text}"
    );
    assert_eq!(session.graph.systems[&1].spawn_weight, Some(3.0));
    assert_eq!(
        result.entry.inverse,
        Op::SetSpawnWeight { id: 1, base: None },
        "a base no number can describe inverts to none; undo replays the bytes"
    );
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), std::fs::read(&path).unwrap());
}

#[test]
fn a_reservation_is_refused_beside_a_modifier_that_tests_the_ai_another_way() {
    for (trigger, extra) in [
        ("is_ai = yes", "is_ai = yes has_country_flag = sgf_ai"),
        ("is_ai = no", "is_ai = no has_country_flag = sgf_ai"),
    ] {
        let (_dir, path) = scenario_of(&format!(
            "system = {{ id = \"1\" name = \"Held\" position = {{ x = 0 y = 0 }}          initializer = custom_starting_init_01          spawn_weight = {{ base = 1 modifier = {{ factor = 0 {trigger}          has_country_flag = sgf_ai }} }} }}"
        ));
        let mut session = Session::open(&path).expect("open the scenario");
        assert_eq!(
            session.graph.systems[&1].spawn_modifiers[0].reservation, None,
            "two triggers are more than this editor reads"
        );
        for reserve in [HUMAN, AI] {
            let error = session
                .apply(Op::SetSpawnReservation { id: 1, reserve })
                .expect_err("refused rather than written beside");
            let message = error.to_string();
            assert!(message.contains("already tests the AI"), "{message}");
            assert!(message.contains(extra), "{message}");
        }
        assert!(!session.is_dirty());
    }
}
