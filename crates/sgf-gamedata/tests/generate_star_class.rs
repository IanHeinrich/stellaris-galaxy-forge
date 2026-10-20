//! Rolling a system around the star class asked for: how often each class and layout comes
//! up, and the classes no layout makes.

use crate::common;

use std::collections::{BTreeMap, BTreeSet};

use sgf_core::ops::BodyKind;
use sgf_gamedata::generate::{GenerateError, generate, star_classes};
use sgf_gamedata::layouts::{
    Eligibility, Unsupported, eligibility, plain_initializers, special_initializers,
};

use common::generate::{SEEDS, hand_written, specs};
use common::scripts::install_with_mod;
use common::{ABUNDANCE, INSTALL, SPOT};

/// A random pick draws each plain layout at its odds and then a class of its list at the
/// class's, so binaries and trinaries come up at the game's own rate: their four layouts are
/// 16 of the 88.
#[test]
fn star_classes_come_up_about_as_often_as_their_layouts_and_odds_give_them() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let mut drawn: BTreeMap<String, f64> = BTreeMap::new();
    let mut several = 0.0;
    for spec in specs(gd) {
        if gd.star_classes.get(&spec.star_class).unwrap().planets.len() > 1 {
            several += 1.0 / SEEDS as f64;
        }
        *drawn.entry(spec.star_class).or_default() += 1.0 / SEEDS as f64;
        if spec.initializer == "basic_init_01" {
            assert_eq!(spec.planets[0].orbit, 65.0, "as the trace found it");
        }
    }
    let layouts = plain_initializers(gd);
    let total: f64 = layouts.iter().filter_map(|i| i.usage_odds).sum();
    let mut weighted: BTreeMap<String, f64> = BTreeMap::new();
    for init in &layouts {
        let list = gd.star_lists.get(init.class.as_deref().unwrap()).unwrap();
        let odds = |key: &String| gd.star_classes.get(key).unwrap().spawn_odds;
        let list_total: f64 = list.stars.iter().map(odds).sum();
        for key in &list.stars {
            *weighted.entry(key.clone()).or_default() +=
                init.usage_odds.unwrap() / total * odds(key) / list_total;
        }
    }
    assert_eq!(
        drawn.keys().collect::<BTreeSet<_>>(),
        weighted.keys().collect::<BTreeSet<_>>()
    );
    assert_eq!(weighted.len(), 7 + 10 + 4);
    for (key, weight) in weighted {
        let share = drawn[&key];
        assert!(
            (share - weight).abs() < 0.04,
            "{key}: drawn {share:.3}, weighted {weight:.3}"
        );
    }
    assert!((several - 16.0 / 88.0).abs() < 0.03, "{several:.3}");
}

#[test]
fn a_hand_written_install_rolls_the_star_class_asked_for() {
    let (_dir, gd) = hand_written();
    assert_eq!(star_classes(&gd), ["sc_sun", "sc_ember", "sc_blaze"]);
    assert_eq!(
        eligibility(&gd, gd.initializers.get("fx_pair").unwrap()),
        Eligibility::Unsupported(Unsupported::StarCount {
            blocks: 1,
            stars: 2
        }),
        "one star block for sc_pair's two stars"
    );
    for seed in 0..50 {
        let spec =
            generate(&gd, seed, "Fx", (1.0, 2.0), Some("sc_ember"), ABUNDANCE).expect("a system");
        assert_eq!(spec.star_class, "sc_ember", "seed {seed}");
        assert_eq!(spec.star.class, "pc_sun_star");
        assert_eq!(
            generate(&gd, seed, "Fx", (1.0, 2.0), Some("sc_ember"), ABUNDANCE),
            Ok(spec),
            "the same seed and class"
        );
    }
    assert_eq!(
        generate(&gd, 1, "Fx", (0.0, 0.0), Some("sc_pair"), ABUNDANCE),
        Err(GenerateError::NoLayoutFor("sc_pair".to_owned())),
        "no layout has a star block for each of its stars"
    );
    assert_eq!(
        generate(&gd, 1, "Fx", (0.0, 0.0), Some("sc_nowhere"), ABUNDANCE),
        Err(GenerateError::UnknownStar("sc_nowhere".to_owned())),
        "no star class at all"
    );
}

#[test]
fn a_star_class_draws_each_layout_as_often_as_it_rolls_that_class() {
    let (_dir, gd) = hand_written();
    let draws = 4000;
    let mut drawn: BTreeMap<String, f64> = BTreeMap::new();
    for seed in 0..draws {
        let spec =
            generate(&gd, seed, "Fx", (0.0, 0.0), Some("sc_sun"), ABUNDANCE).expect("a system");
        assert_eq!(spec.star_class, "sc_sun");
        *drawn.entry(spec.initializer).or_default() += 1.0 / draws as f64;
    }
    // sc_sun is 30 of rl_single's 40 and 30 of rl_warm's 120, each layout at odds 5.
    let expected = [("fx_plain", 3.75), ("fx_rocks", 3.75), ("fx_warm", 1.25)];
    for (layout, weight) in expected {
        let share = drawn.get(layout).copied().unwrap_or_default();
        assert!(
            (share - weight / 8.75).abs() < 0.03,
            "{layout}: drawn {share:.3} of {drawn:?}"
        );
    }
    for seed in 0..50 {
        let spec = generate(&gd, seed, "Fx", (0.0, 0.0), Some("sc_blaze"), ABUNDANCE).unwrap();
        assert_eq!(spec.initializer, "fx_warm", "the one list that holds it");
    }
}

#[test]
fn the_real_install_rolls_each_class_it_lists_and_refuses_the_others() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let classes = star_classes(gd);
    let list = |key: &str| gd.star_lists.get(key).unwrap().stars.clone();
    let (plain, special) = classes.split_at(classes.len() - 3);
    assert_eq!(
        plain,
        [
            list("rl_standard_stars"),
            list("rl_binary_stars"),
            list("rl_trinary_stars")
        ]
        .concat()
    );
    assert_eq!(special, ["sc_black_hole", "sc_neutron_star", "sc_pulsar"]);
    assert_eq!(star_classes(gd), classes, "a stable order");
    let specials: Vec<String> = special_initializers(gd)
        .iter()
        .map(|i| i.name.clone())
        .collect();
    for class in &classes {
        let star = gd.star_classes.get(class).unwrap();
        for seed in 0..40 {
            let spec = generate(gd, seed, "Gen", SPOT, Some(class), ABUNDANCE).expect("a system");
            assert_eq!(spec.star_class, *class, "seed {seed}");
            let stars: Vec<&str> = std::iter::once(&spec.star)
                .chain(spec.planets.iter().filter(|p| p.kind == BodyKind::Star))
                .map(|body| body.class.as_str())
                .collect();
            assert_eq!(
                stars,
                star.planet_keys().collect::<Vec<_>>(),
                "seed {seed}: the class's stars in its order"
            );
            let plain_layout = plain_initializers(gd)
                .iter()
                .any(|i| i.name == spec.initializer);
            assert_eq!(
                plain_layout,
                plain.contains(class),
                "seed {seed}: {class} from {}",
                spec.initializer
            );
            assert!(plain_layout || specials.contains(&spec.initializer));
            assert_eq!(
                generate(gd, seed, "Gen", SPOT, Some(class), ABUNDANCE),
                Ok(spec)
            );
        }
    }
    let error =
        generate(gd, 1, "Gen", SPOT, Some("sc_crisis_binary_1"), ABUNDANCE).expect_err("no layout");
    assert_eq!(
        error,
        GenerateError::NoLayoutFor("sc_crisis_binary_1".to_owned())
    );
}

/// A pick of no class rolls only what the plain layouts make, so the classes only special
/// layouts make have odds of their own and none in a random draw.
#[test]
fn a_random_pick_weighs_only_the_classes_plain_layouts_make() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let picks = gd.star_class_picks();
    let pick = |key: &str| picks.iter().find(|p| p.key == key).expect(key);
    assert!(picks.iter().map(|p| p.random_odds).sum::<f64>() > 0.0);
    for special in ["sc_black_hole", "sc_neutron_star", "sc_pulsar"] {
        let pick = pick(special);
        assert_eq!(pick.random_odds, 0.0, "{special}");
        assert!(pick.odds > 0.0, "{special}");
    }
    let g = pick("sc_g");
    assert!(g.random_odds > 0.0);
    assert!((g.odds - g.random_odds).abs() < 1e-9, "{g:?}");
}

const EVENT_STARS: [(&str, &str); 4] = [
    (
        "common/planet_classes/zz_mod.txt",
        "pc_mod_o_star = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 30 }\n}\n\
         pc_mod_named_star = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 30 }\n}\n\
         pc_mod_rock = {\n\tmin_distance_from_sun = 0\n\tmax_distance_from_sun = 1000\n\tspawn_odds = 10\n\tplanet_size = { min = 10 max = 20 }\n\tmoon_size = { min = 5 max = 8 }\n}\n",
    ),
    (
        "common/star_classes/zz_mod.txt",
        "sc_mod_plain = {\n\tclass = mod_plain\n\tplanet = { key = pc_mod_o_star }\n\tspawn_odds = 10\n}\n\
         sc_mod_o = {\n\tclass = mod_o\n\tplanet = { key = pc_mod_o_star }\n\tspawn_odds = 5\n}\n\
         sc_mod_listed = {\n\tclass = mod_listed\n\tplanet = { key = pc_mod_o_star }\n\tspawn_odds = 10\n}\n\
         sc_mod_named = {\n\tclass = mod_named\n\tplanet = { key = pc_mod_named_star }\n\tspawn_odds = 0\n}\n",
    ),
    (
        "common/star_classes/randomizers/zz_mod.txt",
        "rl_mod = {\n\tstars = { sc_mod_plain }\n}\n\
         rl_mod_script = {\n\tstars = { sc_mod_o sc_mod_listed }\n}\n",
    ),
    (
        "common/solar_system_initializers/zz_mod.txt",
        "mod_plain = {\n\tclass = rl_mod\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { count = 1 class = star orbit_distance = 0 }\n\tchange_orbit = 40\n\
         \tplanet = { count = 2 class = pc_mod_rock orbit_distance = 20 }\n}\n\
         mod_o_1 = {\n\tclass = sc_mod_o\n\
         \tplanet = { count = 1 class = star orbit_distance = 0 }\n\tchange_orbit = 40\n\
         \tplanet = { count = 2 class = pc_mod_rock orbit_distance = 20 }\n}\n\
         mod_o_2 = {\n\tclass = sc_mod_o\n\
         \tplanet = { count = 1 class = star orbit_distance = 0 }\n\tchange_orbit = 40\n\
         \tplanet = { count = 3 class = pc_mod_rock orbit_distance = 20 }\n}\n\
         mod_branch = {\n\tclass = rl_mod_script\n\
         \tplanet = { count = 1 class = star orbit_distance = 0 }\n}\n\
         mod_named = {\n\tname = \"NAME_Mod_Named\"\n\tclass = sc_mod_named\n\
         \tplanet = { count = 1 class = star orbit_distance = 0 }\n}\n",
    ),
];

/// A mod's layouts with no `usage`, which only its events place, are rolled for their star
/// class from the star row. One that draws from a star list, or is named, gives no row.
#[test]
fn a_mods_event_only_star_is_a_star_row_that_rolls_its_layouts() {
    let (_dir, gd) = install_with_mod(&EVENT_STARS);
    let picks = gd.star_class_picks();
    let pick = picks
        .iter()
        .find(|pick| pick.key == "sc_mod_o")
        .expect("the event-only star is a row");
    assert_eq!(pick.random_odds, 0.0);
    assert_eq!(pick.odds, 2.0, "one per layout made for it");
    assert!(picks.iter().all(|pick| pick.key != "sc_mod_named"));
    assert!(
        picks.iter().all(|pick| pick.key != "sc_mod_listed"),
        "only a layout that draws from a star list gives it"
    );

    let mut drawn = BTreeSet::new();
    let mut random = BTreeSet::new();
    for seed in 0..200 {
        let spec = generate(&gd, seed, "Fx", SPOT, Some("sc_mod_o"), ABUNDANCE).expect("a system");
        assert_eq!(spec.star_class, "sc_mod_o");
        drawn.insert(spec.initializer);
        let spec = generate(&gd, seed, "Fx", SPOT, None, ABUNDANCE).expect("a system");
        random.insert(spec.star_class);
    }
    assert_eq!(
        drawn,
        BTreeSet::from(["mod_o_1".to_owned(), "mod_o_2".to_owned()])
    );
    assert!(!random.contains("sc_mod_o"), "{random:?}");
}
