//! Rolling a system around the star class asked for: how often each class and layout comes
//! up, and the classes no layout makes.

use crate::common;

use std::collections::{BTreeMap, BTreeSet};

use sgf_gamedata::generate::{GenerateError, generate, star_classes};
use sgf_gamedata::layouts::{plain_initializers, special_initializers};

use common::generate::{SEEDS, hand_written, specs};
use common::{ABUNDANCE, INSTALL, SPOT};

#[test]
fn star_classes_come_up_about_as_often_as_their_odds() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let mut drawn: BTreeMap<String, f64> = BTreeMap::new();
    for spec in specs(gd) {
        *drawn.entry(spec.star_class).or_default() += 1.0 / SEEDS as f64;
        if spec.initializer == "basic_init_01" {
            assert_eq!(spec.planets[0].orbit, 65.0, "as the trace found it");
        }
    }
    let list = gd.star_lists.get("rl_standard_stars").unwrap();
    let odds: Vec<(String, f64)> = list
        .stars
        .iter()
        .map(|key| (key.clone(), gd.star_classes.get(key).unwrap().spawn_odds))
        .collect();
    let total: f64 = odds.iter().map(|(_, o)| o).sum();
    assert_eq!(
        drawn.keys().cloned().collect::<BTreeSet<_>>(),
        list.stars.iter().cloned().collect::<BTreeSet<_>>()
    );
    for (key, odds) in odds {
        let share = drawn[&key];
        assert!(
            (share - odds / total).abs() < 0.04,
            "{key}: drawn {share:.3}, weighted {:.3}",
            odds / total
        );
    }
}

#[test]
fn a_hand_written_install_rolls_the_star_class_asked_for() {
    let (_dir, gd) = hand_written();
    assert_eq!(star_classes(&gd), ["sc_sun", "sc_ember", "sc_blaze"]);
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
        "only a binary layout makes it"
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
    let standard = &gd.star_lists.get("rl_standard_stars").unwrap().stars;
    let (plain, special) = classes.split_at(standard.len());
    assert_eq!(plain, standard);
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
            assert_eq!(
                spec.star.class,
                star.planet_keys().next().unwrap(),
                "seed {seed}"
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
        generate(gd, 1, "Gen", SPOT, Some("sc_binary_1"), ABUNDANCE).expect_err("no layout");
    assert_eq!(error, GenerateError::NoLayoutFor("sc_binary_1".to_owned()));
}
