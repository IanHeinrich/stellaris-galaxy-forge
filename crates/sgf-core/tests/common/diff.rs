//! The report the op tests snapshot, and the round trips they assert.
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

use sgf_core::ops::{NewSystem, Op};
use sgf_core::projections::galaxy::{GalaxyGraph, SystemNode};
use sgf_core::session::{OpResult, Session};
use sgf_core::validate::IssueCode;
use sgf_core::views::{DocumentKind, GalaxyView};
use similar::{Algorithm, TextDiff};

use super::fixture::from_scenario_text;
use super::{current, issues_at_open, reprojected};

/// Description, the systems the op touched, the inverse, the issues that name one of
/// those systems or the galaxy as a whole and were not there, word for word, when the
/// document opened,
/// and the unified diff (3 lines of context).
pub fn report(session: &Session, result: &OpResult) -> String {
    let at_open: BTreeSet<(IssueCode, Vec<u32>, String)> = issues_at_open(session)
        .into_iter()
        .map(|issue| (issue.code, issue.systems, issue.message))
        .collect();
    let mut out = String::new();
    writeln!(out, "{}", result.entry.description).unwrap();
    writeln!(out, "touched: {:?}", result.touched).unwrap();
    writeln!(out, "inverse: {:?}", result.inverse).unwrap();
    let mut others = 0;
    for issue in &result.issues {
        let about_the_galaxy = issue.systems.is_empty();
        if !about_the_galaxy && !issue.systems.iter().any(|id| result.touched.contains(id)) {
            others += 1;
        } else if !at_open.contains(&(issue.code, issue.systems.clone(), issue.message.clone())) {
            writeln!(out, "{} {}: {}", issue.severity, issue.code, issue.message).unwrap();
        }
    }
    if others > 0 {
        writeln!(out, "… and {others} other issues").unwrap();
    }
    write!(out, "{}", unified_diff(session, None)).unwrap();
    out
}

/// Description, inverse and the unified diff, for the ops whose subject is the text they
/// write rather than the systems they touch.
pub fn plain_report(session: &Session, result: &OpResult) -> String {
    let mut out = String::new();
    writeln!(out, "{}", result.entry.description).unwrap();
    writeln!(out, "inverse: {:?}", result.inverse).unwrap();
    write!(out, "{}", unified_diff(session, None)).unwrap();
    out
}

/// The session's edits as a unified diff against the document as it was opened, cut to
/// its first `cap` lines and a count of the rest when a cap is given.
pub fn unified_diff(session: &Session, cap: Option<usize>) -> String {
    let original = String::from_utf8_lossy(session.doc.original()).into_owned();
    let edited = String::from_utf8_lossy(&current(session)).into_owned();
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(&original, &edited);
    let header = match session.kind() {
        DocumentKind::Save => "gamestate",
        DocumentKind::Scenario => "scenario",
    };
    let full = diff
        .unified_diff()
        .context_radius(3)
        .header(header, header)
        .to_string();
    let lines: Vec<&str> = full.lines().collect();
    match cap {
        Some(cap) if lines.len() > cap => format!(
            "\n{}\n… {} more lines",
            lines[..cap].join("\n"),
            lines.len() - cap
        ),
        _ => format!("\n{full}"),
    }
}

/// Snapshot the [`report`] of `op` applied to `session`.
pub fn snapshot(name: &str, mut session: Session, op: Op) {
    let result = session.apply(op).expect("apply");
    super::snapshot(name, &report(&session, &result));
}

/// Snapshot the [`plain_report`] of `op` applied to `session`.
pub fn plain_snapshot(name: &str, mut session: Session, op: Op) {
    let result = session.apply(op).expect("apply");
    super::snapshot(name, &plain_report(&session, &result));
}

/// Apply `op` to the document as it was opened, undo it, redo it and undo it again: see
/// [`round_trip_step`]. The second undo too puts back the bytes and the galaxy the
/// session was opened with, and leaves nothing in the overlay.
pub fn round_trip(mut session: Session, op: Op) {
    let original = session.doc.original().to_vec();
    assert_eq!(
        current(&session),
        original,
        "a round trip starts from the document as it was opened"
    );
    let opened = GalaxyView::from(&session.graph);
    let label = format!("{op:?}");

    round_trip_step(&mut session, &label, op);

    session.undo().expect("undo again").expect("an op to undo");
    assert_eq!(
        current(&session),
        original,
        "{label}: the second undo drifted"
    );
    assert_eq!(
        GalaxyView::from(&session.graph),
        opened,
        "{label}: the second undo left a different galaxy"
    );
    assert!(
        !session.doc.is_dirty(),
        "{label}: undo left slots in the overlay"
    );
}

/// Apply `op` to the session as it stands, undo it and redo it, and leave it applied.
/// Undo puts back the bytes and the galaxy from before, redo writes what apply wrote,
/// each moves one entry between the history's stacks, and after every step the session
/// agrees with a fresh open of its bytes (see [`assert_fresh`]). Returns what the apply
/// returned.
pub fn round_trip_step(session: &mut Session, label: &str, op: Op) -> OpResult {
    let before = current(session);
    let before_graph = session.graph.clone();
    let before_view = GalaxyView::from(&session.graph);
    let done = session.history().undo.len();

    let applied = session.apply(op).unwrap_or_else(|e| panic!("{label}: {e}"));
    let edited = current(session);
    assert_ne!(edited, before, "{label}: the op changed nothing");
    assert!(
        session.is_dirty(),
        "{label}: an edit leaves the session dirty"
    );
    assert_history(session, label, done + 1, 0);
    assert_fresh(session, label);

    let undone = session.undo().expect("undo").expect("an op to undo");
    assert_eq!(undone.entry.description, applied.entry.description);
    assert_eq!(
        current(session),
        before,
        "{label}: undo is not byte-identical"
    );
    assert_eq!(
        GalaxyView::from(&session.graph),
        before_view,
        "{label}: undo left a different galaxy"
    );
    assert_history(session, label, done, 1);
    let undone_label = format!("{label} undone");
    match session.kind() {
        DocumentKind::Save => assert_same_galaxy(&session.graph, &before_graph, &undone_label),
        DocumentKind::Scenario => assert_fresh(session, &undone_label),
    }

    let redone = session.redo().expect("redo").expect("an op to redo");
    assert_eq!(redone.entry.description, applied.entry.description);
    assert_eq!(
        current(session),
        edited,
        "{label}: redo wrote different bytes"
    );
    assert_history(session, label, done + 1, 0);
    assert!(session.redo().expect("redo").is_none());
    assert_fresh(session, &format!("{label} redone"));
    applied
}

fn assert_history(session: &Session, label: &str, undo: usize, redo: usize) {
    let history = session.history();
    assert_eq!(
        (history.undo.len(), history.redo.len()),
        (undo, redo),
        "{label}: undo and redo stacks"
    );
}

/// The session's galaxy is the one a fresh open of its bytes projects. A scenario's index
/// must agree too: what it lists, and the bytes the same follow-up edit writes on both.
pub fn assert_fresh(session: &Session, step: &str) {
    match session.kind() {
        DocumentKind::Save => assert_same_galaxy(&session.graph, &reprojected(session), step),
        DocumentKind::Scenario => {
            let fresh = from_scenario_text(current(session));
            assert_same_galaxy(&session.graph, &fresh.graph, step);
            assert_eq!(index_view(session), index_view(&fresh), "{step}: index");
            let edited =
                Session::from_document(None, session.doc.clone()).expect("project the doc");
            assert_eq!(
                String::from_utf8_lossy(&probed(edited, probe(session))),
                String::from_utf8_lossy(&probed(fresh, probe(session))),
                "{step}: a follow-up edit"
            );
        }
    }
}

fn assert_same_galaxy(now: &GalaxyGraph, then: &GalaxyGraph, step: &str) {
    assert_eq!(now.systems, then.systems, "{step}: systems");
    assert_eq!(now.order, then.order, "{step}: order");
    assert_eq!(now.nebulae, then.nebulae, "{step}: nebulae");
    assert_eq!(now.header.len(), then.header.len(), "{step}: header");
    assert_eq!(now.bypasses, then.bypasses, "{step}: bypasses");
    assert_eq!(now.galaxy_radius, then.galaxy_radius, "{step}: radius");
    assert_eq!(now.core_radius, then.core_radius, "{step}: core radius");
}

/// What a scenario's index says, without the anchors, which differ between an edited
/// document and a fresh open of its bytes.
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
        writeln!(view, "header {} = {}", stmt.field.key, stmt.field.value).unwrap();
    }
    for (id, anchor) in scenario.systems() {
        let bytes = session.doc.current(anchor).expect("the system's bytes");
        writeln!(
            view,
            "system {id}: {}",
            String::from_utf8_lossy(bytes).trim()
        )
        .unwrap();
    }
    for lane in scenario.lane_statements() {
        writeln!(view, "lane {} {} {}", lane.from, lane.to, lane.prevent).unwrap();
    }
    view
}

/// Insertions at the header, among the systems, lanes and nebulae, and a removal, as one
/// edit: every place `session`'s index says a statement goes or stands.
fn probe(session: &Session) -> Op {
    let next = session.graph.systems.keys().max().map_or(1, |max| max + 1);
    let mut ops = vec![
        Op::SetHeaderField {
            key: "sgf_probe".to_owned(),
            value: Some("1".to_owned()),
        },
        Op::AddSystems {
            systems: vec![NewSystem {
                id: next,
                x: 1.0,
                y: 1.0,
                name: None,
                initializer: None,
                spawn_weight: None,
                spawn_script: None,
                statement: None,
            }],
        },
        Op::AddNebula {
            x: 5.0,
            y: 5.0,
            radius: 1.0,
            name: None,
        },
    ];
    if let Some(&first) = session.graph.order.first() {
        ops.push(Op::AddLane {
            a: next,
            b: first,
            bridge: false,
        });
    }
    if !session.graph.order.is_empty() {
        let last = session
            .graph
            .order
            .last()
            .expect("a system for the probe to remove");
        ops.push(Op::RemoveSystem { id: *last });
    }
    Op::Batch {
        description: "Probe".to_owned(),
        ops,
    }
}

fn probed(mut session: Session, probe: Op) -> Vec<u8> {
    session.apply(probe).expect("the probe");
    current(&session)
}

/// Remove `ids`, apply the inverse the removal recorded, and assert the systems stand as
/// they did: each statement's text, and every system as a fresh open of the bytes
/// projects it, lanes in any order since the restored statements land last.
pub fn assert_removal_inverts_exactly(mut session: Session, ids: &[u32]) {
    let statements = |session: &Session| -> Vec<String> {
        let scenario = session.doc.scenario().expect("a scenario");
        ids.iter()
            .map(|&id| {
                let anchor = scenario.system(id).expect("the system");
                let bytes = session.doc.current(anchor).expect("its bytes");
                String::from_utf8_lossy(bytes).trim().to_owned()
            })
            .collect()
    };
    let before = statements(&session);
    let opened = systems(&from_scenario_text(current(&session)));
    let result = session
        .apply(Op::RemoveSystems { ids: ids.to_vec() })
        .expect("remove the systems");
    for id in ids {
        assert!(!session.graph.systems.contains_key(id), "{id} is gone");
    }
    session.apply(result.inverse).expect("apply the inverse");
    assert_eq!(statements(&session), before);
    assert_eq!(systems(&from_scenario_text(current(&session))), opened);
    assert_eq!(systems(&session), opened);
}

fn systems(session: &Session) -> BTreeMap<u32, SystemNode> {
    session
        .graph
        .systems
        .iter()
        .map(|(&id, system)| {
            let mut system = system.clone();
            system.lanes.sort_by_key(|lane| lane.to);
            (id, system)
        })
        .collect()
}
