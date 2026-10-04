//! Generating a system for a star pick: the layouts a class draws from, the names a generated
//! system settles on.

use crate::common;

use std::collections::{BTreeMap, BTreeSet};

use sgf_core::ops::Op;
use sgf_core::session::Session;
use sgf_gamedata::GameData;
use sgf_gamedata::generate::{GenerateError, generate, settle_name, star_classes};
use sgf_gamedata::special::classify_session;

use common::layouts::{self, FILES, by_name};
use common::{ABUNDANCE, INSTALL, SPOT};

#[test]
fn a_star_only_generic_special_layouts_make_is_listed_and_drawn_from_them() {
    let (_dir, gd) = layouts::hand_written();
    assert_eq!(
        star_classes(&gd),
        ["sc_sun", "sc_hole"],
        "sc_pole comes only from a capped layout"
    );
    for seed in 0..40 {
        let hole = generate(&gd, seed, "Fx", (0.0, 0.0), Some("sc_hole"), ABUNDANCE).unwrap();
        assert_eq!(
            (hole.initializer.as_str(), hole.star.class.as_str()),
            ("fx_hole", "pc_hole"),
            "seed {seed}: never the named fx_named_hole, whatever its odds"
        );
        let sun = generate(&gd, seed, "Fx", (0.0, 0.0), Some("sc_sun"), ABUNDANCE).unwrap();
        assert_eq!(sun.initializer, "fx_plain", "a plain layout makes it");
        let random = generate(&gd, seed, "Fx", (0.0, 0.0), None, ABUNDANCE).unwrap();
        assert_eq!(
            random.initializer, "fx_plain",
            "Random draws only plain layouts"
        );
    }
    assert_eq!(
        generate(&gd, 1, "Fx", (0.0, 0.0), Some("sc_pole"), ABUNDANCE),
        Err(GenerateError::NoLayoutFor("sc_pole".to_owned()))
    );
    let pole = by_name(&gd, 1, "Fx", (0.0, 0.0), "fx_pole").unwrap();
    assert_eq!(pole.star_class, "sc_pole", "by name it is placed");
}

#[test]
fn a_system_of_a_layout_the_generator_draws_is_no_unique_system() {
    let (_dir, gd) = layouts::hand_written();
    let mut session = common::open_4_5();
    let mut spec = generate(&gd, 1, "Fx", SPOT, Some("sc_hole"), ABUNDANCE).unwrap();
    assert_eq!(spec.initializer, "fx_hole");
    spec.lanes = vec![169];
    session
        .apply(Op::AddSystemFromSpec { spec })
        .expect("add the system");
    let special = |gd: Option<&GameData>| {
        classify_session(&session, gd)
            .systems
            .iter()
            .any(|s| s.id == 601)
    };
    assert!(
        special(None),
        "without game data only the game's own layouts are known"
    );
    assert!(!special(Some(&gd)), "a star pick draws it");
}

#[test]
fn rings_come_up_about_as_often_as_their_class_allows() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let seeds = 2000;
    let mut tally: BTreeMap<String, (f64, f64)> = BTreeMap::new();
    for seed in 0..seeds {
        let spec = generate(gd, seed, "Gen", SPOT, None, ABUNDANCE).unwrap();
        assert!(!spec.star.ring);
        for planet in &spec.planets {
            let seen = tally.entry(planet.class.clone()).or_default();
            seen.0 += 1.0;
            seen.1 += f64::from(u8::from(planet.ring));
            assert!(planet.moons.iter().all(|m| !m.ring), "seed {seed}");
        }
    }
    let mut ringed = 0.0;
    for (class, (count, rings)) in &tally {
        let chance = gd.planet_classes.get(class).unwrap().chance_of_ring;
        ringed += rings;
        if *count < 200.0 {
            continue;
        }
        let share = rings / count;
        assert!(
            (share - chance).abs() < 0.06,
            "{class}: {share:.3} ringed of {count}, chance {chance}"
        );
    }
    assert!(ringed > 0.0, "plain systems get rings");
}

#[test]
fn a_fixed_name_a_system_already_holds_gives_way_to_a_pool_name() {
    let (_dir, gd) = layouts::hand_written();
    let gd = &gd;
    let session = common::open_4_5();
    let settled = |session: &Session, layout: &str| {
        let mut spec = by_name(gd, 2, "Gen", (0.0, 0.0), layout).unwrap();
        settle_name(session, gd, &mut spec, "Pooled", 2);
        spec.name
    };
    assert_eq!(settled(&session, "fx_haven"), "NAME_Fx_Haven");
    assert_eq!(settled(&session, "fx_offcentre"), "Gen", "no fixed name");
    let mut session = common::open_4_5();
    let mut haven = by_name(gd, 1, "Gen", SPOT, "fx_haven").unwrap();
    haven.lanes = vec![169];
    session
        .apply(Op::AddSystemFromSpec { spec: haven })
        .expect("add Fx Haven");
    assert_eq!(settled(&session, "fx_haven"), "Pooled");
}
#[test]
fn a_special_star_pick_gives_only_a_generic_layout() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    for (class, layout) in [
        ("sc_pulsar", "special_init_09"),
        ("sc_black_hole", "special_init_01"),
        ("sc_neutron_star", "special_init_08"),
    ] {
        for seed in 0..300 {
            let spec = generate(gd, seed, "Gen", SPOT, Some(class), ABUNDANCE).unwrap();
            assert_eq!(
                spec.initializer, layout,
                "seed {seed}: never star_lifting_system or another named or capped layout"
            );
        }
    }
}

#[test]
fn a_black_hole_is_named_from_the_black_hole_names() {
    let files: Vec<(&str, &str)> = FILES
        .iter()
        .map(|&(rel, text)| match rel {
            "common/star_classes/00_stars.txt" => (
                rel,
                "sc_sun = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 30\n}\n\
                 sc_hole = {\n\tclass = black_hole\n\tplanet = { key = pc_hole }\n\tspawn_odds = 5\n}\n",
            ),
            "common/random_names/base/00_names.txt" => (
                rel,
                "star_names = {\n\tFx_Alpha\n}\nblack_hole_names = {\n\tFx_Void\n\tFx_Maw\n\tDristmak\n}\n",
            ),
            _ => (rel, text),
        })
        .collect();
    let (_dir, gd) = common::hand_written(&files);
    let gd = &gd;
    let session = common::open_4_5();
    let used: BTreeSet<&str> = session
        .graph()
        .systems
        .values()
        .map(|s| s.name.key.as_str())
        .collect();
    assert_eq!(*gd.black_hole_names, ["Fx_Void", "Fx_Maw", "Dristmak"]);
    for seed in 0..20 {
        let mut spec = generate(gd, seed, "Pooled", SPOT, Some("sc_hole"), ABUNDANCE).unwrap();
        settle_name(&session, gd, &mut spec, "Pooled", seed);
        assert!(gd.black_hole_names.contains(&spec.name), "{}", spec.name);
        assert!(!used.contains(spec.name.as_str()), "{}", spec.name);
    }
    let mut sun = generate(gd, 1, "Pooled", SPOT, Some("sc_sun"), ABUNDANCE).unwrap();
    settle_name(&session, gd, &mut sun, "Pooled", 1);
    assert_eq!(sun.name, "Pooled", "only black holes");
}
