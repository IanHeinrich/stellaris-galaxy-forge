//! Waystations and the waylines between them, projected from a synthetic save, from the
//! scenario fixture and from a real 4.4 save that holds three networks.
use std::path::{Path, PathBuf};

use sgf_core::archive;
use sgf_core::ops::Op;
use sgf_core::session::Session;
use sgf_core::synth::{self, SynthOptions};
use sgf_core::views::GalaxyView;

mod common;
use common::fixture::GRAMMAR;

/// Names a local 4.4 save holding three waystation networks, the third being three
/// stations on a chain of two lanes (systems 20, 577, 236); the test that reads it skips
/// when the variable is unset, as the corpus tests do.
const REAL_SAVE_VAR: &str = "SGF_WAYSTATION_SAVE";

/// A 12-system synthetic save holding one network of `network`, opened as a session.
fn synth_session(path: &Path, network: &[u32]) -> Session {
    let generated = synth::galaxy(&SynthOptions {
        systems: 12,
        seed: 1,
        waystation_networks: vec![network.to_vec()],
    })
    .expect("generate the synthetic galaxy");
    archive::write_sav(
        path,
        std::iter::once(generated.gamestate.as_slice()),
        &generated.meta,
    )
    .expect("write the synthetic save");
    Session::open(path).expect("open the synthetic save")
}

fn pairs(session: &Session) -> Vec<(u32, u32, u32)> {
    session
        .graph
        .waylines
        .iter()
        .map(|w| (w.a, w.b, w.network))
        .collect()
}

#[test]
fn a_network_runs_a_wayline_along_each_lane_it_holds() {
    let dir = tempfile::tempdir().unwrap();
    let session = synth_session(&dir.path().join("synth.sav"), &[3, 7, 9]);

    let stations: Vec<(u32, u32, u32)> = session
        .graph
        .waystations
        .iter()
        .map(|w| (w.system, w.starbase, w.network))
        .collect();
    assert_eq!(stations, [(3, 0, 0), (7, 1, 0), (9, 2, 0)]);
    // 3 and 9 are not linked, so the network runs two segments, not three.
    assert_eq!(pairs(&session), [(3, 7, 0), (7, 9, 0)]);

    let view = GalaxyView::from(&session.graph);
    assert_eq!(view.waystations, session.graph.waystations);
    assert_eq!(view.waylines, session.graph.waylines);
}

#[test]
fn cutting_a_wayline_lane_reports_the_shorter_list_and_says_so() {
    let dir = tempfile::tempdir().unwrap();
    let mut session = synth_session(&dir.path().join("synth.sav"), &[3, 7, 9]);

    let result = session
        .apply(Op::RemoveLane { a: 3, b: 7 })
        .expect("remove");
    let description = result.entry.description.clone();
    let delta = session.edit_result(result).delta;
    assert!(
        description.ends_with("; the wayline between them ends"),
        "{description}"
    );
    assert_eq!(
        delta.waylines.as_deref(),
        Some(
            &[sgf_core::projections::galaxy::Wayline {
                a: 7,
                b: 9,
                network: 0
            }][..]
        )
    );
    assert_eq!(pairs(&session), [(7, 9, 0)]);

    let undone = session.undo().expect("undo").expect("an op to undo");
    let delta = session.edit_result(undone).delta;
    assert_eq!(delta.waylines.map(|w| w.len()), Some(2));
    assert_eq!(pairs(&session), [(3, 7, 0), (7, 9, 0)]);
}

#[test]
fn a_lane_removed_elsewhere_leaves_the_waylines_out_of_the_delta() {
    let dir = tempfile::tempdir().unwrap();
    let mut session = synth_session(&dir.path().join("synth.sav"), &[3, 7, 9]);

    let stations = [3u32, 7, 9];
    let (a, b) = session
        .graph
        .systems
        .values()
        .flat_map(|s| s.lanes.iter().map(move |l| (s.id, l.to)))
        .filter(|(a, b)| !stations.contains(a) && !stations.contains(b))
        .min()
        .expect("a lane between two systems holding no waystation");

    let result = session.apply(Op::RemoveLane { a, b }).expect("remove");
    let description = result.entry.description.clone();
    let delta = session.edit_result(result).delta;
    assert!(!description.contains("wayline"), "{description}");
    assert_eq!(delta.waylines, None);
    assert_eq!(pairs(&session), [(3, 7, 0), (7, 9, 0)]);
}

#[test]
fn a_scenario_holds_no_waystations() {
    let session = GRAMMAR.open();
    assert!(session.graph.waystations.is_empty());
    assert!(session.graph.waylines.is_empty());
    let view = GalaxyView::from(&session.graph);
    assert!(view.waystations.is_empty());
    assert!(view.waylines.is_empty());
}

#[test]
fn the_real_save_runs_two_segments_in_its_third_network() {
    let Some(path) = std::env::var_os(REAL_SAVE_VAR).map(PathBuf::from) else {
        println!("skipped: {REAL_SAVE_VAR} unset");
        return;
    };
    if !path.is_file() {
        println!("skipped: {REAL_SAVE_VAR} is not a file");
        return;
    }
    let session = Session::open(&path).expect("open the real save");

    let network: Vec<(u32, u32, u32)> = session
        .graph
        .waystations
        .iter()
        .filter(|w| w.network == 2)
        .map(|w| (w.system, w.starbase, w.network))
        .collect();
    assert_eq!(network, [(20, 71, 2), (236, 73, 2), (577, 72, 2)]);

    let waylines: Vec<(u32, u32)> = session
        .graph
        .waylines
        .iter()
        .filter(|w| w.network == 2)
        .map(|w| (w.a, w.b))
        .collect();
    // 20 and 236 are not connected, so the network shows two segments through 577.
    assert_eq!(waylines, [(20, 577), (236, 577)]);
}
