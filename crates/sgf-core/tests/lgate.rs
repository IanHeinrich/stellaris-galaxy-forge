//! The L-Cluster outcome projected off each sample save's global flags.
use sgf_core::document::Document;
use sgf_core::projections::galaxy::{GalaxyGraph, LGate, LGateOutcome};

use crate::common;
use common::SAMPLE_4_5;

#[test]
fn the_4_5_sample_carries_the_gray_tempest_it_rolled_on_day_one() {
    let doc = Document::load(SAMPLE_4_5).expect("load the 4.5 sample");
    let g = GalaxyGraph::build(&doc).expect("build galaxy");
    assert_eq!(
        g.lgate,
        Some(LGate {
            outcome: LGateOutcome::GrayTempest,
            opened: false,
        })
    );
}

#[test]
fn the_4_4_sample_has_l_gates_but_rolled_none_of_the_flags() {
    let doc = common::load();
    let g = GalaxyGraph::build(&doc).expect("build galaxy");
    assert_eq!(
        g.lgate,
        Some(LGate {
            outcome: LGateOutcome::Empty,
            opened: false,
        })
    );
}
