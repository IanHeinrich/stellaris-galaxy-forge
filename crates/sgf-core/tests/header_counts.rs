//! The empire counts a Paint a Galaxy header carries and the issues a painted scenario
//! raises about its seats: the header against the seats, the player's seat set aside
//! once, the fallen empire zones and the marauder clan homes, a reserved letter or Sol
//! on two systems, the player's seat on two, a Sol seat on the Sol initializer, and a
//! system inside the L-Cluster's circle on any scenario.

use sgf_core::format::scenario::header_counts::{
    SeatCounts, empire_counts, seat_counts, zone_count,
};
use sgf_core::format::scenario::marauder::clan_count;
use sgf_core::ops::{Op, OpError};
use sgf_core::projections::galaxy::{PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;
use sgf_core::validate::{IssueCode, Severity};

use crate::common;
use common::Refused;
use common::diff::snapshot_step;
use common::fixture::{GRAMMAR, PAINTED};
use common::{coded, only_message};

fn seats(seats: u32, reserved: u32, player_on_reserved: bool) -> SeatCounts {
    SeatCounts {
        seats,
        reserved,
        player_on_reserved,
    }
}

fn counts_op(session: &Session) -> Op {
    let zones = zone_count(&session.graph);
    let clans = clan_count(&session.graph);
    Op::SetHeaderKeys {
        entries: empire_counts(seat_counts(&session.graph), zones, clans)
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    }
}

#[test]
fn the_fixture_has_four_seats_three_held_and_a_header_that_allows_too_many() {
    let session = PAINTED.open();
    assert_eq!(seat_counts(&session.graph), seats(4, 3, true));
    assert_eq!(zone_count(&session.graph), 2);
    assert_eq!(clan_count(&session.graph), 0);
    assert_eq!(
        session.graph.header_block_count("num_empires", "max"),
        Some(3)
    );
    assert_eq!(session.graph.header_count("num_empire_default"), Some(3));
    assert_eq!(session.graph.header_count("fallen_empire_max"), Some(6));
    assert_eq!(session.graph.header_count("fallen_empire_default"), Some(0));
    assert_eq!(session.graph.header_count("marauder_empire_max"), Some(3));
    assert_eq!(
        session.graph.header_count("marauder_empire_default"),
        Some(1)
    );
    let issues = session.validate();
    let header = coded(&issues, IssueCode::HeaderEmpireCount);
    assert_eq!(header.len(), 1, "{issues:?}");
    assert_eq!(
        header[0].message,
        "Header allows 3 empires but the file has 4 seats. Update the empire counts."
    );
    assert_eq!(header[0].severity, Severity::Warning);
    assert!(header[0].systems.is_empty());
    assert!(coded(&issues, IssueCode::SeatLetterDuplicate).is_empty());
    assert!(coded(&issues, IssueCode::LClusterSystem).is_empty());

    let save = common::open();
    assert_eq!(save.graph.header_block_count("num_empires", "max"), None);
    assert_eq!(save.graph.header_count("fallen_empire_max"), None);
    assert_eq!(save.graph.header_count("marauder_empire_max"), None);
    let plain = GRAMMAR.open();
    for session in [&save, &plain] {
        let issues = session.validate();
        assert!(coded(&issues, IssueCode::HeaderEmpireCount).is_empty());
        assert!(coded(&issues, IssueCode::SeatLetterDuplicate).is_empty());
    }
}

#[test]
fn updating_the_counts_rewrites_the_nine_keys_as_one_step_and_clears_the_issue() {
    let session = PAINTED.open();
    let op = counts_op(&session);
    assert_eq!(
        op,
        Op::SetHeaderKeys {
            entries: vec![
                ("num_empires".to_owned(), "{ min = 0 max = 3 }".to_owned()),
                ("num_empire_default".to_owned(), "1".to_owned()),
                ("advanced_empire_default".to_owned(), "0".to_owned()),
                ("nomad_empire_default".to_owned(), "0".to_owned()),
                ("nomad_empire_max".to_owned(), "3".to_owned()),
                ("fallen_empire_max".to_owned(), "2".to_owned()),
                ("fallen_empire_default".to_owned(), "2".to_owned()),
                ("marauder_empire_default".to_owned(), "0".to_owned()),
                ("marauder_empire_max".to_owned(), "0".to_owned()),
            ]
        }
    );
    snapshot_step(&mut PAINTED.open(), "update_empire_counts", op.clone());

    let mut session = PAINTED.open();
    let result = session.apply(op).expect("update");
    assert_eq!(result.entry.description, "Update empire counts");
    assert_eq!(
        result.inverse,
        Op::SetHeaderKeys {
            entries: vec![
                ("num_empires".to_owned(), "{ min = 0 max = 3 }".to_owned()),
                ("num_empire_default".to_owned(), "3".to_owned()),
                ("advanced_empire_default".to_owned(), "0".to_owned()),
                ("nomad_empire_default".to_owned(), "0".to_owned()),
                ("nomad_empire_max".to_owned(), "3".to_owned()),
                ("fallen_empire_max".to_owned(), "6".to_owned()),
                ("fallen_empire_default".to_owned(), "0".to_owned()),
                ("marauder_empire_default".to_owned(), "1".to_owned()),
                ("marauder_empire_max".to_owned(), "3".to_owned()),
            ]
        }
    );
    assert!(coded(&result.issues, IssueCode::HeaderEmpireCount).is_empty());
    assert_eq!(session.graph.header_count("num_empire_default"), Some(1));
    assert_eq!(session.graph.header_count("fallen_empire_max"), Some(2));
    assert_eq!(session.graph.header_count("fallen_empire_default"), Some(2));
    assert_eq!(session.graph.header_count("marauder_empire_max"), Some(0));
    assert_eq!(
        session.graph.header_count("marauder_empire_default"),
        Some(0)
    );
    assert_eq!(session.history().undo.len(), 1);
    let header = session
        .edit_result(result)
        .delta
        .header
        .expect("the header");
    assert!(
        header
            .iter()
            .any(|f| f.key == "num_empire_default" && f.value == "1"),
        "{header:?}"
    );
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(
        coded(&session.validate(), IssueCode::HeaderEmpireCount).len(),
        1
    );
}

#[test]
fn a_key_the_header_lacks_is_inserted_and_a_repeated_or_empty_list_is_refused() {
    let op = Op::SetHeaderKeys {
        entries: vec![
            ("core_radius".to_owned(), "40".to_owned()),
            ("num_empire_default".to_owned(), "2".to_owned()),
        ],
    };
    snapshot_step(&mut PAINTED.open(), "set_two_header_keys", op.clone());
    let mut session = PAINTED.open();
    let result = session.apply(op).expect("set two keys");
    assert_eq!(result.entry.description, "Set 2 header keys");
    assert_eq!(
        result.inverse,
        Op::SetHeaderKeys {
            entries: vec![("num_empire_default".to_owned(), "3".to_owned())]
        },
        "a key this added has nothing to put back"
    );
    assert_eq!(session.graph.core_radius, 40.0);

    let mut session = PAINTED.open();
    let cases: [Refused<Vec<(String, String)>>; 3] = [
        (vec![], |e| matches!(e, OpError::NoEntries)),
        (
            vec![
                ("core_radius".to_owned(), "1".to_owned()),
                ("core_radius".to_owned(), "2".to_owned()),
            ],
            |e| matches!(e, OpError::HeaderParse { reason, .. } if reason.contains("more than once")),
        ),
        (
            vec![("system".to_owned(), "5".to_owned())],
            |e| matches!(e, OpError::HeaderParse { reason, .. } if reason.contains("not a header key")),
        ),
    ];
    for (entries, expected) in cases {
        let label = format!("{entries:?}");
        let error = session
            .apply(Op::SetHeaderKeys { entries })
            .expect_err(&label);
        assert!(expected(&error), "{label}: {error:?}");
    }
    assert!(!session.is_dirty());
}

#[test]
fn a_wrong_maximum_is_reported_even_when_the_default_fits() {
    let session = PAINTED.open_edited(&[(
        "num_empires = { min = 0 max = 3 }\n\tnum_empire_default = 3",
        "num_empires = { min = 0 max = 5 }\n\tnum_empire_default = 1",
    )]);
    assert_eq!(
        session.graph.header_block_count("num_empires", "max"),
        Some(5)
    );
    assert_eq!(
        only_message(&session.validate(), IssueCode::HeaderEmpireCount),
        "Header allows 5 empires but the file has 4 seats. Update the empire counts."
    );

    let fixed = PAINTED.open_edited(&[("num_empire_default = 3", "num_empire_default = 1")]);
    assert_eq!(
        only_message(&fixed.validate(), IssueCode::HeaderEmpireCount),
        "Header allows 6 fallen empires but the map has 2 fallen empire zones. Update the empire counts."
    );
}

#[test]
fn the_fallen_counts_are_checked_against_the_zones_once_the_seats_fit() {
    let seats_fit = ("num_empire_default = 3", "num_empire_default = 1");
    let no_clans = ("marauder_empire_max = 3", "marauder_empire_max = 0");
    let no_clan_default = ("marauder_empire_default = 1", "marauder_empire_default = 0");
    let fits = PAINTED.open_edited(&[
        seats_fit,
        ("fallen_empire_max = 6", "fallen_empire_max = 2"),
        no_clans,
        no_clan_default,
    ]);
    assert_eq!(fits.graph.header_count("fallen_empire_max"), Some(2));
    assert!(coded(&fits.validate(), IssueCode::HeaderEmpireCount).is_empty());

    let default_high = PAINTED.open_edited(&[
        seats_fit,
        ("fallen_empire_max = 6", "fallen_empire_max = 2"),
        ("fallen_empire_default = 0", "fallen_empire_default = 3"),
    ]);
    assert_eq!(
        default_high.graph.header_count("fallen_empire_default"),
        Some(3)
    );
    assert_eq!(
        only_message(&default_high.validate(), IssueCode::HeaderEmpireCount),
        "Header allows 3 fallen empires but the map has 2 fallen empire zones. Update the empire counts."
    );

    let max_low = PAINTED.open_edited(&[
        seats_fit,
        ("fallen_empire_max = 6", "fallen_empire_max = 1"),
    ]);
    assert_eq!(
        only_message(&max_low.validate(), IssueCode::HeaderEmpireCount),
        "Header allows 1 fallen empires but the map has 2 fallen empire zones. Update the empire counts."
    );

    let unreadable = PAINTED.open_edited(&[
        seats_fit,
        ("fallen_empire_max = 6", "fallen_empire_max = @al"),
        no_clans,
        no_clan_default,
    ]);
    assert_eq!(unreadable.graph.header_count("fallen_empire_max"), None);
    assert!(coded(&unreadable.validate(), IssueCode::HeaderEmpireCount).is_empty());

    let fallen_fit = ("fallen_empire_max = 6", "fallen_empire_max = 2");
    let max_high = PAINTED.open_edited(&[seats_fit, fallen_fit]);
    assert_eq!(
        only_message(&max_high.validate(), IssueCode::HeaderEmpireCount),
        "Header allows 3 marauder clans but the map has 0 clan homes. Update the empire counts."
    );

    let default_high = PAINTED.open_edited(&[seats_fit, fallen_fit, no_clans]);
    assert_eq!(
        only_message(&default_high.validate(), IssueCode::HeaderEmpireCount),
        "Header allows 1 marauder clans but the map has 0 clan homes. Update the empire counts."
    );
}

#[test]
fn a_greek_name_on_two_systems_is_named_as_the_trait_spells_it() {
    const ALPHA: &str = "spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RESERVED|alpha|RANDOM_MODULO|3|RANDOM_VALUE|0| }";
    let void = format!("id = \"10\" position = {{ x = 150 y = -30 }} name = \"Void\" {ALPHA} }}");
    let plain = format!("id = \"11\" position = {{ x = -150 y = -30 }} {ALPHA} }}");
    let session = PAINTED.open_edited(&[
        (
            "id = \"10\" position = { x = 150 y = -30 } name = \"Void\" }",
            void.as_str(),
        ),
        (
            "id = \"11\" position = { x = -150 y = -30 } }",
            plain.as_str(),
        ),
    ]);
    let issues = session.validate();
    let duplicate = coded(&issues, IssueCode::SeatLetterDuplicate);
    assert_eq!(duplicate.len(), 1, "{issues:?}");
    assert_eq!(
        duplicate[0].message,
        "Reserved Alpha is on 2 systems: only one empire holds the trait."
    );
}

#[test]
fn a_letter_or_sol_on_two_systems_names_them_all() {
    let session = PAINTED.open_edited(&[(
        "id = \"11\" position = { x = -150 y = -30 } }",
        "id = \"11\" position = { x = -150 y = -30 } spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RESERVED|a|RANDOM_MODULO|3|RANDOM_VALUE|0| } }",
    )]);
    let issues = session.validate();
    let duplicate = coded(&issues, IssueCode::SeatLetterDuplicate);
    assert_eq!(duplicate.len(), 1, "{issues:?}");
    assert_eq!(
        duplicate[0].message,
        "Reserved A is on 2 systems: only one empire holds the trait."
    );
    assert_eq!(duplicate[0].systems, [2, 11]);
    assert_eq!(seat_counts(&session.graph), seats(5, 4, true));

    let session = PAINTED.open_edited(&[(
        "id = \"10\" position = { x = 150 y = -30 } name = \"Void\" }",
        "id = \"10\" position = { x = 150 y = -30 } name = \"Void\" initializer = sol_system_initializer spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|SOL|yes|RANDOM_MODULO|1|RANDOM_VALUE|0| } }",
    )]);
    let issues = session.validate();
    let duplicate = coded(&issues, IssueCode::SeatLetterDuplicate);
    assert_eq!(duplicate.len(), 1, "{issues:?}");
    assert_eq!(
        duplicate[0].message,
        "Reserved Sol is on 2 systems: only one empire holds the trait."
    );
    assert_eq!(duplicate[0].systems, [3, 10]);
}

#[test]
fn a_sol_seat_on_the_sol_initializer_raises_no_issue() {
    let issues = PAINTED.open().validate();
    assert!(!issues.iter().any(|i| i.systems == [3]), "{issues:?}");
}

#[test]
fn the_players_seat_on_two_systems_names_them_both() {
    let session = PAINTED.open_edited(&[
        (
            "PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|1| }",
            "PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|1| modifier = { add = 100000 } }",
        ),
        (
            "RESERVED|a|RANDOM_MODULO|3|RANDOM_VALUE|2| }",
            "RESERVED|a|RANDOM_MODULO|3|RANDOM_VALUE|2| modifier = { add = 100000 has_trait = trait_painted_galaxy_reserved_spawn_a } }",
        ),
    ]);
    let issues = session.validate();
    let duplicate = coded(&issues, IssueCode::PlayerSeatDuplicate);
    assert_eq!(duplicate.len(), 1, "{issues:?}");
    assert_eq!(
        duplicate[0].message,
        "The player's seat is on 2 systems: the player starts on only one."
    );
    assert_eq!(duplicate[0].severity, Severity::Warning);
    assert_eq!(duplicate[0].systems, [1, 2]);
    assert_eq!(seat_counts(&session.graph), seats(4, 3, true));
}

/// Paint a Galaxy's own count: `spawns - preferred - reserved - (preferred > 0 ? 0 : 1)`,
/// with the player's marker on a reserved or Sol seat also setting the player aside.
#[test]
fn the_safe_seats_follow_paint_a_galaxys_count() {
    let kind = |kind, player| SpawnScript::PaintAGalaxy {
        kind,
        random_value: 0,
        player,
    };
    let first_player = || kind(PaintSpawnKind::Preferred, false);
    let letter = |name: &str| kind(PaintSpawnKind::Reserved(name.to_owned()), false);
    let sol = || kind(PaintSpawnKind::Sol, false);
    let enabled = || kind(PaintSpawnKind::Enabled, false);
    for (scripts, expected, safe) in [
        (vec![enabled(), enabled()], seats(10, 0, false), 9),
        (vec![first_player(), enabled()], seats(10, 1, true), 9),
        (
            vec![first_player(), letter("a"), letter("alpha"), sol()],
            seats(10, 4, true),
            6,
        ),
        (vec![first_player(), first_player()], seats(10, 2, true), 8),
        (vec![letter("a"), sol()], seats(10, 2, false), 7),
        (
            vec![letter("a"), kind(PaintSpawnKind::Sol, true)],
            seats(10, 2, true),
            8,
        ),
        (
            vec![kind(PaintSpawnKind::Preferred, true), letter("a")],
            seats(10, 2, true),
            8,
        ),
    ] {
        let label = format!("{scripts:?}");
        let counts = SeatCounts::from_scripts(10, &scripts);
        assert_eq!(counts, expected, "{label}");
        assert_eq!(counts.safe(), safe, "{label}");
    }
}

#[test]
fn the_players_seat_is_set_aside_once_whichever_kind_it_is() {
    let default_two = (
        "num_empires = { min = 0 max = 3 }
	num_empire_default = 3",
        "num_empires = { min = 0 max = 3 }
	num_empire_default = 2",
    );
    let sol = (
        "SOL|yes|RANDOM_MODULO|1|RANDOM_VALUE|0| }",
        "SOL|yes|RANDOM_MODULO|1|RANDOM_VALUE|0| modifier = { add = 100000 has_country_flag = human_1 } }",
    );
    let letter = (
        "RESERVED|a|RANDOM_MODULO|3|RANDOM_VALUE|2| }",
        "RESERVED|a|RANDOM_MODULO|3|RANDOM_VALUE|2| modifier = { add = 100000 has_trait = trait_painted_galaxy_reserved_spawn_a } }",
    );
    let first_player = (
        "PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|1| }",
        "PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|1| modifier = { add = 100000 has_country_flag = painted_galaxy_host } }",
    );
    let no_first_player = (
        "PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|1| }",
        "RANDOM_MODULO|10|RANDOM_VALUE|1| }",
    );
    let default_of = |session: &Session| match counts_op(session) {
        Op::SetHeaderKeys { entries } => entries[1].clone(),
        op => panic!("{op:?}"),
    };
    let header_issue =
        |session: &Session| only_message(&session.validate(), IssueCode::HeaderEmpireCount);
    let fallen_issue = "Header allows 6 fallen empires but the map has 2 fallen empire zones. Update the empire counts.";
    let one = ("num_empire_default".to_owned(), "1".to_owned());
    let two = ("num_empire_default".to_owned(), "2".to_owned());

    // The map's 1st Player seat is the host's, so it is among the three held seats
    // wherever the player's marker is, and one seat is open.
    for edits in [
        vec![default_two],
        vec![default_two, first_player],
        vec![default_two, sol],
        vec![default_two, letter],
    ] {
        let session = PAINTED.open_edited(&edits);
        assert_eq!(seat_counts(&session.graph), seats(4, 3, true), "{edits:?}");
        assert_eq!(default_of(&session), one, "{edits:?}");
        assert_eq!(
            header_issue(&session),
            "Header allows 2 empires but the file has 4 seats. Update the empire counts.",
            "{edits:?}"
        );
    }

    // Without a 1st Player seat, the player's seat on Sol is among the two reserved, so
    // the other two seats are open.
    let on_sol = PAINTED.open_edited(&[no_first_player, default_two, sol]);
    assert_eq!(seat_counts(&on_sol.graph), seats(4, 2, true));
    assert_eq!(default_of(&on_sol), two);
    assert_eq!(header_issue(&on_sol), fallen_issue);
    let on_letter = PAINTED.open_edited(&[no_first_player, default_two, letter]);
    assert_eq!(seat_counts(&on_letter.graph), seats(4, 2, true));
    assert_eq!(default_of(&on_letter), two);

    // No seat carries the player's marker: the player takes one of the two open seats.
    let unmarked = PAINTED.open_edited(&[no_first_player, default_two]);
    assert_eq!(seat_counts(&unmarked.graph), seats(4, 2, false));
    assert_eq!(default_of(&unmarked), one);
    assert_eq!(
        header_issue(&unmarked),
        "Header allows 2 empires but the file has 4 seats. Update the empire counts."
    );
}
