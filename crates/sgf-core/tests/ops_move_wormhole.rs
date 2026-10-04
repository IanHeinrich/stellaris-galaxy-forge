//! Moving a save's natural wormhole about its system's star, on the 4.x samples: the diff,
//! byte-exact undo, what the details read back, and what is refused.

use sgf_core::format::save::details::{HeuristicResolver, WormholeSummary};
use sgf_core::ops::Op;
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::{current, open, open_4_5};

fn move_wormhole(wormhole: u32, radius: f64, angle: f64) -> Op {
    Op::MoveWormhole {
        wormhole,
        radius,
        angle,
    }
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

/// Wormhole 1 of the 4.5 sample stands in Ferragon (489), linked to Aulderaan (152).
#[test]
fn a_wormhole_moved_about_its_star() {
    let mut session = open_4_5();
    assert_eq!(
        wormholes(&session, 489),
        [wormhole(1, 9, 152, 4.20498, 459.52851)]
    );
    let result = snapshot_step(&mut session, "moved", move_wormhole(1, 300.0, 45.0));
    assert_eq!(
        result.entry.description,
        "Moved the wormhole in Ferragon #489 from 459.55 at 89.48° to 300 at 45°, \
         linked to Aulderaan #152"
    );
    let Op::MoveWormhole {
        wormhole: 1,
        radius,
        angle,
    } = result.inverse
    else {
        panic!("a move back, not {:?}", result.inverse);
    };
    assert!((radius - 459.547_75).abs() < 1e-3, "{radius}");
    assert!((angle - 89.476).abs() < 1e-3, "{angle}");
    assert_eq!(result.details_stale, [489]);
    assert_eq!(
        wormholes(&session, 489),
        [wormhole(1, 9, 152, 212.13203, 212.13203)]
    );
    assert_eq!(
        wormholes(&session, 152),
        [wormhole(2, 10, 489, 57.61222, 347.70984)],
        "the partner stays where it is"
    );

    session.undo().expect("undo").expect("the move");
    assert_eq!(
        wormholes(&session, 489),
        [wormhole(1, 9, 152, 4.20498, 459.52851)]
    );
}

#[test]
fn the_move_back_writes_the_bytes_the_game_wrote() {
    let mut session = open_4_5();
    let result = session
        .apply(move_wormhole(1, 300.0, 45.0))
        .expect("the move");
    session.apply(result.inverse).expect("move it back");
    assert_eq!(current(&session), session.doc.original());
}

/// Details built after the move read the same point as details refreshed by it.
#[test]
fn details_built_after_the_move_read_the_new_point() {
    let mut session = open_4_5();
    session
        .apply(move_wormhole(1, 120.0, 200.0))
        .expect("the move");
    let refreshed = wormholes(&session, 489);
    let rebuilt = Session::from_document(None, session.doc.clone()).expect("project the doc");
    assert_eq!(wormholes(&rebuilt, 489), refreshed);
    assert_eq!(refreshed[0].x, -112.76311);
    assert_eq!(refreshed[0].y, -41.04242);
}

#[test]
fn a_shroud_tunnel_is_listed_but_not_moved() {
    let mut session = open_4_5();
    assert_eq!(
        wormholes(&session, 24),
        [WormholeSummary {
            id: 0,
            bypass: 1,
            kind: "shroud_tunnel".to_owned(),
            partner: None,
            x: -190.855,
            y: 0.2261,
        }]
    );
    let error = session
        .apply(move_wormhole(0, 100.0, 0.0))
        .expect_err("a shroud tunnel");
    assert_eq!(
        error.to_string(),
        "natural wormhole 0 has bypass type \"shroud_tunnel\": only a wormhole can be moved"
    );
    assert!(!session.doc.is_dirty());
}

#[test]
fn wormhole_moves_are_refused() {
    let mut session = open_4_5();
    let refusals = [
        (
            move_wormhole(99, 100.0, 0.0),
            "natural wormhole 99 does not exist",
        ),
        (
            move_wormhole(1, 0.0, 0.0),
            "radius 0 is invalid: a wormhole's distance from the star must be greater than zero",
        ),
        (
            move_wormhole(1, f64::NAN, 0.0),
            "value is not a finite number",
        ),
        (
            move_wormhole(1, 100.0, f64::INFINITY),
            "value is not a finite number",
        ),
    ];
    common::assert_refusals(&mut session, refusals);
}

#[test]
fn a_move_to_where_the_wormhole_stands_is_refused() {
    let mut session = open_4_5();
    session
        .apply(move_wormhole(1, 300.0, 45.0))
        .expect("the first move");
    let error = session
        .apply(move_wormhole(1, 300.0, 405.0))
        .expect_err("already there");
    assert_eq!(error.to_string(), "wormhole 1 already stands there");
    assert_eq!(session.history().undo.len(), 1);
}

/// The 4.4 sample writes its wormholes as 4.5 does: wormhole 1 stands in system 52,
/// linked to 449.
#[test]
fn a_wormhole_moves_in_a_4_4_save() {
    let session = open();
    assert_eq!(
        wormholes(&session, 52),
        [wormhole(1, 15, 449, 449.82037, 114.12239)]
    );
    round_trip(open(), move_wormhole(1, 300.0, 45.0));
    let mut session = open();
    session
        .apply(move_wormhole(1, 300.0, 45.0))
        .expect("the move");
    assert_eq!(
        wormholes(&session, 52),
        [wormhole(1, 15, 449, 212.13203, 212.13203)]
    );
}
