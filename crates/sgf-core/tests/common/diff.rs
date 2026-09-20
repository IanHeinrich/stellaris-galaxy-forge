//! The report the op tests snapshot, and the round trip they assert.
use std::fmt::Write as _;

use sgf_core::ops::Op;
use sgf_core::session::{OpResult, Session};
use sgf_core::views::{DocumentKind, GalaxyView};
use similar::{Algorithm, TextDiff};

use super::current;

/// Description, the systems the op touched, the inverse, the issues that name one of
/// those systems or the galaxy as a whole, and the unified diff (3 lines of context).
pub fn report(session: &Session, result: &OpResult) -> String {
    let mut out = String::new();
    writeln!(out, "{}", result.entry.description).unwrap();
    writeln!(out, "touched: {:?}", result.touched).unwrap();
    writeln!(out, "inverse: {:?}", result.entry.inverse).unwrap();
    let mut others = 0;
    for issue in &result.issues {
        let about_the_galaxy = issue.systems.is_empty();
        if about_the_galaxy || issue.systems.iter().any(|id| result.touched.contains(id)) {
            writeln!(out, "{} {}: {}", issue.severity, issue.code, issue.message).unwrap();
        } else {
            others += 1;
        }
    }
    if others > 0 {
        writeln!(out, "… and {others} other issues").unwrap();
    }
    write!(out, "{}", unified_diff(session)).unwrap();
    out
}

/// Description, inverse and the unified diff, for the ops whose subject is the text they
/// write rather than the systems they touch.
pub fn plain_report(session: &Session, result: &OpResult) -> String {
    let mut out = String::new();
    writeln!(out, "{}", result.entry.description).unwrap();
    writeln!(out, "inverse: {:?}", result.entry.inverse).unwrap();
    write!(out, "{}", unified_diff(session)).unwrap();
    out
}

fn unified_diff(session: &Session) -> String {
    let original = String::from_utf8_lossy(session.doc.original()).into_owned();
    let edited = String::from_utf8_lossy(&current(session)).into_owned();
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(&original, &edited);
    let header = match session.kind() {
        DocumentKind::Save => "gamestate",
        DocumentKind::Scenario => "scenario",
    };
    format!(
        "\n{}",
        diff.unified_diff().context_radius(3).header(header, header)
    )
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

/// Apply `op`, undo it, redo it and undo it again, asserting that each undo puts back the
/// bytes and the galaxy the session was opened with and that redo writes what apply wrote.
pub fn round_trip(mut session: Session, op: Op) {
    let original = session.doc.original().to_vec();
    assert_eq!(
        current(&session),
        original,
        "a round trip starts from the document as it was opened"
    );
    let opened = GalaxyView::from(&session.graph);

    session.apply(op).expect("apply");
    let applied = current(&session);
    assert_ne!(applied, original, "the op changed nothing");

    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), original, "undo is not byte-identical");
    assert_eq!(
        GalaxyView::from(&session.graph),
        opened,
        "undo left a different galaxy"
    );

    session.redo().expect("redo").expect("an op to redo");
    assert_eq!(current(&session), applied, "redo wrote different bytes");

    session.undo().expect("undo again").expect("an op to undo");
    assert_eq!(current(&session), original, "the second undo drifted");
    assert_eq!(
        GalaxyView::from(&session.graph),
        opened,
        "the second undo left a different galaxy"
    );
}
