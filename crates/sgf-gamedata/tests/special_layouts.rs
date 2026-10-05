//! What the special layouts the generator builds by name give: which of an install's layouts
//! count, what a hand-written layout with every feature gives, and the real install's layouts
//! added to the 4.5 sample save.

use crate::common;

use std::collections::BTreeSet;

use sgf_core::ops::Op;
use sgf_gamedata::generate::GenerateError;
use sgf_gamedata::layouts::{
    CONVERTED_LAYOUTS, Eligibility, SaveFacts, Unsupported, odds, special_initializers,
};

use common::layouts::{self, by_name, of};
use common::{INSTALL, SPOT};

#[test]
fn a_hand_written_install_sorts_its_layouts_by_what_they_are_made_of() {
    let (_dir, gd) = layouts::hand_written();
    assert_eq!(of(&gd, "fx_plain"), Eligibility::Plain);
    assert_eq!(
        of(&gd, "fx_haven"),
        Eligibility::Special,
        "dropped flags, event targets and anomalies, and a home planet no one owns"
    );
    assert_eq!(of(&gd, "fx_offcentre"), Eligibility::Special);
    assert_eq!(of(&gd, "fx_hole"), Eligibility::Special);
    let unsupported = |why| Eligibility::Unsupported(why);
    assert_eq!(
        of(&gd, "fx_fleet"),
        unsupported(Unsupported::Effect("create_fleet".to_owned()))
    );
    assert_eq!(of(&gd, "fx_event"), unsupported(Unsupported::EventOnly));
    assert_eq!(of(&gd, "fx_guardian"), unsupported(Unsupported::Guardian));
    assert_eq!(
        of(&gd, "fx_inherit"),
        unsupported(Unsupported::Effect("change_pc".to_owned())),
        "keeping the old model needs entity_planet_class, which the spec lacks"
    );
    assert_eq!(
        of(&gd, "fx_works"),
        Eligibility::Special,
        "blockers, a class change, a model, a loop and a DLC if, and an if that sets a flag"
    );
    assert_eq!(of(&gd, "fx_empire"), unsupported(Unsupported::Usage));
    assert_eq!(
        of(&gd, "fx_cluster"),
        unsupported(Unsupported::EventOnly),
        "odds added only in a cluster, which a new system is not taken to be in"
    );
    assert_eq!(
        of(&gd, "fx_nested"),
        unsupported(Unsupported::Effect("if".to_owned())),
        "a deposit effect under a condition other than a DLC"
    );
    assert_eq!(
        of(&gd, "fx_system_modifier"),
        unsupported(Unsupported::Effect("add_modifier".to_owned())),
        "a modifier on the system, not a body"
    );
    assert_eq!(
        of(&gd, "fx_mismatch"),
        unsupported(Unsupported::StarMismatch("pc_lone".to_owned())),
        "no star class has that star"
    );
    let special: Vec<&str> = special_initializers(&gd)
        .iter()
        .map(|i| i.name.as_str())
        .collect();
    assert_eq!(
        special,
        [
            "fx_forced",
            "fx_haven",
            "fx_hole",
            "fx_named_hole",
            "fx_offcentre",
            "fx_pole",
            "fx_works"
        ]
    );
    assert_eq!(
        by_name(&gd, 1, "Fx", (0.0, 0.0), "fx_fleet"),
        Err(GenerateError::Unsupported(
            "fx_fleet".to_owned(),
            Unsupported::Effect("create_fleet".to_owned())
        ))
    );
    assert_eq!(
        by_name(&gd, 1, "Fx", (0.0, 0.0), "fx_nowhere"),
        Err(GenerateError::UnknownLayout("fx_nowhere".to_owned()))
    );
}

#[test]
fn a_special_layout_gives_its_bodies_names_models_modifiers_rings_and_deposits() {
    let (_dir, gd) = layouts::hand_written();
    let mut listed = BTreeSet::new();
    for seed in 0..60 {
        let spec = by_name(&gd, seed, "Fx", (1.0, 2.0), "fx_haven").expect("a system");
        assert_eq!(
            by_name(&gd, seed, "Fx", (1.0, 2.0), "fx_haven"),
            Ok(spec.clone()),
            "seed {seed}: the same seed gives the same system"
        );
        assert_eq!(spec.name, "NAME_Fx_Haven", "the layout's fixed name");
        assert_eq!(spec.initializer, "fx_haven");
        assert!(spec.capped, "max_instances");
        assert_eq!(
            spec.flags,
            ["fx_haven", "unique_system"],
            "the layout's star flags"
        );
        assert!(spec.star_named_by_class, "a star written as a class");
        assert_eq!(spec.star_class, "sc_sun");
        assert_eq!(
            (spec.star.class.as_str(), spec.star.size),
            ("pc_sun_star", 25)
        );
        assert_eq!(spec.star.name, None);
        assert_eq!(spec.belts.len(), 1);

        let [husk, rocky, colonizable, barren, hole] = &spec.planets[..] else {
            panic!("seed {seed}: five planets, {:?}", spec.planets);
        };
        assert_eq!(husk.class, "pc_husk");
        assert_eq!(husk.name.as_deref(), Some("NAME_Husk"));
        assert_eq!(husk.entity_name.as_deref(), Some("husk_entity"));
        assert_eq!(husk.modifiers, ["fx_mod"]);
        assert_eq!(husk.deposits, ["d_fx_gem"], "set_deposit after the roll");
        assert!(husk.ring, "has_ring = yes");
        assert!(!husk.asteroid);
        assert_eq!(husk.moons.len(), 1);
        let moon = &husk.moons[0];
        assert_eq!(
            (moon.class.as_str(), moon.name.as_deref(), moon.ring),
            ("pc_husk", Some("NAME_Husk_Moon"), false),
            "a list of one"
        );

        assert!(["pc_rock", "pc_meadow"].contains(&rocky.class.as_str()));
        listed.insert(rocky.class.clone());
        assert!(!rocky.ring, "has_ring = no");
        assert_eq!(rocky.name, None);
        assert_eq!(colonizable.class, "pc_meadow", "the one colonizable class");
        assert_eq!(barren.class, "pc_rock", "the one class that is not");
        assert!(barren.moons.iter().all(|m| m.class == "pc_rock" && !m.ring));
        assert_eq!(hole.class, "pc_hole", "a star class as a body");
        assert!((30..=40).contains(&hole.size));
        assert_eq!(
            spec.planets.iter().map(|p| p.orbit).collect::<Vec<_>>(),
            [70.0, 80.0, 90.0, 190.0, 210.0]
        );
    }
    assert_eq!(listed.len(), 2, "both classes of the list come up");
}

#[test]
fn an_off_centre_star_stands_at_its_orbit_once_and_the_planets_count_from_the_centre() {
    let (_dir, gd) = layouts::hand_written();
    for seed in 0..30 {
        let spec = by_name(&gd, seed, "Fx", (0.0, 0.0), "fx_offcentre").expect("a system");
        assert_eq!(spec.name, "Fx", "no fixed name");
        assert!(!spec.capped, "no max_instances");
        assert!(!spec.star_named_by_class);
        assert_eq!(spec.star.orbit, 40.0);
        assert_eq!(
            spec.planets.len(),
            1,
            "seed {seed}: one star however many it counts"
        );
        assert_eq!(spec.planets[0].orbit, 160.0);
    }
}

/// A star block's count is read as 1, as the generator reads it, so a scenario system of the
/// same layout shows one star and the planet at the same orbit.
#[test]
fn a_ranged_star_block_is_one_star_in_a_scenario_as_in_a_generated_system() {
    let (_dir, gd) = layouts::hand_written();
    let details = gd
        .initializer_details(1, "fx_offcentre", None)
        .expect("fx_offcentre");
    let orbits: Vec<(&str, Option<f64>)> = details
        .planets
        .iter()
        .map(|p| {
            let orbit = p.layout.as_ref().and_then(|l| l.orbit).map(|o| o.min);
            (p.class.as_str(), orbit)
        })
        .collect();
    assert_eq!(
        orbits,
        [("pc_sun_star", Some(40.0)), ("pc_rock", Some(160.0))]
    );
}

/// The example roll of a ranged star block places one star, as the details list one.
#[test]
fn a_ranged_star_blocks_example_roll_places_one_star() {
    let (_dir, gd) = layouts::hand_written();
    let roll = gd.system_roll(1, "fx_offcentre", "", 3, 150.0);
    let orbits: Vec<f64> = roll.bodies.iter().map(|b| b.orbit).collect();
    assert_eq!(orbits, [40.0, 160.0]);
}

/// When the game rolls a system's planets, the roll shows the planets the generator rolls
/// for its star class, drawn in until the outermost lies 20 inside the radius asked for.
#[test]
fn a_system_whose_planets_the_game_rolls_shows_the_generators_planets_as_placeholders() {
    let (_dir, gd) = layouts::hand_written();
    for initializer in ["random", "", "fx_nowhere"] {
        assert!(gd.rolls_planets(initializer), "{initializer:?}");
        let roll = gd.system_roll(1, initializer, "sc_sun", 0, 150.0);
        assert!(roll.rolls_planets && roll.bodies.is_empty());
        let orbits: Vec<f64> = roll.placeholders.iter().map(|p| p.orbit).collect();
        assert_eq!(orbits, [80.0, 100.0], "fx_plain's two planets, which fit");
        for planet in &roll.placeholders {
            assert!(["pc_rock", "pc_meadow"].contains(&planet.class.as_str()));
            assert!((10..=20).contains(&planet.size), "{planet:?}");
            assert!((0.0..360.0).contains(&planet.angle));
        }
        assert_eq!(gd.system_roll(1, initializer, "sc_sun", 0, 150.0), roll);
    }
    let tight = gd.system_roll(1, "random", "sc_sun", 0, 70.0);
    let orbits: Vec<f64> = tight.placeholders.iter().map(|p| p.orbit).collect();
    assert_eq!(orbits, [40.0, 50.0], "drawn in to 50, 20 inside 70");
    let unknown = gd.system_roll(1, "random", "sc_nowhere", 0, 150.0);
    assert_eq!(
        unknown.placeholders.len(),
        2,
        "any class when the install lacks it"
    );
    let defined = gd.system_roll(1, "fx_offcentre", "sc_sun", 0, 150.0);
    assert!(!gd.rolls_planets("fx_offcentre"));
    assert!(!defined.rolls_planets && defined.placeholders.is_empty());
}

#[test]
fn a_star_written_as_a_class_takes_the_class_of_the_list_that_has_it() {
    let (_dir, gd) = layouts::hand_written();
    for seed in 0..30 {
        let spec = by_name(&gd, seed, "Fx", (0.0, 0.0), "fx_forced").unwrap();
        assert_eq!(
            (spec.star_class.as_str(), spec.star.class.as_str()),
            ("sc_hole", "pc_hole"),
            "seed {seed}: rl_both's other class has another star"
        );
        assert!(spec.star_named_by_class);
    }
}

#[test]
fn a_layouts_odds_add_and_multiply_what_the_save_decides_and_nothing_else() {
    let (_dir, gd) = layouts::hand_written();
    let layout = |key: &str| gd.initializers.get(key).unwrap();
    let with = |dlcs: &[&str]| SaveFacts {
        dlcs: dlcs.iter().map(|&d| d.to_owned()).collect(),
        ..SaveFacts::default()
    };
    assert_eq!(
        odds(&gd, layout("fx_pole"), None),
        3.0,
        "the DLC taken as there"
    );
    assert_eq!(odds(&gd, layout("fx_pole"), Some(&with(&["Fx Pack"]))), 3.0);
    assert_eq!(odds(&gd, layout("fx_pole"), Some(&with(&[]))), 0.0);
    assert_eq!(odds(&gd, layout("fx_haven"), Some(&with(&[]))), 0.0);
    assert_eq!(
        odds(&gd, layout("fx_haven"), Some(&with(&["Fx Pack"]))),
        3.0
    );
    assert_eq!(
        odds(&gd, layout("fx_cluster"), None),
        0.0,
        "a cluster condition is unmet"
    );
    assert_eq!(odds(&gd, layout("fx_plain"), None), 5.0);
}

#[test]
fn the_real_install_has_the_special_layouts_the_research_found() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let special: BTreeSet<&str> = special_initializers(gd)
        .iter()
        .map(|i| i.name.as_str())
        .collect();
    let group_a = [
        "crystal_manufactory_system",
        "ice_system",
        "oasis_system",
        "old_foes_system",
        "parvus_system",
        "special_init_01",
        "special_init_08",
        "special_init_09",
    ];
    let group_b = [
        "asteroid_system",
        "big_rip_system",
        "collided_planet_system_initializer",
        "debris_belt_initializer",
        "distar_crystal_system",
        "high_energy_system",
        "metal_planet_system_initializer",
        "previously_terraformed_planet_system_initializer",
        "primitive_robot_system",
        "shattered_world_system",
        "star_lifting_system",
        "the_star_mall_initializer",
        "toxic_planet_toxic_moon",
        "superflare_system",
        "trappist_initializer",
        "unique_system_initializer_02",
        "unique_system_initializer_03",
        "unique_system_initializer_04",
        "unique_system_initializer_05",
        "unique_system_initializer_06",
        "unique_system_initializer_07",
        "unique_system_initializer_08",
        "unique_system_initializer_09",
        "wenkwort_initializer",
        "wooden_planet_system_initializer",
    ];
    let converted: Vec<&str> = CONVERTED_LAYOUTS.iter().map(|layout| layout.key).collect();
    assert_eq!(
        special,
        group_a
            .iter()
            .chain(&group_b)
            .chain(&converted)
            .copied()
            .collect(),
        "A and B with odds, less the layouts whose point is their spawn, time loop's shield \
         and relic_system_4's scripted deposits, and the converted layouts"
    );
    let why = |layout: &str| match of(gd, layout) {
        Eligibility::Unsupported(why) => why,
        other => panic!("{layout} is {other:?}"),
    };
    assert_eq!(
        why("fumongus_init_01"),
        Unsupported::Effect("create_tiyanki_country".to_owned())
    );
    assert_eq!(why("binary_init_01"), Unsupported::MultiStar);
    assert_eq!(
        why("time_loop_world_system"),
        Unsupported::Effect("change_pc".to_owned())
    );
    assert_eq!(why("red_giant_lusus"), Unsupported::EventOnly);
    assert_eq!(
        why("ai_system_01"),
        Unsupported::EventOnly,
        "its odds come only from a cluster"
    );
    assert_eq!(
        odds(gd, gd.initializers.get("oasis_system").unwrap(), None),
        15.0
    );
    let oasis = by_name(gd, 1, "Gen", SPOT, "oasis_system").unwrap();
    assert_eq!(
        (oasis.star_class.as_str(), oasis.star.class.as_str()),
        ("sc_m_giant", "pc_m_giant_star"),
        "sc_m in the layout, with a red giant written as its star"
    );
    assert_eq!(why("guardians_init_hatchling"), Unsupported::Guardian);
    assert_eq!(why("dyson_sphere_init_01"), Unsupported::Megastructure);

    let mut session = common::open_4_5();
    for layout in &special {
        for seed in 0..20 {
            let spec = by_name(gd, seed, "Gen", SPOT, layout)
                .unwrap_or_else(|e| panic!("{layout} seed {seed}: {e}"));
            let init = gd.initializers.get(layout).unwrap();
            assert_eq!(spec.capped, init.max_instances.is_some(), "{layout}");
        }
        let mut spec = by_name(gd, 1, "Gen", SPOT, layout).unwrap();
        spec.lanes = vec![169];
        session
            .apply(Op::AddSystemFromSpec { spec })
            .unwrap_or_else(|e| panic!("{layout}: {e}"));
        session.undo().expect("undo the add");
    }
    let capped = |layout: &str| by_name(gd, 1, "Gen", SPOT, layout).unwrap().capped;
    assert!(!capped("special_init_01"));
    let zevox = by_name(gd, 1, "Gen", SPOT, "unique_system_initializer_03");
    assert_eq!(zevox.unwrap().flags, ["unique_system"]);
    assert!(capped("trappist_initializer"));
}
