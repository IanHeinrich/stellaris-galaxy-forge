//! A scenario edit re-reads only the statements it wrote. After every apply, undo and redo
//! the projection and the index must agree with a fresh open of the current bytes, and the
//! same follow-up edit must write the same bytes on both.

use sgf_core::ops::{InitializerSet, LanePair, Op, SystemMove};
use sgf_core::projections::galaxy::{PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;

mod common;
use common::brush::new_system;
use common::current;
use common::diff::{assert_fresh, round_trip, round_trip_step as step};
use common::fixture::{EXPORTED, GRAMMAR, PAINTED, from_scenario_text};

/// System 1 twice, the second statement winning, and two statements sharing a line.
const DUPLICATES: &str = "static_galaxy_scenario = {
\tname = \"dup\"
\tsystem = { id = \"1\" position = { x = 0 y = 0 } } system = { id = \"2\" position = { x = 10 y = 0 } }
\tsystem = { id = \"3\" position = { x = 20 y = 0 } }
\tsystem = { id = \"1\" position = { x = 5 y = 5 } }
\tadd_hyperlane = { from = \"1\" to = \"2\" } add_hyperlane = { from = \"2\" to = \"3\" }
\tnebula = { name = \"N\" position = { x = 0 y = 0 } radius = 8 }
}
";

fn set_header(key: &str, value: Option<&str>) -> Op {
    Op::SetHeaderField {
        key: key.to_owned(),
        value: value.map(str::to_owned),
    }
}

fn unlinked_pair(session: &Session) -> (u32, u32) {
    let ids = &session.graph.order;
    ids.iter()
        .flat_map(|&a| ids.iter().map(move |&b| (a, b)))
        .find(|&(a, b)| {
            a != b && session.graph.lane(a, b).is_none() && session.graph.lane(b, a).is_none()
        })
        .expect("two systems without a lane")
}

/// Edits any scenario takes.
fn edits(session: &mut Session) {
    assert_fresh(session, "open");
    let ids: Vec<u32> = session.graph.order.clone();
    let (a, b, c) = (ids[0], ids[1], ids[2]);
    let next = session.graph.systems.keys().max().unwrap() + 1;
    let nebula = session.graph.nebulae[0].clone();

    step(
        session,
        "paint",
        Op::Batch {
            description: "Painted".to_owned(),
            ops: vec![
                Op::AddSystems {
                    systems: vec![
                        new_system(next, nebula.x, nebula.y),
                        new_system(next + 1, nebula.x + 5.0, nebula.y),
                        new_system(next + 2, 900.0, 900.0),
                    ],
                },
                Op::AddLanePairs {
                    lanes: vec![
                        LanePair {
                            a: next,
                            b: next + 1,
                            bridge: false,
                        },
                        LanePair {
                            a: next + 1,
                            b: a,
                            bridge: false,
                        },
                    ],
                },
            ],
        },
    );

    let before = current(session);
    let (x, y) = unlinked_pair(session);
    let failed = session.apply(Op::Batch {
        description: "Fails at the last member".to_owned(),
        ops: vec![
            Op::MoveSystem {
                id: a,
                x: 7.0,
                y: 7.0,
            },
            Op::AddLane {
                a: x,
                b: y,
                bridge: false,
            },
            Op::AddLane {
                a: x,
                b: 4_000_000,
                bridge: false,
            },
        ],
    });
    assert!(failed.is_err(), "a lane to an unknown system is refused");
    assert_eq!(current(session), before, "a refused batch leaves the bytes");
    assert_fresh(session, "refused batch");

    step(
        session,
        "move",
        Op::MoveSystems {
            moves: vec![
                SystemMove {
                    id: a,
                    x: nebula.x + 1.0,
                    y: nebula.y + 1.0,
                },
                SystemMove {
                    id: next + 2,
                    x: -1000.0,
                    y: 3.0,
                },
            ],
        },
    );

    let before = current(session);
    session
        .apply(Op::MoveSystem {
            id: b,
            x: 3.0,
            y: 4.0,
        })
        .expect("move");
    session
        .apply(Op::SetSystemName {
            id: b,
            name: "Twice".to_owned(),
        })
        .expect("rename");
    assert_fresh(session, "move then rename");
    session.undo().expect("undo").expect("the rename");
    assert_fresh(session, "rename undone");
    session.undo().expect("undo").expect("the move");
    assert_eq!(current(session), before, "undo past both");
    assert_fresh(session, "move undone");

    step(session, "isolate", Op::IsolateSystem { id: next + 1 });
    step(session, "prevent", Op::PreventLane { a: b, b: next });
    step(session, "unprevent", Op::UnpreventLane { a: b, b: next });
    step(
        session,
        "rename",
        Op::SetSystemName {
            id: b,
            name: "Renamed".to_owned(),
        },
    );
    step(
        session,
        "initializer",
        Op::SetInitializer {
            id: b,
            initializer: Some("random_empire_init_04".to_owned()),
        },
    );
    step(
        session,
        "initializers",
        Op::SetInitializers {
            entries: vec![
                InitializerSet {
                    id: b,
                    initializer: None,
                },
                InitializerSet {
                    id: c,
                    initializer: Some("misc_system_init_03".to_owned()),
                },
            ],
        },
    );
    step(
        session,
        "spawn weight",
        Op::SetSpawnWeight {
            id: next,
            base: Some(5.0),
        },
    );
    step(
        session,
        "spawn weights",
        Op::SetSpawnWeights {
            entries: vec![(next, None), (next + 2, Some(2.0))],
        },
    );
    step(
        session,
        "spawn script",
        Op::SetSpawnScript {
            id: next,
            script: Some(SpawnScript::PaintAGalaxy {
                kind: PaintSpawnKind::Enabled,
                random_value: 1,
                player: false,
            }),
        },
    );
    step(
        session,
        "spawn scripts",
        Op::SetSpawnScripts {
            entries: vec![(next, None)],
        },
    );
    step(
        session,
        "header",
        set_header("name", Some("\"Incremental\"")),
    );
    step(
        session,
        "new header key",
        set_header("sgf_new_key", Some("{ min = 1 max = 2 }")),
    );
    step(
        session,
        "header key removed",
        set_header("sgf_new_key", None),
    );
    step(
        session,
        "header list",
        Op::SetHeaderList {
            key: "supports_shape".to_owned(),
            values: vec!["elliptical".to_owned(), "spiral_2".to_owned()],
        },
    );
    step(
        session,
        "move nebula",
        Op::MoveNebula {
            index: 0,
            x: nebula.x + 20.0,
            y: nebula.y,
        },
    );
    step(
        session,
        "add nebula",
        Op::AddNebula {
            x: -1000.0,
            y: 3.0,
            radius: 30.0,
            name: None,
        },
    );
    step(session, "remove nebula", Op::RemoveNebula { index: 0 });
    step(
        session,
        "remove",
        Op::Batch {
            description: "Erased".to_owned(),
            ops: vec![Op::RemoveSystems {
                ids: vec![c, next, next + 2],
            }],
        },
    );
    step(
        session,
        "re-add a removed id",
        Op::AddSystem {
            id: Some(c),
            x: 1.0,
            y: 2.0,
            name: None,
            initializer: None,
            spawn_weight: None,
            spawn_script: None,
        },
    );
    step(
        session,
        "remove and re-add one id in a batch",
        Op::Batch {
            description: "Replaced".to_owned(),
            ops: vec![
                Op::RemoveSystems { ids: vec![b] },
                Op::AddSystems {
                    systems: vec![new_system(b, 3.0, 4.0)],
                },
            ],
        },
    );
}

#[test]
fn grammar_fixture_edits_match_a_fresh_open() {
    let mut session = GRAMMAR.open();
    edits(&mut session);

    let mut session = GRAMMAR.open();
    step(
        &mut session,
        "duplicated 1-2 and 2-1",
        Op::RemoveLane { a: 1, b: 2 },
    );
    step(
        &mut session,
        "duplicated 1-16",
        Op::RemoveLanePairs {
            lanes: vec![(1, 16)],
        },
    );
    step(
        &mut session,
        "first entity removed",
        Op::RemoveSystem { id: 1 },
    );
    step(
        &mut session,
        "header key after it",
        set_header("sgf_after_first", Some("1")),
    );
}

#[test]
fn sample_scenario_edits_match_a_fresh_open() {
    edits(&mut EXPORTED.open());
}

#[test]
fn painted_fixture_edits_match_a_fresh_open() {
    let mut session = PAINTED.open();
    edits(&mut session);

    let mut session = PAINTED.open();
    let zone = session.graph.systems[&9].fe_zone.clone();
    assert!(zone.is_some(), "system 9 anchors a zone");
    step(
        &mut session,
        "fe links",
        Op::SetFeLinks {
            anchor: 9,
            linked: vec![10],
        },
    );
    step(
        &mut session,
        "fe zone cleared",
        Op::SetFeZone { id: 9, zone: None },
    );
    step(
        &mut session,
        "fe zones",
        Op::SetFeZones {
            entries: vec![(9, zone)],
        },
    );
    step(
        &mut session,
        "wormhole pair",
        Op::SetWormholePair {
            a: 10,
            b: 11,
            pair: Some(3),
        },
    );
    step(
        &mut session,
        "wormhole ends",
        Op::SetWormholeEnds {
            entries: vec![(7, None)],
        },
    );
}

#[test]
fn duplicate_ids_and_shared_lines_match_a_fresh_open() {
    let mut session = from_scenario_text(DUPLICATES);
    assert_fresh(&session, "open");
    step(
        &mut session,
        "move a shared line's second",
        Op::MoveSystem {
            id: 2,
            x: 11.0,
            y: 1.0,
        },
    );
    step(
        &mut session,
        "rename the repeated id",
        Op::SetSystemName {
            id: 1,
            name: "One".to_owned(),
        },
    );
    step(
        &mut session,
        "lane on a shared line",
        Op::RemoveLane { a: 2, b: 3 },
    );
    step(
        &mut session,
        "remove the repeated id's winner",
        Op::RemoveSystem { id: 1 },
    );
    step(
        &mut session,
        "remove a shared line's first",
        Op::RemoveSystem { id: 3 },
    );
}

#[test]
fn removing_a_rewritten_statement_takes_its_line() {
    let rename = Op::SetSystemName {
        id: 9,
        name: "Renamed".to_owned(),
    };
    let mut edited = GRAMMAR.open();
    edited
        .apply(rename.clone())
        .expect("rewrite system 9's statement");
    let mut fresh = from_scenario_text(current(&edited));

    edited
        .apply(Op::RemoveSystem { id: 9 })
        .expect("remove the rewritten statement");
    fresh
        .apply(Op::RemoveSystem { id: 9 })
        .expect("remove the statement as a fresh open reads it");
    assert_eq!(
        String::from_utf8_lossy(&current(&edited)),
        String::from_utf8_lossy(&current(&fresh))
    );

    round_trip(
        GRAMMAR.open(),
        Op::Batch {
            description: "Rename and remove".to_owned(),
            ops: vec![rename, Op::RemoveSystem { id: 9 }],
        },
    );
}

#[test]
fn removing_a_rewritten_statement_inverts_to_the_rewritten_text() {
    let statement = |session: &Session| -> String {
        let anchor = session
            .doc
            .scenario()
            .expect("a scenario")
            .system(9)
            .expect("system 9");
        let bytes = session.doc.current(anchor).expect("its bytes");
        String::from_utf8_lossy(bytes).trim().to_owned()
    };
    let lanes = |session: &Session| {
        let mut lanes = session.graph.systems[&9].lanes.clone();
        lanes.sort_by_key(|lane| lane.to);
        lanes
    };

    let mut session = GRAMMAR.open();
    step(
        &mut session,
        "rename",
        Op::SetSystemName {
            id: 9,
            name: "Renamed".to_owned(),
        },
    );
    let renamed = statement(&session);
    let linked = lanes(&session);

    let removed = step(&mut session, "remove", Op::RemoveSystem { id: 9 });
    assert!(!session.graph.systems.contains_key(&9), "9 is gone");

    step(&mut session, "inverse", removed.inverse);
    assert_eq!(statement(&session), renamed);
    assert_eq!(lanes(&session), linked);
}

#[test]
fn removing_the_first_system_beside_an_inserted_header_key() {
    for rewrite in [false, true] {
        let mut session = GRAMMAR.open();
        let first = session.graph.order[0];
        step(
            &mut session,
            "a header key the file lacks",
            set_header("sgf_added", Some("1")),
        );
        if rewrite {
            step(
                &mut session,
                "rename the first system",
                Op::SetSystemName {
                    id: first,
                    name: "Renamed".to_owned(),
                },
            );
        }
        step(
            &mut session,
            "remove the first system",
            Op::RemoveSystem { id: first },
        );
    }
}
