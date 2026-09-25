//! Rolling a new body's deposits from the install's own rules, on a hand-written install
//! and on the real one, against the shares the research tallied in day-one saves.

use crate::common;

use std::collections::{BTreeMap, BTreeSet};

use sgf_core::ops::{BodySpec, SystemSpec};
use sgf_gamedata::GameData;
use sgf_gamedata::deposit_roll::{NewBody, RollBody, roll_deposits};
use sgf_gamedata::generate::generate;
use sgf_gamedata::layouts::odds;
use sgf_gamedata::rng::Rng;

use common::INSTALL;

const FILES: [(&str, &str); 8] = [
    (
        "common/defines/00_defines.txt",
        "NGraphics = {\n\tBORDER_SYSTEM_RADIUS = 35\n}\nNGameplay = {\n\tMIN_BLOCKED_DEPOSITS = 1\n\tMIN_UNBLOCKED_DEPOSITS = 3\n\
         \tCOLONY_DEPOSITS_FIXED_BASE = 5\n\tCOLONY_DEPOSITS_RANDOM_BASE = 2\n\tCOLONY_DEPOSITS_FIXED_FROM_SIZE = 0.2\n\tCOLONY_DEPOSITS_RANDOM_FROM_SIZE = 0.2\n\
         \tNON_COLONY_DEPOSITS_FIXED_BASE = 1\n\tRESOURCE_ABUNDANCE_DEFAULT = 2\n\tRESOURCE_ABUNDANCE_MAX = 5\n}\n",
    ),
    (
        "common/defines/99_fx.txt",
        "NGameplay = {\n\tMIN_BLOCKED_DEPOSITS = 2\n}\nNGraphics = {\n\tBORDER_SYSTEM_RADIUS = 40\n}\n",
    ),
    (
        "common/planet_classes/00_fx.txt",
        "pc_fx_star = {\n\tstar = yes\n\tplanet_size = 25\n}\n\
         pc_fx_rock = {\n\tplanet_size = { min = 10 max = 20 }\n}\n\
         pc_fx_meadow = {\n\tclimate = wet\n\tcolonizable = yes\n\tplanet_size = { min = 12 max = 20 }\n}\n",
    ),
    (
        "common/scripted_triggers/00_fx.txt",
        "is_rocky = {\n\toptimize_memory\n\tis_planet_class = pc_fx_rock\n}\n\
         is_wet = {\n\thas_climate = wet\n}\n\
         is_fx_class = {\n\tis_planet_class = $CLASS$\n}\n\
         is_fx_optional = {\n\t[[ROCK]\n\t\tis_planet_class = pc_fx_rock\n\t]\n}\n",
    ),
    (
        "common/deposit_categories/00_fx.txt",
        "deposit_cat_blockers = {\n\tblocker = yes\n}\ndeposit_cat_food = {}\n",
    ),
    (
        "common/deposits/00_fx.txt",
        "@fx_ore = 20\n\
         d_null_deposit = {\n\tis_null = yes\n\tpotential = { is_primary_star = no }\n\tdrop_weight = { weight = 100 }\n}\n\
         d_fx_star_energy = {\n\tis_for_colonizable = no\n\tpotential = { is_star = yes }\n\tdrop_weight = { weight = 3 }\n}\n\
         d_fx_star_physics = {\n\tis_for_colonizable = no\n\tpotential = { is_star = yes }\n}\n\
         d_fx_ore = {\n\tis_for_colonizable = no\n\tpotential = { is_rocky = yes }\n\
         \tdrop_weight = {\n\t\tweight = @fx_ore\n\t\tmodifier = { factor = 0 mystery_scope = { x = y } }\n\t}\n}\n\
         d_fx_unmarked = {\n\tpotential = { NOT = { is_star = yes } is_moon = no }\n\tdrop_weight = { weight = 5 }\n}\n\
         d_fx_moon_only = {\n\tis_for_colonizable = no\n\tpotential = { is_moon = yes }\n\tdrop_weight = { weight = 25 }\n}\n\
         d_fx_mystery = {\n\tis_for_colonizable = no\n\tpotential = { mystery_scope = { x = y } }\n\tdrop_weight = { weight = 1000 }\n}\n\
         d_fx_param_value = {\n\tis_for_colonizable = no\n\tpotential = { NOT = { is_fx_class = yes } }\n\tdrop_weight = { weight = 1000 }\n}\n\
         d_fx_param_block = {\n\tis_for_colonizable = no\n\tpotential = { is_fx_optional = yes }\n\tdrop_weight = { weight = 1000 }\n}\n\
         d_fx_planet_scope = {\n\tis_for_colonizable = no\n\tpotential = { planet = { is_planet_class = pc_fx_rock } }\n\tdrop_weight = { weight = 1000 }\n}\n",
    ),
    (
        "common/deposits/01_fx_features.txt",
        "d_fx_farmland = {\n\tcategory = deposit_cat_food\n\tis_for_colonizable = yes\n\tuse_for_min_max_adjustments = yes\n\tpotential = { is_wet = yes }\n\tdrop_weight = { weight = 10 }\n}\n\
         d_fx_dry_farmland = {\n\tcategory = deposit_cat_food\n\tis_for_colonizable = yes\n\tpotential = { is_wet = no }\n}\n\
         d_fx_blocker = {\n\tcategory = deposit_cat_blockers\n\tis_for_colonizable = yes\n\
         \tdrop_weight = {\n\t\tweight = 2\n\t\tmodifier = { factor = 0 planet_size < 10 }\n\t\tmodifier = { factor = 0 num_free_districts = { type = district_city value < 2 } }\n\t}\n}\n\
         d_fx_swamp = {\n\tcategory = deposit_cat_food\n\tis_for_colonizable = yes\n\
         \tdrop_weight = {\n\t\tweight = 5\n\t\tmodifier = { factor = 0 has_deposit = d_fx_bog }\n\t}\n}\n\
         d_fx_bog = {\n\tcategory = deposit_cat_food\n\tis_for_colonizable = yes\n\
         \tdrop_weight = {\n\t\tweight = 5\n\t\tmodifier = { factor = 0 has_deposit = d_fx_swamp }\n\t}\n}\n",
    ),
    ("localisation/english/fx_l_english.yml", "l_english:\n"),
];

fn hand_written() -> (tempfile::TempDir, GameData) {
    common::hand_written(&FILES)
}

fn body(class: &str, size: u32) -> RollBody<'_> {
    RollBody {
        class,
        size,
        star: false,
        moon: false,
    }
}

/// The share of `n` rolls of `body` that got a deposit, and every key seen.
fn share(gd: &GameData, body: &RollBody<'_>, abundance: f64, n: u32) -> (f64, BTreeSet<String>) {
    let mut unit = Rng::new(7);
    let mut with = 0;
    let mut seen = BTreeSet::new();
    for _ in 0..n {
        let rolled = roll_deposits(gd, body, abundance, &mut unit);
        assert!(rolled.len() <= 1, "{}: {rolled:?}", body.class);
        with += u32::from(!rolled.is_empty());
        seen.extend(rolled);
    }
    (f64::from(with) / f64::from(n), seen)
}

fn blockers(gd: &GameData, rolled: &[String]) -> usize {
    rolled.iter().filter(|key| gd.is_blocker(key)).count()
}

fn keys(items: &[&str]) -> BTreeSet<String> {
    items.iter().map(|&k| k.to_owned()).collect()
}

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

    let moon = RollBody { moon: true, ..rock };
    let (_, seen) = share(&gd, &moon, 2.0, 2_000);
    assert_eq!(seen, keys(&["d_fx_ore", "d_fx_moon_only"]));
}

#[test]
fn a_hand_written_star_always_gets_exactly_one() {
    let (_dir, gd) = hand_written();
    let star = RollBody {
        star: true,
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
        star: true,
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

/// The share of fresh bodies with a deposit per class in the 4.4 and 4.5 day-one saves, at
/// Resource Abundance 2.
const TALLIES: [(&str, f64); 8] = [
    ("pc_barren_cold", 0.154),
    ("pc_barren", 0.142),
    ("pc_molten", 0.304),
    ("pc_asteroid", 0.458),
    ("pc_frozen", 0.147),
    ("pc_gas_giant", 0.435),
    ("pc_ice_asteroid", 0.374),
    ("pc_toxic", 0.322),
];

fn size_of(gd: &GameData, class: &str, rng: &mut Rng) -> u32 {
    let range = gd.planet_classes.get(class).unwrap().planet_size.unwrap();
    (range.min + (range.max - range.min) * rng.unit()).round() as u32
}

#[test]
fn the_real_install_matches_the_tallied_shares_at_abundance_2() {
    let Some(gd) = INSTALL.as_ref() else { return };
    common::parallel(TALLIES.len(), |i| {
        let (class, want) = TALLIES[i];
        let mut unit = Rng::new(5 + i as u64);
        let n = 6_000;
        let mut with = 0;
        for _ in 0..n {
            let size = size_of(gd, class, &mut unit);
            let rolled = roll_deposits(gd, &body(class, size), 2.0, &mut unit);
            assert!(rolled.len() <= 1, "{class}: {rolled:?}");
            with += u32::from(!rolled.is_empty());
        }
        let got = f64::from(with) / f64::from(n);
        eprintln!("{class}: {got:.3} against {want:.3}");
        assert!((got - want).abs() < 0.035, "{class}: {got} against {want}");
    });
}

#[test]
fn the_real_install_gives_every_star_one_deposit() {
    let Some(gd) = INSTALL.as_ref() else { return };
    let mut unit = Rng::new(9);
    for class in [
        "pc_a_star",
        "pc_b_star",
        "pc_f_star",
        "pc_g_star",
        "pc_k_star",
        "pc_m_star",
        "pc_m_giant_star",
        "pc_t_star",
        "pc_neutron_star",
        "pc_pulsar",
        "pc_black_hole",
    ] {
        let star = RollBody {
            star: true,
            ..body(class, 25)
        };
        for abundance in [0.25, 2.0, 5.0] {
            for _ in 0..200 {
                let rolled = roll_deposits(gd, &star, abundance, &mut unit);
                assert_eq!(rolled.len(), 1, "{class} at {abundance}: {rolled:?}");
            }
        }
        assert!(roll_deposits(gd, &star, 0.0, &mut unit).is_empty());
    }
}

/// The 55 unowned habitable worlds in plain systems of the 4.4 and 4.5 day-one saves:
/// class, size and how many. They average 10.4 deposits and 2.5 blockers.
const HABITABLE_MIX: [(&str, u32, u32); 44] = [
    ("pc_alpine", 11, 2),
    ("pc_alpine", 13, 1),
    ("pc_alpine", 16, 1),
    ("pc_alpine", 17, 1),
    ("pc_alpine", 19, 1),
    ("pc_alpine", 21, 1),
    ("pc_alpine", 22, 1),
    ("pc_arctic", 16, 1),
    ("pc_arctic", 18, 1),
    ("pc_arid", 12, 1),
    ("pc_arid", 13, 1),
    ("pc_arid", 14, 1),
    ("pc_arid", 15, 1),
    ("pc_arid", 18, 1),
    ("pc_continental", 12, 2),
    ("pc_continental", 19, 1),
    ("pc_continental", 24, 1),
    ("pc_desert", 11, 1),
    ("pc_desert", 12, 2),
    ("pc_desert", 16, 1),
    ("pc_desert", 19, 1),
    ("pc_desert", 21, 1),
    ("pc_desert", 22, 1),
    ("pc_desert", 25, 1),
    ("pc_ocean", 10, 1),
    ("pc_ocean", 11, 3),
    ("pc_ocean", 14, 2),
    ("pc_ocean", 16, 1),
    ("pc_ocean", 20, 2),
    ("pc_savannah", 9, 1),
    ("pc_savannah", 18, 1),
    ("pc_savannah", 21, 1),
    ("pc_savannah", 23, 1),
    ("pc_tropical", 12, 2),
    ("pc_tropical", 13, 1),
    ("pc_tropical", 15, 1),
    ("pc_tropical", 18, 1),
    ("pc_tropical", 19, 1),
    ("pc_tropical", 20, 3),
    ("pc_tropical", 24, 2),
    ("pc_tundra", 10, 1),
    ("pc_tundra", 14, 1),
    ("pc_tundra", 15, 1),
    ("pc_tundra", 18, 1),
];

#[test]
fn the_real_install_gives_habitable_worlds_the_same_counts_and_blockers_at_every_abundance() {
    let Some(gd) = INSTALL.as_ref() else { return };
    let defines = &gd.deposit_defines;
    let nulls: BTreeSet<&str> = gd
        .deposits
        .iter()
        .filter(|d| d.roll.is_null)
        .map(|d| d.key.as_str())
        .collect();
    assert!(!nulls.is_empty());
    const ABUNDANCES: [f64; 3] = [0.25, 2.0, 5.0];
    let means = common::parallel(ABUNDANCES.len(), |i| {
        let abundance = ABUNDANCES[i];
        let mut unit = Rng::new(13 + i as u64);
        let (mut total, mut blocked_total, mut unblocked, mut n) = (0, 0, 0u32, 0u32);
        for (class, size, planets) in HABITABLE_MIX {
            let habitable = body(class, size);
            for _ in 0..planets * 80 {
                let rolled = roll_deposits(gd, &habitable, abundance, &mut unit);
                let blocked = blockers(gd, &rolled);
                let most = defines.colony.draws(f64::from(size))
                    + defines.min_blocked as usize
                    + defines.min_unblocked as usize;
                assert!(
                    (defines.colony.minimum(f64::from(size))..=most).contains(&rolled.len()),
                    "{class} {size}: {rolled:?}"
                );
                assert!(
                    rolled.iter().all(|k| !nulls.contains(k.as_str())),
                    "{rolled:?}"
                );
                assert!(
                    (rolled.len() - blocked) as f64 >= defines.min_unblocked,
                    "{class}: {rolled:?}"
                );
                total += rolled.len();
                blocked_total += blocked;
                unblocked += u32::from(blocked == 0);
                n += 1;
            }
            assert!(roll_deposits(gd, &habitable, 0.0, &mut unit).is_empty());
        }
        let mean = total as f64 / f64::from(n);
        let mean_blocked = blocked_total as f64 / f64::from(n);
        eprintln!("habitable at {abundance}: {mean:.2} deposits, {mean_blocked:.2} blockers");
        assert!(
            (9.9..=10.9).contains(&mean),
            "10.0 to 10.7 in the saves, {mean} at {abundance}"
        );
        assert!(
            (2.4..=2.9).contains(&mean_blocked),
            "2.5 to 2.8 in the saves, {mean_blocked} at {abundance}"
        );
        let none = f64::from(unblocked) / f64::from(n);
        assert!(
            (0.03..=0.2).contains(&none),
            "7 of 80 and 9 of 79 unowned habitable worlds in the saves have no blocker, {none} at {abundance}"
        );
        (mean, mean_blocked)
    });
    let (first, first_blocked) = means[0];
    for &(mean, blocked) in &means {
        assert!(
            (mean - first).abs() < 0.2 && (blocked - first_blocked).abs() < 0.1,
            "{means:?}"
        );
    }
}

#[test]
fn the_real_install_leaves_no_body_empty_at_the_maximum_and_all_at_zero() {
    let Some(gd) = INSTALL.as_ref() else { return };
    let max = gd.deposit_defines.abundance_max;
    assert_eq!(max, 5.0);
    let mut unit = Rng::new(17);
    for (class, _) in TALLIES {
        for moon in [false, true] {
            for _ in 0..300 {
                let size = size_of(gd, class, &mut unit);
                let b = RollBody {
                    moon,
                    ..body(class, size)
                };
                assert_eq!(roll_deposits(gd, &b, max, &mut unit).len(), 1, "{class}");
                assert!(roll_deposits(gd, &b, 0.0, &mut unit).is_empty());
            }
        }
    }
}

#[test]
fn the_real_install_uses_no_condition_the_roll_cannot_judge() {
    let Some(gd) = INSTALL.as_ref() else { return };
    let mut unknown = BTreeSet::new();
    let habitable = body("pc_continental", 15);
    let new = NewBody::new(gd, &habitable, &[]);
    for deposit in gd.deposits.iter() {
        if let Some(potential) = &deposit.roll.potential {
            potential.unknown_keys(&new, &mut unknown);
        }
        for modifier in &deposit.roll.drop_weight.modifiers {
            modifier.when.unknown_keys(&new, &mut unknown);
        }
    }
    assert!(unknown.is_empty(), "{unknown:?}");
}

/// Every body of `spec`, the star first, then each planet and its moons, with whether it
/// is a moon.
fn generated(spec: &SystemSpec) -> Vec<(&BodySpec, bool)> {
    let mut out = vec![(&spec.star, false)];
    for planet in &spec.planets {
        out.push((planet, false));
        out.extend(planet.moons.iter().map(|moon| (moon, true)));
    }
    out
}

fn generate_at(gd: &GameData, seed: u64, abundance: f64) -> SystemSpec {
    generate(gd, seed, "Gen", (-313.94, -124.34), None, abundance).expect("a system")
}

#[test]
fn a_generated_system_rolls_deposits_on_every_kind_of_body_at_abundance_2() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let mut seen: BTreeMap<&str, (u32, u32)> = BTreeMap::new();
    for seed in 0..300 {
        let spec = generate_at(gd, seed, 2.0);
        assert_eq!(spec.star.deposits.len(), 1, "seed {seed}: the star's one");
        for (body, moon) in generated(&spec).into_iter().skip(1) {
            let class = gd.planet_classes.get(&body.class).unwrap();
            let kind = match (class.colonizable, body.asteroid, moon) {
                (true, ..) => "habitable",
                (_, true, _) => "asteroid",
                (.., true) => "moon",
                _ => "planet",
            };
            let entry = seen.entry(kind).or_default();
            entry.0 += 1;
            entry.1 += u32::from(!body.deposits.is_empty());
            for key in &body.deposits {
                assert!(gd.deposits.get(key).is_some(), "seed {seed}: {key}");
            }
            if class.colonizable {
                assert!(
                    body.deposits.len() >= 4,
                    "seed {seed}: {} {:?}",
                    body.class,
                    body.deposits
                );
            } else {
                assert!(body.deposits.len() <= 1, "seed {seed}: {body:?}");
            }
        }
    }
    let (worlds, with) = seen["habitable"];
    assert!(worlds > 0 && with == worlds, "{seen:?}");
    for kind in ["asteroid", "planet", "moon"] {
        let (bodies, with) = seen[kind];
        assert!(with > 0 && with < bodies, "{kind}: {seen:?}");
    }
}
