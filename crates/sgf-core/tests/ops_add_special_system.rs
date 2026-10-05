//! Adding the special layouts to a save, on the 4.5 and the 4.4 sample: a black hole, a
//! system whose star is named by its class, fixed body names, modifiers, a model named by
//! entity, a ring, an off-centre star and star classes as bodies. Each is written as the
//! game writes the layout it copies, undoes byte for byte, and reads back exactly for a
//! removal's and a reroll's inverse. The spec builders here serve the other
//! `ops_add_special_system_*` files.

use sgf_core::ops::{BeltSpec, BodySpec, Op, SystemSpec, initializer_counts};
use sgf_core::session::Session;

use crate::common;
use common::current;
use common::diff::{report, round_trip_step};
use common::spec::{SAMPLE_4_5, SAMPLES, Sample, body, rerolled, star, with_deposits as with};

/// A sample as opened, the spike's system for it, whose place and lane the special
/// systems take, and the id a new system takes.
pub(crate) fn opened(sample: &Sample) -> (Session, SystemSpec, u32) {
    ((sample.open)(), (sample.spike)(), sample.id)
}

pub(crate) fn add(spec: SystemSpec) -> Op {
    Op::AddSystemFromSpec { spec }
}

fn named(name: &str, body: BodySpec) -> BodySpec {
    BodySpec {
        name: Some(name.to_owned()),
        ..body
    }
}

fn belt(kind: &str, inner_radius: f64) -> BeltSpec {
    BeltSpec {
        kind: kind.to_owned(),
        inner_radius,
    }
}

/// `special_init_01`: a black hole with a broken world and a cold barren one.
pub(crate) fn black_hole(at: &SystemSpec) -> SystemSpec {
    SystemSpec {
        name: "Xulbaks_Maw".to_owned(),
        star_class: "sc_black_hole".to_owned(),
        initializer: "special_init_01".to_owned(),
        star: with(
            star(body("pc_black_hole", 30, 0.0, 0.0, 0)),
            &["d_dark_matter_deposit_1"],
        ),
        planets: vec![
            body("pc_broken", 12, 60.0, 40.0, 0),
            body("pc_barren_cold", 14, 90.0, 200.0, 1),
        ],
        ..at.clone()
    }
}

/// `trappist_initializer`: the star written as `class = pc_m_star`, so named by the
/// system's fixed name, and two terraforming candidates.
pub(crate) fn trappist(at: &SystemSpec) -> SystemSpec {
    let candidate = |body: BodySpec| BodySpec {
        modifiers: vec!["terraforming_candidate".to_owned()],
        ..body
    };
    SystemSpec {
        name: "NAME_Trappist".to_owned(),
        star_class: "sc_m".to_owned(),
        initializer: "trappist_initializer".to_owned(),
        capped: true,
        star_named_by_class: true,
        star: star(body("pc_m_star", 20, 0.0, 0.0, 0)),
        planets: vec![
            body("pc_molten", 16, 20.0, 15.0, 1),
            body("pc_barren", 16, 36.0, 100.0, 1),
            body("pc_toxic", 12, 52.0, 210.0, 1),
            candidate(body("pc_barren", 14, 68.0, 335.0, 1)),
            body("pc_continental", 16, 84.0, 40.0, 2),
            candidate(body("pc_barren_cold", 18, 100.0, 270.0, 1)),
            body("pc_frozen", 12, 116.0, 155.0, 1),
        ],
        ..at.clone()
    }
}

/// `previously_terraformed_planet_system_initializer`: the star off centre at 40, a
/// ringed continental world with the layout's model and modifier, and the two belts.
pub(crate) fn terraformed(at: &SystemSpec) -> SystemSpec {
    let world = BodySpec {
        ring: true,
        entity_name: Some("previously_terraformed_planet_entity".to_owned()),
        modifiers: vec!["previously_terraformed_planet".to_owned()],
        ..body("pc_continental", 21, 160.0, 1.0, 0)
    };
    let mut barren = body("pc_barren", 12, 180.0, 130.0, 1);
    barren.moons = vec![body("pc_frozen", 6, 10.0, 200.0, 1)];
    SystemSpec {
        name: "Sgf_Terraformed".to_owned(),
        star_class: "sc_g".to_owned(),
        initializer: "previously_terraformed_planet_system_initializer".to_owned(),
        capped: true,
        star: star(body("pc_g_star", 25, 40.0, 120.0, 0)),
        planets: vec![world, barren],
        belts: vec![
            belt("debris_asteroid_belt", 158.0),
            belt("rocky_asteroid_belt", 100.0),
        ],
        ..at.clone()
    }
}

/// `unique_system_initializer_02`, the Larionessi Refuge: a neutron star, two asteroids
/// from the pool, and a planet with a fixed name whose moons are lettered after it. No
/// sample has drawn it, so its count is appended.
pub(crate) fn larionessi(at: &SystemSpec) -> SystemSpec {
    let moon = || with(body("pc_barren", 10, 10.0, 90.0, 1), &["d_minerals_3"]);
    let mut refuge = named(
        "NAME_Unique_System_2_Planet",
        with(
            body("pc_tropical", 20, 95.0, 300.0, 2),
            &["d_green_hills", "d_lush_jungle", "d_tempestous_mountain"],
        ),
    );
    refuge.moons = vec![
        moon(),
        BodySpec {
            orbit: 20.0,
            ..moon()
        },
    ];
    let asteroid = |angle: f64| BodySpec {
        asteroid: true,
        ..with(body("pc_asteroid", 5, 80.0, angle, 0), &["d_alloys_2"])
    };
    SystemSpec {
        name: "NAME_Unique_System_2".to_owned(),
        star_class: "sc_neutron_star".to_owned(),
        initializer: "unique_system_initializer_02".to_owned(),
        capped: true,
        star: star(with(
            body("pc_neutron_star", 25, 0.0, 0.0, 0),
            &["d_physics_5"],
        )),
        planets: vec![
            with(body("pc_barren", 18, 65.0, 20.0, 1), &["d_minerals_5"]),
            asteroid(120.0),
            asteroid(230.0),
            refuge,
        ],
        belts: vec![
            belt("rocky_asteroid_belt", 35.0),
            belt("rocky_asteroid_belt", 45.0),
            belt("rocky_asteroid_belt", 55.0),
        ],
        ..at.clone()
    }
}

/// `unique_system_initializer_03`, Zevox, on the spike's bodies: a unique system, whose
/// `unique_system` star flag the game's timeline reads when an empire takes it.
pub(crate) fn zevox(at: &SystemSpec) -> SystemSpec {
    SystemSpec {
        name: "NAME_Unique_System_3".to_owned(),
        initializer: "unique_system_initializer_03".to_owned(),
        capped: true,
        flags: vec!["unique_system".to_owned()],
        ..at.clone()
    }
}

/// `great_wound_system`, cut to two of its ten rifts: black holes as bodies, each with a
/// fixed name.
fn great_wound(at: &SystemSpec) -> SystemSpec {
    SystemSpec {
        name: "Sgf_Wound".to_owned(),
        star_class: "sc_black_hole".to_owned(),
        initializer: "great_wound_system".to_owned(),
        capped: true,
        star: with(
            star(body("pc_black_hole", 40, 0.0, 0.0, 0)),
            &["d_dark_matter_deposit_10"],
        ),
        planets: vec![
            named(
                "NAME_Subspace_Rupture_1",
                star(body("pc_black_hole", 20, 60.0, 1.0, 0)),
            ),
            named(
                "NAME_Subspace_Rupture_2",
                star(body("pc_black_hole", 20, 120.0, 211.0, 0)),
            ),
            body("pc_barren", 10, 150.0, 90.0, 1),
        ],
        ..at.clone()
    }
}

/// `wenkwort_initializer`'s shape: a planet with the layout's modifier whose first moon
/// has a fixed name and whose second is lettered, and a gas giant with the layout's model
/// and no ring.
pub(crate) fn wenkwort(at: &SystemSpec) -> SystemSpec {
    let mut prime = BodySpec {
        modifiers: vec!["pm_wenkwort_gardens".to_owned()],
        ..body("pc_tropical", 18, 80.0, 60.0, 1)
    };
    prime.moons = vec![
        named("NAME_wenkwort_moon", body("pc_barren", 8, 12.0, 30.0, 1)),
        body("pc_frozen", 6, 20.0, 200.0, 1),
    ];
    let giant = BodySpec {
        entity_name: Some("gas_giant_02_entity".to_owned()),
        ..body("pc_gas_giant", 24, 140.0, 250.0, 0)
    };
    SystemSpec {
        name: "Sgf_Wenkwort".to_owned(),
        star_class: "sc_f".to_owned(),
        initializer: "wenkwort_initializer".to_owned(),
        capped: true,
        star: star(body("pc_f_star", 24, 0.0, 0.0, 0)),
        planets: vec![body("pc_molten", 12, 45.0, 170.0, 1), prime, giant],
        ..at.clone()
    }
}

type Special = (&'static str, fn(&SystemSpec) -> SystemSpec);

pub(crate) const SPECIALS: [Special; 6] = [
    ("black_hole", black_hole),
    ("trappist", trappist),
    ("terraformed", terraformed),
    ("larionessi", larionessi),
    ("great_wound", great_wound),
    ("wenkwort", wenkwort),
];

/// `n` places near `at` inside the galaxy, each at least 10 from every system and from
/// the others.
pub(crate) fn free_spots(session: &Session, at: &SystemSpec, n: usize) -> Vec<(f64, f64)> {
    let graph = session.graph();
    let mut spots: Vec<(f64, f64)> = Vec::new();
    for step in 0..400_u32 {
        let (ring, turn) = (f64::from(step / 12), f64::from(step % 12));
        let angle = (turn * 30.0 + ring * 7.0).to_radians();
        let (x, y) = (
            at.x + ring * 12.0 * angle.cos(),
            at.y + ring * 12.0 * angle.sin(),
        );
        let clear = |(ox, oy): (f64, f64)| (ox - x).hypot(oy - y) >= 11.0;
        if x.hypot(y) < graph.galaxy_radius - 5.0
            && graph.systems.values().all(|s| clear((s.x, s.y)))
            && spots.iter().all(|&spot| clear(spot))
        {
            spots.push((x, y));
            if spots.len() == n {
                return spots;
            }
        }
    }
    panic!("no room near ({}, {})", at.x, at.y);
}

/// On the 4.5 sample only: the 4.4 sample differs in ids, slots and coordinates, and
/// `ops_add_system` snapshots what its version writes differently.
#[test]
fn each_special_layout_is_written_as_the_game_writes_it() {
    for (label, special) in SPECIALS {
        let (mut session, at, _) = opened(SAMPLE_4_5);
        let result = session.apply(add(special(&at))).expect("add the system");
        common::snapshot(&format!("add_{label}_4_5"), &report(&session, &result));
    }
}

#[test]
fn all_of_them_added_and_removed_together_give_back_the_file_as_opened() {
    for sample in &SAMPLES {
        let (mut session, at, id) = opened(sample);
        let spots = free_spots(&session, &at, SPECIALS.len());
        let mut ids = Vec::new();
        for ((label, special), (x, y)) in SPECIALS.into_iter().zip(spots) {
            let mut spec = special(&at);
            (spec.x, spec.y) = (x, y);
            round_trip_step(&mut session, label, add(spec));
            ids.push(id + ids.len() as u32);
        }
        let result = round_trip_step(
            &mut session,
            "remove all",
            Op::RemoveSystems { systems: ids },
        );
        assert_eq!(current(&session), session.doc().original(), "{id}");
        session.apply(result.inverse).expect("add them back");
        for (i, (label, special)) in SPECIALS.into_iter().enumerate() {
            let back = session.system(id + i as u32).expect("the system");
            assert_eq!(back.initializer, special(&at).initializer, "{label}");
        }
    }
}

/// Each layout, on both samples, added, rolled plain and back by the inverse, rolled as
/// itself and removed: each inverse reads the spec back exactly and writes the text back.
#[test]
fn each_special_layout_reads_back_exactly_for_a_reroll_and_a_removal() {
    for (label, special) in SPECIALS {
        for sample in &SAMPLES {
            let (mut session, at, id) = opened(sample);
            let spec = special(&at);
            round_trip_step(&mut session, "add", add(spec.clone()));
            let added = current(&session);
            let counted = initializer_counts(session.doc());
            let plain = SystemSpec {
                name: spec.name.clone(),
                ..rerolled(at.clone())
            };
            let result = round_trip_step(
                &mut session,
                "reroll plain",
                Op::ReplaceSystemFromSpec {
                    system: id,
                    spec: plain,
                },
            );
            let Op::ReplaceSystemFromSpec { spec: back, .. } = &result.inverse else {
                panic!("{:?}", result.inverse);
            };
            assert_eq!(
                back,
                &SystemSpec {
                    lanes: back.lanes.clone(),
                    ..spec.clone()
                }
            );
            round_trip_step(&mut session, "reroll back", result.inverse);
            assert_eq!(
                current(&session),
                added,
                "{}: the inverse",
                spec.initializer
            );

            let again = SystemSpec {
                name: spec.name.clone(),
                ..special(&at)
            };
            session
                .apply(Op::ReplaceSystemFromSpec {
                    system: id,
                    spec: again,
                })
                .expect("reroll as itself");
            assert_eq!(current(&session), added, "{}: as itself", spec.initializer);
            assert_eq!(
                initializer_counts(session.doc()),
                counted,
                "{label} on {id}"
            );
            let result = round_trip_step(&mut session, "remove", Op::RemoveSystem { system: id });
            assert_eq!(
                current(&session),
                session.doc().original(),
                "{label} on {id}"
            );
            assert_eq!(result.inverse, add(special(&at)), "{label} on {id}");
        }
    }
}
