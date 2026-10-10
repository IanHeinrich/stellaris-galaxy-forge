//! A scenario written with Windows line endings keeps them: every line an op inserts ends
//! the way the line beside it ends, and every op undoes byte for byte.

use sgf_core::format::scenario::fe_zone::{FeDirection, FeKind};
use sgf_core::ops::Op;
use sgf_core::projections::galaxy::{PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;

use crate::common;
use common::current;
use common::fixture::{EXPORTED, PAINTED, from_scenario_text};
use common::paint::zone;

fn to_crlf(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len() + bytes.len() / 20);
    for &b in bytes {
        if b == b'\n' {
            out.push(b'\r');
        }
        out.push(b);
    }
    out
}

fn to_lf(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    for (i, &b) in bytes.iter().enumerate() {
        if !(b == b'\r' && bytes.get(i + 1) == Some(&b'\n')) {
            out.push(b);
        }
    }
    out
}

fn bare_lf(bytes: &[u8]) -> Option<usize> {
    bytes
        .iter()
        .enumerate()
        .position(|(i, &b)| b == b'\n' && (i == 0 || bytes[i - 1] != b'\r'))
}

fn header(key: &str, value: Option<&str>) -> Op {
    Op::SetHeaderField {
        key: key.to_owned(),
        value: value.map(str::to_owned),
    }
}

fn shapes(values: &[&str]) -> Op {
    Op::SetHeaderList {
        key: "supports_shape".to_owned(),
        values: values.iter().map(|v| (*v).to_owned()).collect(),
    }
}

fn enabled_seat() -> SpawnScript {
    SpawnScript::PaintAGalaxy {
        kind: PaintSpawnKind::Enabled,
        random_value: 1,
        player: false,
    }
}

/// Apply `ops` to a CRLF copy of `original` and to `original` itself. After each op the
/// CRLF bytes hold no bare `\n` and are the LF bytes with `\r\n` for `\n`; then every op is
/// undone, and each undo gives back the bytes from before it.
fn crlf_matches_lf(label: &str, original: &[u8], ops: Vec<Op>) {
    let crlf = to_crlf(original);
    let mut lf_session = from_scenario_text(original);
    let mut session = from_scenario_text(&crlf);
    let mut states = vec![current(&session)];
    assert_eq!(states[0], crlf, "{label}: opening changed the bytes");
    for op in ops {
        let step = format!("{label}: {op:?}");
        lf_session
            .apply(op.clone())
            .unwrap_or_else(|e| panic!("{step} on the LF file: {e}"));
        session
            .apply(op)
            .unwrap_or_else(|e| panic!("{step} on the CRLF file: {e}"));
        let bytes = current(&session);
        assert_ne!(
            &bytes,
            states.last().unwrap(),
            "{step}: the op changed nothing"
        );
        if let Some(at) = bare_lf(&bytes) {
            let from = at.saturating_sub(60);
            panic!(
                "{step}: bare LF at {at}: {:?}",
                String::from_utf8_lossy(&bytes[from..(at + 60).min(bytes.len())])
            );
        }
        assert_eq!(
            to_lf(&bytes),
            current(&lf_session),
            "{step}: the CRLF file does not match the LF file"
        );
        states.push(bytes);
    }
    while states.len() > 1 {
        session.undo().expect("undo").expect("an op to undo");
        states.pop();
        assert_eq!(
            &current(&session),
            states.last().unwrap(),
            "{label}: undo is not byte-identical"
        );
    }
}

fn unlinked_pair(session: &Session) -> (u32, u32) {
    let ids = &session.graph().order;
    ids.iter()
        .flat_map(|&a| ids.iter().map(move |&b| (a, b)))
        .find(|&(a, b)| {
            a != b && session.graph().lane(a, b).is_none() && session.graph().lane(b, a).is_none()
        })
        .expect("two systems without a lane")
}

fn linked_pair(session: &Session) -> (u32, u32) {
    let ids = &session.graph().order;
    ids.iter()
        .flat_map(|&a| ids.iter().map(move |&b| (a, b)))
        .find(|&(a, b)| a != b && session.graph().lane(a, b).is_some())
        .expect("two systems with a lane")
}

/// The ops any scenario takes that insert or remove lines.
fn common_ops(session: &Session) -> Vec<(&'static str, Vec<Op>)> {
    let ids = session.graph().order.clone();
    let next = session.graph().systems.keys().max().unwrap() + 1;
    let (a, b) = unlinked_pair(session);
    let (x, y) = linked_pair(session);
    let nebulae = session.graph().nebulae.len();
    let unweighted = session
        .graph()
        .systems
        .values()
        .find(|s| s.spawn_weight.is_none() && s.spawn_script.is_none())
        .expect("a system with no spawn weight")
        .id;
    vec![
        (
            "add and remove a system",
            vec![
                Op::AddSystem {
                    system: Some(next),
                    x: 1.5,
                    y: -2.5,
                    name: Some("Added".to_owned()),
                    initializer: Some("random_empire_init_01".to_owned()),
                    spawn_weight: Some(2.0),
                    spawn_script: None,
                },
                Op::AddSystem {
                    system: None,
                    x: 9.0,
                    y: 9.0,
                    name: None,
                    initializer: None,
                    spawn_weight: None,
                    spawn_script: None,
                },
                Op::RemoveSystem { system: next },
                Op::RemoveSystem { system: ids[0] },
            ],
        ),
        (
            "add and remove a lane",
            vec![
                Op::AddLane {
                    a,
                    b,
                    bridge: false,
                },
                Op::RemoveLane { a: x, b: y },
            ],
        ),
        (
            "prevent and allow a lane",
            vec![Op::PreventLane { a, b }, Op::AllowLane { a, b }],
        ),
        (
            "add and remove a nebula",
            vec![
                Op::AddNebula {
                    x: 0.0,
                    y: 0.0,
                    radius: 12.0,
                    name: Some("Added".to_owned()),
                },
                Op::RemoveNebula { index: nebulae },
            ],
        ),
        (
            "set and clear an initializer",
            vec![
                Op::SetInitializer {
                    system: ids[1],
                    initializer: Some("random_empire_init_04".to_owned()),
                },
                Op::SetInitializer {
                    system: ids[1],
                    initializer: None,
                },
            ],
        ),
        (
            "set and clear a spawn weight",
            vec![
                Op::SetSpawnWeight {
                    system: unweighted,
                    base: Some(5.0),
                },
                Op::SetSpawnWeight {
                    system: unweighted,
                    base: None,
                },
            ],
        ),
        (
            "header fields",
            vec![
                header("test_key", Some("3")),
                header("test_key", Some("4")),
                Op::SetHeaderKeys {
                    entries: vec![
                        ("test_key_a".to_owned(), "1".to_owned()),
                        ("test_key_b".to_owned(), "2".to_owned()),
                    ],
                },
                header("test_key", None),
                header("priority", None),
            ],
        ),
        (
            "header lists",
            vec![
                shapes(&["ring", "bar", "elliptical"]),
                shapes(&[
                    "elliptical",
                    "ring",
                    "spiral_2",
                    "spiral_3",
                    "spiral_4",
                    "spiral_6",
                    "bar",
                    "starburst",
                    "cartwheel",
                    "spoked",
                    "cluster",
                    "ring_2",
                ]),
                shapes(&[]),
            ],
        ),
    ]
}

#[test]
fn an_exported_scenario_with_windows_line_endings_keeps_them() {
    let session = EXPORTED.open();
    for (label, ops) in common_ops(&session) {
        crlf_matches_lf(label, &EXPORTED.bytes(), ops);
    }
}

#[test]
fn a_painted_scenario_with_windows_line_endings_keeps_them() {
    let session = PAINTED.open();
    for (label, ops) in common_ops(&session) {
        crlf_matches_lf(label, &PAINTED.bytes(), ops);
    }
    crlf_matches_lf(
        "spawn scripts",
        &PAINTED.bytes(),
        vec![
            Op::SetSpawnScript {
                system: 10,
                script: Some(enabled_seat()),
            },
            Op::SetSpawnScript {
                system: 10,
                script: None,
            },
        ],
    );
    crlf_matches_lf(
        "fallen empire zones and links",
        &PAINTED.bytes(),
        vec![
            Op::SetFeLinks {
                anchor: 9,
                linked: vec![3, 2],
            },
            Op::SetFeLinks {
                anchor: 9,
                linked: vec![],
            },
            Op::SetFeZone {
                system: 9,
                zone: None,
            },
        ],
    );
}

const MULTI_LINE: &str = "static_galaxy_scenario = {
\tname = \"Spread out\"
\tpriority = 5
\tsystem = {
\t\tid = \"0\"
\t\tname = \"A\"
\t\tposition = { x = 0 y = 0 }
\t\tinitializer = random_empire_init_01
\t\tspawn_weight = {
\t\t\tmodifier = { add = 1 }
\t\t}
\t\teffect = {
\t\t\tset_star_flag = first
\t\t}
\t}
\tsystem = {
\t\tid = \"1\"
\t\tposition = { x = 300 y = 0 }
\t}
\tsystem = {
\t\tid = \"2\"
\t\tposition = { x = -300 y = 0 }
\t}
\tsystem = {
\t\tid = \"3\"
\t\tposition = { x = 0 y = 300 }
\t}
\tsystem = {
\t\tid = \"4\"
\t\tposition = { x = 0 y = -300 }
\t}
\tadd_hyperlane = {
\t\tfrom = \"1\"
\t\tto = \"2\"
\t}
}
";

#[test]
fn statements_spread_over_lines_take_the_line_ending_of_their_neighbours() {
    crlf_matches_lf(
        "multi-line statements",
        MULTI_LINE.as_bytes(),
        vec![
            Op::SetSpawnWeight {
                system: 0,
                base: Some(5.0),
            },
            Op::SetSpawnWeight {
                system: 0,
                base: None,
            },
            Op::SetSpawnScript {
                system: 1,
                script: Some(enabled_seat()),
            },
            Op::SetFeZone {
                system: 0,
                zone: Some(zone(FeDirection::E, FeKind::Random, 40, true)),
            },
            Op::SetHomeSystem {
                system: 3,
                home: true,
            },
            Op::SetInitializer {
                system: 0,
                initializer: None,
            },
            Op::RenameSystem {
                system: 2,
                name: "Two".to_owned(),
            },
            Op::AddLane {
                a: 3,
                b: 4,
                bridge: false,
            },
            Op::PreventLane { a: 0, b: 1 },
            Op::RemoveLane { a: 1, b: 2 },
            Op::RemoveSystem { system: 4 },
        ],
    );
}

#[test]
fn a_line_inserted_beside_an_lf_line_in_a_crlf_file_ends_in_lf() {
    let mixed = "static_galaxy_scenario = {\r
\tname = \"Mixed\"\r
\tsystem = { id = \"0\" position = { x = 0 y = 0 } }\r
\tsystem = { id = \"1\" position = { x = 10 y = 0 } }\r
}\n";
    let mut session = from_scenario_text(mixed);
    session
        .apply(Op::AddLane {
            a: 0,
            b: 1,
            bridge: false,
        })
        .expect("add a lane");
    let text = String::from_utf8(current(&session)).unwrap();
    assert!(
        text.ends_with("\tadd_hyperlane = { from = \"0\" to = \"1\" }\n}\n"),
        "{text:?}"
    );
    assert!(
        text.contains("y = 0 } }\r\n\tadd_hyperlane"),
        "the lines before are untouched: {text:?}"
    );

    let unterminated = mixed.replace("}\n", "}");
    let mut session = from_scenario_text(unterminated);
    session
        .apply(Op::AddLane {
            a: 0,
            b: 1,
            bridge: false,
        })
        .expect("add a lane");
    let text = String::from_utf8(current(&session)).unwrap();
    assert!(
        text.ends_with("\tadd_hyperlane = { from = \"0\" to = \"1\" }\r\n}"),
        "{text:?}"
    );
}
