//! What the special layouts the generator builds by name give: which of an install's layouts
//! count, what a hand-written layout with every feature gives, and the real install's layouts
//! added to the 4.5 sample save.

use crate::common;

use std::collections::BTreeSet;

use sgf_core::ops::{Op, SystemSpec};
use sgf_core::session::Session;
use sgf_gamedata::GameData;
use sgf_gamedata::generate::{GenerateError, generate_layout_for};
use sgf_gamedata::initializers::InitPlanet;
use sgf_gamedata::install::script::Range;
use sgf_gamedata::layouts::{
    CONVERTED_LAYOUTS, Eligibility, SaveFacts, Unsupported, eligibility, odds, special_initializers,
};
use sgf_gamedata::menu::special_layouts;

use common::layouts::{self, by_name};
use common::{ABUNDANCE, INSTALL, SPOT};

fn of(gd: &GameData, layout: &str) -> Eligibility {
    eligibility(gd, gd.initializers.get(layout).expect(layout))
}

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
            assert_eq!(
                by_name(gd, seed, "Gen", SPOT, layout),
                Ok(spec.clone()),
                "{layout} seed {seed}"
            );
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

/// The point nearest [`SPOT`], on a grid, that stands 10 from every system of `session`.
fn free_ground(session: &Session) -> (f64, f64) {
    let clear = |(x, y): (f64, f64)| {
        session
            .graph()
            .systems
            .values()
            .all(|s| (s.x - x).hypot(s.y - y) >= 10.0)
    };
    let mut grid: Vec<(f64, f64)> = (-8..=8)
        .flat_map(|i| (-8..=8).map(move |j| (f64::from(i) * 11.0, f64::from(j) * 11.0)))
        .collect();
    grid.sort_by(|a, b| a.0.hypot(a.1).total_cmp(&b.0.hypot(b.1)));
    grid.into_iter()
        .map(|(dx, dy)| (SPOT.0 + dx, SPOT.1 + dy))
        .find(|&at| clear(at))
        .expect("free ground near the spot")
}

/// The label the install's own localisation gives each of [`CONVERTED_LAYOUTS`], which only
/// the real install can settle.
const LABELS: [(&str, &str); 14] = [
    ("sol_system_initializer", "Sol"),
    ("new_bratulla_initializer", "New Bratulla"),
    ("special_init_06", "Zanaam"),
    ("great_wound_system", "Great Wound"),
    ("breachsealer_system", "Seddom"),
    ("vultaumar_system", "Vultaumar"),
    ("fen_habbanis_system", "Fen Habbanis"),
    ("irass_system", "Irass"),
    ("last_baol_system", "Grunur"),
    ("sol_neighbor_t1", "Barnard's Star"),
    ("hostile_init_16", "Tiyana Vek"),
    ("hostile_init_21", "Tiyun Ort"),
    ("holibrae_initializer", "Holibrae"),
    ("the_chosen_escapee_initializer", "Ophala"),
];

fn label_of(key: &str) -> &'static str {
    LABELS
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, label)| *label)
        .unwrap_or_else(|| panic!("no label recorded for {key}"))
}

#[test]
fn converted_layouts_come_without_their_empires_civilisations_and_story_flags() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let keys: BTreeSet<&str> = CONVERTED_LAYOUTS.iter().map(|layout| layout.key).collect();
    for key in &keys {
        assert_eq!(of(gd, key), Eligibility::Special, "{key}");
    }
    for other in [
        "sanctuary_system",
        "cybrex_beta",
        "unique_system_initializer_01",
        "pre_ftl_init_sol",
        "com_sol_system",
        "special_init_04",
        "neighbor_t2",
        "ai_system_01",
        "the_chosen_home_initializer",
        "Zrocursor_system",
        "legendary_leader_last_site",
        "chrysanthemum_tomb_system",
    ] {
        assert!(
            matches!(of(gd, other), Eligibility::Unsupported(_)),
            "{other} is {:?}",
            of(gd, other)
        );
    }

    let mut session = common::open_4_5();
    let entries = special_layouts(gd, &session);
    let menu: Vec<(&str, &str, bool)> = entries
        .iter()
        .filter(|e| keys.contains(e.key.as_str()))
        .map(|e| (e.key.as_str(), e.label.as_str(), e.unique))
        .collect();
    let mut expected: Vec<(&str, &str, bool)> = CONVERTED_LAYOUTS
        .iter()
        .map(|layout| (layout.key, label_of(layout.key), layout.unique))
        .collect();
    expected.sort_by_key(|&(key, label, _)| (label, key));
    assert_eq!(
        menu, expected,
        "by label, Sol alone with the unique systems"
    );

    let findings = |session: &Session| -> BTreeSet<(String, Vec<u32>, String)> {
        session
            .validate()
            .into_iter()
            .map(|issue| (issue.code.to_string(), issue.systems, issue.message))
            .collect()
    };
    let before = findings(&session);
    let known: BTreeSet<u32> = session.graph().systems.keys().copied().collect();
    for layout in &CONVERTED_LAYOUTS {
        let key = layout.key;
        let mut spec = by_name(gd, 1, "Gen", free_ground(&session), key).unwrap();
        let unique = gd
            .initializers
            .get(key)
            .unwrap()
            .flags
            .iter()
            .any(|f| f == "unique_system");
        let kept: Vec<&str> = layout
            .flags
            .iter()
            .copied()
            .chain(unique.then_some("unique_system"))
            .collect();
        assert_eq!(spec.flags, kept, "{key}: no story flags");
        spec.lanes = vec![169];
        session
            .apply(Op::AddSystemFromSpec { spec })
            .unwrap_or_else(|e| panic!("{key}: {e}"));
    }

    let spec = by_name(gd, 1, "Gen", SPOT, "sol_system_initializer").unwrap();
    assert_eq!(spec.name, "NAME_Sol");
    let earth = spec
        .planets
        .iter()
        .find(|p| p.name.as_deref() == Some("NAME_Earth"))
        .expect("Earth");
    assert_eq!(earth.class, "pc_continental");
    assert_eq!(
        earth.entity_name.as_deref(),
        Some("continental_planet_earth_entity")
    );
    let moons: Vec<Option<&str>> = earth.moons.iter().map(|m| m.name.as_deref()).collect();
    assert_eq!(moons, [Some("NAME_Luna")]);
    for seed in 0..20 {
        let spec = by_name(gd, seed, "Gen", SPOT, "sol_system_initializer").unwrap();
        let earth = spec
            .planets
            .iter()
            .find(|p| p.name.as_deref() == Some("NAME_Earth"))
            .expect("Earth");
        assert!(
            !earth.deposits.is_empty(),
            "seed {seed}: Earth rolls deposits"
        );
        assert!(
            earth.deposits.iter().all(|d| !gd.is_blocker(d)),
            "seed {seed}: deposit_blockers = none: {:?}",
            earth.deposits
        );
    }

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("converted.sav");
    session.save_as(&path).expect("save");
    let reopened = Session::open(&path).expect("reopen");
    assert_eq!(findings(&reopened), before);
    let details = reopened.details().expect("details");
    let added: Vec<u32> = reopened
        .graph()
        .systems
        .keys()
        .copied()
        .filter(|id| !known.contains(id))
        .collect();
    let layouts: BTreeSet<&str> = added
        .iter()
        .map(|&id| reopened.system(id).unwrap().initializer.as_str())
        .collect();
    assert_eq!(layouts, keys);
    for id in added {
        let initializer = &reopened.system(id).unwrap().initializer;
        let system = details.raw(id).expect("details");
        assert!(system.starbases.is_empty(), "{initializer}: a starbase");
        assert!(system.fleets.is_empty(), "{initializer}: a fleet");
        for planet in &system.planets {
            assert!(
                !planet.colonised && !planet.pre_ftl && planet.owner.is_none() && planet.pops == 0,
                "{initializer}: {} is owned or lived on",
                planet.name_key
            );
        }
    }
}

/// A body whose class the install makes a star is marked a star, as the system's own star
/// is, so the core writes it with a star's carrier flags whatever the class is called.
#[test]
fn a_body_of_a_star_class_is_marked_a_star() {
    let (_dir, gd) = layouts::hand_written();
    let spec = by_name(&gd, 1, "Fx", (1.0, 2.0), "fx_haven").unwrap();
    assert!(spec.star.star, "the system's own star");
    let marked: Vec<(&str, bool)> = spec
        .planets
        .iter()
        .flat_map(|planet| std::iter::once(planet).chain(&planet.moons))
        .map(|body| (body.class.as_str(), body.star))
        .collect();
    assert!(marked.contains(&("pc_hole", true)), "{marked:?}");
    assert!(
        marked
            .iter()
            .all(|&(class, star)| star == (class == "pc_hole")),
        "{marked:?}"
    );
}

/// Barnard's Star gives its planets no `orbit_angle`. The game's own, system 614 of the 4.4
/// sample, has them at angles scattered about the star, so each one is drawn.
#[test]
fn planets_with_no_orbit_angle_do_not_line_up() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let mut checked = 0;
    for seed in 0..20 {
        let spec = by_name(gd, seed, "Gen", SPOT, "sol_neighbor_t1").unwrap();
        let lines: Vec<f64> = spec
            .planets
            .iter()
            .map(|p| p.angle.rem_euclid(180.0))
            .collect();
        if lines.len() < 3 {
            continue;
        }
        checked += 1;
        let first = lines[0];
        assert!(
            lines.iter().any(|a| {
                let apart = (a - first).abs();
                apart.min(180.0 - apart) > 1.0
            }),
            "seed {seed}: every planet on one line through the star: {lines:?}"
        );
    }
    assert!(checked > 0);
}

/// The black hole layout gives its broken world and its cold barren world no
/// `orbit_distance`, and the debris belt its molten world. Each lies 10 to 20 past the
/// running orbit, as the game places them, and the bodies after it move out with it.
#[test]
fn a_body_with_no_orbit_distance_is_rolled_10_to_20_past_the_running_orbit() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let band = |orbit: f64, running: f64| (running + 10.0..=running + 20.0).contains(&orbit);
    for seed in 0..20 {
        let hole = by_name(gd, seed, "Gen", SPOT, "special_init_01").unwrap();
        let mut running = 60.0;
        for planet in &hole.planets {
            if planet.class == "pc_barren_cold" {
                running += 30.0;
            }
            assert!(
                band(planet.orbit, running),
                "seed {seed}: {} at {}, running orbit {running}",
                planet.class,
                planet.orbit
            );
            running = planet.orbit;
        }

        let debris = by_name(gd, seed, "Gen", SPOT, "debris_belt_initializer").unwrap();
        let (molten, cabin) = (&debris.planets[0], &debris.planets[1]);
        assert_eq!(molten.class, "pc_molten");
        assert!(
            band(molten.orbit, 60.0),
            "seed {seed}: molten world at {}",
            molten.orbit
        );
        assert_eq!(
            cabin.orbit,
            molten.orbit + 86.0,
            "seed {seed}: The Cabin lies its change_orbit and distance past the molten world"
        );

        for spec in [&hole, &debris] {
            let orbits: Vec<f64> = spec.planets.iter().map(|p| p.orbit).collect();
            assert!(
                orbits.first().is_none_or(|&first| first > 0.0),
                "seed {seed}: {} has a planet on the star: {orbits:?}",
                spec.initializer
            );
            assert!(
                orbits.windows(2).all(|pair| pair[1] > pair[0]),
                "seed {seed}: {} has a planet on the orbit before it: {orbits:?}",
                spec.initializer
            );
        }
    }
}

/// Each moon lies its `orbit_angle` on from the moon before it, and the first moon its
/// `orbit_angle` on from 180°. Sol's Jupiter has four moons with fixed angles, and
/// `basic_init_03`'s gas giants one to four at 90° to 270°.
#[test]
fn each_moon_turns_on_from_the_moon_before() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let mut checked = 0;
    for layout in ["sol_system_initializer", "basic_init_03"] {
        let init = gd.initializers.get(layout).unwrap();
        for seed in 0..20 {
            let spec = by_name(gd, seed, "Gen", SPOT, layout).unwrap();
            for planet in spec.planets.iter().filter(|p| !p.moons.is_empty()) {
                let block = init
                    .planets
                    .iter()
                    .find(|b| match &planet.name {
                        Some(name) => b.name.as_ref() == Some(name),
                        None => b.class.written() == planet.class,
                    })
                    .unwrap_or_else(|| panic!("{layout}: no block for {}", planet.class));
                let ranges = moon_angles(block, planet.moons.len());
                let mut from = 180.0;
                for (n, (moon, range)) in planet.moons.iter().zip(ranges).enumerate() {
                    assert!(
                        turned(from, moon.angle, range),
                        "{layout} seed {seed}: moon {n} of {} at {}°, {range:?} on from {from}°",
                        planet.class,
                        moon.angle
                    );
                    from = moon.angle;
                    checked += 1;
                }
            }
        }
    }
    assert!(checked > 100, "{checked} moons");
}

/// A system whose first planet has a fixed count and angle has that planet at 180° plus the
/// star's `orbit_angle` and its own. Sol fixes every body's angle.
#[test]
fn the_planets_turn_on_from_180_degrees() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let sol = gd.initializers.get("sol_system_initializer").unwrap();
    for seed in 0..5 {
        let spec = by_name(gd, seed, "Gen", SPOT, "sol_system_initializer").unwrap();
        let bodies = std::iter::once(&spec.star).chain(&spec.planets);
        assert_eq!(sol.planets.len(), 1 + spec.planets.len());
        let mut from = 180.0;
        for (body, block) in bodies.zip(&sol.planets) {
            let range = block.orbit_angle.expect("Sol gives every body an angle");
            assert!(
                turned(from, body.angle, range),
                "seed {seed}: {:?} at {}°, {range:?} on from {from}°",
                body.name,
                body.angle
            );
            from = body.angle;
        }
    }
}

/// Whether `to` lies `range` on from `from`, in degrees.
fn turned(from: f64, to: f64, range: Range) -> bool {
    let turn = (to - from - range.min).rem_euclid(360.0);
    turn <= range.max - range.min + 0.01 || turn >= 359.99
}

/// The `orbit_angle` of each of `moons` moons `block` spawns.
fn moon_angles(block: &InitPlanet, moons: usize) -> Vec<Range> {
    let angle = |moon: &InitPlanet| moon.orbit_angle.expect("a moon with an angle");
    match block.moons.as_slice() {
        [only] => vec![angle(only); moons],
        several => several
            .iter()
            .map(|moon| {
                assert_eq!(moon.count, Range::fixed(1.0));
                angle(moon)
            })
            .collect(),
    }
}

#[test]
fn a_bodys_blockers_class_model_and_dlc_branches_run_in_order() {
    let (_dir, gd) = layouts::hand_written();
    let gem = || "d_fx_gem".to_owned();
    let block = || "d_fx_block".to_owned();
    let pack = SaveFacts {
        dlcs: ["Fx Pack".to_owned()].into(),
        ..SaveFacts::default()
    };
    let with_pack =
        generate_layout_for(&gd, &pack, 1, "Fx", (0.0, 0.0), "fx_works", ABUNDANCE).unwrap();
    let rock = &with_pack.planets[0];
    assert_eq!(
        rock.deposits,
        [gem(), block(), gem(), gem(), gem()],
        "clear_blockers took the first blocker, add_blocker put one back, the loop ran three times"
    );
    assert_eq!(rock.class, "pc_meadow", "with the DLC");
    assert_eq!(rock.entity_name.as_deref(), Some("fx_meadow_entity"));
    assert!(rock.modifiers.is_empty());
    assert_eq!(
        rock.moons.len(),
        1,
        "a planet written inside a planet is its moon"
    );
    let without = SaveFacts::default();
    let bare =
        generate_layout_for(&gd, &without, 1, "Fx", (0.0, 0.0), "fx_works", ABUNDANCE).unwrap();
    let rock = &bare.planets[0];
    assert_eq!(
        (rock.class.as_str(), rock.entity_name.as_deref()),
        ("pc_rock", None)
    );
    assert_eq!(rock.modifiers, ["fx_mod"], "the else arm");
}

#[test]
fn the_real_installs_effect_layouts_come_out_as_their_scripts_say() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let layout = |key: &str| by_name(gd, 1, "Gen", SPOT, key).unwrap();
    let relic = |spec: &SystemSpec| {
        spec.planets
            .iter()
            .find(|p| p.name.as_deref() == Some("NAME_Unique_System_2_Planet"))
            .cloned()
            .expect("Larionessi's world")
    };
    let refuge = relic(&layout("unique_system_initializer_02"));
    assert_eq!(refuge.class, "pc_relic", "with Ancient Relics");
    assert!(refuge.deposits.contains(&"d_rich_mountain".to_owned()));
    let without = SaveFacts::default();
    let bare = generate_layout_for(
        gd,
        &without,
        1,
        "Gen",
        SPOT,
        "unique_system_initializer_02",
        ABUNDANCE,
    )
    .unwrap();
    let refuge = relic(&bare);
    assert_eq!(refuge.class, "pc_tropical", "without it");
    assert!(refuge.deposits.contains(&"d_green_hills".to_owned()));

    let mall = layout("the_star_mall_initializer");
    let habitat = mall
        .planets
        .iter()
        .flat_map(|p| &p.moons)
        .find(|m| m.class == "pc_habitat")
        .expect("the mall");
    assert_eq!(
        habitat.entity_name.as_deref(),
        Some("habitat_phase_03_entity")
    );
    let stalls = habitat
        .deposits
        .iter()
        .filter(|d| *d == "d_star_mall_blocker")
        .count();
    assert_eq!(stalls, 8, "the while loop");

    let collided = layout("collided_planet_system_initializer");
    let planet = collided
        .planets
        .iter()
        .find(|p| p.modifiers.contains(&"collided_planet".to_owned()))
        .expect("the collided planet");
    for blocker in ["d_former_battlefield", "d_crater", "d_ruined_district"] {
        assert!(planet.deposits.contains(&blocker.to_owned()), "{blocker}");
    }
    assert!(
        planet.moons.iter().all(|m| !m.asteroid),
        "asteroid moons are lettered, not pool-named"
    );

    let flare = layout("superflare_system");
    let nuked = flare
        .planets
        .iter()
        .flat_map(|p| &p.moons)
        .find(|m| m.class == "pc_nuked")
        .expect("the nuked moon");
    let blockers: Vec<&String> = nuked.deposits.iter().filter(|d| gd.is_blocker(d)).collect();
    assert!(
        blockers
            .iter()
            .all(|d| ["d_radioactive_wasteland", "d_irradiated_valley"].contains(&d.as_str())),
        "only the ones added after clear_blockers: {blockers:?}"
    );
}
