//! A scenario edit re-reads only the statements it wrote. After every apply, undo and redo
//! the projection and the index must agree with a fresh open of the current bytes, and the
//! same follow-up edit must write the same bytes on both.

use sgf_core::document::Document;
use sgf_core::ops::{InitializerSet, LanePair, NewSystem, Op, SystemMove};
use sgf_core::projections::galaxy::{PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;

mod common;
use common::current;

const GRAMMAR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/scenario_grammar.txt"
);
const SAMPLE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/2206.11.16.scenario.txt"
);
const PAINTED: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/paint_a_galaxy.txt"
);

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

fn open(path: &str) -> Session {
    Session::open(path).expect("open the scenario")
}

fn from_bytes(bytes: Vec<u8>) -> Session {
    let doc = Document::from_scenario_bytes(bytes).expect("index the bytes");
    Session::from_document(None, doc).expect("project the bytes")
}

/// What the index says, without the anchors, which differ between an edited document and
/// a fresh open of its bytes.
fn index_view(session: &Session) -> String {
    let scenario = session.doc.scenario().expect("a scenario");
    let mut view = format!(
        "name {:?} core {:?} transform {} next {} nebulae {}\n",
        scenario.header.name,
        scenario.header.core_radius,
        scenario.header.has_coordinate_transform,
        scenario.next_id(),
        scenario.nebulae().len()
    );
    for stmt in &scenario.header.statements {
        view.push_str(&format!(
            "header {} = {}\n",
            stmt.field.key, stmt.field.value
        ));
    }
    for (id, anchor) in scenario.systems() {
        let bytes = session.doc.current(anchor).expect("the system's bytes");
        view.push_str(&format!(
            "system {id}: {}\n",
            String::from_utf8_lossy(bytes).trim()
        ));
    }
    for lane in scenario.lane_statements() {
        view.push_str(&format!(
            "lane {} {} {}\n",
            lane.from, lane.to, lane.prevent
        ));
    }
    view
}

/// Insertions at the header, among the systems, lanes and nebulae, and a removal, as one
/// edit: every place the index says a statement goes or stands.
fn probe(session: &Session) -> Op {
    let first = session.graph.order[0];
    let last = *session.graph.order.last().unwrap();
    let next = session.graph.systems.keys().max().unwrap() + 1;
    Op::Batch {
        description: "Probe".to_owned(),
        ops: vec![
            Op::SetHeaderField {
                key: "sgf_probe".to_owned(),
                value: Some("1".to_owned()),
            },
            Op::AddSystems {
                systems: vec![new_system(next, 1.0, 1.0)],
            },
            Op::AddLane {
                a: next,
                b: first,
                bridge: false,
            },
            Op::AddNebula {
                x: 5.0,
                y: 5.0,
                radius: 1.0,
                name: None,
            },
            Op::RemoveSystem { id: last },
        ],
    }
}

fn probed(mut session: Session) -> Vec<u8> {
    let op = probe(&session);
    session.apply(op).expect("the probe");
    current(&session)
}

fn assert_fresh(session: &Session, step: &str) {
    let fresh = from_bytes(current(session));
    let (now, then) = (&session.graph, &fresh.graph);
    assert_eq!(now.systems, then.systems, "{step}: systems");
    assert_eq!(now.order, then.order, "{step}: order");
    assert_eq!(now.nebulae, then.nebulae, "{step}: nebulae");
    assert_eq!(now.header.len(), then.header.len(), "{step}: header");
    assert_eq!(now.bypasses, then.bypasses, "{step}: bypasses");
    assert_eq!(now.galaxy_radius, then.galaxy_radius, "{step}: radius");
    assert_eq!(now.core_radius, then.core_radius, "{step}: core radius");
    assert_eq!(index_view(session), index_view(&fresh), "{step}: index");
    let edited = Session::from_document(None, session.doc.clone()).expect("project the doc");
    assert_eq!(
        String::from_utf8_lossy(&probed(edited)),
        String::from_utf8_lossy(&probed(fresh)),
        "{step}: a follow-up edit"
    );
}

/// Apply `op`, then undo and redo it, checking each step, and leave it applied.
fn step(session: &mut Session, label: &str, op: Op) {
    let before = current(session);
    session.apply(op).unwrap_or_else(|e| panic!("{label}: {e}"));
    assert_fresh(session, label);
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(
        current(session),
        before,
        "{label}: undo is not byte-identical"
    );
    assert_fresh(session, &format!("{label} undone"));
    session.redo().expect("redo").expect("an op to redo");
    assert_fresh(session, &format!("{label} redone"));
}

fn new_system(id: u32, x: f64, y: f64) -> NewSystem {
    NewSystem {
        id,
        x,
        y,
        name: None,
        initializer: None,
        spawn_weight: None,
        spawn_script: None,
    }
}

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
    let mut session = open(GRAMMAR);
    edits(&mut session);

    let mut session = open(GRAMMAR);
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
    edits(&mut open(SAMPLE));
}

#[test]
fn painted_fixture_edits_match_a_fresh_open() {
    let mut session = open(PAINTED);
    edits(&mut session);

    let mut session = open(PAINTED);
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
    let mut session = from_bytes(DUPLICATES.as_bytes().to_vec());
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
