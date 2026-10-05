//! Rolling a new body's deposits from a hand-written install's own rules: the defines,
//! counts, minimums and top-ups, and the types a body's potential allows.

use crate::common;

use std::collections::{BTreeMap, BTreeSet};

use sgf_gamedata::deposit_roll::{Kind, NewBody, RollBody, fitting, roll_deposits};
use sgf_gamedata::layouts::odds;
use sgf_gamedata::rng::Rng;

use common::deposits::{FILES, blockers, body, hand_written, keys, share};

#[test]
fn a_hand_written_install_reads_its_defines_in_file_order() {
    let (_dir, gd) = hand_written();
    let defines = &gd.deposit_defines;
    assert_eq!(defines.min_blocked, 2.0, "the later file wins");
    assert_eq!(gd.border.system_radius, 40.0, "the later file wins");
    assert_eq!(gd.border.hyperlane_thickness, 20.0);
    assert_eq!(defines.min_unblocked, 3.0);
    assert_eq!(defines.colony.draws(20.0), 15);
    assert_eq!(defines.colony.minimum(20.0), 9);
    assert_eq!(defines.non_colony.draws(20.0), 1);
    assert_eq!(defines.abundance(None), 2.0);
    assert_eq!(defines.abundance(Some(0.25)), 0.25);
    let unmarked = gd.deposits.get("d_fx_unmarked").unwrap();
    assert!(!unmarked.is_for_colonizable, "a missing key reads as no");
    assert!(!unmarked.orbital(), "no station works it");
}

#[test]
fn each_broken_defines_file_is_reported_once_and_the_rest_still_read() {
    let mut files = FILES.to_vec();
    files[0].1 = "NGraphics = {\n\tBORDER_SYSTEM_RADIUS = 35\n}}\n";
    files[1].1 = "NGameplay = {\n\tMIN_BLOCKED_DEPOSITS = 2\n";
    files.push((
        "common/defines/50_fx.txt",
        "NGameplay = {\n\tMIN_UNBLOCKED_DEPOSITS = 4\n}\n",
    ));
    let (_dir, gd) = common::hand_written(&files);
    let broken: Vec<_> = gd
        .diagnostics
        .iter()
        .filter_map(|d| match d {
            sgf_gamedata::Diagnostic::ParseError { file, .. } => file.file_name(),
            _ => None,
        })
        .collect();
    assert_eq!(
        broken,
        ["00_defines.txt", "99_fx.txt"],
        "{:?}",
        gd.diagnostics
    );
    assert_eq!(gd.deposit_defines.min_unblocked, 4.0, "50_fx.txt is read");
}

#[test]
fn a_parameterised_or_planet_scoped_condition_rolls_nothing() {
    let (_dir, gd) = hand_written();
    for key in ["is_fx_class", "is_fx_optional"] {
        let mut unknown = BTreeSet::new();
        gd.scripted_triggers
            .get(key)
            .unwrap()
            .condition
            .unknown_keys(
                &NewBody::new(&gd, &body("pc_fx_rock", 15), &[]),
                &mut unknown,
            );
        assert_eq!(unknown, keys(&[key]), "its meaning depends on the caller");
    }
    let (_, seen) = share(&gd, &body("pc_fx_rock", 15), 5.0, 2_000);
    assert_eq!(seen, keys(&["d_fx_ore", "d_fx_unmarked"]));
}

#[test]
fn a_hand_written_rock_rolls_one_draw_scaled_by_abundance() {
    let (_dir, gd) = hand_written();
    let rock = body("pc_fx_rock", 15);
    // Ore 20 (its unjudgeable modifier skipped) and the unmarked 5 against the null's 100.
    for (abundance, want) in [
        (1.0, 25.0 / 125.0),
        (2.0, 50.0 / 150.0),
        (0.25, 6.25 / 106.25),
    ] {
        let (got, seen) = share(&gd, &rock, abundance, 20_000);
        assert!(
            (got - want).abs() < 0.015,
            "at {abundance}: {got} against {want}"
        );
        assert_eq!(
            seen,
            keys(&["d_fx_ore", "d_fx_unmarked"]),
            "the mystery deposit's potential cannot be judged, so it is left out"
        );
    }
    let (got, _) = share(&gd, &rock, 5.0, 2_000);
    assert_eq!(got, 1.0, "at the maximum the null is never drawn");
    let (got, _) = share(&gd, &rock, 0.0, 2_000);
    assert_eq!(got, 0.0);

    let moon = RollBody {
        kind: Kind::Moon,
        ..rock
    };
    let (_, seen) = share(&gd, &moon, 2.0, 2_000);
    assert_eq!(seen, keys(&["d_fx_ore", "d_fx_moon_only"]));
}

#[test]
fn a_hand_written_star_always_gets_exactly_one() {
    let (_dir, gd) = hand_written();
    let star = RollBody {
        kind: Kind::Star,
        ..body("pc_fx_star", 25)
    };
    let mut unit = Rng::new(3);
    let mut tally: BTreeMap<String, u32> = BTreeMap::new();
    for _ in 0..4_000 {
        let rolled = roll_deposits(&gd, &star, 0.25, &mut unit);
        assert_eq!(rolled.len(), 1, "{rolled:?}");
        *tally.entry(rolled[0].clone()).or_default() += 1;
    }
    let energy = f64::from(tally["d_fx_star_energy"]) / 4_000.0;
    assert!((energy - 0.75).abs() < 0.03, "{tally:?}");
    assert!(roll_deposits(&gd, &star, 0.0, &mut unit).is_empty());
}

#[test]
fn a_hand_written_habitable_world_gets_its_counts_and_minimums() {
    let (_dir, gd) = hand_written();
    let mut unit = Rng::new(11);
    for size in [8, 12, 20] {
        let meadow = body("pc_fx_meadow", size);
        let most = (7.0 + 0.4 * f64::from(size)) as usize + 2 + 3;
        let least = (5.0 + 0.2 * f64::from(size)) as usize;
        for _ in 0..500 {
            let rolled = roll_deposits(&gd, &meadow, 0.25, &mut unit);
            let blocked = blockers(&gd, &rolled);
            assert!((least..=most).contains(&rolled.len()), "{rolled:?}");
            if size == 8 {
                assert_eq!(blocked, 0, "no blocker can drop below size 10: {rolled:?}");
            }
            assert!(rolled.len() - blocked >= 3, "{rolled:?}");
            assert!(
                !(rolled.contains(&"d_fx_swamp".to_owned())
                    && rolled.contains(&"d_fx_bog".to_owned())),
                "each excludes the other once drawn: {rolled:?}"
            );
            assert!(!rolled.contains(&"d_fx_dry_farmland".to_owned()));
            assert!(!rolled.contains(&"d_fx_unmarked".to_owned()));
        }
        assert!(roll_deposits(&gd, &meadow, 0.0, &mut unit).is_empty());
    }
}

/// A habitable world that draws nothing but its top-ups, beside flagged and unflagged
/// deposits of each kind; the unflagged ones far outweigh the flagged.
const TOP_UPS: [(&str, &str); 5] = [
    (
        "common/defines/00_defines.txt",
        "NGameplay = {\n\tMIN_BLOCKED_DEPOSITS = 1\n\tMIN_UNBLOCKED_DEPOSITS = 3\n\
         \tCOLONY_DEPOSITS_FIXED_BASE = 0\n\tCOLONY_DEPOSITS_RANDOM_BASE = 0\n\
         \tCOLONY_DEPOSITS_FIXED_FROM_SIZE = 0\n\tCOLONY_DEPOSITS_RANDOM_FROM_SIZE = 0\n}\n",
    ),
    (
        "common/planet_classes/00_fx.txt",
        "pc_fx_meadow = {\n\tcolonizable = yes\n\tplanet_size = 15\n}\n",
    ),
    (
        "common/deposit_categories/00_fx.txt",
        "deposit_cat_blockers = {\n\tblocker = yes\n}\ndeposit_cat_food = {}\n",
    ),
    (
        "common/deposits/00_fx.txt",
        "d_fx_rubble = {\n\tcategory = deposit_cat_blockers\n\tis_for_colonizable = yes\n\tdrop_weight = { weight = 100 }\n}\n\
         d_fx_marked_rubble = {\n\tcategory = deposit_cat_blockers\n\tis_for_colonizable = yes\n\tuse_for_min_max_adjustments = yes\n}\n\
         d_fx_plain = {\n\tcategory = deposit_cat_food\n\tis_for_colonizable = yes\n\tdrop_weight = { weight = 100 }\n}\n\
         d_fx_marked = {\n\tcategory = deposit_cat_food\n\tis_for_colonizable = yes\n\tuse_for_min_max_adjustments = yes\n}\n",
    ),
    ("localisation/english/fx_l_english.yml", "l_english:\n"),
];

#[test]
fn a_habitable_world_is_topped_up_only_from_deposits_flagged_for_it() {
    let (_dir, gd) = common::hand_written(&TOP_UPS);
    let meadow = body("pc_fx_meadow", 15);
    let mut unit = Rng::new(19);
    for _ in 0..200 {
        assert_eq!(
            roll_deposits(&gd, &meadow, 2.0, &mut unit),
            [
                "d_fx_marked_rubble",
                "d_fx_marked",
                "d_fx_marked",
                "d_fx_marked"
            ]
        );
    }

    let unflagged: Vec<(&str, String)> = TOP_UPS
        .iter()
        .map(|&(rel, text)| {
            (
                rel,
                text.replace("\tuse_for_min_max_adjustments = yes\n", ""),
            )
        })
        .collect();
    let unflagged: Vec<(&str, &str)> = unflagged.iter().map(|(rel, t)| (*rel, &**t)).collect();
    let (_dir, gd) = common::hand_written(&unflagged);
    assert!(
        roll_deposits(&gd, &meadow, 2.0, &mut unit).is_empty(),
        "no deposit is flagged, so nothing tops the world up"
    );
}

/// A layout's odds and a star's deposit weight, each from a base of 1 and one modifier
/// that both adds 1 and multiplies by 3, beside a deposit that weighs 4.
const ADD_AND_FACTOR: [(&str, &str); 5] = [
    (
        "common/star_classes/00_fx.txt",
        "sc_fx = {\n\tclass = fx_star\n\tplanet = { key = pc_fx_star }\n\tspawn_odds = 1\n}\n",
    ),
    (
        "common/planet_classes/00_fx.txt",
        "pc_fx_star = {\n\tstar = yes\n\tplanet_size = 20\n}\n",
    ),
    (
        "common/solar_system_initializers/00_fx.txt",
        "fx_both = {\n\tclass = sc_fx\n\tusage = misc_system_init\n\
         \tusage_odds = {\n\t\tbase = 1\n\t\tmodifier = { add = 1 factor = 3 host_has_dlc = \"Fx Pack\" }\n\t}\n\
         \tplanet = { class = star orbit_distance = 0 }\n}\n",
    ),
    (
        "common/deposits/00_fx.txt",
        "d_fx_both = {\n\tis_for_colonizable = no\n\tdrop_weight = {\n\t\tweight = 1\n\t\tmodifier = { add = 1 factor = 3 }\n\t}\n}\n\
         d_fx_four = {\n\tis_for_colonizable = no\n\tdrop_weight = { weight = 4 }\n}\n",
    ),
    ("localisation/english/fx_l_english.yml", "l_english:\n"),
];

#[test]
fn a_modifier_that_adds_and_multiplies_weighs_a_layout_and_a_deposit_alike() {
    let (_dir, gd) = common::hand_written(&ADD_AND_FACTOR);
    let layout = gd.initializers.get("fx_both").expect("fx_both");
    assert_eq!(odds(&gd, layout, None), 4.0, "1 times 3, plus 1");

    let star = RollBody {
        kind: Kind::Star,
        ..body("pc_fx_star", 20)
    };
    let mut unit = Rng::new(23);
    let draws = 20_000;
    let both = (0..draws)
        .filter(|_| roll_deposits(&gd, &star, 2.0, &mut unit) == ["d_fx_both"])
        .count();
    let share = both as f64 / f64::from(draws);
    assert!((share - 0.5).abs() < 0.02, "weighed 4 against 4: {share}");
}

#[test]
fn the_same_stream_rolls_the_same_deposits() {
    let (_dir, gd) = hand_written();
    let meadow = body("pc_fx_meadow", 16);
    let first = roll_deposits(&gd, &meadow, 2.0, &mut Rng::new(42));
    assert_eq!(roll_deposits(&gd, &meadow, 2.0, &mut Rng::new(42)), first);
}

#[test]
fn the_types_that_fit_a_hand_written_body_are_those_its_potential_allows() {
    let (_dir, gd) = hand_written();
    let fit_with = |body: &RollBody<'_>, have: &[String]| -> BTreeSet<String> {
        fitting(&gd, body, have)
            .iter()
            .map(|d| d.key.clone())
            .collect()
    };
    let fit = |body: &RollBody<'_>| fit_with(body, &[]);
    let star = RollBody {
        kind: Kind::Star,
        ..body("pc_fx_star", 25)
    };
    assert_eq!(fit(&star), keys(&["d_fx_star_energy", "d_fx_star_physics"]));
    let rock = body("pc_fx_rock", 15);
    assert_eq!(
        fit(&rock),
        keys(&["d_fx_ore", "d_fx_unmarked"]),
        "the null deposit, a potential that cannot be judged and a type that weighs nothing are left out"
    );
    let moon = RollBody {
        kind: Kind::Moon,
        ..rock
    };
    assert_eq!(fit(&moon), keys(&["d_fx_ore", "d_fx_moon_only"]));
    assert_eq!(
        fit(&body("pc_fx_meadow", 16)),
        keys(&["d_fx_farmland", "d_fx_blocker", "d_fx_swamp", "d_fx_bog"]),
        "a habitable world takes the colonisable types, blockers included"
    );
    assert_eq!(
        fit_with(&body("pc_fx_meadow", 16), &["d_fx_bog".to_owned()]),
        keys(&["d_fx_farmland", "d_fx_blocker", "d_fx_bog"]),
        "a weight reads the deposits the body holds"
    );
}
