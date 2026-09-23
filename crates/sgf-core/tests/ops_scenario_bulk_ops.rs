//! The bulk system ops on the exported real scenario, at the map brushes' scale: 500
//! systems added as one op and laned as a second, and 200 removed as one, both ends of
//! some lanes among them. Each is one undo step and undoes byte for byte.

use std::time::{Duration, Instant};

use sgf_core::ops::{LanePair, NewSystem, Op};
use sgf_core::session::Session;
use sgf_core::validate::Severity;

mod common;
use common::current;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/2206.11.16.scenario.txt"
);

/// One op, one refresh: an unoptimised build stays well inside this, and the release run
/// prints the real numbers.
const BUDGET: Duration = Duration::from_secs(2);

/// A paint brush's grid: `ROWS` rows of `COLS` columns, 10 apart, east of the galaxy
/// (whose systems sit within ±454).
const COLS: u32 = 20;
const ROWS: u32 = 25;

fn open() -> Session {
    Session::open(FIXTURE).expect("open the exported scenario")
}

fn bytes() -> Vec<u8> {
    std::fs::read(FIXTURE).expect("read the fixture")
}

fn no_errors(session: &Session) {
    let issues = session.validate();
    assert!(
        issues.iter().all(|i| i.severity != Severity::Error),
        "{issues:?}"
    );
}

/// The grid's systems, and the lanes to each one's right and lower neighbour plus 20
/// tying the first rows' west edge to the existing systems with the lowest ids.
fn grid(session: &Session) -> (Vec<NewSystem>, Vec<LanePair>) {
    let next_id = session.graph.systems.keys().max().map_or(1, |max| max + 1);
    let id_at = |row: u32, col: u32| next_id + row * COLS + col;
    let mut systems = Vec::new();
    let mut lanes = Vec::new();
    for row in 0..ROWS {
        for col in 0..COLS {
            systems.push(NewSystem {
                id: id_at(row, col),
                x: 1000.0 + f64::from(col) * 10.0,
                y: -200.0 + f64::from(row) * 10.0,
                name: None,
                initializer: None,
                spawn_weight: None,
                spawn_script: None,
                statement: None,
            });
            let lane = |b| LanePair {
                a: id_at(row, col),
                b,
                bridge: false,
            };
            if col + 1 < COLS {
                lanes.push(lane(id_at(row, col + 1)));
            }
            if row + 1 < ROWS {
                lanes.push(lane(id_at(row + 1, col)));
            }
        }
    }
    let mut existing: Vec<u32> = session.graph.systems.keys().copied().collect();
    existing.sort_unstable();
    for (row, &old) in (0..20).zip(&existing) {
        lanes.push(LanePair {
            a: id_at(row, 0),
            b: old,
            bridge: false,
        });
    }
    (systems, lanes)
}

#[test]
fn add_systems_adds_500_as_one_op_and_one_undo_step() {
    let mut session = open();
    let original = bytes();
    assert_eq!(current(&session), original);
    let systems_before = session.graph.systems.len();
    let lane_ends_before: usize = session.graph.systems.values().map(|s| s.lanes.len()).sum();
    let (systems, lanes) = grid(&session);
    assert_eq!(systems.len(), 500);
    assert_eq!(lanes.len(), 975);

    let start = Instant::now();
    let added = session
        .apply(Op::AddSystems {
            systems: systems.clone(),
        })
        .expect("add 500 systems");
    let add_time = start.elapsed();
    assert_eq!(added.entry.description, "Added 500 systems");
    assert_eq!(session.graph.systems.len(), systems_before + 500);
    let after_systems = current(&session);

    let start = Instant::now();
    session
        .apply(Op::AddLanePairs {
            lanes: lanes.clone(),
        })
        .expect("lane the grid");
    let lane_time = start.elapsed();
    for lane in &lanes {
        assert!(session.graph.lane(lane.a, lane.b).is_some());
    }
    let lane_ends_after: usize = session.graph.systems.values().map(|s| s.lanes.len()).sum();
    assert_eq!(lane_ends_after, lane_ends_before + 2 * lanes.len());
    assert_eq!(
        session.history().undo.len(),
        2,
        "the systems, then the lanes"
    );
    no_errors(&session);

    session.undo().expect("undo").expect("the lanes to undo");
    assert_eq!(current(&session), after_systems);
    let start = Instant::now();
    session.undo().expect("undo").expect("the systems to undo");
    let undo_time = start.elapsed();
    assert_eq!(current(&session), original, "undo is not byte-identical");
    assert_eq!(session.graph.systems.len(), systems_before);

    session.redo().expect("redo").expect("the systems to redo");
    assert_eq!(
        current(&session),
        after_systems,
        "redo wrote different bytes"
    );

    println!(
        "AddSystems (500): apply {add_time:?}, undo {undo_time:?}; AddLanePairs ({}): apply {lane_time:?}",
        lanes.len()
    );
    assert!(add_time < BUDGET, "AddSystems took {add_time:?}");
}

/// The 200 lowest ids holding no spawn weight: a territory edit, not a change of seats.
/// Neighbours in id order are often linked, so some lanes lose both ends at once.
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
fn remove_systems_removes_200_as_one_op_and_one_undo_step() {
    let mut session = open();
    let original = bytes();
    let ids = erase_candidates(&session);
    assert_eq!(ids.len(), 200);
    let both_ends = session
        .graph
        .systems
        .values()
        .filter(|s| ids.contains(&s.id))
        .flat_map(|s| s.lanes.iter().map(move |l| (s.id, l.to)))
        .filter(|&(a, b)| a < b && ids.contains(&b))
        .count();
    assert!(both_ends > 0, "some lane loses both ends");
    let systems_before = session.graph.systems.len();

    let start = Instant::now();
    let removed = session
        .apply(Op::RemoveSystems { ids: ids.clone() })
        .expect("remove 200 systems");
    let remove_time = start.elapsed();
    assert!(
        removed
            .entry
            .description
            .starts_with("Removed 200 systems ("),
        "{}",
        removed.entry.description
    );
    assert_eq!(session.graph.systems.len(), systems_before - 200);
    for id in &ids {
        assert!(!session.graph.systems.contains_key(id));
    }
    assert!(
        session
            .graph
            .systems
            .values()
            .all(|s| s.lanes.iter().all(|l| !ids.contains(&l.to))),
        "a lane still names a removed system"
    );
    assert_eq!(session.history().undo.len(), 1);
    let applied = current(&session);

    let start = Instant::now();
    session.undo().expect("undo").expect("the removal to undo");
    let undo_time = start.elapsed();
    assert_eq!(current(&session), original, "undo is not byte-identical");
    assert_eq!(session.graph.systems.len(), systems_before);

    session.redo().expect("redo").expect("the removal to redo");
    assert_eq!(current(&session), applied, "redo wrote different bytes");

    println!(
        "RemoveSystems (200, {both_ends} lanes losing both ends): apply {remove_time:?}, undo {undo_time:?}"
    );
    assert!(remove_time < BUDGET, "RemoveSystems took {remove_time:?}");
}
