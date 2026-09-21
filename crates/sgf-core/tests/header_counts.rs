//! The empire counts a Paint a Galaxy header carries and the issues a painted scenario
//! raises about its seats: the header against the seats, the fallen empire zones and
//! the marauder clan homes, a reserved letter or Sol on two systems, a Sol seat off the
//! Sol initializer, and a system inside the L-Cluster's circle on any scenario.

use sgf_core::document::Document;
use sgf_core::format::scenario::header_counts::{empire_counts, seat_counts, zone_count};
use sgf_core::format::scenario::listings::sibling_names;
use sgf_core::format::scenario::marauder::clan_count;
use sgf_core::guides::{Guide, L_CLUSTER};
use sgf_core::ops::{Op, OpError};
use sgf_core::session::Session;
use sgf_core::validate::{Issue, IssueCode, Severity};

mod common;
use common::diff::{plain_snapshot, round_trip};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/paint_a_galaxy.txt"
);

fn open() -> Session {
    Session::open(FIXTURE).expect("open the painted fixture")
}

/// The fixture with `from` replaced by `to` once.
fn open_edited(from: &str, to: &str) -> Session {
    open_edited_all(&[(from, to)])
}

/// The fixture with each `from` replaced by its `to` once, in order.
fn open_edited_all(edits: &[(&str, &str)]) -> Session {
    let mut text = std::fs::read_to_string(FIXTURE).expect("read the fixture");
    for (from, to) in edits {
        assert!(text.contains(from), "{from}");
        text = text.replacen(from, to, 1);
    }
    let doc = Document::from_scenario_bytes(text.into_bytes()).expect("index");
    Session::from_document(None, doc).expect("open")
}

fn coded(issues: &[Issue], code: IssueCode) -> Vec<&Issue> {
    issues.iter().filter(|issue| issue.code == code).collect()
}

fn counts_op(session: &Session) -> Op {
    let (seats, reserved) = seat_counts(&session.graph);
    let zones = zone_count(&session.graph);
    let clans = clan_count(&session.graph);
    Op::SetHeaderKeys {
        entries: empire_counts(seats, reserved, zones, clans)
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value))
            .collect(),
    }
}

#[test]
fn the_fixture_has_four_seats_two_reserved_and_a_header_that_allows_too_many() {
    let session = open();
    assert_eq!(seat_counts(&session.graph), (4, 2));
    assert_eq!(zone_count(&session.graph), 2);
    assert_eq!(clan_count(&session.graph), 0);
    assert_eq!(session.graph.num_empires_max, Some(3));
    assert_eq!(session.graph.num_empire_default, Some(3));
    assert_eq!(session.graph.fallen_empire_max, Some(6));
    assert_eq!(session.graph.fallen_empire_default, Some(0));
    assert_eq!(session.graph.marauder_empire_max, Some(3));
    assert_eq!(session.graph.marauder_empire_default, Some(1));
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
    assert!(coded(&issues, IssueCode::SolSeatMismatch).is_empty());
    assert!(coded(&issues, IssueCode::LClusterSystem).is_empty());

    let save = common::open();
    assert_eq!(save.graph.num_empires_max, None);
    assert_eq!(save.graph.fallen_empire_max, None);
    assert_eq!(save.graph.marauder_empire_max, None);
    let plain = common::scenario::open();
    for session in [&save, &plain] {
        let issues = session.validate();
        assert!(coded(&issues, IssueCode::HeaderEmpireCount).is_empty());
        assert!(coded(&issues, IssueCode::SeatLetterDuplicate).is_empty());
        assert!(coded(&issues, IssueCode::SolSeatMismatch).is_empty());
    }
}

#[test]
fn updating_the_counts_rewrites_the_nine_keys_as_one_step_and_clears_the_issue() {
    let session = open();
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
    plain_snapshot("update_empire_counts", open(), op.clone());
    round_trip(open(), op.clone());

    let mut session = open();
    let result = session.apply(op).expect("update");
    assert_eq!(result.entry.description, "Update empire counts");
    assert_eq!(
        result.entry.inverse,
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
    assert_eq!(session.graph.num_empire_default, Some(1));
    assert_eq!(session.graph.fallen_empire_max, Some(2));
    assert_eq!(session.graph.fallen_empire_default, Some(2));
    assert_eq!(session.graph.marauder_empire_max, Some(0));
    assert_eq!(session.graph.marauder_empire_default, Some(0));
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
    plain_snapshot("set_two_header_keys", open(), op.clone());
    round_trip(open(), op.clone());
    let mut session = open();
    let result = session.apply(op).expect("set two keys");
    assert_eq!(result.entry.description, "Set 2 header keys");
    assert_eq!(
        result.entry.inverse,
        Op::SetHeaderKeys {
            entries: vec![("num_empire_default".to_owned(), "3".to_owned())]
        },
        "a key this added has nothing to put back"
    );
    assert_eq!(session.graph.core_radius, 40.0);

    let mut session = open();
    for (entries, name) in [
        (vec![], "Empty"),
        (
            vec![
                ("core_radius".to_owned(), "1".to_owned()),
                ("core_radius".to_owned(), "2".to_owned()),
            ],
            "HeaderParse",
        ),
        (vec![("system".to_owned(), "5".to_owned())], "HeaderParse"),
    ] {
        let error = session
            .apply(Op::SetHeaderKeys { entries })
            .expect_err(name);
        assert!(
            matches!(error, OpError::Empty | OpError::HeaderParse { .. }),
            "{name}: {error}"
        );
    }
    assert!(!session.is_dirty());
}

#[test]
fn a_wrong_maximum_is_reported_even_when_the_default_fits() {
    let session = open_edited(
        "num_empires = { min = 0 max = 3 }\n\tnum_empire_default = 3",
        "num_empires = { min = 0 max = 5 }\n\tnum_empire_default = 1",
    );
    assert_eq!(session.graph.num_empires_max, Some(5));
    let issues = session.validate();
    let header = coded(&issues, IssueCode::HeaderEmpireCount);
    assert_eq!(header.len(), 1, "{issues:?}");
    assert_eq!(
        header[0].message,
        "Header allows 5 empires but the file has 4 seats. Update the empire counts."
    );

    let fixed = open_edited("num_empire_default = 3", "num_empire_default = 1");
    let issues = fixed.validate();
    let header = coded(&issues, IssueCode::HeaderEmpireCount);
    assert_eq!(header.len(), 1, "{issues:?}");
    assert_eq!(
        header[0].message,
        "Header allows 6 fallen empires but the map has 2 fallen empire zones. Update the empire counts."
    );
}

#[test]
fn the_fallen_counts_are_checked_against_the_zones_once_the_seats_fit() {
    let seats_fit = ("num_empire_default = 3", "num_empire_default = 1");
    let no_clans = ("marauder_empire_max = 3", "marauder_empire_max = 0");
    let no_clan_default = ("marauder_empire_default = 1", "marauder_empire_default = 0");
    let fits = open_edited_all(&[
        seats_fit,
        ("fallen_empire_max = 6", "fallen_empire_max = 2"),
        no_clans,
        no_clan_default,
    ]);
    assert_eq!(fits.graph.fallen_empire_max, Some(2));
    assert!(coded(&fits.validate(), IssueCode::HeaderEmpireCount).is_empty());

    let default_high = open_edited_all(&[
        seats_fit,
        ("fallen_empire_max = 6", "fallen_empire_max = 2"),
        ("fallen_empire_default = 0", "fallen_empire_default = 3"),
    ]);
    assert_eq!(default_high.graph.fallen_empire_default, Some(3));
    let issues = default_high.validate();
    let header = coded(&issues, IssueCode::HeaderEmpireCount);
    assert_eq!(header.len(), 1, "{issues:?}");
    assert_eq!(
        header[0].message,
        "Header allows 3 fallen empires but the map has 2 fallen empire zones. Update the empire counts."
    );

    let max_low = open_edited_all(&[
        seats_fit,
        ("fallen_empire_max = 6", "fallen_empire_max = 1"),
    ]);
    let issues = max_low.validate();
    let header = coded(&issues, IssueCode::HeaderEmpireCount);
    assert_eq!(header.len(), 1, "{issues:?}");
    assert_eq!(
        header[0].message,
        "Header allows 1 fallen empires but the map has 2 fallen empire zones. Update the empire counts."
    );

    let unreadable = open_edited_all(&[
        seats_fit,
        ("fallen_empire_max = 6", "fallen_empire_max = @al"),
        no_clans,
        no_clan_default,
    ]);
    assert_eq!(unreadable.graph.fallen_empire_max, None);
    assert!(coded(&unreadable.validate(), IssueCode::HeaderEmpireCount).is_empty());

    let fallen_fit = ("fallen_empire_max = 6", "fallen_empire_max = 2");
    let max_high = open_edited_all(&[seats_fit, fallen_fit]);
    let issues = max_high.validate();
    let header = coded(&issues, IssueCode::HeaderEmpireCount);
    assert_eq!(header.len(), 1, "{issues:?}");
    assert_eq!(
        header[0].message,
        "Header allows 3 marauder clans but the map has 0 clan homes. Update the empire counts."
    );

    let default_high = open_edited_all(&[seats_fit, fallen_fit, no_clans]);
    let issues = default_high.validate();
    let header = coded(&issues, IssueCode::HeaderEmpireCount);
    assert_eq!(header.len(), 1, "{issues:?}");
    assert_eq!(
        header[0].message,
        "Header allows 1 marauder clans but the map has 0 clan homes. Update the empire counts."
    );
}

#[test]
fn a_letter_or_sol_on_two_systems_names_them_all() {
    let session = open_edited(
        "id = \"11\" position = { x = -150 y = -30 } }",
        "id = \"11\" position = { x = -150 y = -30 } spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RESERVED|a|RANDOM_MODULO|3|RANDOM_VALUE|0| } }",
    );
    let issues = session.validate();
    let duplicate = coded(&issues, IssueCode::SeatLetterDuplicate);
    assert_eq!(duplicate.len(), 1, "{issues:?}");
    assert_eq!(
        duplicate[0].message,
        "Reserved A is on 2 systems: only one empire holds the trait."
    );
    assert_eq!(duplicate[0].systems, [2, 11]);
    assert_eq!(seat_counts(&session.graph), (5, 3));

    let session = open_edited(
        "id = \"10\" position = { x = 150 y = -30 } name = \"Void\" }",
        "id = \"10\" position = { x = 150 y = -30 } name = \"Void\" initializer = sol_system_initializer spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|SOL|yes|RANDOM_MODULO|1|RANDOM_VALUE|0| } }",
    );
    let issues = session.validate();
    let duplicate = coded(&issues, IssueCode::SeatLetterDuplicate);
    assert_eq!(duplicate.len(), 1, "{issues:?}");
    assert_eq!(
        duplicate[0].message,
        "Reserved SOL is on 2 systems: only one empire holds the trait."
    );
    assert_eq!(duplicate[0].systems, [3, 10]);
    assert!(coded(&issues, IssueCode::SolSeatMismatch).is_empty());
}

#[test]
fn a_sol_seat_and_the_sol_initializer_go_together() {
    let session = open_edited(
        "name = \"Sol\" initializer = sol_system_initializer",
        "name = \"Sol\" initializer = random_empire_init_04",
    );
    let issues = session.validate();
    let mismatch = coded(&issues, IssueCode::SolSeatMismatch);
    assert_eq!(mismatch.len(), 1, "{issues:?}");
    assert_eq!(
        mismatch[0].message,
        "Sol has a Sol seat but not the Sol initializer."
    );
    assert_eq!(mismatch[0].severity, Severity::Info);
    assert_eq!(mismatch[0].systems, [3]);

    let session = open_edited(
        "name = \"Beta\" initializer = random_empire_init_02",
        "name = \"Beta\" initializer = sol_system_initializer",
    );
    let issues = session.validate();
    let mismatch = coded(&issues, IssueCode::SolSeatMismatch);
    assert_eq!(mismatch.len(), 1, "{issues:?}");
    assert_eq!(
        mismatch[0].message,
        "Beta has the Sol initializer but its seat is not Sol."
    );
    assert_eq!(mismatch[0].systems, [1]);

    let unseated = open_edited(
        "name = \"Void\" }",
        "name = \"Void\" initializer = sol_system_initializer }",
    );
    assert!(coded(&unseated.validate(), IssueCode::SolSeatMismatch).is_empty());
}

#[test]
fn a_system_moved_into_the_l_cluster_is_reported_on_any_scenario() {
    assert_eq!(L_CLUSTER, (-392.4, -392.4, 90.0));
    let guide = Guide::l_cluster();
    assert!(guide.contains(-392.0, -392.0));
    assert!(guide.contains(-330.0, -330.0));
    assert!(!guide.contains(-300.0, -300.0));

    let mut session = open();
    let result = session
        .apply(Op::MoveSystem {
            id: 10,
            x: -392.0,
            y: -392.0,
        })
        .expect("move Void into the circle");
    let l_cluster = coded(&result.issues, IssueCode::LClusterSystem);
    assert_eq!(l_cluster.len(), 1, "{:?}", result.issues);
    assert_eq!(
        l_cluster[0].message,
        "Void sits where the game places the L-Cluster."
    );
    assert_eq!(l_cluster[0].systems, [10]);
    session.undo().expect("undo").expect("an op to undo");
    assert!(coded(&session.validate(), IssueCode::LClusterSystem).is_empty());

    let mut plain = common::scenario::open();
    let id = plain.graph.order[0];
    let result = plain
        .apply(Op::MoveSystem {
            id,
            x: -400.0,
            y: -380.0,
        })
        .expect("move a plain scenario's system there");
    assert_eq!(
        coded(&result.issues, IssueCode::LClusterSystem).len(),
        1,
        "{:?}",
        result.issues
    );

    let mut save = common::open();
    let id = save.graph.order[0];
    let result = save
        .apply(Op::MoveSystem {
            id,
            x: -392.0,
            y: -392.0,
        })
        .expect("move a save's system there");
    assert!(
        coded(&result.issues, IssueCode::LClusterSystem).is_empty(),
        "a save is the galaxy the game already built"
    );
}

#[test]
fn the_other_scenarios_beside_a_file_are_listed_by_name() {
    let dir = tempfile::tempdir().unwrap();
    let mine = dir.path().join("mine.txt");
    std::fs::copy(FIXTURE, &mine).unwrap();
    std::fs::copy(common::scenario::FIXTURE, dir.path().join("grammar.txt")).unwrap();
    std::fs::write(
        dir.path().join("other.txt"),
        "static_galaxy_scenario = {\n\tname = \"Other Reach\"\n}\n",
    )
    .unwrap();
    std::fs::write(dir.path().join("notes.txt"), "not a scenario").unwrap();
    std::fs::write(dir.path().join("mine.bak"), "static_galaxy_scenario = { }").unwrap();
    assert_eq!(
        sibling_names(&mine),
        [
            ("grammar.txt".to_owned(), "sgf_grammar".to_owned()),
            ("other.txt".to_owned(), "Other Reach".to_owned()),
        ]
    );
    assert_eq!(
        sibling_names(&dir.path().join("other.txt")),
        [
            ("grammar.txt".to_owned(), "sgf_grammar".to_owned()),
            ("mine.txt".to_owned(), "Painted Reach".to_owned()),
        ]
    );
}
