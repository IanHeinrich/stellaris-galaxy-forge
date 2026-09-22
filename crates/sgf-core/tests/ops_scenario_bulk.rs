//! Batch-sized edits on the exported real scenario: the map brushes' scale, applied and
//! undone as one step. A paint-sized batch adds 500 systems and their lanes; an
//! erase-sized batch removes 200 systems at once, including a case where both ends of a
//! lane are removed in the same batch.

use std::collections::HashSet;
use std::fmt::Write as _;
use std::time::{Duration, Instant};

use sgf_core::ops::{LanePair, Op};
use sgf_core::session::Session;
use sgf_core::validate::Severity;
use similar::{Algorithm, TextDiff};

mod common;
use common::current;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/2206.11.16.scenario.txt"
);

/// Generous enough that debug builds never flake: an unoptimised build re-parsing 500
/// single-entity inserts measures around 10s, so this leaves ample headroom without
/// letting a genuine hang pass unnoticed. The release run reports the real numbers.
const BUDGET: Duration = Duration::from_secs(30);

fn open() -> Session {
    Session::open(FIXTURE).expect("open the exported scenario")
}

fn bytes() -> Vec<u8> {
    std::fs::read(FIXTURE).expect("read the fixture")
}

/// The grid a paint brush would leave: `ROWS` rows of `COLS` columns, 10 apart, starting
/// well east of the galaxy (whose systems sit within ±454), plus the lanes to each
/// system's right and lower neighbour and 20 lanes tying the grid's west edge to
/// existing systems 0..20.
const COLS: u32 = 20;
const ROWS: u32 = 25;

struct Paint {
    ids: Vec<u32>,
    system_ops: Vec<Op>,
    lanes: Vec<LanePair>,
}

fn paint_batch(next_id: u32) -> Paint {
    let id_at = |row: u32, col: u32| next_id + row * COLS + col;
    let mut ids = Vec::with_capacity((ROWS * COLS) as usize);
    let mut system_ops = Vec::with_capacity(ids.capacity());
    for row in 0..ROWS {
        for col in 0..COLS {
            let id = id_at(row, col);
            ids.push(id);
            system_ops.push(Op::AddSystem {
                id: Some(id),
                x: 1000.0 + f64::from(col) * 10.0,
                y: -200.0 + f64::from(row) * 10.0,
                name: None,
                initializer: None,
                spawn_weight: None,
                spawn_script: None,
            });
        }
    }
    let mut lanes = Vec::new();
    for row in 0..ROWS {
        for col in 0..COLS {
            if col + 1 < COLS {
                lanes.push(LanePair {
                    a: id_at(row, col),
                    b: id_at(row, col + 1),
                    bridge: false,
                });
            }
            if row + 1 < ROWS {
                lanes.push(LanePair {
                    a: id_at(row, col),
                    b: id_at(row + 1, col),
                    bridge: false,
                });
            }
        }
    }
    for row in 0..20 {
        lanes.push(LanePair {
            a: id_at(row, 0),
            b: row,
            bridge: false,
        });
    }
    Paint {
        ids,
        system_ops,
        lanes,
    }
}

/// The first ~40 lines of the unified diff, plus how many more there are: enough to spot
/// a shape regression without snapshotting a diff thousands of lines long.
fn compact_diff(session: &Session) -> String {
    let original = String::from_utf8_lossy(session.doc.original()).into_owned();
    let edited = String::from_utf8_lossy(&current(session)).into_owned();
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(&original, &edited);
    let full = diff
        .unified_diff()
        .context_radius(3)
        .header("scenario", "scenario")
        .to_string();
    let lines: Vec<&str> = full.lines().collect();
    if lines.len() <= 40 {
        return full;
    }
    format!(
        "{}\n… {} more lines",
        lines[..40].join("\n"),
        lines.len() - 40
    )
}

fn no_errors(session: &Session) {
    let issues = session.validate();
    assert!(
        issues.iter().all(|i| i.severity != Severity::Error),
        "{issues:?}"
    );
}

#[test]
fn paint_sized_batch_adds_500_systems_and_their_lanes_as_one_step() {
    let mut session = open();
    let original = bytes();
    assert_eq!(current(&session), original);

    let systems_before = session.graph.systems.len();
    let lane_ends_before: usize = session.graph.systems.values().map(|s| s.lanes.len()).sum();
    let next_id = session
        .graph
        .systems
        .keys()
        .max()
        .copied()
        .map_or(1, |max| max + 1);

    let paint = paint_batch(next_id);
    let system_count = paint.system_ops.len();
    let lane_count = paint.lanes.len();
    let ids = paint.ids.clone();
    let lanes = paint.lanes.clone();
    let mut ops = paint.system_ops;
    ops.push(Op::AddLanePairs { lanes: paint.lanes });
    let op = Op::Batch {
        description: "Painted 500 systems".to_owned(),
        ops,
    };

    let apply_start = Instant::now();
    let result = session.apply(op).expect("apply the paint-sized batch");
    let apply_time = apply_start.elapsed();

    assert_eq!(session.graph.systems.len(), systems_before + system_count);
    for id in &ids {
        assert!(
            session.graph.systems.contains_key(id),
            "system {id} missing"
        );
    }
    for lane in &lanes {
        assert!(
            session.graph.lane(lane.a, lane.b).is_some(),
            "lane {} <-> {} missing",
            lane.a,
            lane.b
        );
    }
    let lane_ends_after: usize = session.graph.systems.values().map(|s| s.lanes.len()).sum();
    assert_eq!(lane_ends_after, lane_ends_before + 2 * lane_count);

    assert_eq!(session.history().undo.len(), 1, "one batch, one undo step");
    assert!(session.history().redo.is_empty());
    no_errors(&session);

    let mut summary = String::new();
    writeln!(summary, "{}", result.entry.description).unwrap();
    writeln!(
        summary,
        "systems: {systems_before} -> {}",
        session.graph.systems.len()
    )
    .unwrap();
    writeln!(summary, "lane pairs added: {lane_count}").unwrap();
    writeln!(summary, "issues: {}", result.issues.len()).unwrap();
    write!(summary, "{}", compact_diff(&session)).unwrap();
    common::snapshot("paint_batch_500_summary", &summary);

    let applied_bytes = current(&session);
    assert_ne!(applied_bytes, original, "the batch changed nothing");

    let undo_start = Instant::now();
    session
        .undo()
        .expect("undo")
        .expect("the paint batch to undo");
    let undo_time = undo_start.elapsed();
    assert_eq!(current(&session), original, "undo is not byte-identical");
    assert_eq!(session.history().undo.len(), 0);
    for id in &ids {
        assert!(!session.graph.systems.contains_key(id));
    }

    session
        .redo()
        .expect("redo")
        .expect("the paint batch to redo");
    assert_eq!(
        current(&session),
        applied_bytes,
        "redo wrote different bytes"
    );

    println!(
        "paint-sized batch ({system_count} systems, {lane_count} lanes): apply {apply_time:?}, undo {undo_time:?}"
    );
    assert!(apply_time < BUDGET, "apply took {apply_time:?}");
    assert!(undo_time < BUDGET, "undo took {undo_time:?}");
}

/// The first 200 systems (ascending id) that hold no spawn weight: seats are left alone
/// so the batch is a plain territory edit, not also a change to who can spawn where.
fn erase_candidates(session: &Session) -> Vec<u32> {
    let mut ids: Vec<u32> = session
        .graph
        .systems
        .iter()
        .filter(|(_, s)| s.spawn_weight.is_none())
        .map(|(&id, _)| id)
        .collect();
    ids.sort_unstable();
    ids.truncate(200);
    ids
}

#[test]
fn erase_sized_batch_removes_200_systems_as_one_step() {
    let mut session = open();
    let original = bytes();

    let remove_ids = erase_candidates(&session);
    assert_eq!(remove_ids.len(), 200);
    let remove_set: HashSet<u32> = remove_ids.iter().copied().collect();
    let systems_before = session.graph.systems.len();

    let ops: Vec<Op> = remove_ids
        .iter()
        .map(|&id| Op::RemoveSystem { id })
        .collect();
    let op = Op::Batch {
        description: "Erased 200 systems".to_owned(),
        ops,
    };

    let apply_start = Instant::now();
    let result = session.apply(op).expect("apply the erase-sized batch");
    let apply_time = apply_start.elapsed();

    assert_eq!(session.graph.systems.len(), systems_before - 200);
    for id in &remove_ids {
        assert!(!session.graph.systems.contains_key(id));
    }
    for system in session.graph.systems.values() {
        for lane in &system.lanes {
            assert!(
                !remove_set.contains(&lane.to),
                "system {} still lists a lane to removed system {}",
                system.id,
                lane.to
            );
        }
    }

    assert_eq!(session.history().undo.len(), 1, "one batch, one undo step");
    no_errors(&session);

    let mut summary = String::new();
    writeln!(summary, "{}", result.entry.description).unwrap();
    writeln!(
        summary,
        "systems: {systems_before} -> {}",
        session.graph.systems.len()
    )
    .unwrap();
    writeln!(summary, "issues: {}", result.issues.len()).unwrap();
    write!(summary, "{}", compact_diff(&session)).unwrap();
    common::snapshot("erase_batch_200_summary", &summary);

    let undo_start = Instant::now();
    session
        .undo()
        .expect("undo")
        .expect("the erase batch to undo");
    let undo_time = undo_start.elapsed();
    assert_eq!(current(&session), original, "undo is not byte-identical");
    assert_eq!(session.history().undo.len(), 0);
    for id in &remove_ids {
        assert!(session.graph.systems.contains_key(id));
    }

    println!("erase-sized batch (200 systems): apply {apply_time:?}, undo {undo_time:?}");
    assert!(apply_time < BUDGET, "apply took {apply_time:?}");
    assert!(undo_time < BUDGET, "undo took {undo_time:?}");
}

/// Systems 0, 64, 86 and 246 hyperlane to each other (five lanes among the four: 0-64,
/// 0-86, 0-246, 64-246, 86-246), and each also lanes to a system outside the set. A
/// removal batch naming both ends of a lane is the case most likely to break inverse
/// ordering: the same `add_hyperlane` statement is erased once per end that names it.
const LINKED_CLUSTER: [u32; 4] = [0, 64, 86, 246];
const CLUSTER_LANES: [(u32, u32); 9] = [
    (0, 64),
    (0, 86),
    (0, 246),
    (64, 246),
    (86, 246),
    (0, 200),
    (0, 752),
    (64, 505),
    (86, 112),
];

fn assert_cluster_linked(session: &Session, when: &str) {
    for &(a, b) in &CLUSTER_LANES {
        assert!(
            session.graph.lane(a, b).is_some() || session.graph.lane(b, a).is_some(),
            "{when}: lane {a} <-> {b} is missing"
        );
    }
}

fn erase_linked_cluster(order: [u32; 4]) {
    let mut session = open();
    let original = bytes();
    assert_cluster_linked(&session, "before the batch");

    let ops: Vec<Op> = order.iter().map(|&id| Op::RemoveSystem { id }).collect();
    session
        .apply(Op::Batch {
            description: "Erased a linked cluster".to_owned(),
            ops,
        })
        .expect("apply the linked-cluster removal");
    for id in LINKED_CLUSTER {
        assert!(!session.graph.systems.contains_key(&id));
    }

    session
        .undo()
        .expect("undo")
        .expect("the linked-cluster removal to undo");
    assert_eq!(current(&session), original, "undo is not byte-identical");
    for id in LINKED_CLUSTER {
        assert!(session.graph.systems.contains_key(&id));
    }
    assert_cluster_linked(&session, "after undo");
}

#[test]
fn erasing_a_linked_cluster_restores_every_lane_on_undo() {
    erase_linked_cluster([0, 64, 86, 246]);
}

#[test]
fn erasing_a_linked_cluster_in_reverse_order_restores_every_lane_on_undo() {
    erase_linked_cluster([246, 86, 64, 0]);
}
