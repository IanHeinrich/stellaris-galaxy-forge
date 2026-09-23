//! The L-Gate outcome op on both sample saves: the diff each switch produces is
//! snapshotted, a reload of the edited bytes reads the new outcome, and undo puts the
//! original bytes back.

use sgf_core::ops::{Op, OpError};
use sgf_core::projections::galaxy::{LGate, LGateOutcome};
use sgf_core::session::Session;
use sgf_core::views::DocumentKind;

mod common;
use common::diff::plain_report;
use common::examples;
use common::{SAMPLE_4_5, current, open, open_edited, reprojected};

fn set(outcome: LGateOutcome) -> Op {
    Op::SetLGateOutcome { outcome }
}

fn unopened(outcome: LGateOutcome) -> Option<LGate> {
    Some(LGate {
        outcome,
        opened: false,
    })
}

/// Apply `outcome` to `session`, check the projection and a reload of the bytes both read
/// it, snapshot the diff, then undo and check the original bytes and outcome are back.
fn switch_and_undo(session: &mut Session, outcome: LGateOutcome, snapshot: &str) {
    let before = session.graph.lgate;
    let result = session.apply(set(outcome)).expect("set the outcome");
    assert_eq!(session.graph.lgate, unopened(outcome), "{snapshot}");
    assert_eq!(reprojected(session).lgate, unopened(outcome), "{snapshot}");
    let edit = session.edit_result(result.clone());
    assert_eq!(
        edit.delta.lgate,
        unopened(outcome),
        "{snapshot}: reaches the app"
    );
    common::snapshot(snapshot, &plain_report(session, &result));

    session.undo().expect("undo").expect("something to undo");
    assert_eq!(current(session), session.doc.original(), "{snapshot}: undo");
    assert_eq!(session.graph.lgate, before, "{snapshot}: undo");
}

#[test]
fn the_4_5_samples_gray_tempest_switches_to_each_other_outcome_and_back() {
    let mut session = Session::open(SAMPLE_4_5).expect("open the 4.5 sample");
    assert_eq!(session.graph.lgate, unopened(LGateOutcome::GrayTempest));
    for (outcome, snapshot) in [
        (LGateOutcome::LDrakes, "gray_tempest_to_l_drakes"),
        (
            LGateOutcome::DessanuConsonance,
            "gray_tempest_to_dessanu_consonance",
        ),
        (LGateOutcome::Empty, "gray_tempest_to_empty"),
    ] {
        switch_and_undo(&mut session, outcome, snapshot);
    }

    // The inverse op writes the Tempest's two flags back where they stood.
    let result = session.apply(set(LGateOutcome::LDrakes)).unwrap();
    assert_eq!(
        result.entry.description,
        "Set the L-Gate outcome to L-Drakes"
    );
    assert_eq!(result.inverse, set(LGateOutcome::GrayTempest));
    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(session.graph.lgate, unopened(LGateOutcome::GrayTempest));
}

#[test]
fn the_4_4_samples_empty_cluster_takes_l_drakes() {
    let mut session = open();
    switch_and_undo(&mut session, LGateOutcome::LDrakes, "empty_to_l_drakes");
    session.redo().expect("redo").expect("something to redo");
    assert_eq!(session.graph.lgate, unopened(LGateOutcome::LDrakes));
    assert_eq!(reprojected(&session).lgate, unopened(LGateOutcome::LDrakes));
}

#[test]
fn the_outcome_is_refused_once_a_gate_has_opened_or_where_there_is_none_to_set() {
    let flag = "\tgame_started=62808000\n";
    let mut opened = open_edited(|gamestate| {
        let text = String::from_utf8(std::mem::take(gamestate)).expect("utf-8");
        let edited = text.replacen(flag, &format!("{flag}\tl_cluster_opened=62900000\n"), 1);
        *gamestate = edited.into_bytes();
    });
    assert!(matches!(
        opened.apply(set(LGateOutcome::LDrakes)),
        Err(OpError::LGateOpened)
    ));

    let mut no_gate = open_edited(|gamestate| {
        let text = String::from_utf8(std::mem::take(gamestate)).expect("utf-8");
        *gamestate = text
            .replace("type=\"lgate\"", "type=\"sgf_test\"")
            .into_bytes();
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

    let mut scenario = examples::scenario();
    assert!(matches!(
        scenario.apply(set(LGateOutcome::LDrakes)),
        Err(OpError::Unsupported {
            kind: DocumentKind::Scenario,
            ..
        })
    ));
    for session in [&opened, &no_gate, &unchanged, &scenario] {
        assert!(!session.doc.is_dirty());
    }
}
