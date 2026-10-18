//! Binary and trinary systems on the real install: which multi-star layouts the generator
//! builds, Sol's neighbours and the four random layouts rolled star by star, Sol's cluster
//! offered, and each added to the 4.5 sample, removed and added back byte for byte.

use crate::common;

use std::collections::BTreeSet;

use sgf_core::ops::{BodyKind, Op, PrimaryName, SpecAnomaly, SpecBody, SpecStar};
use sgf_core::session::Session;
use sgf_gamedata::GameData;
use sgf_gamedata::generate::{
    Pick, cluster_op, for_save, layout_system_for, roll_cluster, special_op,
};
use sgf_gamedata::layouts::{Eligibility, SaveFacts, Unsupported, eligibility};
use sgf_gamedata::menu::menu_clusters;

use common::layouts::{by_name, of, stars};
use common::prepare::current;
use common::{ABUNDANCE, INSTALL, SPOT, hand_written, open_4_5};

const ALPHA_CENTAURI: &str = "sol_neighbor_t1_no_guaranteed_colony";
const PROCYON: &str = "sol_neighbor_t2";
const SIRIUS: &str = "sol_neighbor_t2_no_guaranteed_colony";
const RANDOM: [(&str, &str); 4] = [
    ("binary_init_01", "sc_binary_7"),
    ("binary_init_02", "sc_binary_7"),
    ("trinary_init_01", "sc_trinary_1"),
    ("trinary_init_02", "sc_trinary_1"),
];

/// Its class has more than one star, or it writes more than one `class = star` block.
fn multi_star(gd: &GameData, key: &str) -> bool {
    let init = gd.initializers.get(key).expect(key);
    let class = init.class.as_deref().unwrap_or_default();
    let several = |star: &str| {
        gd.star_classes
            .get(star)
            .is_some_and(|c| c.planets.len() > 1)
    };
    several(class)
        || gd
            .star_lists
            .get(class)
            .is_some_and(|list| list.stars.iter().any(|star| several(star)))
        || init
            .planets
            .iter()
            .filter(|p| p.class.written() == "star")
            .count()
            > 1
}

/// The first seed from 0 whose roll of `class` for `session` is built from `layout`.
fn by_class(gd: &GameData, session: &Session, layout: &str, class: &str) -> (u64, Pick) {
    let pick = Pick::Random(Some(class.to_owned()));
    let seed = (0..200)
        .find(|&seed| {
            for_save(gd, session, seed, SPOT, &pick)
                .expect("a roll")
                .initializer
                == layout
        })
        .unwrap_or_else(|| panic!("no seed of {class} draws {layout}"));
    (seed, pick)
}

/// Every layout the generator once refused for having more than one star is built now, but
/// those another blocker keeps out.
#[test]
fn the_multi_star_layouts_with_no_other_blocker_are_special_or_plain() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let mut special = BTreeSet::new();
    let mut plain = BTreeSet::new();
    for init in gd.initializers.iter() {
        if !multi_star(gd, &init.name) {
            continue;
        }
        match eligibility(gd, init) {
            Eligibility::Special => special.insert(init.name.as_str()),
            Eligibility::Plain => plain.insert(init.name.as_str()),
            Eligibility::Unsupported(why) => {
                assert!(
                    !matches!(why, Unsupported::StarCount { .. }),
                    "{}: {why}",
                    init.name
                );
                false
            }
        };
    }
    assert_eq!(
        special,
        BTreeSet::from([
            "broken_shroudwalker_init_01",
            "distar_phaseshift_system",
            "distar_pod_system",
            "living_planet_system",
            "mechanocalibrator_system",
            "megacorp_mega_art_installation_init_01",
            "orbital_ring_init_01",
            ALPHA_CENTAURI,
            PROCYON,
            SIRIUS,
            "solarpunk_01",
        ])
    );
    assert_eq!(
        plain,
        BTreeSet::from([
            "binary_init_01",
            "binary_init_02",
            "trinary_init_01",
            "trinary_init_02"
        ])
    );
}

/// Alpha Centauri as the 4.4 sample holds it: A at 15, B stepped back to -20, Proxima at 240
/// with b and c about it, b with its anomaly, its `prevent_anomaly` and its tidal lock, and
/// every star rolling its deposit as a star.
#[test]
fn alpha_centauri_rolls_its_three_named_stars_and_proxima_b() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let facts = SaveFacts::read(&open_4_5());
    for seed in 0..20 {
        let add = layout_system_for(gd, &facts, seed, "Gen", SPOT, ALPHA_CENTAURI, ABUNDANCE)
            .expect("Alpha Centauri");
        let spec = &add.spec;
        assert_eq!(spec.name, "NAME_Alpha_Centauri");
        assert_eq!(spec.star_class, "sc_trinary_1");
        assert_eq!(
            spec.star_name,
            PrimaryName::Fixed("NAME_Alpha_Centauri_A".to_owned())
        );
        assert_eq!(
            spec.star.name, None,
            "the star's name is the system's to write"
        );
        let placed: Vec<(&str, f64, Option<&str>)> = stars(spec)
            .iter()
            .map(|s| (s.class.as_str(), s.orbit, s.name.as_deref()))
            .collect();
        assert_eq!(
            placed,
            [
                ("pc_g_star", 15.0, None),
                ("pc_k_star", -20.0, Some("NAME_Alpha_Centauri_B")),
                ("pc_m_star", 240.0, Some("NAME_Proxima_Centauri")),
            ],
            "seed {seed}"
        );
        assert_eq!(spec.star.angle, 170.0, "350 on from the walk's 180");
        for star in stars(spec) {
            assert!(star.deposits.len() <= 1, "seed {seed}: {star:?}");
        }
        let proxima = spec
            .planets
            .iter()
            .position(|p| p.name.as_deref() == Some("NAME_Proxima_Centauri"))
            .expect("Proxima");
        let [b, c] = &spec.planets[proxima].moons[..] else {
            panic!("seed {seed}: two planets about Proxima");
        };
        assert_eq!(
            (b.class.as_str(), b.orbit, b.name.as_deref()),
            ("pc_barren_cold", 35.0, Some("NAME_Proxima_Centauri_b"))
        );
        assert!(b.prevent_anomaly);
        assert_eq!(b.modifiers, ["tidal_locked"]);
        assert_eq!(
            (c.class.as_str(), c.orbit, c.name.as_deref()),
            ("pc_gas_giant", 60.0, Some("NAME_Proxima_Centauri_c"))
        );
        assert_eq!(
            add.extras.anomalies,
            [SpecAnomaly {
                body: SpecBody::Satellite {
                    star: SpecStar::Companion(proxima),
                    index: 0
                },
                category: "ALPHA_CENTAURI_CAT".to_owned(),
            }]
        );
        assert!(
            spec.planets
                .iter()
                .filter(|p| p.kind != BodyKind::Star)
                .all(|p| p.orbit < 240.0),
            "the planets about the centre after change_orbit = -220"
        );
    }
}

/// Procyon keeps the `sc_binary_8` its layout writes with both its stars F, as the game keeps
/// them, and Sirius takes the A and F stars its layout names.
#[test]
fn procyon_and_sirius_keep_the_stars_their_layouts_write() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let facts = SaveFacts::read(&open_4_5());
    for (layout, class, named) in [
        (
            PROCYON,
            "sc_binary_8",
            [
                ("pc_f_star", "NAME_Procyon_A"),
                ("pc_f_star", "NAME_Procyon_B"),
            ],
        ),
        (
            SIRIUS,
            "sc_binary_9",
            [
                ("pc_a_star", "NAME_Sirius_A"),
                ("pc_f_star", "NAME_Sirius_B"),
            ],
        ),
    ] {
        for seed in 0..10 {
            let spec = layout_system_for(gd, &facts, seed, "Gen", SPOT, layout, ABUNDANCE)
                .expect(layout)
                .spec;
            assert_eq!(spec.star_class, class);
            let written: Vec<(&str, String)> = stars(&spec)
                .iter()
                .map(|s| {
                    let name = match &s.name {
                        Some(name) => name.clone(),
                        None => match &spec.star_name {
                            PrimaryName::Fixed(name) => name.clone(),
                            other => format!("{other:?}"),
                        },
                    };
                    (s.class.as_str(), name)
                })
                .collect();
            let expected: Vec<(&str, String)> = named
                .iter()
                .map(|&(class, name)| (class, name.to_owned()))
                .collect();
            assert_eq!(written, expected, "{layout} seed {seed}");
            assert_eq!(
                stars(&spec).iter().map(|s| s.orbit).collect::<Vec<_>>(),
                [30.0, 30.0]
            );
        }
    }
}

/// The four random layouts, drawn by a class pick: one star for each of the class's in its
/// order, the companions' deposits rolled as a star's, their planets' classes drawn at their
/// orbit about their own star, and ranged distances drawn on the game's 0.02 grid.
#[test]
fn the_random_multi_star_layouts_roll_their_stars_and_companions_planets() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let session = open_4_5();
    let mut primary_deposits: BTreeSet<String> = BTreeSet::new();
    let mut companion_deposits: BTreeSet<String> = BTreeSet::new();
    let mut fractional = 0;
    for (layout, class) in RANDOM {
        let keys: Vec<&str> = gd.star_classes.get(class).unwrap().planet_keys().collect();
        let pick = Pick::Random(Some(class.to_owned()));
        let mut drawn = 0;
        for seed in 0..300 {
            let spec = for_save(gd, &session, seed, SPOT, &pick).expect("a roll");
            assert_eq!(spec.star_class, class);
            primary_deposits.extend(spec.star.deposits.iter().cloned());
            if spec.initializer != layout {
                continue;
            }
            drawn += 1;
            let classes: Vec<&str> = stars(&spec).iter().map(|s| s.class.as_str()).collect();
            assert_eq!(classes, keys, "{layout} seed {seed}");
            assert_eq!(spec.star_name, PrimaryName::Lettered);
            for star in stars(&spec) {
                assert!(star.deposits.len() <= 1, "{layout} seed {seed}: {star:?}");
                assert!(star.name.is_none());
            }
            for companion in stars(&spec).into_iter().skip(1) {
                companion_deposits.extend(companion.deposits.iter().cloned());
                for satellite in &companion.moons {
                    let def = gd.planet_classes.get(&satellite.class).unwrap();
                    assert!(!def.star, "{layout} seed {seed}");
                    if layout == "trinary_init_02" {
                        let band = def.distance_from_sun.expect("a drawn class has a band");
                        assert!(
                            band.contains(satellite.orbit),
                            "{layout} seed {seed}: {} at {} about its star",
                            satellite.class,
                            satellite.orbit
                        );
                    }
                    for moon in &satellite.moons {
                        assert!(gd.planet_classes.get(&moon.class).unwrap().can_be_moon);
                        assert!(moon.moons.is_empty());
                    }
                }
            }
            match layout {
                "binary_init_01" => {
                    assert_eq!(
                        stars(&spec).iter().map(|s| s.orbit).collect::<Vec<_>>(),
                        [25.0, 25.0],
                        "both off the centre"
                    );
                }
                "binary_init_02" => {
                    let unhabitable = gd.planet_lists.get("rl_unhabitable_planets").unwrap();
                    let companion = stars(&spec)[1];
                    assert_eq!((spec.star.orbit, companion.orbit), (0.0, 240.0));
                    assert!((2..=3).contains(&companion.moons.len()));
                    for satellite in &companion.moons {
                        assert!(unhabitable.contains(&satellite.class));
                    }
                }
                "trinary_init_01" => {
                    let orbits: Vec<f64> = stars(&spec).iter().map(|s| s.orbit).collect();
                    assert_eq!(orbits[0], 25.0);
                    for pair in orbits.windows(2) {
                        let step = pair[1] - pair[0];
                        assert!((0.0..=20.0 + 1e-9).contains(&step), "{orbits:?}");
                    }
                    for orbit in &orbits {
                        assert!((orbit * 50.0 - (orbit * 50.0).round()).abs() < 1e-6);
                        if orbit.fract() != 0.0 {
                            fractional += 1;
                        }
                    }
                }
                _ => {
                    let companions: Vec<f64> =
                        stars(&spec).iter().skip(1).map(|s| s.orbit).collect();
                    assert_eq!(companions, [220.0, 220.0]);
                }
            }
        }
        assert!(drawn > 5, "{layout}: {drawn}");
    }
    assert!(fractional > 0, "trinary_init_01's ranged steps draw reals");
    assert!(!companion_deposits.is_empty());
    assert!(
        companion_deposits.is_subset(&primary_deposits),
        "a companion rolls only what a star rolls: {companion_deposits:?}"
    );
}

/// A scenario system whose planets the game rolls shows only planets about the centre for a
/// trinary class: its stars, and the planets of its companions, are no placeholders.
#[test]
fn a_rolled_trinary_systems_placeholders_are_its_planets_alone() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let mut shown = 0;
    for roll in 0..40 {
        let rolled = gd.system_roll(7, "", "sc_trinary_1", roll, 400.0);
        assert!(rolled.rolls_planets);
        for body in &rolled.placeholders {
            let class = gd.planet_classes.get(&body.class).expect("a class");
            assert!(!class.star, "roll {roll}: {}", body.class);
            assert!(body.orbit <= 400.0);
        }
        shown += rolled.placeholders.len();
    }
    assert!(shown > 0);
}

/// Sol's cluster is offered now that its neighbours build, and rolls inside its chain.
#[test]
fn sols_cluster_is_offered_and_rolls() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    assert!(menu_clusters(gd).iter().any(|c| c.key == "sol_neighbours"));
    let mut session = open_4_5();
    let original = current(&session);
    let roll = roll_cluster(gd, &session, 2, SPOT, "sol_neighbours")
        .expect("the roll")
        .view(gd);
    assert_eq!(roll.members.len(), 5);
    assert!(roll.members.iter().all(|m| m.refused.is_none()));
    let op = cluster_op(gd, &session, 2, SPOT, "sol_neighbours", true, &[]).expect("the op");
    let Op::Batch { description, .. } = &op else {
        panic!("a batch")
    };
    assert_eq!(
        description,
        "Added Sol and its neighbours: 5 systems and 4 lanes"
    );
    session.apply(op).expect("the add");
    session.undo().expect("undo").expect("the add");
    assert_eq!(current(&session), original);
}

/// Each multi-star system goes into the 4.5 sample with what its script plants, and taking
/// it out and undoing that gives the same bytes. Without the extras the removal keeps no
/// record of, it reads back whole: adding the read-back spec writes the same bytes.
#[test]
fn each_multi_star_system_round_trips_through_a_removal() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let session = open_4_5();
    let original = current(&session);
    let mut adds: Vec<(String, Op, Op)> = Vec::new();
    for layout in [
        ALPHA_CENTAURI,
        PROCYON,
        SIRIUS,
        "broken_shroudwalker_init_01",
        "mechanocalibrator_system",
        "living_planet_system",
    ] {
        let op = |extras| special_op(gd, &session, 1, SPOT, layout, extras, &[]).expect(layout);
        adds.push((layout.to_owned(), op(true), op(false)));
    }
    for (layout, class) in RANDOM {
        let (seed, pick) = by_class(gd, &session, layout, class);
        let spec = for_save(gd, &session, seed, SPOT, &pick).expect(layout);
        let op = Op::AddSystemFromSpec { spec };
        adds.push((layout.to_owned(), op.clone(), op));
    }
    let last_added = |session: &Session| {
        session
            .graph()
            .systems
            .values()
            .filter(|s| s.added)
            .map(|s| s.id)
            .max()
            .expect("an added system")
    };
    for (layout, with_extras, bare) in adds {
        let mut session = open_4_5();
        session
            .apply(with_extras)
            .unwrap_or_else(|e| panic!("{layout}: {e}"));
        let added = current(&session);
        let system = last_added(&session);
        session
            .apply(Op::RemoveSystem { system })
            .expect("the removal");
        session.undo().expect("undo").expect("the removal");
        same(
            &current(&session),
            &added,
            &format!("{layout}: undo the removal"),
        );
        session.undo().expect("undo").expect("the add");
        same(
            &current(&session),
            &original,
            &format!("{layout}: undo the add"),
        );

        let mut session = open_4_5();
        session
            .apply(bare)
            .unwrap_or_else(|e| panic!("{layout}: {e}"));
        let added = current(&session);
        let system = last_added(&session);
        let removed = session
            .apply(Op::RemoveSystem { system })
            .expect("the removal");
        session
            .apply_inverse(removed.inverse)
            .unwrap_or_else(|e| panic!("{layout}: {e}"));
        same(
            &current(&session),
            &added,
            &format!("{layout}: the read-back"),
        );
    }
}

/// `got` is `want`, else the lines about where they first differ.
fn same(got: &[u8], want: &[u8], what: &str) {
    if got == want {
        return;
    }
    let (got, want) = (String::from_utf8_lossy(got), String::from_utf8_lossy(want));
    let (got, want): (Vec<&str>, Vec<&str>) = (got.lines().collect(), want.lines().collect());
    let at = got
        .iter()
        .zip(&want)
        .position(|(a, b)| a != b)
        .unwrap_or(got.len().min(want.len()));
    let around = |lines: &[&str]| {
        lines[at.saturating_sub(15)..(at + 15).min(lines.len())].join(
            "
",
        )
    };
    panic!(
        "{what}: line {at}
--- got
{}
--- want
{}",
        around(&got),
        around(&want)
    );
}

/// Stars of two classes, a list of the two binaries, and layouts that write their stars as
/// classes, count them, and number what they hold.
const STAR_FILES: [(&str, &str); 3] = [
    (
        "common/planet_classes/00_planets.txt",
        "pc_x_star = {\n\tstar = yes\n\tplanet_size = 20\n}\n\
         pc_y_star = {\n\tstar = yes\n\tplanet_size = 20\n}\n\
         pc_z_star = {\n\tstar = yes\n\tplanet_size = 20\n}\n\
         pc_rock = {\n\tspawn_odds = 10\n\tplanet_size = 10\n\tmoon_size = 5\n}\n",
    ),
    (
        "common/star_classes/00_stars.txt",
        "sc_x = {\n\tclass = x_star\n\tplanet = { key = pc_x_star }\n\tspawn_odds = 10\n}\n\
         sc_xy = {\n\tclass = x_star\n\tplanet = { key = pc_x_star }\n\tplanet = { key = pc_y_star }\n\tspawn_odds = 5\n}\n\
         sc_yx = {\n\tclass = y_star\n\tplanet = { key = pc_y_star }\n\tplanet = { key = pc_x_star }\n\tspawn_odds = 5\n}\n\
         rl_one = {\n\tstars = { sc_x }\n}\n\
         rl_two = {\n\tstars = { sc_xy sc_yx }\n}\n",
    ),
    (
        "common/solar_system_initializers/00_fx.txt",
        "fx_written = {\n\tclass = rl_two\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { class = pc_y_star orbit_distance = 20 }\n\
         \tplanet = { class = pc_x_star orbit_distance = 0 orbit_angle = 180 }\n}\n\
         fx_unmatched = {\n\tclass = rl_two\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { class = pc_z_star orbit_distance = 20 }\n\
         \tplanet = { class = pc_z_star orbit_distance = 0 }\n}\n\
         fx_counted = {\n\tclass = sc_xy\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { class = pc_x_star count = 2 orbit_distance = 20 orbit_angle = 180 }\n}\n\
         fx_ranged = {\n\tclass = sc_xy\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { class = pc_x_star count = { min = 1 max = 2 } orbit_distance = 20 }\n}\n\
         fx_one_star_block = {\n\tclass = sc_xy\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { class = star count = 2 orbit_distance = 20 }\n}\n\
         fx_numbered = {\n\tclass = rl_two\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { class = star orbit_distance = 0 }\n\
         \tplanet = {\n\t\tclass = star orbit_distance = 200\n\t\tsatellite_naming_policy = upper_case_roman_numerals\n\
         \t\tplanet = {\n\t\t\tclass = pc_rock orbit_distance = 30\n\t\t\tsatellite_naming_policy = lower_case_latin_letters\n\
         \t\t\tmoon = { class = pc_rock orbit_distance = 5 }\n\t\t}\n\t}\n}\n\
         fx_roman_planet = {\n\tclass = rl_one\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { class = star orbit_distance = 0 }\n\
         \tplanet = { class = pc_rock orbit_distance = 40 satellite_naming_policy = upper_case_roman_numerals }\n}\n\
         fx_latin_star = {\n\tclass = rl_one\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { class = star orbit_distance = 0 satellite_naming_policy = lower_case_latin_letters }\n}\n",
    ),
];

/// A list layout whose stars are written as classes takes the list's class with those stars
/// in that order, or none; star bodies are counted by instance; and a naming policy is the
/// one the add writes only where it sits on a body of that kind.
#[test]
fn stars_written_as_classes_counted_and_numbered_are_judged_where_they_sit() {
    let (_dir, gd) = hand_written(&STAR_FILES);
    assert_eq!(of(&gd, "fx_written"), Eligibility::Special);
    for seed in 0..20 {
        let spec = by_name(&gd, seed, "Fx", (0.0, 0.0), "fx_written").expect("fx_written");
        assert_eq!(spec.star_class, "sc_yx", "seed {seed}: Y then X");
        let classes: Vec<&str> = stars(&spec).iter().map(|s| s.class.as_str()).collect();
        assert_eq!(classes, ["pc_y_star", "pc_x_star"]);
    }
    assert_eq!(
        of(&gd, "fx_unmatched"),
        Eligibility::Unsupported(Unsupported::StarMismatch("pc_z_star".to_owned())),
        "no class of the list has its stars"
    );

    assert_eq!(of(&gd, "fx_counted"), Eligibility::Special);
    let spec = by_name(&gd, 1, "Fx", (0.0, 0.0), "fx_counted").expect("fx_counted");
    let classes: Vec<&str> = stars(&spec).iter().map(|s| s.class.as_str()).collect();
    assert_eq!(
        classes,
        ["pc_x_star", "pc_x_star"],
        "two instances, kept as written"
    );
    assert_eq!(
        of(&gd, "fx_ranged"),
        Eligibility::Unsupported(Unsupported::StarCount {
            blocks: 1,
            stars: 2
        }),
        "one or two stars for a class of two"
    );
    assert_eq!(
        of(&gd, "fx_one_star_block"),
        Eligibility::Unsupported(Unsupported::StarCount {
            blocks: 1,
            stars: 2
        }),
        "class = star spawns once whatever its count"
    );

    assert_eq!(of(&gd, "fx_numbered"), Eligibility::Plain);
    for (layout, policy) in [
        ("fx_roman_planet", "upper_case_roman_numerals"),
        ("fx_latin_star", "lower_case_latin_letters"),
    ] {
        assert_eq!(
            of(&gd, layout),
            Eligibility::Unsupported(Unsupported::Naming(policy.to_owned())),
            "{layout}"
        );
    }
}

/// A fixed distance that is not whole is taken as written, with no draw: Jupiter's moons in
/// Sol step 10, 2.5 and 2.5 out from its change_orbit of 6.
#[test]
fn a_fractional_fixed_distance_is_taken_as_written() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    for seed in 0..10 {
        let sol = by_name(gd, seed, "Gen", SPOT, "sol_system_initializer").expect("Sol");
        let jupiter = sol
            .planets
            .iter()
            .find(|p| p.name.as_deref() == Some("NAME_Jupiter"))
            .expect("Jupiter");
        let orbits: Vec<f64> = jupiter.moons.iter().take(3).map(|m| m.orbit).collect();
        assert_eq!(orbits, [16.0, 18.5, 21.0], "seed {seed}");
    }
}
