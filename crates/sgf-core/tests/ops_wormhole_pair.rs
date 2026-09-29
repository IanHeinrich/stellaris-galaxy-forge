//! Adding and removing a save's natural wormhole pairs on the 4.x samples: the diff,
//! byte-exact undo, what the galaxy and the details read back, and what is refused.

use sgf_core::format::save::details::{HeuristicResolver, WormholeSummary};
use sgf_core::ops::{Op, OpError};
use sgf_core::projections::galaxy::{BypassLink, GalaxyGraph};
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::examples::save_with_added;
use common::{current, open, open_3_4, open_4_5};

fn add(a: u32, b: u32) -> Op {
    Op::AddSaveWormholePair { a, b, at: None }
}

fn remove(a: u32, b: u32) -> Op {
    Op::RemoveSaveWormholePair { a, b }
}

fn wormholes(session: &Session, system: u32) -> Vec<WormholeSummary> {
    let details = session.details().expect("details");
    details
        .resolve(system, &HeuristicResolver, false)
        .expect("the system's details")
        .wormholes
}

fn wormhole(id: u32, bypass: u32, partner: u32, x: f64, y: f64) -> WormholeSummary {
    WormholeSummary {
        id,
        bypass,
        kind: "wormhole".to_owned(),
        partner: Some(partner),
        x,
        y,
    }
}

fn linked(graph: &GalaxyGraph, a: u32, b: u32) -> bool {
    graph.bypasses.iter().any(|link| {
        matches!(*link, BypassLink::Wormhole { a: x, b: y } if (x, y) == (a, b) || (x, y) == (b, a))
    })
}

/// The 4.5 sample's natural wormholes run to row 14 and its bypasses to 22, so the pair
/// takes rows 15 and 16 and bypasses 23 and 24.
#[test]
fn a_wormhole_pair_added_between_two_systems() {
    let mut session = open_4_5();
    assert!(wormholes(&session, 1).is_empty() && wormholes(&session, 140).is_empty());
    let result = snapshot_step(&mut session, "wormhole_pair_added", add(1, 140));
    assert_eq!(result.inverse, remove(1, 140));
    assert_eq!(result.details_stale, [1, 140]);
    assert!(linked(&session.graph, 1, 140));
    let one = wormholes(&session, 1);
    let other = wormholes(&session, 140);
    assert_eq!((one.len(), other.len()), (1, 1));
    assert_eq!((one[0].id, one[0].bypass), (15, 23));
    assert_eq!(one[0].partner, Some(140));
    assert_eq!((other[0].id, other[0].bypass), (16, 24));
    assert_eq!(other[0].partner, Some(1));
    assert!(one[0].x < 0.0 && one[0].y == 0.0, "{:?}", one[0]);
    assert!(other[0].x == 0.0 && other[0].y > 0.0, "{:?}", other[0]);

    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("wormhole-pair.sav");
    session.save_as(&path).expect("save_as");
    let reopened = Session::open(&path).expect("reopen");
    assert!(linked(&reopened.graph, 1, 140));
    assert_eq!(wormholes(&reopened, 1), one);
    assert_eq!(wormholes(&reopened, 140), other);
}

#[test]
fn an_added_pair_removed_gives_back_the_bytes_as_opened() {
    let mut session = open_4_5();
    session.apply(add(1, 140)).expect("the add");
    let removed = session.apply(remove(140, 1)).expect("the removal");
    assert_eq!(current(&session), session.doc.original());
    assert!(!linked(&session.graph, 1, 140));
    assert!(wormholes(&session, 1).is_empty() && wormholes(&session, 140).is_empty());
    assert!(matches!(
        removed.inverse,
        Op::AddSaveWormholePair {
            a: 140,
            b: 1,
            at: Some(_)
        }
    ));
}

/// Wormhole 1 of the 4.5 sample stands in Ferragon (489), linked to Aulderaan (152).
#[test]
fn a_wormhole_pair_the_game_wrote_removed() {
    let mut session = open_4_5();
    assert!(linked(&session.graph, 489, 152));
    let result = snapshot_step(&mut session, "wormhole_pair_removed", remove(152, 489));
    assert_eq!(result.details_stale, [152, 489]);
    assert!(!linked(&session.graph, 489, 152));
    assert!(wormholes(&session, 489).is_empty() && wormholes(&session, 152).is_empty());

    session.apply(result.inverse).expect("add it back");
    assert!(linked(&session.graph, 489, 152));
    assert_eq!(
        wormholes(&session, 152),
        [wormhole(15, 23, 489, 57.61222, 347.70984)],
        "back where it stood, numbered as a new pair"
    );
    assert_eq!(
        wormholes(&session, 489),
        [wormhole(16, 24, 152, 4.20498, 459.52851)]
    );
}

#[test]
fn wormhole_pairs_are_refused() {
    let mut session = open_4_5();
    let refusals = [
        (add(1, 1), "system 1 cannot be paired with itself"),
        (add(1, 99_999), "system 99999 does not exist"),
        (
            add(1, 489),
            "system 489 already has a natural wormhole of bypass type \"wormhole\", and a system holds one at most",
        ),
        (
            add(24, 1),
            "system 24 already has a natural wormhole of bypass type \"shroud_tunnel\", and a system holds one at most",
        ),
        (
            remove(1, 140),
            "systems 1 and 140 are not the two ends of a wormhole",
        ),
        (
            remove(489, 163),
            "systems 489 and 163 are not the two ends of a wormhole",
        ),
        (
            remove(24, 1),
            "systems 24 and 1 are not the two ends of a wormhole",
        ),
        (remove(99_999, 1), "system 99999 does not exist"),
    ];
    for (op, message) in refusals {
        let error = session.apply(op).expect_err(message);
        assert_eq!(error.to_string(), message);
    }
    assert!(!session.doc.is_dirty());
}

/// The 4.4 sample writes its wormholes as 4.5 does: wormhole 1 stands in system 52,
/// linked to 449.
#[test]
fn wormhole_pairs_in_a_4_4_save() {
    round_trip(open(), add(0, 752));
    round_trip(open(), remove(52, 449));
    let mut session = open();
    session.apply(add(0, 752)).expect("the add");
    assert!(linked(&session.graph, 0, 752));
    session.apply(remove(752, 0)).expect("the removal");
    assert_eq!(current(&session), session.doc.original());
}

#[test]
fn an_added_system_with_a_wormhole_is_not_removed() {
    let mut session = save_with_added();
    session.apply(add(791, 0)).expect("the add");
    let error = session
        .apply(Op::RemoveSystem { id: 791 })
        .expect_err("a wormhole in the way");
    assert_eq!(
        error.to_string(),
        "system 791 has a wormhole: remove the wormhole pair first"
    );
    session.apply(remove(0, 791)).expect("the removal");
    session
        .apply(Op::RemoveSystem { id: 791 })
        .expect("then the system goes");
}

#[test]
fn a_3_x_save_is_refused() {
    for op in [add(0, 1), remove(0, 1)] {
        let error = open_3_4().apply(op).expect_err("a 3.4 save");
        assert!(matches!(error, OpError::SaveTooOld(_)), "{error:?}");
    }
}
