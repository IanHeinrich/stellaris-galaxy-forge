//! Adding a system with companion stars to a save: Moscot's shape (4.5 sample, system 114),
//! a centre star and two companions at 220 with planets and moons of their own, and Alpha
//! Centauri's (4.4 sample, system 278), with fixed star names, a star at a negative orbit
//! and an anomaly on a companion's planet. Each is written as the game writes the system it
//! copies, reads back exactly for a removal's and a reroll's inverse, and refuses a star
//! anywhere but about the centre.

use sgf_core::entity::get_planet_page;
use sgf_core::ops::{
    BodyKind, BodySpec, Op, OpError, PrimaryName, SpecAnomaly, SpecBody, SpecStar, SystemAdd,
    SystemExtras, SystemSpec, initializer_counts,
};
use sgf_core::projections::name::NameTemplate;
use sgf_core::session::Session;
use sgf_core::views::details::BodyRole;

use crate::common;
use crate::ops_add_special_system::{add, named, opened};
use common::current;
use common::diff::{report, round_trip_step};
use common::spec::{SAMPLE_4_4, SAMPLE_4_5, SAMPLES, body, rerolled, star};
use common::{open, planet_ids, planets};

fn orbited(body: BodySpec, moons: Vec<BodySpec>) -> BodySpec {
    BodySpec { moons, ..body }
}

/// `trinary_init_02` as Moscot rolled it: a G star at the centre, an M star at 220 with
/// three planets each with a moon, a K star at 220 with two planets, the second with a
/// moon, and four planets about the centre, the last ringed with a moon.
fn moscot(at: &SystemSpec) -> SystemSpec {
    let moon =
        |class: &str, size: u32, angle: f64, entity: u32| body(class, size, 13.0, angle, entity);
    let b = orbited(
        star(body("pc_m_star", 26, 220.0, 48.0, 0)),
        vec![
            orbited(
                body("pc_molten", 22, 55.0, 16.0, 0),
                vec![moon("pc_molten", 7, 355.0, 2)],
            ),
            orbited(
                body("pc_barren_cold", 13, 80.0, 233.0, 0),
                vec![moon("pc_barren", 8, 308.0, 0)],
            ),
            orbited(
                body("pc_gas_giant", 24, 105.0, 98.0, 2),
                vec![moon("pc_toxic", 6, 21.0, 0)],
            ),
        ],
    );
    let c = orbited(
        star(body("pc_k_star", 23, 220.0, 139.0, 0)),
        vec![
            body("pc_molten", 28, 50.0, 332.0, 0),
            orbited(
                body("pc_molten", 17, 75.0, 192.0, 1),
                vec![moon("pc_molten", 8, 287.0, 2)],
            ),
        ],
    );
    let ringed = BodySpec {
        ring: true,
        ..orbited(
            body("pc_barren", 21, 80.0, 355.0, 1),
            vec![moon("pc_barren", 6, 298.0, 1)],
        )
    };
    SystemSpec {
        name: "Sgf_Moscot".to_owned(),
        star_class: "sc_trinary_1".to_owned(),
        initializer: "trinary_init_02".to_owned(),
        star: star(body("pc_g_star", 30, 0.0, 0.0, 0)),
        planets: vec![
            b,
            c,
            body("pc_molten", 29, 35.0, 276.0, 0),
            body("pc_molten", 20, 50.0, 184.0, 2),
            body("pc_barren", 24, 65.0, 86.0, 1),
            ringed,
        ],
        ..at.clone()
    }
}

/// `sol_neighbor_t1_first_colony` as the 4.4 sample holds it, cut to two planets about the
/// centre: Alpha Centauri A at 15, B at -20, and Proxima Centauri at 240 with Proxima b,
/// on which no random anomaly rolls, and the ringed Proxima c, each star and planet of
/// Proxima with its fixed name.
fn alpha_centauri(at: &SystemSpec) -> SystemSpec {
    let proxima_b = BodySpec {
        prevent_anomaly: true,
        ..named(
            "NAME_Proxima_Centauri_b",
            body("pc_barren_cold", 20, 35.0, 78.0, 1),
        )
    };
    let proxima_c = BodySpec {
        ring: true,
        ..named(
            "NAME_Proxima_Centauri_c",
            body("pc_gas_giant", 18, 60.0, 335.0, 3),
        )
    };
    let continental = BodySpec {
        prevent_anomaly: true,
        ..body("pc_continental", 16, 100.0, 99.0, 2)
    };
    SystemSpec {
        name: "NAME_Alpha_Centauri".to_owned(),
        star_class: "sc_trinary_1".to_owned(),
        initializer: "sol_neighbor_t1_first_colony".to_owned(),
        star_name: PrimaryName::Fixed("NAME_Alpha_Centauri_A".to_owned()),
        star: star(body("pc_g_star", 32, 15.0, 170.0, 0)),
        planets: vec![
            named(
                "NAME_Alpha_Centauri_B",
                star(body("pc_k_star", 27, -20.0, 180.0, 0)),
            ),
            named(
                "NAME_Proxima_Centauri",
                orbited(
                    star(body("pc_m_star", 15, 240.0, 310.0, 0)),
                    vec![proxima_b, proxima_c],
                ),
            ),
            orbited(
                body("pc_molten", 19, 45.0, 90.0, 2),
                vec![body("pc_molten", 11, 15.0, 294.0, 2)],
            ),
            continental,
        ],
        ..at.clone()
    }
}

/// The star's own planets, as Broken Shroudwalker's asteroids orbit its star: an asteroid
/// and a planet with a moon about the star, then a planet about the centre.
fn star_planets(at: &SystemSpec) -> SystemSpec {
    let asteroid = BodySpec {
        kind: BodyKind::Asteroid,
        ..body("pc_asteroid", 5, 30.0, 40.0, 0)
    };
    SystemSpec {
        name: "Sgf_Shroud".to_owned(),
        star: orbited(
            star(body("pc_g_star", 25, 0.0, 0.0, 0)),
            vec![
                asteroid,
                orbited(
                    body("pc_barren", 12, 50.0, 200.0, 1),
                    vec![body("pc_frozen", 6, 10.0, 90.0, 1)],
                ),
            ],
        ),
        planets: vec![body("pc_toxic", 15, 90.0, 300.0, 1)],
        ..at.clone()
    }
}

/// A star named by the system with an unnamed companion, which is numbered as a planet:
/// the companion is "X I" and the planet after it "X II".
fn system_named_pair(at: &SystemSpec) -> SystemSpec {
    SystemSpec {
        name: "Sgf_Pair".to_owned(),
        star_name: PrimaryName::System,
        star: star(body("pc_m_star", 20, 0.0, 0.0, 0)),
        planets: vec![
            orbited(
                star(body("pc_k_star", 18, 120.0, 30.0, 0)),
                vec![body("pc_molten", 10, 25.0, 0.0, 1)],
            ),
            body("pc_barren", 14, 60.0, 200.0, 1),
        ],
        ..at.clone()
    }
}

/// `init_sol_geocentric`'s Helios: a G star as a moon of a gas giant, written as a moon.
fn helios(at: &SystemSpec) -> SystemSpec {
    SystemSpec {
        name: "Sgf_Helios".to_owned(),
        star: star(body("pc_k_star", 20, 0.0, 0.0, 0)),
        planets: vec![orbited(
            body("pc_gas_giant", 24, 80.0, 45.0, 1),
            vec![
                star(body("pc_g_star", 8, 15.0, 10.0, 0)),
                body("pc_barren", 6, 25.0, 180.0, 1),
            ],
        )],
        ..at.clone()
    }
}

type Shape = (&'static str, fn(&SystemSpec) -> SystemSpec);

const SHAPES: [Shape; 5] = [
    ("moscot", moscot),
    ("alpha_centauri", alpha_centauri),
    ("star_planets", star_planets),
    ("system_named_pair", system_named_pair),
    ("helios", helios),
];

/// A name as the save nests it: `KEY(variable …)`, a literal as written.
fn written(name: &NameTemplate) -> String {
    match (name.literal, name.variables.is_empty()) {
        (true, _) | (false, true) => name.key.clone(),
        (false, false) => {
            let values: Vec<String> = name.variables.iter().map(|v| written(&v.value)).collect();
            format!("{}({})", name.key, values.join(" "))
        }
    }
}

/// Each body of system `id` in the order it lists them: its role, its name, and the place
/// in that order of the body its `moon_of` names.
fn bodies(session: &Session, id: u32) -> Vec<(BodyRole, String, Option<usize>)> {
    let ids = planet_ids(session, id);
    planets(session, id)
        .iter()
        .map(|planet| {
            let parent = planet
                .parent
                .map(|parent| ids.iter().position(|&id| id == parent).expect("listed"));
            (planet.role, written(&planet.name), parent)
        })
        .collect()
}

#[test]
fn moscots_shape_is_written_as_the_game_wrote_moscot() {
    let (mut session, at, id) = opened(SAMPLE_4_5);
    let result = session.apply(add(moscot(&at))).expect("add the system");
    let written = report(&session, &result);
    common::snapshot("add_moscot_4_5", &written);
    // 220 + 105 + 13 is the furthest chain, B's gas giant's moon.
    assert!(written.contains("inner_radius=368\n"), "{written}");

    let star = |k: usize| format!("STAR_NAME_{k}_OF_3(Sgf_Moscot)");
    let of = |parent: &str, numeral: &str| format!("SUBPLANET_NAME_FORMAT({parent} {numeral})");
    let planet = |numeral: &str| format!("PLANET_NAME_FORMAT(Sgf_Moscot {numeral})");
    use BodyRole::{Moon, Planet, Primary, Star};
    let expected = vec![
        (Primary, star(1), None),
        (Star, star(2), None),
        (Planet, of(&star(2), "I"), Some(1)),
        (Moon, of(&of(&star(2), "I"), "a"), Some(2)),
        (Planet, of(&star(2), "II"), Some(1)),
        (Moon, of(&of(&star(2), "II"), "a"), Some(4)),
        (Planet, of(&star(2), "III"), Some(1)),
        (Moon, of(&of(&star(2), "III"), "a"), Some(6)),
        (Star, star(3), None),
        (Planet, of(&star(3), "I"), Some(8)),
        (Planet, of(&star(3), "II"), Some(8)),
        (Moon, of(&of(&star(3), "II"), "a"), Some(10)),
        (Planet, planet("I"), None),
        (Planet, planet("II"), None),
        (Planet, planet("III"), None),
        (Planet, planet("IV"), None),
        (Moon, of(&planet("IV"), "a"), Some(15)),
    ];
    assert_eq!(bodies(&session, id), expected);
}

/// Alpha Centauri's stars keep their fixed names with the fixed-name bit, B stands at its
/// negative orbit on the far side, Proxima's planets are planets of it without the moon
/// bit, and the anomaly its layout plants lands on Proxima b.
#[test]
fn alpha_centauris_shape_is_written_as_the_game_wrote_alpha_centauri() {
    let (mut session, at, id) = opened(SAMPLE_4_4);
    let system = SystemAdd {
        spec: alpha_centauri(&at),
        extras: SystemExtras {
            anomalies: vec![SpecAnomaly {
                body: SpecBody::Satellite {
                    star: SpecStar::Companion(1),
                    index: 0,
                },
                category: "ALPHA_CENTAURI_CAT".to_owned(),
            }],
            ..SystemExtras::default()
        },
    };
    let op = session
        .save("adding a system")
        .expect("a save")
        .add_systems_op(vec![system], &[], true, None)
        .expect("the op");
    let result = round_trip_step(&mut session, "alpha centauri", op);
    let written = report(&session, &result);
    common::snapshot("add_alpha_centauri_4_4", &written);
    // Proxima c at 60 about Proxima at 240.
    assert!(written.contains("inner_radius=330\n"), "{written}");

    let numbered = |numeral: &str| format!("PLANET_NAME_FORMAT(NAME_Alpha_Centauri {numeral})");
    use BodyRole::{Moon, Planet, Primary, Star};
    let expected = vec![
        (Primary, "NAME_Alpha_Centauri_A".to_owned(), None),
        (Star, "NAME_Alpha_Centauri_B".to_owned(), None),
        (Star, "NAME_Proxima_Centauri".to_owned(), None),
        (Planet, "NAME_Proxima_Centauri_b".to_owned(), Some(2)),
        (Planet, "NAME_Proxima_Centauri_c".to_owned(), Some(2)),
        (Planet, numbered("I"), None),
        (
            Moon,
            format!("SUBPLANET_NAME_FORMAT({} a)", numbered("I")),
            Some(5),
        ),
        (Planet, numbered("II"), None),
    ];
    assert_eq!(bodies(&session, id), expected);
    let proxima_b = planet_ids(&session, id)[3];
    let page = get_planet_page(session.doc(), proxima_b).expect("Proxima b");
    let anomaly = page.anomaly.map(|anomaly| anomaly.category);
    assert_eq!(anomaly.as_deref(), Some("ALPHA_CENTAURI_CAT"));
}

/// The star's planets are listed straight after it, named after it in roman numerals
/// without the moon bit, before the planets about the centre are numbered from I.
#[test]
fn the_stars_own_planets_are_written_as_a_companions_are() {
    let (mut session, at, id) = opened(SAMPLE_4_5);
    let result = session.apply(add(star_planets(&at))).expect("add");
    common::snapshot("add_star_planets_4_5", &report(&session, &result));
    let found = bodies(&session, id);
    let star = "STAR_NAME_1_OF_1(Sgf_Shroud)";
    let satellite = format!("SUBPLANET_NAME_FORMAT({star} I)");
    use BodyRole::{Moon, Planet, Primary};
    assert_eq!(found[0], (Primary, star.to_owned(), None));
    assert_eq!((found[1].0, found[1].2), (Planet, Some(0)), "the asteroid");
    assert_eq!(found[2], (Planet, satellite.clone(), Some(0)));
    assert_eq!(
        found[3],
        (
            Moon,
            format!("SUBPLANET_NAME_FORMAT({satellite} a)"),
            Some(2)
        )
    );
    assert_eq!(
        found[4],
        (Planet, "PLANET_NAME_FORMAT(Sgf_Shroud I)".to_owned(), None)
    );
}

/// A system whose star takes the system's name numbers an unnamed companion as a planet, as
/// the writer always has, so no star shares the system's name.
#[test]
fn an_unnamed_companion_of_a_star_named_by_its_system_is_numbered_as_a_planet() {
    let (mut session, at, id) = opened(SAMPLE_4_5);
    session.apply(add(system_named_pair(&at))).expect("add");
    let companion = "PLANET_NAME_FORMAT(Sgf_Pair I)";
    use BodyRole::{Planet, Primary, Star};
    let expected = vec![
        (Primary, "Sgf_Pair".to_owned(), None),
        (Star, companion.to_owned(), None),
        (
            Planet,
            format!("SUBPLANET_NAME_FORMAT({companion} I)"),
            Some(1),
        ),
        (Planet, "PLANET_NAME_FORMAT(Sgf_Pair II)".to_owned(), None),
    ];
    assert_eq!(bodies(&session, id), expected);
}

/// A star that orbits a planet is written as any moon is: lettered, with the moon bit, and
/// with a star's carrier flags.
#[test]
fn a_star_orbiting_a_planet_is_written_as_a_moon() {
    let (mut session, at, id) = opened(SAMPLE_4_5);
    let result = session.apply(add(helios(&at))).expect("add");
    common::snapshot("add_helios_4_5", &report(&session, &result));
    let giant = "PLANET_NAME_FORMAT(Sgf_Helios I)";
    use BodyRole::{Moon, Planet, Primary};
    let expected = vec![
        (Primary, "STAR_NAME_1_OF_1(Sgf_Helios)".to_owned(), None),
        (Planet, giant.to_owned(), None),
        (Moon, format!("SUBPLANET_NAME_FORMAT({giant} a)"), Some(1)),
        (Moon, format!("SUBPLANET_NAME_FORMAT({giant} b)"), Some(1)),
    ];
    assert_eq!(bodies(&session, id), expected);
}

/// A spec in the old shape, with `star` on a body or `star_named_by_class` on the system,
/// is refused rather than read without them.
#[test]
fn a_spec_with_a_field_the_spec_lacks_is_refused() {
    let body = r#"{"class":"pc_g_star","size":25,"orbit":0,"angle":0,"entity":0,"star":true}"#;
    let error = serde_json::from_str::<BodySpec>(body).expect_err("refused");
    assert!(
        error.to_string().contains("unknown field `star`"),
        "{error}"
    );
    let mut system = serde_json::to_value(moscot(&common::spec::mura())).expect("json");
    system["star_named_by_class"] = serde_json::Value::Bool(true);
    let error = serde_json::from_value::<SystemSpec>(system).expect_err("refused");
    assert!(
        error
            .to_string()
            .contains("unknown field `star_named_by_class`"),
        "{error}"
    );
}

/// Each shape, on both samples, added, rolled plain and back by the inverse, rolled as
/// itself and removed: each inverse reads the spec back exactly and writes the text back.
#[test]
fn each_shape_reads_back_exactly_for_a_reroll_and_a_removal() {
    for (label, shape) in SHAPES {
        for sample in &SAMPLES {
            let (mut session, at, id) = opened(sample);
            let spec = shape(&at);
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
                },
                "{label} on {id}"
            );
            round_trip_step(&mut session, "reroll back", result.inverse);
            assert_eq!(current(&session), added, "{label} on {id}: the inverse");

            session
                .apply(Op::ReplaceSystemFromSpec {
                    system: id,
                    spec: spec.clone(),
                })
                .expect("reroll as itself");
            assert_eq!(current(&session), added, "{label} on {id}: as itself");
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
            assert_eq!(result.inverse, add(spec), "{label} on {id}");
        }
    }
}

/// A change to Moscot's shape, and whether an error is the refusal it should meet.
type Case = common::Refused<fn(&mut SystemSpec)>;

fn a_star() -> BodySpec {
    star(body("pc_m_star", 12, 10.0, 0.0, 0))
}

fn a_moon() -> BodySpec {
    body("pc_barren", 5, 6.0, 0.0, 1)
}

#[test]
fn no_star_orbits_a_star_and_a_stars_planets_follow_the_planet_rules() {
    let parent = |e: &OpError| matches!(e, OpError::InvalidParent { .. });
    let cases: Vec<Case> = vec![
        (|s| s.star.moons = vec![a_star()], parent),
        (|s| s.planets[0].moons[1] = a_star(), parent),
        (|s| s.planets[0].moons[0].moons[0] = a_star(), parent),
        (
            |s| s.planets[0].moons[0].moons[0].moons = vec![a_moon()],
            |e| matches!(e, OpError::MoonsNotAllowed("a moon")),
        ),
        (
            |s| s.planets[0].moons[1].kind = BodyKind::Asteroid,
            |e| matches!(e, OpError::MoonsNotAllowed("an asteroid")),
        ),
        (
            |s| s.planets[0].moons[0].moons[0].ring = true,
            |e| matches!(e, OpError::RingNotAllowed("a moon")),
        ),
        (
            |s| s.star.name = Some("NAME_Star".to_owned()),
            |e| {
                e.to_string()
                    == "the star's body, which takes the star's name, cannot have a fixed name"
            },
        ),
        (
            |s| s.star_name = PrimaryName::Fixed(String::new()),
            |e| matches!(e, OpError::EmptyText { what: "a name" }),
        ),
    ];
    for (edit, expected) in cases {
        let mut spec = moscot(&common::spec::dorellion());
        edit(&mut spec);
        let mut session = open();
        let error = session.apply(add(spec.clone())).expect_err("refused");
        assert!(!session.doc().is_dirty(), "{error}");
        assert!(expected(&error), "{spec:?}: {error:?}");
    }
}
