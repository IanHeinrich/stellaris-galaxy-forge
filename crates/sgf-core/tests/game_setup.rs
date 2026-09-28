//! What each sample save was set up with, read off its setup screen, its player country,
//! its Resource Abundance and its global flags, and their absence on a scenario.
use sgf_core::archive::GalaxySettings;
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

/// The settings the game keeps reading after day one, as `settings` holds them.
fn runtime(settings: &GalaxySettings) -> Vec<(&'static str, Option<f64>)> {
    let whole = |n: Option<u32>| n.map(f64::from);
    vec![
        ("crises", settings.crises),
        ("mid_game_start", whole(settings.mid_game_start)),
        ("end_game_start", whole(settings.end_game_start)),
        ("victory_year", whole(settings.victory_year)),
        (
            "storm chance early",
            settings.cosmic_storm_early_game_spawn_chance_scale,
        ),
        (
            "storm chance mid",
            settings.cosmic_storm_mid_game_spawn_chance_scale,
        ),
        (
            "storm chance late",
            settings.cosmic_storm_late_game_spawn_chance_scale,
        ),
        (
            "storm cap early",
            whole(settings.cosmic_storm_early_game_spawn_max_cap),
        ),
        (
            "storm cap mid",
            whole(settings.cosmic_storm_mid_game_spawn_max_cap),
        ),
        (
            "storm cap late",
            whole(settings.cosmic_storm_late_game_spawn_max_cap),
        ),
        ("storm cooldown", settings.cosmic_storm_spawn_cooldown_scale),
        ("storm devastation", settings.cosmic_storm_devastation),
        ("voidworms", settings.voidworms_scaling),
        ("cutholoids", settings.cutholoids_scaling),
        ("fallen empires", settings.fallen_empire_strength_scale),
    ]
}

#[test]
fn each_sample_carries_the_settings_the_game_keeps_reading() {
    for (label, session, crises) in [("4.4", open(), 5.0), ("4.5", open_4_5(), 1.0)] {
        let settings = session.graph.settings.clone().expect("a save's settings");
        assert_eq!(settings.crisis_type.as_deref(), Some("all"), "{label}");
        let expected = [
            crises, 150.0, 225.0, 1050.0, 1.0, 5.0, 1.0, 2.0, 5.0, 8.0, 1.0, 1.0, 1.0, 1.0, 1.0,
        ];
        let read = runtime(&settings);
        for ((key, value), want) in read.iter().zip(expected) {
            assert_eq!(*value, Some(want), "{label} {key}");
        }
    }
    let old = open_3_4()
        .graph
        .settings
        .clone()
        .expect("3.4 writes a galaxy block");
    assert_eq!(old.victory_year, Some(300));
    assert_eq!(
        old.cosmic_storm_devastation, None,
        "3.4 has no cosmic storms"
    );
    assert_eq!(old.cutholoids_scaling, None, "3.4 has no Cutholoids");
}

#[test]
fn each_sample_carries_its_abundance_and_the_l_gate_outcome_it_rolled() {
    let unopened = |outcome| {
        Some(LGate {
            outcome,
            opened: false,
        })
    };
    for (label, session, outcome, kaleidoscope) in [
        (
            "4.4, with L-Gates but none of the flags",
            open(),
            LGateOutcome::Empty,
            true,
        ),
        (
            "4.5, on day one",
            open_4_5(),
            LGateOutcome::GrayTempest,
            false,
        ),
    ] {
        assert_eq!(session.resource_abundance(), Some(2.0), "{label}");
        assert_eq!(session.graph.lgate, unopened(outcome), "{label}");
        assert_eq!(session.graph.kaleidoscope, kaleidoscope, "{label}");
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
    assert_eq!(session.graph.settings, None);
    assert_eq!(session.graph.player_country, None);
    assert_eq!(session.resource_abundance(), None);
    assert!(!session.graph.kaleidoscope);
}
