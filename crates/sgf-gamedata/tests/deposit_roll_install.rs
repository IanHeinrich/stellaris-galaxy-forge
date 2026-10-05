//! Rolling a new body's deposits from the real install's rules, against the shares the
//! research tallied in day-one saves.

use crate::common;

use std::collections::{BTreeMap, BTreeSet};

use sgf_core::ops::{BodySpec, SystemSpec};
use sgf_gamedata::GameData;
use sgf_gamedata::deposit_roll::{Kind, NewBody, RollBody, roll_deposits};
use sgf_gamedata::generate::generate;
use sgf_gamedata::rng::Rng;

use common::INSTALL;
use common::deposits::{blockers, body};

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
            kind: Kind::Star,
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
            for _ in 0..planets * 40 {
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
                let kind = match moon {
                    true => Kind::Moon,
                    false => Kind::Planet,
                };
                let b = RollBody {
                    kind,
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
