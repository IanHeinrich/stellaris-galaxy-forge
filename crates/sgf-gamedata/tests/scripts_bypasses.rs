//! The bypasses a scenario's scripts spawn: the pairs a day-one event
//! links, the ends this reader can place, and the ones it can only count.

use crate::common;

use sgf_gamedata::GameData;
use sgf_gamedata::scripts::{BypassKind, BypassSource, ScenarioBypass, ScenarioSystem};

use common::scripts::{install_with_mod, owners, sys};

/// The systems the bypass readers reach: the two ends of the pair the
/// day-one event links, the gateway's system, one whose own initializer
/// spawns a shroud tunnel, and one no bypass touches.
const BYPASSES: [ScenarioSystem<'static>; 5] = [
    sys(40, "wormhole_a_init"),
    sys(41, "wormhole_b_init"),
    sys(42, "gate_flag_init"),
    sys(43, "tunnel_init"),
    sys(44, "basic_init_01"),
];

fn day_one(system: u32, kind: BypassKind, partner: Option<u32>, event: &str) -> ScenarioBypass {
    ScenarioBypass {
        system,
        kind,
        partner,
        source: BypassSource::DayOne {
            event: event.to_owned(),
        },
        assumed: false,
    }
}

#[test]
fn the_day_one_event_links_the_two_systems_its_star_flags_pick_out() {
    let gd = common::cached_fixture_with_mods();
    let found = gd.scenario_bypasses(&BYPASSES);
    assert!(found.with_game_data);

    assert_eq!(
        found.bypasses,
        [
            day_one(40, BypassKind::Wormhole, Some(41), "fixture.8"),
            day_one(41, BypassKind::Wormhole, Some(40), "fixture.8"),
            day_one(42, BypassKind::Gateway { ruined: true }, None, "fixture.9"),
            ScenarioBypass {
                system: 43,
                kind: BypassKind::Other {
                    kind: "shroud_tunnel".to_owned(),
                },
                partner: None,
                source: BypassSource::Initializer {
                    key: "tunnel_init".to_owned(),
                },
                assumed: false,
            },
        ],
        "the plain system carries nothing",
    );
    assert_eq!(found.random_wormhole_pairs, 1, "fixture.10 places one pair");
    assert_eq!(found.open_endpoints, 0, "both ends of the pair are drawn");
    assert_eq!(
        found.random_gateways, 1,
        "fixture.13 spawns through a scope this reader loses: one, wherever it landed",
    );
}

#[test]
fn a_mouth_spawned_back_through_prev_lands_on_the_system_the_loop_came_from() {
    let gd = common::cached_fixture_with_mods();
    let found = gd.scenario_bypasses(&[sys(49, "prev_wormhole_init")]);

    assert_eq!(
        found.bypasses,
        [day_one(49, BypassKind::Wormhole, None, "fixture.12")],
        "fixture.12 spawns inside a second loop, through `prev`",
    );
}

#[test]
fn a_gateway_spawned_through_a_scope_this_reader_cannot_follow_is_counted_not_drawn() {
    let gd = common::cached_fixture_with_mods();
    let found = gd.scenario_bypasses(&[sys(50, "gate_scope_init"), sys(51, "basic_init_01")]);

    assert!(
        found.bypasses.is_empty(),
        "the country's capital is not the system the loop is on: {:#?}",
        found.bypasses,
    );
    assert_eq!(
        found.random_gateways, 1,
        "the loop sweeps two systems, but the spawn is one gateway somewhere else",
    );
}

#[test]
fn the_far_end_is_the_endpoint_the_same_event_spawned_and_never_a_tunnel_beside_it() {
    let gd = common::cached_fixture_with_mods();
    let found = gd.scenario_bypasses(&[sys(40, "wormhole_a_init"), sys(46, "tunnel_b_init")]);

    assert_eq!(
        found.bypasses,
        [
            day_one(40, BypassKind::Wormhole, Some(46), "fixture.8"),
            ScenarioBypass {
                system: 46,
                kind: BypassKind::Other {
                    kind: "shroud_tunnel".to_owned(),
                },
                partner: None,
                source: BypassSource::Initializer {
                    key: "tunnel_b_init".to_owned(),
                },
                assumed: false,
            },
            day_one(46, BypassKind::Wormhole, Some(40), "fixture.8"),
        ],
        "the tunnel keeps to itself",
    );
}

#[test]
fn a_random_loop_that_fits_two_systems_draws_both_and_says_it_is_guessing() {
    let gd = common::cached_fixture_with_mods();
    let found = gd.scenario_bypasses(&[sys(40, "wormhole_a_init"), sys(47, "wormhole_a_init")]);

    assert_eq!(
        found.bypasses,
        [
            ScenarioBypass {
                assumed: true,
                ..day_one(40, BypassKind::Wormhole, None, "fixture.8")
            },
            ScenarioBypass {
                assumed: true,
                ..day_one(47, BypassKind::Wormhole, None, "fixture.8")
            },
        ],
        "a random_system spawns on one of them and this reader cannot say which",
    );
    assert_eq!(found.open_endpoints, 2, "no wh_b system to pair with");
}

#[test]
fn the_vanilla_gate_shape_draws_the_mouth_it_spawns_back_on_its_own_system() {
    let gd = common::cached_fixture_with_mods();
    let found = gd.scenario_bypasses(&[sys(48, "chosen_gate_init")]);

    assert_eq!(
        found.bypasses,
        [ScenarioBypass {
            system: 48,
            kind: BypassKind::Wormhole,
            partner: None,
            source: BypassSource::Initializer {
                key: "chosen_gate_init".to_owned(),
            },
            assumed: false,
        }],
        "the NOR guard names no star flag, so the far end is the random system",
    );
    assert_eq!(found.open_endpoints, 1, "its far end is a system at random");
    assert_eq!(
        found.random_wormhole_pairs, 1,
        "only fixture.10, whose two ends are both elsewhere",
    );
}

#[test]
fn a_pair_the_game_places_where_it_likes_is_counted_and_never_drawn() {
    let gd = common::cached_fixture_with_mods();
    let found = gd.scenario_bypasses(&[sys(44, "basic_init_01")]);

    assert!(found.bypasses.is_empty(), "{:#?}", found.bypasses);
    assert_eq!(
        found.random_wormhole_pairs, 1,
        "both ends of the fixture.10 pair are one pair",
    );
}

#[test]
fn an_initializer_that_links_its_wormhole_to_a_random_system_draws_only_its_own_end() {
    let gd = common::cached_fixture_with_mods();
    let found = gd.scenario_bypasses(&[sys(45, "random_gate_init")]);

    assert_eq!(
        found.bypasses,
        [ScenarioBypass {
            system: 45,
            kind: BypassKind::Wormhole,
            partner: None,
            source: BypassSource::Initializer {
                key: "random_gate_init".to_owned(),
            },
            assumed: false,
        }],
    );
    assert_eq!(
        found.random_wormhole_pairs, 1,
        "only fixture.10; a pair with one end drawn is an open endpoint",
    );
    assert_eq!(found.open_endpoints, 1);
}

#[test]
fn the_bypass_events_claim_nothing_so_the_territories_are_the_ones_they_were() {
    let gd = common::cached_fixture_with_mods();
    assert_eq!(owners(gd).territories.len(), 2);
    assert!(
        gd.scenario_owners(&BYPASSES).territories.is_empty(),
        "no initializer of the bypass scenario gives its system away",
    );
}

/// A mod whose day-one event spawns a wormhole, links it twice over, and
/// spawns beside it in the same scope a tunnel nothing links, and whose
/// initializers carry the star flags the event picks its systems by.
fn linked_spawn_install() -> (tempfile::TempDir, GameData) {
    let initializers = r#"many_wh_a_init = {
	class = sc_sun
	flags = { many_wh_a }
}

many_wh_b_init = {
	class = sc_sun
	flags = { many_wh_b }
}

many_wh_c_init = {
	class = sc_sun
	flags = { many_wh_c }
}
"#;
    let events = r#"namespace = many

event = {
	id = many.1
	is_triggered_only = yes
	immediate = {
		random_system = {
			limit = { has_star_flag = many_wh_a }
			save_event_target_as = many_a_sys
		}
		random_system = {
			limit = { has_star_flag = many_wh_c }
			save_event_target_as = many_c_sys
		}
		random_system = {
			limit = { has_star_flag = many_wh_b }
			spawn_natural_wormhole = {
				bypass_type = wormhole
				random_pos = no
				orbit_angle = 360
			}
			link_wormholes = event_target:many_a_sys
			link_wormholes = event_target:many_c_sys
			spawn_natural_wormhole = {
				bypass_type = shroud_tunnel
				random_pos = no
				orbit_angle = 360
			}
		}
		event_target:many_a_sys = {
			spawn_natural_wormhole = {
				bypass_type = wormhole
				random_pos = no
				orbit_angle = 360
			}
		}
	}
}
"#;
    let on_actions = "on_game_start = {\n\tevents = {\n\t\tmany.1\n\t}\n}\n";
    install_with_mod(&[
        ("common/solar_system_initializers/zz_many.txt", initializers),
        ("events/zz_many.txt", events),
        ("common/on_actions/zz_many.txt", on_actions),
    ])
}

#[test]
fn a_link_wormholes_names_the_far_end_of_the_spawn_it_follows_and_no_other() {
    let (_dir, gd) = linked_spawn_install();
    let found = gd.scenario_bypasses(&[
        sys(60, "many_wh_a_init"),
        sys(61, "many_wh_b_init"),
        sys(62, "many_wh_c_init"),
    ]);

    assert_eq!(
        found.bypasses,
        [
            day_one(60, BypassKind::Wormhole, Some(61), "many.1"),
            day_one(61, BypassKind::Wormhole, Some(60), "many.1"),
            ScenarioBypass {
                kind: BypassKind::Other {
                    kind: "shroud_tunnel".to_owned(),
                },
                ..day_one(61, BypassKind::Wormhole, None, "many.1")
            },
        ],
        "the second link_wormholes speaks for no spawn of its own",
    );
    assert_eq!(
        found.open_endpoints, 0,
        "the tunnel spawned beside the pair is waiting for nothing",
    );
}

#[test]
fn a_wormhole_spawned_inside_a_while_lands_on_the_system_the_initializer_makes() {
    let initializers = r#"many_while_init = {
	class = sc_sun
	init_effect = {
		while = {
			count = 2
			spawn_natural_wormhole = {
				bypass_type = shroud_tunnel
				random_pos = no
				orbit_angle = 360
			}
		}
	}
}
"#;
    let (_dir, gd) =
        install_with_mod(&[("common/solar_system_initializers/zz_many.txt", initializers)]);
    let found = gd.scenario_bypasses(&[sys(62, "many_while_init")]);

    assert_eq!(
        found.bypasses,
        [ScenarioBypass {
            system: 62,
            kind: BypassKind::Other {
                kind: "shroud_tunnel".to_owned(),
            },
            partner: None,
            source: BypassSource::Initializer {
                key: "many_while_init".to_owned(),
            },
            assumed: false,
        }],
        "a `while` body still runs on the system its initializer generates",
    );
    assert_eq!(found.open_endpoints, 0);
    assert_eq!(found.random_wormhole_pairs, 0);
}

#[test]
fn a_target_saved_in_an_events_immediate_names_the_system_the_scope_picked() {
    let initializers = r#"many_keep_init = {
	class = sc_sun
	flags = { many_keep }
}
"#;
    let events = r#"namespace = many

event = {
	id = many.1
	is_triggered_only = yes
	immediate = {
		random_system = {
			limit = { has_star_flag = many_keep }
			save_event_target_as = many_keep_sys
		}
		event_target:many_keep_sys = {
			spawn_natural_wormhole = {
				bypass_type = shroud_tunnel
				random_pos = no
				orbit_angle = 360
			}
		}
	}
}
"#;
    let on_actions = "on_game_start = {\n\tevents = {\n\t\tmany.1\n\t}\n}\n";
    let (_dir, gd) = install_with_mod(&[
        ("common/solar_system_initializers/zz_many.txt", initializers),
        ("events/zz_many.txt", events),
        ("common/on_actions/zz_many.txt", on_actions),
    ]);
    let found = gd.scenario_bypasses(&[sys(70, "many_keep_init")]);

    assert_eq!(
        found.bypasses,
        [day_one(
            70,
            BypassKind::Other {
                kind: "shroud_tunnel".to_owned(),
            },
            None,
            "many.1",
        )],
        "an `immediate` body runs where the event does, so the target names the flagged system",
    );
    assert_eq!(found.open_endpoints, 0);
}
