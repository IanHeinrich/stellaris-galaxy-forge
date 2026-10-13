//! Inline maths written with spaces, `@[ 4 * local ]`, read as a number wherever the install
//! writes one: an initializer's distances, counts and effects, a weight, a star class's odds,
//! a megastructure's offset, the arguments of a scripted effect and the parameters of an
//! `inline_script`.

use crate::common;

use sgf_core::format::save::details::UsageOdds;
use sgf_core::ops::VariableStep;
use sgf_gamedata::body_effects::BodyEffect;
use sgf_gamedata::condition::{Comparison, Condition};
use sgf_gamedata::construction::Effect;
use sgf_gamedata::construction::layout::{Plan, lay_out};
use sgf_gamedata::install::script::Range;
use sgf_gamedata::structure_spawns::WrittenPlace;

const VARIABLES: (&str, &str) = ("common/scripted_variables/00_fx.txt", "@local = 2\n");

const INITIALIZER: &str = "fx_maths = {
	class = sc_sun
	usage = misc_system_init
	usage_odds = @[ 4 * local ]
	inner_radius_offset = @[ local * 3 ]
	outer_radius_offset = @[ local + 4 ]
	spawn_chance = @[ 10 / local ]
	scaled_spawn_chance = @[ ( 1 + local ) * 2 ]
	neighbor_system = { initializer = fx_other distance = @[ 5 * local ] }
	spawn_system = { initializer = fx_far max_distance = @[ 10 * local ] }
	asteroid_belt = { type = rocky_asteroid_belt radius = @[ 30 + 5 ] }
	planet = { class = star orbit_distance = 0 }
	change_orbit = @[ 3 * local ]
	planet = {
		class = pc_rock
		orbit_distance = @[ 4 * local ]
		orbit_angle = @[ 10 * 3 ]
		size = @[ 5 * local ]
		count = @[ 1 + local ]
		init_effect = {
			add_modifier = { modifier = fx_mod days = @[ 10 * local ] }
			while = { count = @[ 1 + local ] add_deposit = d_fx }
		}
	}
	planet = { class = pc_rock init_effect = { set_planet_size = @[ 3 * local ] } }
}
fx_flat = {
	class = sc_sun
	usage = misc_system_init
	usage_odds = 8
	planet = { class = pc_rock orbit_distance = 8 size = 10 count = 3 }
}
";

/// A number an initializer writes as inline maths with spaces is the same as one written
/// without: none of its statements is kept as written for the reader not to have taken.
#[test]
fn an_initializer_reads_inline_maths_written_with_spaces() {
    let (_dir, gd) = common::hand_written(&[
        VARIABLES,
        ("common/solar_system_initializers/00_fx.txt", INITIALIZER),
    ]);
    let init = gd.initializers.get("fx_maths").expect("fx_maths");
    assert_eq!(init.usage_odds, Some(8.0));
    assert_eq!(
        init.spawn_reach,
        [
            ("fx_other".to_owned(), Some(10.0)),
            ("fx_far".to_owned(), Some(20.0))
        ]
    );
    assert_eq!(init.asteroid_belts.len(), 1);
    assert_eq!(init.asteroid_belts[0].radius, Some(Range::fixed(35.0)));

    let rock = &init.planets[1];
    assert_eq!(rock.orbit_distance, Some(Range::fixed(8.0)));
    assert_eq!(rock.orbit_angle, Some(Range::fixed(30.0)));
    assert_eq!(rock.size, Some((10, 10)));
    assert_eq!(rock.count, Range::fixed(3.0));
    assert_eq!(rock.change_orbit, Range::fixed(6.0));
    assert_eq!(
        rock.effects,
        [
            BodyEffect::Modifier("fx_mod".to_owned()),
            BodyEffect::Repeat(3, vec![BodyEffect::AddDeposit("d_fx".to_owned())]),
        ]
    );
    assert_eq!(rock.stated.added_modifiers.len(), 1);
    assert_eq!(rock.stated.added_modifiers[0].days, Some(20.0));
    assert_eq!(init.planets[2].stated.changed_size, Some(6));
    for planet in &init.planets {
        assert!(
            planet.stated.other_keys.is_empty(),
            "{:?}",
            planet.stated.other_keys
        );
    }

    let stated = &init.stated;
    assert_eq!(stated.usage_odds, Some(UsageOdds::Number { value: 8.0 }));
    assert_eq!(stated.inner_radius_offset, Some(6.0));
    assert_eq!(stated.outer_radius_offset, Some(6.0));
    assert_eq!(stated.spawn_chance, Some(5.0));
    assert_eq!(stated.scaled_spawn_chance, Some(6.0));
    assert_eq!(stated.neighbors.len(), 1);
    assert_eq!(stated.neighbors[0].distance, Some(Range::fixed(10.0)));
    let kept: Vec<&str> = stated.other_keys.iter().map(|s| s.key.as_str()).collect();
    assert_eq!(
        kept,
        ["spawn_system"],
        "the one key the reader does not model"
    );

    let flat = gd.initializers.get("fx_flat").expect("fx_flat");
    assert_eq!(flat.usage_odds, Some(8.0));
    assert_eq!(flat.planets[0].orbit_distance, Some(Range::fixed(8.0)));
}

const WEIGHTS: [(&str, &str); 5] = [
    VARIABLES,
    (
        "common/deposits/00_fx.txt",
        "d_fx_scalar = { drop_weight = @[ 2 * local ] }
d_fx_block = {
	drop_weight = {
		weight = @[ 3 * 2 ]
		factor = @[ 1 + 1 ]
		factor = @[ 3 / 2 ]
		modifier = { factor = @[ 2 * 2 ] add = @[ 1 + 1 ] is_planet_class = pc_rock }
		modifier = { weight = @[ 5 * local ] is_planet_class = pc_ice }
	}
}
d_fx_potential = {
	potential = { planet_size < @[ 2 * 10 ] num_modifiers > @[ local + 1 ] }
}
",
    ),
    (
        "common/anomalies/00_fx.txt",
        "fx_cat = { level = @[ 1 + 2 ] spawn_chance = @[ 3 * local ] }\n",
    ),
    (
        "common/planet_modifiers/00_fx.txt",
        "pm_fx = {
	modifier = fx_mod
	spawn_chance = { base = @[ 2 * local ] modifier = { factor = @[ 3 * 1 ] is_planet_class = pc_rock } }
}
",
    ),
    (
        "common/archaeological_site_types/00_fx.txt",
        "fx_site = { stage = { difficulty = @[ 2 * 3 ] } weight = @[ 2 * 3 ] }
fx_unrolled = { stage = { difficulty = 1 } weight = @[ 0 * 3 ] }
",
    ),
];

/// A weight, a chance or a condition written as inline maths with spaces is read as the number
/// it works out to.
#[test]
fn a_weight_and_a_comparison_read_inline_maths_written_with_spaces() {
    let (_dir, gd) = common::hand_written(&WEIGHTS);
    let roll = |key: &str| &gd.deposits.get(key).expect(key).roll;
    let scalar = &roll("d_fx_scalar").drop_weight;
    assert_eq!((scalar.base, scalar.factor), (4.0, 1.0));
    assert!(scalar.modifiers.is_empty());

    let block = &roll("d_fx_block").drop_weight;
    assert_eq!((block.base, block.factor), (6.0, 3.0));
    assert_eq!(block.modifiers.len(), 2);
    let (rock, ice) = (&block.modifiers[0], &block.modifiers[1]);
    assert_eq!(
        (rock.factor, rock.add, rock.weight),
        (Some(4.0), Some(2.0), None)
    );
    assert_eq!(
        rock.when,
        Condition::All(vec![Condition::PlanetClass("pc_rock".to_owned())])
    );
    assert_eq!((ice.factor, ice.add, ice.weight), (None, None, Some(10.0)));
    assert_eq!(
        ice.when,
        Condition::All(vec![Condition::PlanetClass("pc_ice".to_owned())])
    );
    assert_eq!(
        roll("d_fx_potential").potential,
        Some(Condition::All(vec![
            Condition::Size(Comparison::Less, 20.0),
            Condition::Modifiers(Comparison::Greater, 3.0),
        ]))
    );

    let cat = gd.anomaly_categories.get("fx_cat").expect("fx_cat");
    assert_eq!(cat.level, Some(3));
    assert_eq!(cat.spawn_chance.base, 6.0);

    let modifier = gd.planet_modifiers.get("pm_fx").expect("pm_fx");
    assert_eq!(modifier.spawn_chance.base, 4.0);
    assert_eq!(modifier.spawn_chance.modifiers[0].factor, Some(3.0));

    let site = gd.dig_site_types.get("fx_site").expect("fx_site");
    assert_eq!(site.difficulties, [Some(6)]);
    assert!(site.rolled);
    assert!(
        !gd.dig_site_types
            .get("fx_unrolled")
            .expect("fx_unrolled")
            .rolled
    );
}

/// A star class's odds, its planet classes' odds around it and a megastructure's offset are
/// read the same way.
#[test]
fn a_star_class_and_an_offset_read_inline_maths_written_with_spaces() {
    let (_dir, gd) = common::hand_written(&[
        VARIABLES,
        (
            "common/star_classes/00_fx.txt",
            "sc_fx = {
	class = fx_star
	spawn_odds = @[ 4 * local ]
	icon_scale = @[ 1 + 0.5 ]
	num_planets = { min = @[ 2 * 2 ] max = @[ 3 * 3 ] }
	pc_rock = { spawn_odds = @[ 3 * local ] }
	pc_ice = { spawn_odds = 0.5 }
}
",
        ),
        (
            "common/megastructures/00_fx.txt",
            "fx_offset = { entity_offset = { x = @[ 2 * local ] y = @[ -3 * local ] } }\n",
        ),
    ]);
    let star = gd.star_classes.get("sc_fx").expect("sc_fx");
    assert_eq!(star.spawn_odds, 8.0);
    assert_eq!(star.icon_scale, 1.5);
    assert_eq!(star.num_planets, Some(Range { min: 4.0, max: 9.0 }));
    assert_eq!(
        star.planet_odds,
        [("pc_rock".to_owned(), 6.0), ("pc_ice".to_owned(), 0.5)]
    );
    let offset = gd.megastructures.get("fx_offset").expect("fx_offset");
    assert_eq!(offset.entity_offset, (4.0, -6.0));
}

/// A parameter of an `inline_script` written as inline maths, quoted or not, is put into the
/// script's text, and read as a number there.
#[test]
fn an_inline_script_parameter_written_as_inline_maths_is_put_in() {
    let (_dir, gd) = common::hand_written(&[
        VARIABLES,
        (
            "common/inline_scripts/fx/rocks.txt",
            "planet = { class = pc_rock count = $COUNT$ orbit_distance = $DISTANCE$ }\n",
        ),
        (
            "common/solar_system_initializers/00_fx.txt",
            "fx_scripted = {
	class = sc_sun
	inline_script = { script = fx/rocks COUNT = @[ local * 2 ] DISTANCE = @[ 10 + 5 ] }
}
fx_quoted = {
	class = sc_sun
	inline_script = { script = fx/rocks COUNT = \"@[ local * 3 ]\" DISTANCE = @[10+5] }
}
",
        ),
    ]);
    for (key, count) in [("fx_scripted", 4.0), ("fx_quoted", 6.0)] {
        let init = gd.initializers.get(key).expect(key);
        assert_eq!(init.planets.len(), 1, "{key}");
        assert_eq!(init.planets[0].count, Range::fixed(count), "{key}");
        assert_eq!(
            init.planets[0].orbit_distance,
            Some(Range::fixed(15.0)),
            "{key}"
        );
    }
}

/// A megastructure's layout reads the orbit of the rows it spawns, and the arguments of the
/// scripted effects it calls, written as inline maths with spaces.
#[test]
fn a_layout_reads_inline_maths_written_with_spaces() {
    let (_dir, gd) = common::hand_written(&[
        VARIABLES,
        (
            "common/megastructures/mod.txt",
            "mod_spawner = {
	on_build_complete = {
		spawn_megastructure = { type = mod_row orbit_angle = @[ 45 * 2 ] orbit_distance = @[ 10 + local ] }
		mod_spawn_at = { DISTANCE = @[ 2 * local ] ANGLE = 180 }
	}
}
mod_row = { }
",
        ),
        (
            "common/scripted_effects/mod.txt",
            "mod_spawn_at = {
	spawn_megastructure = { type = mod_row orbit_angle = $ANGLE$ orbit_distance = $DISTANCE$ }
}
",
        ),
    ]);
    let layout = lay_out(&gd, "mod_spawner", &Plan::default()).expect("mod_spawner");
    let at: Vec<_> = layout
        .sections
        .iter()
        .map(|s| (s.at.angle, s.at.distance))
        .collect();
    assert_eq!(at, [(90.0, 12.0), (180.0, 4.0)]);
    assert!(layout.unfollowed.is_empty(), "{:?}", layout.unfollowed);
}

/// A construction and a dismantle read the numbers they change a variable by and a modifier's
/// days from inline maths and `@variables`, in the stage's own file, a scripted effect's, an
/// event's and `common/scripted_variables`, and from a parameter passed in.
#[test]
fn a_construction_and_a_dismantle_read_inline_maths_and_variables() {
    let (_dir, gd) = common::hand_written(&[
        VARIABLES,
        (
            "common/megastructures/mod.txt",
            "@stage_days = 3
mod_calc = {
	on_build_start = {
		from = { change_variable = { which = mod_calc_a value = @[ 2 * 3 ] } }
		from = { change_variable = { which = mod_calc_b value = @local } }
	}
	on_build_complete = {
		fromfrom.planet = {
			add_modifier = { modifier = mod_calc_m days = @[ 30 * 2 ] }
			add_modifier = { modifier = mod_calc_v days = @stage_days }
			mod_apply = { DAYS = @[ local * 5 ] }
		}
		from = { country_event = { id = modcalc.1 } }
	}
	on_dismantle_complete = {
		from = { subtract_variable = { which = mod_calc_a value = @[ 2 * local ] } }
	}
}
",
        ),
        (
            "common/scripted_effects/mod.txt",
            "@effect_days = 9
mod_apply = {
	add_modifier = { modifier = mod_calc_p days = $DAYS$ }
	add_modifier = { modifier = mod_calc_f days = @effect_days }
}
",
        ),
        (
            "events/mod.txt",
            "@event_days = 7
namespace = modcalc
country_event = {
	id = modcalc.1
	is_triggered_only = yes
	immediate = {
		fromfromfrom = { solar_system = { add_modifier = { modifier = mod_calc_e days = @[ event_days + local ] } } }
	}
}
",
        ),
    ]);
    let calc = gd.megastructures.get("mod_calc").expect("mod_calc");
    let effects: Vec<&Effect> = calc.construction.steps.iter().map(|s| &s.effect).collect();
    let modifier = |modifier: &str, days: i32| Effect::AddModifier {
        modifier: modifier.to_owned(),
        days,
    };
    let variable = |variable: &str, by: f64| Effect::ChangeVariable {
        variable: variable.to_owned(),
        by,
    };
    assert_eq!(
        effects,
        [
            &variable("mod_calc_a", 6.0),
            &variable("mod_calc_b", 2.0),
            &modifier("mod_calc_m", 60),
            &modifier("mod_calc_v", 3),
            &modifier("mod_calc_p", 10),
            &modifier("mod_calc_f", 9),
            &modifier("mod_calc_e", 9),
        ]
    );
    assert!(
        calc.construction.unfollowed.is_empty(),
        "{:?}",
        calc.construction.unfollowed
    );
    assert_eq!(
        calc.dismantle.variables,
        [VariableStep {
            variable: "mod_calc_a".to_owned(),
            by: 4,
        }]
    );
}

/// A statement the reader does not model is kept whole, including inline maths written with
/// spaces, and so is an orbit it cannot read.
#[test]
fn a_statement_with_spaced_inline_maths_is_kept_as_written() {
    let (_dir, gd) = common::hand_written(&[
        VARIABLES,
        (
            "common/solar_system_initializers/00_fx.txt",
            "fx_kept = {
	class = sc_sun
	fx_unknown_key = @[ 2 * local ]
	planet = {
		class = pc_rock
		fx_unknown_body_key = @[ 3 * local ]
		init_effect = { fx_unknown_effect = @[ 4 * local ] }
	}
	init_effect = {
		spawn_megastructure = { type = fx_gate orbit_distance = @[ 5 * unknown_name ] }
	}
}
",
        ),
    ]);
    let init = gd.initializers.get("fx_kept").expect("fx_kept");
    let texts = |raw: &[sgf_core::format::save::details::RawStatement]| -> Vec<String> {
        raw.iter().map(|r| r.text.clone()).collect()
    };
    assert_eq!(
        texts(&init.stated.other_keys),
        ["fx_unknown_key = @[ 2 * local ]"]
    );
    let body = &init.planets[0].stated;
    assert_eq!(
        texts(&body.other_keys),
        ["fx_unknown_body_key = @[ 3 * local ]"]
    );
    assert_eq!(texts(&body.script), ["fx_unknown_effect = @[ 4 * local ]"]);
    assert_eq!(init.megastructures.len(), 1);
    assert_eq!(
        init.megastructures[0].place,
        WrittenPlace::Unknown("orbit_distance = @[ 5 * unknown_name ]".to_owned())
    );
}
