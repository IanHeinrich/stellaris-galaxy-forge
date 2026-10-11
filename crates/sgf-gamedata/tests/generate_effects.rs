//! A rolled system's deposits: the layouts' body effects, blockers, rings and conditions,
//! and deposits drawn apart from the bodies, at any abundance and at the save's own.

use crate::common;

use std::collections::BTreeMap;

use sgf_core::format::save::details::OrbitFit;
use sgf_core::ops::SystemSpec;
use sgf_gamedata::GameData;
use sgf_gamedata::body_effects::{BodyEffect, Dropping};
use sgf_gamedata::condition::Condition;
use sgf_gamedata::generate::{Pick, for_save, generate, generate_layout_for};
use sgf_gamedata::layouts::SaveFacts;

use common::generate::FILES;
use common::{ABUNDANCE, INSTALL, SPOT};

const INITIALIZERS: &str = "common/solar_system_initializers/00_fx.txt";

/// One layout whose bodies carry deposit effects, and the deposits they name.
const EFFECTS: [(&str, &str); 2] = [
    (
        INITIALIZERS,
        "fx_effects = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { count = 1 class = star orbit_distance = 0 init_effect = { set_deposit = d_fx_bright } }\n\
         \tchange_orbit = 40\n\
         \tplanet = {\n\t\tcount = 1 class = pc_rock orbit_distance = 20\n\t\tinit_effect = {\n\t\t\tclear_deposits = yes\n\t\t\tadd_deposit = d_fx_gem\n\t\t\tadd_deposit = d_fx_gem\n\
         \t\t\tif = { limit = { always = yes } add_deposit = d_fx_bright }\n\t\t\tadd_deposit = random_blocker\n\t\t}\n\t}\n\
         \tplanet = {\n\t\tcount = 1 class = pc_rock orbit_distance = 20\n\t\tinit_effect = { add_deposit = d_fx_gem }\n\
         \t\tmoon = { count = 1 class = pc_rock orbit_distance = 5 init_effect = { clear_deposits = yes } }\n\t}\n\
         \tplanet = { count = 1 class = pc_rock orbit_distance = 20 init_effect = { add_deposit = d_fx_gem set_deposit = d_fx_bright } }\n}\n",
    ),
    (
        "common/deposits/00_fx.txt",
        "d_null_deposit = {\n\tis_null = yes\n\tpotential = { is_primary_star = no }\n\tdrop_weight = { weight = 100 }\n}\n\
         d_fx_shine = {\n\tpotential = { is_star = yes }\n}\n\
         d_fx_ore = {\n\tpotential = { is_planet_class = pc_rock }\n}\n\
         d_fx_gem = {\n\tpotential = { always = no }\n}\n\
         d_fx_bright = {\n\tpotential = { always = no }\n}\n",
    ),
];

fn with_effects() -> (tempfile::TempDir, GameData) {
    let files: Vec<(&str, &str)> = FILES
        .iter()
        .filter(|(rel, _)| *rel != INITIALIZERS)
        .chain(&EFFECTS)
        .copied()
        .collect();
    common::hand_written(&files)
}

/// Each body's deposits, the star first, then every planet followed by its moons.
fn deposits(spec: &SystemSpec) -> Vec<Vec<String>> {
    let mut out = vec![spec.star.deposits.clone()];
    for planet in &spec.planets {
        out.push(planet.deposits.clone());
        out.extend(planet.moons.iter().map(|m| m.deposits.clone()));
    }
    out
}

#[test]
fn a_layouts_body_effects_are_read_in_order_with_what_cannot_be_written() {
    let (_dir, gd) = with_effects();
    let init = gd.initializers.get("fx_effects").expect("fx_effects");
    let gem = || "d_fx_gem".to_owned();
    let bright = || "d_fx_bright".to_owned();
    assert_eq!(init.planets[0].effects, [BodyEffect::SetDeposit(bright())]);
    assert_eq!(
        init.planets[1].effects,
        [
            BodyEffect::ClearDeposits,
            BodyEffect::AddDeposit(gem()),
            BodyEffect::AddDeposit(gem()),
            BodyEffect::Branch(vec![(
                Some(Condition::All(vec![Condition::Always(true)])),
                vec![BodyEffect::AddDeposit(bright())]
            )]),
        ],
        "the `if` kept with its check"
    );
    assert_eq!(
        init.planets[1].unwritten.get(Dropping::Script).as_deref(),
        Some("add_deposit"),
        "a random blocker is no deposit key"
    );
    assert_eq!(
        init.planets[2].effects,
        [BodyEffect::AddDeposit(gem())],
        "its moon's aside"
    );
    assert_eq!(
        init.planets[2].moons[0].effects,
        [BodyEffect::ClearDeposits]
    );
    assert_eq!(
        init.planets[3].effects,
        [
            BodyEffect::AddDeposit(gem()),
            BodyEffect::SetDeposit(bright())
        ]
    );
}

#[test]
fn a_layouts_deposit_effects_run_after_the_roll() {
    let (_dir, gd) = with_effects();
    let keys = |keys: &[&str]| keys.iter().map(|&k| k.to_owned()).collect::<Vec<_>>();
    for seed in 0..20 {
        let spec = generate(&gd, seed, "Fx", (0.0, 0.0), None, 5.0).expect("a system");
        assert_eq!(spec.initializer, "fx_effects");
        assert_eq!(
            deposits(&spec),
            [
                keys(&["d_fx_bright"]),
                keys(&["d_fx_gem", "d_fx_gem", "d_fx_bright"]),
                keys(&["d_fx_ore", "d_fx_gem"]),
                keys(&[]),
                keys(&["d_fx_bright"]),
            ],
            "seed {seed}: set replaces the star's roll, clear empties the first planet's and \
             the moon's, an `if` that always holds adds, add keeps the second planet's, and \
             set after add leaves one"
        );
        let bare = generate(&gd, seed, "Fx", (0.0, 0.0), None, 0.0).unwrap();
        assert_eq!(
            deposits(&bare),
            [
                keys(&["d_fx_bright"]),
                keys(&["d_fx_gem", "d_fx_gem", "d_fx_bright"]),
                keys(&["d_fx_gem"]),
                keys(&[]),
                keys(&["d_fx_bright"]),
            ],
            "seed {seed}: at 0 nothing is rolled and the effects still run"
        );
    }
}

/// A layout with two colonisable worlds, one of them writing `deposit_blockers = none`,
/// against the one blocker deposit the install can give either.
const BLOCKERS: [(&str, &str); 7] = [
    (
        "common/defines/00_defines.txt",
        "NGameplay = {\n\tMIN_BLOCKED_DEPOSITS = 1\n\tMIN_UNBLOCKED_DEPOSITS = 0\n\
         \tCOLONY_DEPOSITS_FIXED_BASE = 0\n\tCOLONY_DEPOSITS_RANDOM_BASE = 0\n\
         \tCOLONY_DEPOSITS_FIXED_FROM_SIZE = 0\n\tCOLONY_DEPOSITS_RANDOM_FROM_SIZE = 0\n}\n",
    ),
    (
        "common/star_classes/00_stars.txt",
        "sc_fx = {\n\tclass = fx_star\n\tplanet = { key = pc_fx_star }\n\tspawn_odds = 1\n}\n",
    ),
    (
        "common/planet_classes/00_fx.txt",
        "pc_fx_star = {\n\tstar = yes\n\tplanet_size = 20\n}\n\
         pc_fx_meadow = {\n\tcolonizable = yes\n\tplanet_size = 15\n}\n",
    ),
    (
        "common/deposit_categories/00_fx.txt",
        "deposit_cat_blockers = {\n\tblocker = yes\n}\n",
    ),
    (
        "common/deposits/00_fx.txt",
        "d_fx_rubble = {\n\tcategory = deposit_cat_blockers\n\tis_for_colonizable = yes\n\
         \tuse_for_min_max_adjustments = yes\n\tdrop_weight = { weight = 100 }\n}\n",
    ),
    (
        "common/solar_system_initializers/00_fx.txt",
        "fx_blockers = {\n\tclass = sc_fx\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { count = 1 class = star orbit_distance = 0 }\n\tchange_orbit = 40\n\
         \tplanet = { count = 1 class = pc_fx_meadow orbit_distance = 20 }\n\
         \tplanet = { count = 1 class = pc_fx_meadow orbit_distance = 20 deposit_blockers = none }\n}\n",
    ),
    ("localisation/english/fx_l_english.yml", "l_english:\n"),
];

#[test]
fn deposit_blockers_none_draws_no_blocker_and_skips_its_minimum() {
    let (_dir, gd) = common::hand_written(&BLOCKERS);
    let save = SaveFacts::default();
    for seed in 0..5 {
        let spec = generate_layout_for(&gd, &save, seed, "Fx", (0.0, 0.0), "fx_blockers", 2.0)
            .expect("fx_blockers");
        assert_eq!(
            spec.planets[0].deposits,
            ["d_fx_rubble"],
            "seed {seed}: the one blocker tops up the minimum"
        );
        assert!(
            spec.planets[1].deposits.is_empty(),
            "seed {seed}: deposit_blockers = none draws no blocker and skips the top-up: {:?}",
            spec.planets[1].deposits
        );
    }
}

/// A layout with one random-class planet, drawn evenly between a class with a
/// `chance_of_ring` and one without.
const RING_ODDS: [(&str, &str); 4] = [
    (
        "common/star_classes/00_stars.txt",
        "sc_fx = {\n\tclass = fx_star\n\tplanet = { key = pc_fx_star }\n\tspawn_odds = 1\n}\n",
    ),
    (
        "common/planet_classes/00_fx.txt",
        "pc_fx_star = {\n\tstar = yes\n\tplanet_size = 20\n}\n\
         pc_fx_ringed = {\n\tmin_distance_from_sun = 0\n\tmax_distance_from_sun = 1000\n\
         \tspawn_odds = 1\n\tchance_of_ring = 0.6\n\tplanet_size = 15\n}\n\
         pc_fx_bare = {\n\tmin_distance_from_sun = 0\n\tmax_distance_from_sun = 1000\n\
         \tspawn_odds = 1\n\tplanet_size = 15\n}\n",
    ),
    (
        "common/solar_system_initializers/00_fx.txt",
        "fx_ringodds = {\n\tclass = sc_fx\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { count = 1 class = star orbit_distance = 0 }\n\tchange_orbit = 40\n\
         \tplanet = { count = 1 orbit_distance = 20 }\n}\n",
    ),
    ("localisation/english/fx_l_english.yml", "l_english:\n"),
];

#[test]
fn ring_odds_follow_each_classs_chance_of_ring() {
    let (_dir, gd) = common::hand_written(&RING_ODDS);
    let save = SaveFacts::default();
    let mut tally: BTreeMap<String, (f64, f64)> = BTreeMap::new();
    for seed in 0..4000 {
        let spec =
            generate_layout_for(&gd, &save, seed, "Fx", (0.0, 0.0), "fx_ringodds", ABUNDANCE)
                .expect("fx_ringodds");
        assert!(!spec.star.ring, "a star never has a ring");
        let planet = &spec.planets[0];
        let seen = tally.entry(planet.class.clone()).or_default();
        seen.0 += 1.0;
        seen.1 += f64::from(u8::from(planet.ring));
    }
    assert_eq!(
        tally.keys().collect::<Vec<_>>(),
        ["pc_fx_bare", "pc_fx_ringed"],
        "both classes are drawn"
    );
    let chances = [("pc_fx_bare", 0.0), ("pc_fx_ringed", 0.6)];
    for (class, chance) in chances {
        let (count, rings) = tally[class];
        let share = rings / count;
        assert!(
            (share - chance).abs() < 0.06,
            "{class}: {share:.3} ringed of {count}, chance {chance}"
        );
    }
}

/// A layout with a plain `random` planet at an orbit no class spawns at.
const UNBANDED: [(&str, &str); 4] = [
    (
        "common/star_classes/00_stars.txt",
        "sc_fx = {\n\tclass = fx_star\n\tplanet = { key = pc_fx_star }\n\tspawn_odds = 1\n}\n",
    ),
    (
        "common/planet_classes/00_fx.txt",
        "pc_fx_star = {\n\tstar = yes\n\tplanet_size = 20\n}\n\
         pc_fx_far = {\n\tmin_distance_from_sun = 500\n\tmax_distance_from_sun = 1000\n\
         \tspawn_odds = 1\n\tplanet_size = 15\n}\n",
    ),
    (
        "common/solar_system_initializers/00_fx.txt",
        "fx_unbanded = {\n\tclass = sc_fx\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { count = 1 class = star orbit_distance = 0 }\n\tchange_orbit = 40\n\
         \tplanet = { count = 1 class = random orbit_distance = 20 }\n}\n",
    ),
    ("localisation/english/fx_l_english.yml", "l_english:\n"),
];

/// The game's `example.txt` says a draw that no class fits is treated as `class = none`: no
/// planet. Add-system drops it, and the scenario details say it never spawns.
#[test]
fn a_random_planet_at_an_orbit_no_class_spawns_at_is_not_spawned() {
    let (_dir, gd) = common::hand_written(&UNBANDED);
    let spec = generate_layout_for(
        &gd,
        &SaveFacts::default(),
        1,
        "Fx",
        (0.0, 0.0),
        "fx_unbanded",
        ABUNDANCE,
    )
    .expect("fx_unbanded");
    assert!(spec.planets.is_empty(), "{:?}", spec.planets);

    let details = gd
        .initializer_details(1, "fx_unbanded", None)
        .expect("fx_unbanded");
    let planet = details.planets[1].spawn.as_ref().expect("a spawn");
    assert_eq!(planet.orbit_fit, Some(OrbitFit::Never));
    assert_eq!(planet.naming, None, "a body that never spawns is not named");
    assert_eq!(
        details.spawn.as_ref().and_then(|s| s.inner_radius),
        Some(common::fixed(150.0)),
        "the smallest inner radius, the planet that never spawns aside"
    );
}

/// A layout whose one planet is given a gem when the save has neither of two DLC.
const NEITHER: (&str, &str) = (
    INITIALIZERS,
    "fx_neither = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = 5\n\
     \tplanet = { count = 1 class = star orbit_distance = 0 }\n\tchange_orbit = 40\n\
     \tplanet = {\n\t\tcount = 1 class = pc_rock orbit_distance = 20\n\
     \t\tinit_effect = { if = { limit = { NOT = { host_has_dlc = \"Fx A\" host_has_dlc = \"Fx B\" } } add_deposit = d_fx_gem } }\n\t}\n}\n",
);

#[test]
fn a_not_of_two_conditions_holds_only_when_neither_does() {
    let files: Vec<(&str, &str)> = FILES
        .iter()
        .filter(|(rel, _)| *rel != INITIALIZERS)
        .chain([&NEITHER, &EFFECTS[1]])
        .copied()
        .collect();
    let (_dir, gd) = common::hand_written(&files);
    for (dlcs, gem) in [
        (&[][..], true),
        (&["Fx A"][..], false),
        (&["Fx A", "Fx B"][..], false),
    ] {
        let save = SaveFacts {
            dlcs: dlcs.iter().map(|&d| d.to_owned()).collect(),
            ..SaveFacts::default()
        };
        let spec = generate_layout_for(&gd, &save, 1, "Fx", (0.0, 0.0), "fx_neither", 0.0)
            .expect("a system");
        assert_eq!(
            spec.planets[0].deposits == ["d_fx_gem"],
            gem,
            "with {dlcs:?}: {:?}",
            spec.planets[0].deposits
        );
    }
}

/// `spec` with every body's deposits taken off.
fn bare(mut spec: SystemSpec) -> SystemSpec {
    spec.star.deposits.clear();
    for planet in &mut spec.planets {
        planet.deposits.clear();
        for moon in &mut planet.moons {
            moon.deposits.clear();
        }
    }
    spec
}

#[test]
fn deposits_are_drawn_apart_so_a_seed_rolls_the_same_bodies_at_any_abundance() {
    let files: Vec<(&str, &str)> = FILES.iter().chain([&EFFECTS[1]]).copied().collect();
    let (_dir, gd) = common::hand_written(&files);
    let gd = &gd;
    let mut with = 0;
    for seed in 0..200 {
        let rolled = generate(gd, seed, "Gen", SPOT, None, ABUNDANCE).unwrap();
        assert_eq!(
            generate(gd, seed, "Gen", SPOT, None, ABUNDANCE),
            Ok(rolled.clone()),
            "seed {seed}: the same seed and abundance"
        );
        let none = generate(gd, seed, "Gen", SPOT, None, 0.0).unwrap();
        let most = generate(gd, seed, "Gen", SPOT, None, 5.0).unwrap();
        assert!(deposits(&none).iter().all(Vec::is_empty), "seed {seed}");
        with += usize::from(deposits(&rolled).iter().any(|d| !d.is_empty()));
        assert_eq!(bare(rolled), none, "seed {seed}");
        assert_eq!(bare(most), none, "seed {seed}");
    }
    assert_eq!(with, 200, "every star rolls one");
}

/// A system rolled for a save draws its deposits at the Resource Abundance the save's galaxy
/// was set up with.
#[test]
fn a_system_rolled_for_a_save_draws_at_the_abundance_the_save_was_set_up_with() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let rolled_at = |abundance: &str| {
        let session = common::open_4_5_edited(|text| {
            let written = "	resource_abundance=2
";
            assert_eq!(text.matches(written).count(), 1, "the sample's setting");
            *text = text.replace(
                written,
                &format!(
                    "	resource_abundance={abundance}
"
                ),
            );
        });
        for_save(gd, &session, 55, SPOT, &Pick::Random(None)).expect("a system")
    };
    let none = rolled_at("0");
    assert!(deposits(&none).len() > 1, "a star and planets");
    assert!(
        deposits(&none).iter().all(Vec::is_empty),
        "at 0: {:?}",
        deposits(&none)
    );
    let most = rolled_at("5");
    assert!(
        deposits(&most).iter().all(|keys| !keys.is_empty()),
        "at 5: {:?}",
        deposits(&most)
    );
    assert_eq!(bare(most), none, "the same bodies at either abundance");
}
