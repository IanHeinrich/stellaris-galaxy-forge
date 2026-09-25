//! What each sample save was set up with, read off its setup screen, its player country,
//! its Resource Abundance and its global flags, and their absence on a scenario.
use sgf_core::projections::galaxy::{GameSetup, LGate, LGateOutcome};

use crate::common;
use common::fixture::PAINTED;
use common::{open, open_3_4, open_4_5};

#[test]
fn the_4_4_sample_carries_its_setup_screen_and_player_country() {
    let g = open().graph;
    assert_eq!(
        g.setup,
        Some(GameSetup {
            template: "large".to_owned(),
            shape: "elliptical".to_owned(),
            num_empires: 13,
            num_advanced_empires: 0,
            num_fallen_empires: 3,
            num_marauder_empires: 2,
            num_nomad_empires: 2,
            num_gateways: 1,
            num_wormhole_pairs: 1,
            num_hyperlanes: 0.75,
            primitive: 0.25,
            habitability: 0.25,
            resource_abundance: Some(2.0),
        })
    );
    assert_eq!(g.player_country, Some(0));
}

#[test]
fn each_sample_carries_its_abundance_and_the_l_gate_outcome_it_rolled() {
    let unopened = |outcome| {
        Some(LGate {
            outcome,
            opened: false,
        })
    };
    for (label, session, outcome) in [
        (
            "4.4, with L-Gates but none of the flags",
            open(),
            LGateOutcome::Empty,
        ),
        ("4.5, on day one", open_4_5(), LGateOutcome::GrayTempest),
    ] {
        assert_eq!(session.resource_abundance(), Some(2.0), "{label}");
        assert_eq!(session.graph.lgate, unopened(outcome), "{label}");
    }
    assert_eq!(
        open_3_4().resource_abundance(),
        None,
        "3.4 writes no such key"
    );
}

#[test]
fn a_scenario_carries_none_of_them() {
    let session = PAINTED.open();
    assert_eq!(session.graph.setup, None);
    assert_eq!(session.graph.player_country, None);
    assert_eq!(session.resource_abundance(), None);
}
