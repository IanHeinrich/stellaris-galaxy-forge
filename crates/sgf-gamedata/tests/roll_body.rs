//! Rolling a lone planet or moon from the classes that spawn where it stands, on a
//! hand-written install and on the real one.

use crate::common;

use std::collections::BTreeSet;

use sgf_core::ops::{BodySpec, NewBody, Op};
use sgf_core::views::OrbitPlacement;
use sgf_gamedata::GameData;
use sgf_gamedata::generate::{BodyRoll, GenerateError, body_classes, roll_body};

use common::generate::{SEEDS, hand_written, within};
use common::{ABUNDANCE, INSTALL};

fn lone(class: Option<&str>, moon: bool, orbit: f64) -> BodyRoll<'_> {
    BodyRoll {
        star_class: "sc_sun",
        class,
        size: None,
        moon,
        orbit,
        abundance: ABUNDANCE,
    }
}

#[test]
fn a_lone_body_is_rolled_from_the_classes_that_spawn_where_it_stands() {
    let (_dir, gd) = hand_written();
    let keys = |moon| -> Vec<&str> {
        body_classes(&gd, moon)
            .iter()
            .map(|c| c.key.as_str())
            .collect()
    };
    assert_eq!(keys(false), ["pc_meadow", "pc_puff", "pc_rock"]);
    assert_eq!(
        keys(true),
        ["pc_meadow", "pc_rock"],
        "pc_puff cannot be a moon"
    );

    let mut near = BTreeSet::new();
    let mut moons = BTreeSet::new();
    let mut far = BTreeSet::new();
    for seed in 0..200 {
        let planet = roll_body(&gd, seed, &lone(None, false, 20.0)).expect("a planet");
        near.insert(planet.class.clone());
        let range = gd.planet_classes.get(&planet.class).unwrap().planet_size;
        assert!(within(planet.size, range.unwrap()), "seed {seed}");
        let moon = roll_body(&gd, seed, &lone(None, true, 80.0)).expect("a moon");
        assert!(!moon.ring, "a moon has no ring");
        moons.insert(moon.class);
        far.insert(
            roll_body(&gd, seed, &lone(None, false, 5000.0))
                .unwrap()
                .class,
        );
    }
    assert_eq!(
        near,
        BTreeSet::from(["pc_rock".to_owned()]),
        "only rock spawns at 20"
    );
    assert_eq!(
        moons,
        BTreeSet::from(["pc_meadow".to_owned(), "pc_rock".to_owned()])
    );
    assert_eq!(
        far,
        BTreeSet::from([
            "pc_meadow".to_owned(),
            "pc_puff".to_owned(),
            "pc_rock".to_owned()
        ]),
        "past every band, any class"
    );
}

#[test]
fn an_artificial_planet_is_never_offered_or_rolled() {
    let (_dir, gd) = hand_written();
    assert!(gd.planet_classes.get("pc_shell").unwrap().artificial);
    for moon in [false, true] {
        assert!(
            body_classes(&gd, moon).iter().all(|c| c.key != "pc_shell"),
            "moon {moon}"
        );
    }
    for seed in 0..SEEDS {
        for (moon, orbit) in [(false, 20.0), (true, 80.0), (false, 5000.0)] {
            let body = roll_body(&gd, seed, &lone(None, moon, orbit)).expect("a body");
            assert_ne!(body.class, "pc_shell", "seed {seed}");
        }
    }
}

#[test]
fn the_real_install_offers_no_arkship_but_keeps_its_other_special_worlds() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    for moon in [false, true] {
        let keys: Vec<&str> = body_classes(gd, moon)
            .iter()
            .map(|c| c.key.as_str())
            .collect();
        assert!(!keys.contains(&"pc_ark"), "moon {moon}");
        for kept in [
            "pc_city",
            "pc_relic",
            "pc_infested",
            "pc_gray_goo",
            "pc_nanotech",
        ] {
            assert!(keys.contains(&kept), "{kept}, moon {moon}");
        }
    }
    assert!(gd.planet_classes.get("pc_ark").unwrap().artificial);
}

#[test]
fn a_lone_body_keeps_the_class_and_size_asked_for() {
    let (_dir, gd) = hand_written();
    for seed in 0..50 {
        let sized = BodyRoll {
            size: Some(17),
            ..lone(Some("pc_meadow"), false, 300.0)
        };
        let planet = roll_body(&gd, seed, &sized).expect("a meadow");
        assert_eq!((planet.class.as_str(), planet.size), ("pc_meadow", 17));
        let moon = roll_body(&gd, seed, &lone(Some("pc_rock"), true, 10.0)).expect("a moon");
        assert!((5..=8).contains(&moon.size), "a moon's size range");
        let drawn = lone(None, true, 80.0);
        assert_eq!(
            roll_body(&gd, seed, &drawn),
            roll_body(&gd, seed, &drawn),
            "seed {seed}: the same seed rolls the same moon"
        );
    }
    assert_eq!(
        roll_body(&gd, 1, &lone(Some("pc_nowhere"), false, 50.0)),
        Err(GenerateError::UnknownPlanetClass("pc_nowhere".to_owned()))
    );
    let unknown_star = BodyRoll {
        star_class: "sc_nowhere",
        ..lone(None, false, 50.0)
    };
    assert_eq!(
        roll_body(&gd, 1, &unknown_star),
        Err(GenerateError::UnknownStar("sc_nowhere".to_owned()))
    );
}

/// Bodies rolled from the real install join Meissa (408) of the 4.5 sample, a planet and a moon
/// of Meissa IV, each with the deposits it rolled.
#[test]
fn bodies_rolled_from_the_real_install_are_added_to_a_save() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let mut session = common::open_4_5();
    let planet = roll_body(
        gd,
        7,
        &BodyRoll {
            star_class: "sc_b",
            class: None,
            size: None,
            moon: false,
            orbit: 170.0,
            abundance: ABUNDANCE,
        },
    )
    .expect("a planet");
    let moon = roll_body(
        gd,
        8,
        &BodyRoll {
            star_class: "sc_b",
            class: Some("pc_barren"),
            size: None,
            moon: true,
            orbit: 145.0,
            abundance: ABUNDANCE,
        },
    )
    .expect("a moon");
    for (spec, moon_of, radius) in [(planet, None, 170.0), (moon, Some(138), 15.0)] {
        let class = gd.planet_classes.get(&spec.class).expect("a real class");
        assert!(body_classes(gd, moon_of.is_some()).contains(&class));
        session
            .apply(Op::AddBody {
                system: 408,
                spec: NewBody {
                    class: spec.class,
                    size: spec.size,
                    moon_of,
                    name: None,
                    deposits: spec.deposits,
                    ring: spec.ring,
                },
                at: OrbitPlacement {
                    radius,
                    angle: 90.0,
                },
            })
            .expect("the op takes the rolled body");
    }
    assert_eq!(session.system(408).expect("Meissa").planet_count, 7);
}

fn real_body(gd: &GameData, seed: u64, class: &str) -> BodySpec {
    let roll = BodyRoll {
        star_class: "sc_b",
        class: Some(class),
        size: None,
        moon: false,
        orbit: 170.0,
        abundance: ABUNDANCE,
    };
    roll_body(gd, seed, &roll).expect("a body")
}

#[test]
fn a_relic_world_gets_the_relic_deposits_from_the_install() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let relic_deposits = [
        "d_relic_dense_ruins",
        "d_collapsed_spire",
        "d_massive_crevice",
        "d_shattered_solar_array",
        "d_flooded_reactor_pits",
        "d_crumbling_mining_tunnels",
        "d_relic_metal_boneyard",
    ];
    for seed in 0..20 {
        assert_eq!(real_body(gd, seed, "pc_relic").deposits, relic_deposits);
    }
}

#[test]
fn other_worlds_the_game_never_spawns_get_no_deposits() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    for class in ["pc_city", "pc_hive", "pc_machine", "pc_nanotech"] {
        assert!(
            gd.planet_classes.get(class).unwrap().spawn_odds <= 0.0,
            "{class} spawns"
        );
        for seed in 0..20 {
            assert!(real_body(gd, seed, class).deposits.is_empty(), "{class}");
        }
    }
}

#[test]
fn a_barren_world_still_rolls_minerals_at_its_usual_share() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let with_minerals = (0..SEEDS)
        .filter(|&seed| {
            let body = real_body(gd, seed, "pc_barren");
            body.deposits.iter().any(|d| d.starts_with("d_mineral"))
        })
        .count();
    assert!(
        (100..=190).contains(&with_minerals),
        "{with_minerals} of {SEEDS} barren worlds rolled minerals"
    );
}
