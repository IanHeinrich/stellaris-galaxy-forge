//! The save's setup screen and player country, and their absence on a scenario.
use sgf_core::projections::galaxy::{GalaxyGraph, GameSetup};

use crate::common;
use common::fixture::PAINTED;
use common::load;

#[test]
fn the_sample_save_carries_its_setup_screen_and_player_country() {
    let doc = load();
    let g = GalaxyGraph::build(&doc).expect("build galaxy");

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
fn a_scenario_carries_neither() {
    let session = PAINTED.open();
    assert_eq!(session.graph.setup, None);
    assert_eq!(session.graph.player_country, None);
}
