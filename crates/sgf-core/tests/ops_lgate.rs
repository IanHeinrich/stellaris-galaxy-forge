//! The L-Gate outcome op on both sample saves: the diff each switch produces is
//! snapshotted, a reload of the edited bytes reads the new outcome, and undo puts the
//! original bytes back.

use sgf_core::ops::{Op, OpError};
use sgf_core::projections::galaxy::{LGate, LGateOutcome};
use sgf_core::session::{OpResult, Session};

use crate::common;
use common::diff::snapshot_step;
use common::{current, open, open_4_5, open_edited, reprojected};

fn set(outcome: LGateOutcome) -> Op {
    Op::SetLGateOutcome { outcome }
}

fn unopened(outcome: LGateOutcome) -> Option<LGate> {
    Some(LGate {
        outcome,
        opened: false,
    })
}

/// Round-trip and snapshot `outcome` on `session`, and check the projection, a reload of
/// the bytes and the app's delta read it.
fn switch(session: &mut Session, outcome: LGateOutcome, snapshot: &str) -> OpResult {
    let result = snapshot_step(session, snapshot, set(outcome));
    assert_eq!(session.graph.lgate, unopened(outcome), "{snapshot}");
    assert_eq!(reprojected(session).lgate, unopened(outcome), "{snapshot}");
    let edit = session.edit_result(result.clone());
    assert_eq!(
        edit.delta.lgate,
        unopened(outcome),
        "{snapshot}: reaches the app"
    );
    result
}

#[test]
fn the_4_5_samples_gray_tempest_switches_to_each_other_outcome_and_back() {
    assert_eq!(open_4_5().graph.lgate, unopened(LGateOutcome::GrayTempest));
    for (outcome, snapshot) in [
        (LGateOutcome::LDrakes, "gray_tempest_to_l_drakes"),
        (
            LGateOutcome::DessanuConsonance,
            "gray_tempest_to_dessanu_consonance",
        ),
        (LGateOutcome::Empty, "gray_tempest_to_empty"),
    ] {
        let mut session = open_4_5();
        let result = switch(&mut session, outcome, snapshot);
        if outcome == LGateOutcome::LDrakes {
            assert_eq!(
                result.entry.description,
                "Set the L-Gate outcome to L-Drakes"
            );
        }
        assert_eq!(result.inverse, set(LGateOutcome::GrayTempest));
        session.apply(result.inverse).unwrap();
        assert_eq!(current(&session), session.doc.original());
        assert_eq!(session.graph.lgate, unopened(LGateOutcome::GrayTempest));
    }
}

#[test]
fn the_4_4_samples_empty_cluster_takes_l_drakes() {
    let mut session = open();
    switch(&mut session, LGateOutcome::LDrakes, "empty_to_l_drakes");
}

#[test]
fn the_outcome_is_refused_once_a_gate_has_opened_or_where_there_is_none_to_set() {
    let flag = "\tgame_started=62808000\n";
    let mut opened = open_edited(|gamestate| {
        *gamestate = gamestate.replacen(flag, &format!("{flag}\tl_cluster_opened=62900000\n"), 1);
    });
    assert!(matches!(
        opened.apply(set(LGateOutcome::LDrakes)),
        Err(OpError::LGateOpened)
    ));

    let mut no_gate = open_edited(|gamestate| {
        *gamestate = gamestate.replace("type=\"lgate\"", "type=\"sgf_test\"");
    });
    assert_eq!(no_gate.graph.lgate, None);
    assert!(matches!(
        no_gate.apply(set(LGateOutcome::LDrakes)),
        Err(OpError::NoLGate)
    ));

    let mut unchanged = open();
    let error = unchanged.apply(set(LGateOutcome::Empty)).unwrap_err();
    assert_eq!(
        error.to_string(),
        "the L-Gate outcome is already Empty cluster"
    );

    for session in [&opened, &no_gate, &unchanged] {
        assert!(!session.doc.is_dirty());
    }
}
