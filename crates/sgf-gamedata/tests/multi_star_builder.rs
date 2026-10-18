//! Binary and trinary systems built star by star on the real install: the class chosen stars
//! are filed under, one case per step of the rule, the star types and arrangements the
//! builder offers, a built system rolled and added to the 4.5 sample, and random binaries and
//! trinaries.

use crate::common;

use sgf_core::ops::{BodyKind, BodySpec, Op};
use sgf_gamedata::GameData;
use sgf_gamedata::deposit_roll::{Kind, RollBody, fitting};
use sgf_gamedata::generate::{BuiltSystem, ForSaveError, GenerateError, Pick, built_op, for_save};
use sgf_gamedata::multi_star::{FiledReason, Shape, arrangements, file_star_class, star_types};
use sgf_gamedata::views::StarClassView;

use common::layouts::stars;
use common::prepare::current;
use common::{INSTALL, SPOT, open_4_5};

fn keys(stars: &[&str]) -> Vec<String> {
    stars.iter().map(|&star| star.to_owned()).collect()
}

fn filed(gd: &GameData, stars: &[&str]) -> (String, FiledReason) {
    let filed = file_star_class(gd, &keys(stars), None).expect("filed");
    (filed.class, filed.reason)
}

/// One case for each step of the rule, with the precedents it follows.
#[test]
fn chosen_stars_are_filed_by_the_first_step_that_applies() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let effect = |star: &str| FiledReason::EffectStar {
        star: star.to_owned(),
    };
    let alone = |star: &str| FiledReason::EffectStarAlone {
        star: star.to_owned(),
    };
    let cases: [(&[&str], &str, FiledReason); 10] = [
        (
            &["pc_b_star", "pc_neutron_star"],
            "sc_binary_2",
            FiledReason::Exact,
        ),
        (
            &["pc_neutron_star", "pc_b_star"],
            "sc_binary_2",
            FiledReason::Exact,
        ),
        (
            &["pc_m_giant_star", "pc_pulsar"],
            "sc_crisis_binary_1",
            FiledReason::Exact,
        ),
        (
            &["pc_g_star", "pc_pulsar"],
            "sc_binary_1",
            effect("pc_pulsar"),
        ),
        (
            &["pc_black_hole"; 3],
            "sc_black_hole",
            alone("pc_black_hole"),
        ),
        (
            &["pc_t_star", "pc_black_hole"],
            "sc_black_hole",
            alone("pc_black_hole"),
        ),
        (&["pc_pulsar"; 3], "sc_pulsar", alone("pc_pulsar")),
        (
            &["pc_g_star", "pc_g_star"],
            "sc_binary_8",
            FiledReason::MostShared { shared: 1 },
        ),
        // A brown dwarf shares one star with A + T, and a red giant one with each of its two
        // binaries; no class leads with T, so the first key wins.
        (
            &["pc_t_star", "pc_m_giant_star"],
            "sc_binary_10",
            FiledReason::MostShared { shared: 1 },
        ),
        // No class has a protostar: the binary a galaxy draws most often, the first key of
        // those without effects.
        (
            &["pc_protostar", "pc_protostar"],
            "sc_binary_10",
            FiledReason::Commonest,
        ),
    ];
    for (stars, class, reason) in cases {
        assert_eq!(filed(gd, stars), (class.to_owned(), reason), "{stars:?}");
    }

    let chosen = file_star_class(gd, &keys(&["pc_black_hole", "pc_t_star"]), Some("sc_g"))
        .expect("an override");
    assert_eq!(
        (chosen.class.as_str(), chosen.reason),
        ("sc_g", FiledReason::Chosen)
    );
    assert_eq!(file_star_class(gd, &[], None), Err(GenerateError::NoStars));
    assert_eq!(
        file_star_class(gd, &keys(&["pc_g_star", "pc_continental"]), None),
        Err(GenerateError::NotAStar("pc_continental".to_owned()))
    );
    assert_eq!(
        file_star_class(gd, &keys(&["pc_g_star"]), Some("sc_nope")),
        Err(GenerateError::UnknownStar("sc_nope".to_owned()))
    );
}

/// Every star type of the install, the eleven a galaxy draws first, each marked when its own
/// class has effects.
#[test]
fn the_slots_offer_every_star_type_the_usual_ones_first() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let types = star_types(gd);
    let usual: Vec<&str> = types
        .iter()
        .take_while(|t| t.usual)
        .map(|t| t.key.as_str())
        .collect();
    let mut sorted = usual.clone();
    sorted.sort_unstable();
    assert_eq!(
        sorted,
        [
            "pc_a_star",
            "pc_b_star",
            "pc_black_hole",
            "pc_f_star",
            "pc_g_star",
            "pc_k_star",
            "pc_m_giant_star",
            "pc_m_star",
            "pc_neutron_star",
            "pc_pulsar",
            "pc_t_star",
        ]
    );
    for rest in ["pc_toxoid_star", "pc_rift_star", "pc_protostar"] {
        let found = types[usual.len()..].iter().find(|t| t.key == rest);
        assert!(found.is_some(), "{rest} after the usual ones");
    }
    let with_effects: Vec<&str> = types
        .iter()
        .filter(|t| t.effects)
        .map(|t| t.key.as_str())
        .collect();
    assert_eq!(
        with_effects.len(),
        4,
        "black hole, neutron star, pulsar, toxoid: {with_effects:?}"
    );
    assert!(types.iter().all(|t| !t.name.is_empty()));
}

/// A class with effects lists each modifier with the game's name for it, for the class
/// picker's tags; one without lists none.
#[test]
fn a_star_class_names_the_modifiers_it_puts_on_its_systems() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let view = |key: &str| StarClassView::new(gd.star_classes.get(key).expect(key), &gd.loc);
    let neutron = view("sc_neutron_star").modifiers.expect("a neutron star's");
    assert_eq!(neutron.len(), 1);
    assert_eq!(neutron[0].key, "ship_speed_reduction");
    assert!(!neutron[0].name.is_empty(), "{neutron:?}");
    assert_eq!(view("sc_g").modifiers, None);
    assert_eq!(
        view("sc_rift_star").modifiers,
        None,
        "an empty modifier block"
    );
}

/// The four random layouts, each named by what it does with its stars, with its share of the
/// draw among the layouts of as many stars and where its stars stand.
#[test]
fn the_arrangements_are_the_plain_multi_star_layouts() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let arrangements = arrangements(gd);
    let got: Vec<(&str, u32, Shape, f64)> = arrangements
        .iter()
        .map(|a| (a.layout.as_str(), a.stars, a.shape, a.share))
        .collect();
    assert_eq!(
        got,
        [
            ("binary_init_01", 2, Shape::ClosePair, 0.6),
            ("binary_init_02", 2, Shape::DistantCompanion, 0.4),
            ("trinary_init_01", 3, Shape::CloseTrio, 0.5),
            ("trinary_init_02", 3, Shape::TwoDistantCompanions, 0.5),
        ]
    );
    let orbits: Vec<(&str, &str, Vec<f64>)> = arrangements
        .iter()
        .map(|a| {
            let orbits = a.diagram.stars.iter().map(|s| s.orbit).collect();
            (a.layout.as_str(), a.name.as_str(), orbits)
        })
        .collect();
    assert_eq!(
        orbits,
        [
            ("binary_init_01", "Close pair", vec![25.0, 25.0]),
            ("binary_init_02", "Distant companion", vec![0.0, 240.0]),
            ("trinary_init_01", "Close trio", vec![25.0, 35.0, 45.0]),
            (
                "trinary_init_02",
                "Two distant companions",
                vec![0.0, 220.0, 220.0]
            ),
        ]
    );
    for arrangement in &arrangements {
        for star in &arrangement.diagram.stars {
            assert!(
                (star.x.hypot(star.y) - star.orbit).abs() < 1e-6,
                "{}: {star:?} stands on its path",
                arrangement.layout
            );
        }
    }
    let pair = &arrangements[0].diagram.stars;
    assert!(
        (pair[0].x - pair[1].x).hypot(pair[0].y - pair[1].y) > 1.0,
        "a close pair's stars stand apart: {pair:?}"
    );
}

/// A system built without planets holds its stars alone, where the arrangement puts them,
/// each with its own deposits; undoing its add gives back the same bytes.
#[test]
fn a_built_system_without_planets_holds_its_stars_alone() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let built = BuiltSystem {
        layout: "trinary_init_02".to_owned(),
        stars: keys(&["pc_pulsar", "pc_g_star", "pc_m_star"]),
        star_class: None,
        planets: false,
    };
    let mut session = open_4_5();
    let spec = for_save(gd, &session, 5, SPOT, &Pick::Built(built.clone())).expect("the roll");
    assert_eq!(spec.star_class, "sc_pulsar");
    assert!(spec.belts.is_empty());
    assert!(
        spec.planets
            .iter()
            .all(|p| p.kind == BodyKind::Star && p.moons.is_empty())
    );
    let classes: Vec<&str> = stars(&spec).iter().map(|s| s.class.as_str()).collect();
    assert_eq!(classes, ["pc_pulsar", "pc_g_star", "pc_m_star"]);
    let orbits: Vec<f64> = stars(&spec).iter().map(|s| s.orbit).collect();
    assert_eq!(orbits, [0.0, 220.0, 220.0]);
    assert!(
        stars(&spec).iter().any(|s| !s.deposits.is_empty()),
        "{spec:?}"
    );

    let original = current(&session);
    let op = built_op(gd, &session, 5, SPOT, &built, &[]).expect("the op");
    session.apply(op).expect("the add");
    let added = session
        .graph()
        .systems
        .values()
        .find(|s| s.added)
        .expect("the added system");
    assert_eq!(added.star_class, "sc_pulsar");
    session.undo().expect("undo").expect("the add");
    assert!(current(&session) == original, "undo gives back the bytes");
}

/// A black hole with a brown dwarf companion, built: the stars in slot order, filed as a black
/// hole, each star's deposits its own class's, planets drawn at the black hole's odds within
/// the layout's counts. The add writes the pick's roll, and undoing it gives back the same
/// bytes.
#[test]
fn a_built_system_rolls_its_chosen_stars_and_adds_as_rolled() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let built = BuiltSystem {
        layout: "binary_init_02".to_owned(),
        stars: keys(&["pc_black_hole", "pc_t_star"]),
        star_class: None,
        planets: true,
    };
    let pick = |built: &BuiltSystem| Pick::Built(built.clone());
    let mut session = open_4_5();
    let black_hole = gd.star_classes.get("sc_black_hole").expect("sc_black_hole");
    for seed in 0..12 {
        let spec = for_save(gd, &session, seed, SPOT, &pick(&built)).expect("the roll");
        assert_eq!(spec.star_class, "sc_black_hole", "seed {seed}");
        assert_eq!(spec.initializer, "binary_init_02");
        let classes: Vec<&str> = stars(&spec).iter().map(|s| s.class.as_str()).collect();
        assert_eq!(classes, ["pc_black_hole", "pc_t_star"], "seed {seed}");
        for star in stars(&spec) {
            let body = RollBody {
                class: &star.class,
                size: star.size,
                kind: Kind::Star,
            };
            let fits: Vec<&str> = fitting(gd, &body, &[])
                .iter()
                .map(|d| d.key.as_str())
                .collect();
            assert!(
                star.deposits.iter().all(|d| fits.contains(&d.as_str())),
                "seed {seed}: {} holds {:?}",
                star.class,
                star.deposits
            );
        }
        let centre: Vec<&BodySpec> = spec
            .planets
            .iter()
            .filter(|p| p.kind != BodyKind::Star)
            .collect();
        let companion = stars(&spec)[1];
        assert!(
            centre.len() <= 5 && companion.moons.len() <= 3,
            "seed {seed}"
        );
        // The companion's planets are written as a list, drawn alike whatever the star.
        for planet in &centre {
            assert!(
                black_hole.planet_odds(&planet.class) > 0.0,
                "seed {seed}: {} never spawns about a black hole",
                planet.class
            );
        }
    }

    let original = current(&session);
    let op = built_op(gd, &session, 3, SPOT, &built, &[]).expect("the op");
    session.apply(op).expect("the add");
    let mut rolled = open_4_5();
    let spec = for_save(gd, &rolled, 3, SPOT, &pick(&built)).expect("the roll");
    rolled
        .apply(Op::AddSystemFromSpec { spec })
        .expect("the roll's add");
    assert!(
        current(&session) == current(&rolled),
        "the add writes the roll"
    );
    session.undo().expect("undo").expect("the add");
    assert!(current(&session) == original, "undo gives back the bytes");

    let chosen = BuiltSystem {
        star_class: Some("sc_binary_10".to_owned()),
        ..built.clone()
    };
    let spec = for_save(gd, &session, 3, SPOT, &pick(&chosen)).expect("an override");
    assert_eq!(spec.star_class, "sc_binary_10");

    let three = BuiltSystem {
        stars: keys(&["pc_g_star"; 3]),
        ..built.clone()
    };
    assert!(matches!(
        for_save(gd, &session, 3, SPOT, &pick(&three)),
        Err(ForSaveError::Generate(GenerateError::StarCount {
            blocks: 2,
            stars: 3,
            ..
        }))
    ));
    let special = BuiltSystem {
        layout: "sol_neighbor_t2".to_owned(),
        ..built
    };
    assert!(matches!(
        for_save(gd, &session, 3, SPOT, &pick(&special)),
        Err(ForSaveError::Generate(GenerateError::NotPlain(_)))
    ));
}

/// A random binary rolls only the two-star layouts and a random trinary the three-star ones,
/// each with a class of its layout's list.
#[test]
fn random_binaries_and_trinaries_roll_only_layouts_of_that_many_stars() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let session = open_4_5();
    for (count, layouts) in [
        (2, ["binary_init_01", "binary_init_02"]),
        (3, ["trinary_init_01", "trinary_init_02"]),
    ] {
        let mut seen: Vec<String> = Vec::new();
        for seed in 0..30 {
            let spec = for_save(gd, &session, seed, SPOT, &Pick::Stars(count)).expect("a roll");
            assert!(
                layouts.contains(&spec.initializer.as_str()),
                "{count} stars, seed {seed}: {}",
                spec.initializer
            );
            assert_eq!(stars(&spec).len(), count, "seed {seed}");
            let class = gd.star_classes.get(&spec.star_class).expect("its class");
            assert_eq!(class.planets.len(), count, "seed {seed}");
            if !seen.contains(&spec.initializer) {
                seen.push(spec.initializer.clone());
            }
        }
        assert_eq!(seen.len(), 2, "both layouts of {count} stars: {seen:?}");
    }
    assert!(matches!(
        for_save(gd, &session, 0, SPOT, &Pick::Stars(4)),
        Err(ForSaveError::Generate(GenerateError::NoArrangement(4)))
    ));
}
