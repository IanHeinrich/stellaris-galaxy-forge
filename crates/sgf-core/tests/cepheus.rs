//! Index, projection and lane-op invariants on the Stellaris 3.4.5 (Cepheus) sample save,
//! whose `hyperlane` blocks open their brace on the key's line rather than the next one.
use sgf_core::archive;
use sgf_core::document::Document;
use sgf_core::ops::Op;
use sgf_core::projections::galaxy::GalaxyGraph;
use sgf_core::validate::{Severity, validate};

use crate::common;
use common::diff::{plain_report, round_trip_step};
use common::{SAMPLE_3_4, current, open_3_4};

fn load() -> Document {
    Document::load(SAMPLE_3_4).expect("load the 3.4 sample")
}

#[test]
fn index_partitions_the_save_with_no_residue_and_round_trips_it() {
    let doc = load();
    let gaps = doc.index().coverage_gaps(doc.original());
    assert!(gaps.is_empty(), "non-whitespace gaps: {gaps:?}");
    let covered: usize = doc.section_sizes().iter().map(|(_, n)| n).sum();
    let total = doc.original().len();
    assert!(
        covered * 1000 >= total * 999,
        "covered {covered} of {total}"
    );

    let joined: Vec<u8> = doc.pieces().flatten().copied().collect();
    assert_eq!(joined, doc.original());

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("cepheus.sav");
    doc.save_as(&path).expect("save_as");
    let written = archive::read_sav(&path).expect("read back");
    assert_eq!(written.gamestate, doc.original());
    assert_eq!(written.meta, doc.meta());

    let meta = archive::parse_meta(doc.meta()).expect("meta header");
    assert_eq!(meta.version, "Cepheus v3.4.5");
    assert_eq!(meta.date, "2200.04.11");
}

#[test]
fn validator_reports_no_errors() {
    let doc = load();
    let g = GalaxyGraph::build(&doc).unwrap();
    let issues = validate(&g);
    let errors: Vec<_> = issues
        .iter()
        .filter(|i| i.severity == Severity::Error)
        .collect();
    assert!(errors.is_empty(), "{errors:#?}");
}

/// System 0 has a `hyperlane` block; systems 0 and 1 are not linked.
#[test]
fn a_lane_between_two_blocked_systems_is_added_on_both_ends_and_undoes_exactly() {
    let mut session = open_3_4();
    assert!(!session.graph.systems[&0].lanes.is_empty());
    assert!(!session.graph.systems[&1].lanes.is_empty());
    assert!(session.graph.lane(0, 1).is_none());

    let op = Op::AddLane {
        a: 0,
        b: 1,
        bridge: false,
    };
    let applied = round_trip_step(&mut session, "AddLane(0, 1)", op.clone());
    let lane_0_1 = session.graph.lane(0, 1).expect("0 -> 1");
    let lane_1_0 = session.graph.lane(1, 0).expect("1 -> 0");
    assert_eq!(lane_0_1.length, lane_1_0.length);
    assert!(!lane_0_1.bridge);
    common::snapshot("add_lane_0_1", &plain_report(&session, &applied));

    let undone = session.undo().expect("undo").expect("something to undo");
    assert_eq!(undone.entry.description, applied.entry.description);
    assert_eq!(current(&session), session.doc.original());
    assert!(session.graph.lane(0, 1).is_none());
}

/// System 591 has no `hyperlane` block at all: the op must create one in the 4.x shape.
#[test]
fn a_lane_to_a_system_with_no_hyperlane_block_creates_it() {
    let mut session = open_3_4();
    assert!(session.graph.systems[&591].lanes.is_empty());
    assert!(!session.graph.systems[&590].lanes.is_empty());

    let op = Op::AddLane {
        a: 591,
        b: 590,
        bridge: false,
    };
    let applied = round_trip_step(&mut session, "AddLane(591, 590)", op);
    assert_eq!(session.graph.systems[&591].lanes.len(), 1);
    let lane = session.graph.lane(591, 590).expect("591 -> 590");
    assert_eq!(
        session.graph.lane(590, 591).expect("590 -> 591").length,
        lane.length
    );
    common::snapshot(
        "add_lane_to_blockless_system",
        &plain_report(&session, &applied),
    );

    session.undo().expect("undo").expect("something to undo");
    assert_eq!(current(&session), session.doc.original());
    assert!(session.graph.systems[&591].lanes.is_empty());
}

/// The existing lane 0 <-> 398, as `sgf lane remove` refused before the fix.
#[test]
fn removing_an_existing_lane_takes_it_from_both_ends() {
    let mut session = open_3_4();
    assert!(session.graph.lane(0, 398).is_some());

    let op = Op::RemoveLane { a: 0, b: 398 };
    let applied = round_trip_step(&mut session, "RemoveLane(0, 398)", op);
    assert!(session.graph.lane(0, 398).is_none());
    assert!(session.graph.lane(398, 0).is_none());
    common::snapshot("remove_lane_0_398", &plain_report(&session, &applied));

    session.undo().expect("undo").expect("something to undo");
    assert_eq!(current(&session), session.doc.original());
    assert!(session.graph.lane(0, 398).is_some());
}

/// Isolating system 0 takes its whole `hyperlane` block and every neighbour's entry back
/// to it, on the old brace shape.
#[test]
fn isolating_a_system_removes_its_whole_block_and_every_neighbours_entry() {
    let mut session = open_3_4();
    let before = session.graph.systems[&0].clone();
    assert!(!before.lanes.is_empty());

    let op = Op::IsolateSystem { id: 0 };
    let applied = round_trip_step(&mut session, "IsolateSystem(0)", op);
    assert!(session.graph.systems[&0].lanes.is_empty());
    for lane in &before.lanes {
        assert!(session.graph.lane(lane.to, 0).is_none(), "{}", lane.to);
    }
    common::snapshot("isolate_system_0", &plain_report(&session, &applied));

    session.undo().expect("undo").expect("something to undo");
    assert_eq!(current(&session), session.doc.original());
    let mut restored: Vec<_> = session.graph.systems[&0]
        .lanes
        .iter()
        .map(|l| (l.to, l.bridge))
        .collect();
    let mut expected: Vec<_> = before.lanes.iter().map(|l| (l.to, l.bridge)).collect();
    restored.sort_unstable();
    expected.sort_unstable();
    assert_eq!(restored, expected);
}

/// After the edits above, saving to a fresh file and reloading it agrees with the
/// session's own graph, and the reload validates clean.
#[test]
fn edited_bytes_reload_and_validate_clean() {
    let mut session = open_3_4();
    session
        .apply(Op::AddLane {
            a: 0,
            b: 1,
            bridge: false,
        })
        .expect("add 0-1");
    session
        .apply(Op::AddLane {
            a: 591,
            b: 590,
            bridge: false,
        })
        .expect("add 591-590");
    session
        .apply(Op::RemoveLane { a: 0, b: 398 })
        .expect("remove 0-398");
    session
        .apply(Op::IsolateSystem { id: 5 })
        .expect("isolate 5");

    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("cepheus-edited.sav");
    session.save_as(&path).expect("save_as");

    let reloaded = Document::load(&path).expect("reload");
    let graph = GalaxyGraph::build(&reloaded).expect("build galaxy");
    assert_eq!(graph.systems, session.graph.systems);
    assert_eq!(graph.order, session.graph.order);

    let issues = validate(&graph);
    let errors: Vec<_> = issues
        .iter()
        .filter(|i| i.severity == Severity::Error)
        .collect();
    assert!(errors.is_empty(), "{errors:#?}");
}
