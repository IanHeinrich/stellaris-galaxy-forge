//! Paint a Galaxy's wormhole pairs on the painted fixture: what the flags read as, the
//! links the map draws from them, what the pair op writes and takes away, and the
//! refusals that keep a number on two systems.

use sgf_core::format::scenario::paint;
use sgf_core::ops::{Op, OpError};
use sgf_core::projections::galaxy::BypassLink;
use sgf_core::session::Session;

mod common;
use common::diff::{plain_report, round_trip};

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

fn set_pair(a: u32, b: u32, pair: Option<u32>) -> Op {
    Op::SetWormholePair { a, b, pair }
}

#[test]
fn each_pair_reads_from_its_flags_and_projects_as_one_link() {
    let session = open();
    let systems = &session.graph.systems;
    for (id, pair) in [(7, Some(1)), (8, Some(1)), (12, Some(2)), (13, Some(2))] {
        assert_eq!(systems[&id].wormhole_pair, pair, "system {id}");
    }
    for id in (0..=6).chain(9..=11) {
        assert_eq!(systems[&id].wormhole_pair, None, "system {id}");
    }
    assert_eq!(
        session.graph.bypasses,
        [
            BypassLink::Wormhole { a: 7, b: 8 },
            BypassLink::Wormhole { a: 12, b: 13 },
        ]
    );
    assert_eq!(paint::next_wormhole_pair(&session.graph), 3);
    assert_eq!(
        paint::wormhole_pair_of("painted_galaxy_wormhole_12"),
        Some(12)
    );
    assert_eq!(paint::wormhole_pair_of("painted_galaxy_wormhole_x"), None);
    assert_eq!(paint::wormhole_pair_of("empire_cluster"), None);

    let save = common::open();
    assert!(
        save.graph
            .systems
            .values()
            .all(|s| s.wormhole_pair.is_none())
    );
    assert_eq!(paint::next_wormhole_pair(&save.graph), 1);
    let error = common::open()
        .apply(set_pair(0, 1, Some(1)))
        .expect_err("a save has no pairs");
    assert!(matches!(error, OpError::Unsupported { .. }), "{error}");
}

#[test]
fn a_pair_is_written_on_both_ends_and_taken_off_both() {
    struct Case {
        name: &'static str,
        a: u32,
        b: u32,
        pair: Option<u32>,
        written: &'static [&'static str],
    }
    let case = |name, a, b, pair, written| Case {
        name,
        a,
        b,
        pair,
        written,
    };
    let cases = [
        case(
            "pair_10_11_new",
            10,
            11,
            Some(3),
            &[
                "name = \"Void\" effect = { set_star_flag = painted_galaxy_wormhole_3 set_star_flag = empire_cluster } }",
                "id = \"11\" position = { x = -150 y = -30 } effect = { set_star_flag = painted_galaxy_wormhole_3 set_star_flag = empire_cluster } }",
            ],
        ),
        case(
            "pair_7_13_rejoin",
            7,
            13,
            Some(3),
            &[
                "name = \"Ingress\" effect = { set_star_flag = painted_galaxy_wormhole_3 set_star_flag = empire_cluster } }",
                "name = \"Low Seat\" effect = { set_star_flag = painted_galaxy_wormhole_3 set_star_flag = empire_cluster } }",
            ],
        ),
        case(
            "pair_12_13_remove",
            12,
            13,
            None,
            &[
                "effect = { set_star_flag = painted_galaxy_automatic_initializer set_star_flag = painted_galaxy_fe_spawn set_star_flag = painted_galaxy_fe_spawn_se",
                "name = \"Low Seat\" }",
            ],
        ),
        case(
            "pair_9_12_beside_zone",
            9,
            12,
            Some(5),
            &[
                "set_star_flag = painted_galaxy_fe_spawn_preferred set_star_flag = painted_galaxy_wormhole_5 set_star_flag = empire_cluster } }",
                "set_star_flag = painted_galaxy_fe_spawn_fallback set_star_flag = painted_galaxy_wormhole_5 set_star_flag = empire_cluster } }",
            ],
        ),
    ];
    for Case {
        name,
        a,
        b,
        pair,
        written,
    } in cases
    {
        let mut session = open();
        let result = session.apply(set_pair(a, b, pair)).expect(name);
        assert_eq!(session.graph.systems[&a].wormhole_pair, pair, "{name}");
        assert_eq!(session.graph.systems[&b].wormhole_pair, pair, "{name}");
        for fragment in written {
            assert!(
                text(&session).contains(fragment),
                "{name}: {}",
                text(&session)
            );
        }
        common::snapshot(name, &plain_report(&session, &result));
        session.undo().expect("undo").expect("an op to undo");
        assert_eq!(common::current(&session), bytes(), "{name}");
        round_trip(open(), set_pair(a, b, pair));
    }
}

#[test]
fn rejoining_one_end_inverts_end_by_end_and_the_links_follow() {
    let mut session = open();
    let result = session
        .apply(set_pair(7, 13, Some(3)))
        .expect("Ingress leaves Egress for Low Seat");
    assert_eq!(
        result.entry.inverse,
        Op::SetWormholeEnds {
            entries: vec![(7, Some(1)), (13, Some(2))]
        }
    );
    assert_eq!(
        result.entry.description,
        "Join Ingress and Low Seat as wormhole pair 3"
    );
    assert_eq!(
        session.graph.bypasses,
        [BypassLink::Wormhole { a: 7, b: 13 }],
        "8 and 12 are left holding numbers with no partner"
    );
    assert_eq!(session.graph.systems[&8].wormhole_pair, Some(1));
    assert_eq!(session.graph.systems[&12].wormhole_pair, Some(2));
    assert_eq!(paint::next_wormhole_pair(&session.graph), 4);

    let result = session
        .apply(set_pair(7, 8, None))
        .expect("take the pair off");
    assert_eq!(
        result.entry.inverse,
        Op::SetWormholeEnds {
            entries: vec![(7, Some(3)), (8, Some(1))]
        }
    );
    assert_eq!(
        result.entry.description,
        "Remove the wormhole pair from Ingress and Egress"
    );
    assert!(session.graph.bypasses.is_empty());
    assert_eq!(session.graph.systems[&13].wormhole_pair, Some(3));
    session.undo().expect("undo").expect("an op to undo");
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(common::current(&session), bytes());
    round_trip(
        open(),
        Op::SetWormholeEnds {
            entries: vec![(7, None), (13, Some(1))],
        },
    );
}

#[test]
fn an_empire_cluster_of_its_own_stays_when_the_pair_goes() {
    let multi_line = "static_galaxy_scenario = {
	name = \"lines\"
	system = {
		id = \"7\"
		position = { x = 1 y = 2 }
		effect = {
			set_star_flag = empire_cluster
			set_star_flag = painted_galaxy_wormhole_4
			set_star_flag = empire_cluster
			set_star_flag = painted_galaxy_fe_custom_connections
		}
	}
	system = {
		id = \"8\"
		position = { x = 3 y = 4 }
		effect = { set_star_flag = painted_galaxy_wormhole_4 }
	}
}
";
    let doc = sgf_core::document::Document::from_scenario_bytes(multi_line.as_bytes().to_vec())
        .expect("index");
    let mut session = Session::from_document(None, doc).expect("open");
    assert_eq!(
        session.graph.bypasses,
        [BypassLink::Wormhole { a: 7, b: 8 }]
    );
    session.apply(set_pair(7, 8, None)).expect("remove");
    assert_eq!(
        text(&session),
        "static_galaxy_scenario = {
	name = \"lines\"
	system = {
		id = \"7\"
		position = { x = 1 y = 2 }
		effect = {
			set_star_flag = empire_cluster
			set_star_flag = painted_galaxy_fe_custom_connections
		}
	}
	system = {
		id = \"8\"
		position = { x = 3 y = 4 }
	}
}
"
    );
    session.apply(set_pair(8, 7, Some(2))).expect("join again");
    assert!(text(&session).contains(
        "			set_star_flag = painted_galaxy_fe_custom_connections
			set_star_flag = painted_galaxy_wormhole_2
			set_star_flag = empire_cluster
		}"
    ));
    assert!(text(&session).contains(
        "		position = { x = 3 y = 4 }
		effect = { set_star_flag = painted_galaxy_wormhole_2 set_star_flag = empire_cluster }
	}"
    ));
    session.undo().expect("undo").expect("an op to undo");
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(text(&session), multi_line);
}

#[test]
fn a_pair_needs_two_systems_that_exist_and_a_number_nobody_else_holds() {
    let mut session = open();
    for (op, name) in [
        (set_pair(7, 7, Some(3)), "WormholeSelf"),
        (set_pair(7, 99, Some(3)), "UnknownSystem"),
        (set_pair(10, 11, Some(2)), "WormholePairInUse"),
        (
            Op::SetWormholeEnds {
                entries: Vec::new(),
            },
            "Empty",
        ),
    ] {
        let error = session.apply(op).expect_err(name);
        assert!(
            matches!(
                error,
                OpError::WormholeSelf(7)
                    | OpError::UnknownSystem(99)
                    | OpError::WormholePairInUse(2)
                    | OpError::Empty
            ),
            "{name}: {error}"
        );
    }
    assert_eq!(
        session
            .apply(set_pair(10, 11, Some(2)))
            .expect_err("in use")
            .to_string(),
        "wormhole pair 2 is already in use"
    );
    assert!(!session.is_dirty());
    session
        .apply(set_pair(12, 13, Some(2)))
        .expect("the holders may keep their own number");
    assert_eq!(session.graph.systems[&12].wormhole_pair, Some(2));
    assert_eq!(
        session.graph.bypasses,
        [
            BypassLink::Wormhole { a: 7, b: 8 },
            BypassLink::Wormhole { a: 12, b: 13 },
        ]
    );
}
