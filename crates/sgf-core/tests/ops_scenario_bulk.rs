//! The map brushes' strokes on the exported real scenario, at their scale and in the
//! shapes they send: a paint of 500 systems and their lanes, an erase of 200 systems
//! with both ends of some lanes among them, a connect and a cut. Each is one edit and
//! one undo step, and undoes byte for byte.

use std::fmt::Write as _;

use sgf_core::ops::{LanePair, NewSystem, Op};
use sgf_core::session::{OpResult, Session};
use sgf_core::validate::Severity;

use crate::common;
use common::brush::{connect, cut, erase, grid, lane, paint};
use common::diff::{round_trip, unified_diff};
use common::fixture::EXPORTED;

/// A 20 by 25 grid east of the galaxy (whose systems sit within ±454), laned to each
/// system's right and lower neighbour, with its first 20 rows' west edge tied to the
/// existing systems with the lowest ids.
fn paint_stroke(session: &Session) -> (Vec<NewSystem>, Vec<LanePair>) {
    const COLS: u32 = 20;
    let first = session.graph.systems.keys().max().map_or(1, |max| max + 1);
    let (systems, mut lanes) = grid(first, (1000.0, -200.0), COLS, 25);
    let mut existing: Vec<u32> = session.graph.systems.keys().copied().collect();
    existing.sort_unstable();
    for (row, &old) in (0..20).zip(&existing) {
        lanes.push(lane(first + row * COLS, old));
    }
    (systems, lanes)
}

/// The 200 lowest ids holding no spawn weight: a territory edit, not a change of seats.
/// Neighbours in id order are often linked, so some lanes lose both ends at once.
fn erase_stroke(session: &Session) -> Vec<u32> {
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

fn no_errors(session: &Session) {
    let issues = session.validate();
    assert!(
        issues.iter().all(|i| i.severity != Severity::Error),
        "{issues:?}"
    );
}

/// The description, the system count before and after, the issue count and the first 40
/// lines of the diff: enough to spot a shape regression without a diff thousands of
/// lines long.
fn summary(session: &Session, result: &OpResult, systems_before: usize) -> String {
    let mut summary = String::new();
    writeln!(summary, "{}", result.entry.description).unwrap();
    writeln!(
        summary,
        "systems: {systems_before} -> {}",
        session.graph.systems.len()
    )
    .unwrap();
    writeln!(summary, "issues: {}", result.issues.len()).unwrap();
    write!(summary, "{}", unified_diff(session, Some(40))).unwrap();
    summary
}

#[test]
fn a_paint_stroke_adds_500_systems_and_their_lanes_as_one_step() {
    let mut session = EXPORTED.open();
    let systems_before = session.graph.systems.len();
    let lane_ends_before: usize = session.graph.systems.values().map(|s| s.lanes.len()).sum();
    let (systems, lanes) = paint_stroke(&session);
    assert_eq!(systems.len(), 500);
    assert_eq!(lanes.len(), 975);

    let result = session
        .apply(paint(systems.clone(), lanes.clone()))
        .expect("paint 500 systems");
    assert_eq!(session.graph.systems.len(), systems_before + 500);
    for system in &systems {
        assert!(
            session.graph.systems.contains_key(&system.id),
            "{}",
            system.id
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
    assert_eq!(lane_ends_after, lane_ends_before + 2 * lanes.len());
    assert_eq!(session.history().undo.len(), 1, "one stroke, one undo step");
    no_errors(&session);
    common::snapshot(
        "paint_batch_500_summary",
        &summary(&session, &result, systems_before),
    );

    let added = EXPORTED
        .open()
        .apply(Op::AddSystems {
            systems: systems.clone(),
        })
        .expect("add the stroke's systems alone");
    assert_eq!(added.entry.description, "Added 500 systems");

    round_trip(EXPORTED.open(), paint(systems, lanes));
}

#[test]
fn an_erase_stroke_removes_200_systems_and_every_lane_naming_one_as_one_step() {
    let mut session = EXPORTED.open();
    let ids = erase_stroke(&session);
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

    let result = session
        .apply(erase(ids.clone()))
        .expect("erase 200 systems");
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
    assert_eq!(session.history().undo.len(), 1, "one stroke, one undo step");
    no_errors(&session);
    common::snapshot(
        "erase_batch_200_summary",
        &summary(&session, &result, systems_before),
    );

    let removed = EXPORTED
        .open()
        .apply(Op::RemoveSystems { ids: ids.clone() })
        .expect("remove the stroke's systems alone");
    assert!(
        removed
            .entry
            .description
            .starts_with("Removed 200 systems ("),
        "{}",
        removed.entry.description
    );

    round_trip(EXPORTED.open(), erase(ids));
}

/// Systems 0, 64, 86 and 246 hyperlane to each other (five lanes among the four: 0-64,
/// 0-86, 0-246, 64-246, 86-246), and each also lanes to a system outside the set. A
/// removal naming both ends of a lane is the case most likely to break inverse ordering:
/// the same `add_hyperlane` statement is named by each end, and a batch of single
/// removals erases it once per end.
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

#[test]
fn erasing_a_linked_cluster_in_either_order_restores_every_lane_on_undo() {
    for order in [LINKED_CLUSTER, [246, 86, 64, 0]] {
        let mut session = EXPORTED.open();
        assert_cluster_linked(&session, "before the stroke");
        session
            .apply(erase(order.to_vec()))
            .expect("erase the linked cluster");
        for id in LINKED_CLUSTER {
            assert!(!session.graph.systems.contains_key(&id), "{order:?}: {id}");
        }
        session.undo().expect("undo").expect("the erase to undo");
        assert_eq!(common::current(&session), EXPORTED.bytes(), "{order:?}");
        assert_cluster_linked(&session, "after undo");

        round_trip(EXPORTED.open(), erase(order.to_vec()));
        round_trip(
            EXPORTED.open(),
            Op::Batch {
                description: "Removed a linked cluster one system at a time".to_owned(),
                ops: order.iter().map(|&id| Op::RemoveSystem { id }).collect(),
            },
        );
    }
}

#[test]
fn a_connect_stroke_lays_every_lane_as_one_step() {
    let session = EXPORTED.open();
    let lanes = vec![lane(0, 1), lane(1, 2), lane(2, 3)];
    for lane in &lanes {
        assert!(session.graph.lane(lane.a, lane.b).is_none());
    }
    round_trip(session, connect(lanes));
}

#[test]
fn a_cut_stroke_takes_every_lane_as_one_step() {
    let mut session = EXPORTED.open();
    let lanes = CLUSTER_LANES.to_vec();
    session.apply(cut(lanes.clone())).expect("cut the cluster");
    for (a, b) in &lanes {
        assert!(session.graph.lane(*a, *b).is_none(), "{a} <-> {b}");
    }
    assert_eq!(session.history().undo.len(), 1, "one stroke, one undo step");

    round_trip(EXPORTED.open(), cut(lanes));
}
