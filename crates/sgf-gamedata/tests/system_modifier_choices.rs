//! The modifiers a scenario system's page offers: those the install's initializers, scripted
//! effects, events and on_actions add with a system as their scope, and those the system's file
//! holds.

use crate::common;

#[test]
fn a_system_is_offered_what_scripts_add_to_a_system_and_nothing_the_nebula_or_a_planet_owns() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let keys = |present: &[String]| -> Vec<String> {
        gd.system_modifier_choices(present)
            .into_iter()
            .map(|choice| choice.modifier)
            .collect()
    };
    let scripted = keys(&[]);
    assert_eq!(
        scripted,
        [
            "instable_astral_scar_modifier",
            "queen_big_scorn_storm",
            "queen_scorn_storm",
            "queen_small_scorn_storm",
            "vluur_storm",
            "voidspawn_system_mod",
            "zroni_storm",
        ]
    );
    let choice = gd
        .system_modifier_choices(&[])
        .into_iter()
        .find(|choice| choice.modifier == "queen_scorn_storm")
        .expect("the storm is offered");
    assert_eq!(choice.view.name, "Veil of Scorn");
    assert!(choice.feature.is_none() && choice.flags.is_empty());

    let present = [
        "turbulent_nebula".to_owned(),
        "pulsar_frying_pan".to_owned(),
        "not_a_modifier".to_owned(),
    ];
    let with_present = keys(&present);
    assert!(
        with_present.iter().any(|k| k == "pulsar_frying_pan"),
        "the file's own modifiers join the list"
    );
    assert!(
        !with_present
            .iter()
            .any(|k| k == "turbulent_nebula" || k == "not_a_modifier"),
        "but not one the nebula owns, nor a key the install does not define"
    );
}

/// Each scope rule on a hand-written install: what a system-scope statement adds counts, what a
/// planet's adds does not.
#[test]
fn the_walk_reads_system_scope_through_calls_prev_root_switch_and_the_iterators() {
    let modifiers = [
        "fx_called",
        "fx_prev",
        "fx_root",
        "fx_switch",
        "fx_random",
        "fx_aura",
        "fx_planet",
    ];
    let static_modifiers: String = modifiers
        .iter()
        .map(|key| format!("{key} = {{ ship_speed_mult = -0.1 }}\n"))
        .collect();
    let (_dir, gd) = common::hand_written(&[
        ("common/static_modifiers/fx.txt", &static_modifiers),
        (
            "common/scripted_effects/fx.txt",
            "fx_add_called = { add_modifier = { modifier = fx_called } }
fx_from_prev = { prev = { add_modifier = { modifier = fx_prev } } }
",
        ),
        (
            "events/fx_calls.txt",
            "namespace = fx
system_event = { id = fx.1 immediate = { fx_add_called = yes } }
",
        ),
        (
            "events/fx_scopes.txt",
            "namespace = fx
country_event = {
	id = fx.2
	immediate = {
		every_system_with_aura = { add_modifier = { modifier = fx_aura } }
	}
}
system_event = {
	id = fx.3
	immediate = {
		owner = { random_owned_planet = { fx_from_prev = yes } }
		random_system_planet = {
			fx_from_prev = yes
			add_modifier = { modifier = fx_planet }
			root = { add_modifier = { modifier = fx_root } }
		}
		switch = { trigger = has_star_flag fx_a = { add_modifier = { modifier = fx_switch } } }
		random = { chance = 50 add_modifier = { modifier = fx_random } }
	}
}
",
        ),
    ]);
    let keys: Vec<String> = gd
        .system_modifier_choices(&[])
        .into_iter()
        .map(|choice| choice.modifier)
        .collect();
    assert_eq!(
        keys,
        [
            "fx_aura",
            "fx_called",
            "fx_prev",
            "fx_random",
            "fx_root",
            "fx_switch"
        ],
        "a file reaching a modifier only through a call counts, `prev` in an effect a planet of \
         the system calls reads the system, and a planet's own modifier does not"
    );
}
