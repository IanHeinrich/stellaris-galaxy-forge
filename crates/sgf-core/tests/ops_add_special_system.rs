//! Adding the special layouts to a save, on the 4.5 and the 4.4 sample: a black hole, a
//! system whose star is named by its class, fixed body names, modifiers, a model named by
//! entity, a ring, an off-centre star, star classes as bodies and the count of a capped
//! layout. Each is written as the game writes the layout it copies, reopens after a save,
//! undoes byte for byte, reads back exactly for a removal's and a reroll's inverse, and a
//! rename leaves the bodies with names of their own alone.

use std::collections::BTreeMap;

use sgf_core::ops::{BeltSpec, BodySpec, Op, OpError, SystemSpec, initializer_counts};
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;

use crate::common;
use common::diff::{report, round_trip, round_trip_step};
use common::spec::{body, dorellion, mura, rerolled};
use common::{current, open, open_4_5, text};

/// Both samples, each with the spike's system for it, whose place and lane the special
/// systems take, and the id a new system takes.
fn samples() -> [(Session, SystemSpec, u32); 2] {
    [(open_4_5(), mura(), 601), (open(), dorellion(), 791)]
}

fn add(spec: SystemSpec) -> Op {
    Op::AddSaveSystem { spec }
}

fn with(body: BodySpec, deposits: &[&str]) -> BodySpec {
    BodySpec {
        deposits: deposits.iter().map(|d| (*d).to_owned()).collect(),
        ..body
    }
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
fn black_hole(at: &SystemSpec) -> SystemSpec {
    SystemSpec {
        name: "Xulbaks_Maw".to_owned(),
        star_class: "sc_black_hole".to_owned(),
        initializer: "special_init_01".to_owned(),
        star: with(
            body("pc_black_hole", 30, 0.0, 0.0, 0),
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
fn trappist(at: &SystemSpec) -> SystemSpec {
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
        star: body("pc_m_star", 20, 0.0, 0.0, 0),
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
fn terraformed(at: &SystemSpec) -> SystemSpec {
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
        star: body("pc_g_star", 25, 40.0, 120.0, 0),
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
fn larionessi(at: &SystemSpec) -> SystemSpec {
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
        star: with(body("pc_neutron_star", 25, 0.0, 0.0, 0), &["d_physics_5"]),
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

/// `great_wound_system`, cut to two of its ten rifts: black holes as bodies, each with a
/// fixed name.
fn great_wound(at: &SystemSpec) -> SystemSpec {
    SystemSpec {
        name: "Sgf_Wound".to_owned(),
        star_class: "sc_black_hole".to_owned(),
        initializer: "great_wound_system".to_owned(),
        capped: true,
        star: with(
            body("pc_black_hole", 40, 0.0, 0.0, 0),
            &["d_dark_matter_deposit_10"],
        ),
        planets: vec![
            named(
                "NAME_Subspace_Rupture_1",
                body("pc_black_hole", 20, 60.0, 1.0, 0),
            ),
            named(
                "NAME_Subspace_Rupture_2",
                body("pc_black_hole", 20, 120.0, 211.0, 0),
            ),
            body("pc_barren", 10, 150.0, 90.0, 1),
        ],
        ..at.clone()
    }
}

/// `wenkwort_initializer`'s shape: a planet with the layout's modifier whose first moon
/// has a fixed name and whose second is lettered, and a gas giant with the layout's model
/// and no ring.
fn wenkwort(at: &SystemSpec) -> SystemSpec {
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
        star: body("pc_f_star", 24, 0.0, 0.0, 0),
        planets: vec![body("pc_molten", 12, 45.0, 170.0, 1), prime, giant],
        ..at.clone()
    }
}

type Special = (&'static str, fn(&SystemSpec) -> SystemSpec);

const SPECIALS: [Special; 6] = [
    ("black_hole", black_hole),
    ("trappist", trappist),
    ("terraformed", terraformed),
    ("larionessi", larionessi),
    ("great_wound", great_wound),
    ("wenkwort", wenkwort),
];

/// `n` places near `at` inside the galaxy, each at least 10 from every system and from
/// the others.
fn free_spots(session: &Session, at: &SystemSpec, n: usize) -> Vec<(f64, f64)> {
    let graph = &session.graph;
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

fn sample_name(id: u32) -> &'static str {
    match id {
        601 => "4_5",
        _ => "4_4",
    }
}

fn open_again(id: u32) -> Session {
    match id {
        601 => open_4_5(),
        _ => open(),
    }
}

fn findings(session: &Session) -> std::collections::BTreeSet<(IssueCode, Vec<u32>, String)> {
    session
        .validate()
        .into_iter()
        .map(|issue| (issue.code, issue.systems, issue.message))
        .collect()
}

/// Each body the details list for system `id`, as (class, its name's key, the keys of
/// its name's variables' values).
fn names(session: &Session, id: u32) -> Vec<(String, String, Vec<String>)> {
    let details = session.details().expect("details");
    details
        .raw(id)
        .expect("the system's details")
        .planets
        .iter()
        .map(|p| {
            let values = p
                .name
                .variables
                .iter()
                .map(|v| v.value.key.clone())
                .collect();
            (p.class.clone(), p.name.key.clone(), values)
        })
        .collect()
}

/// System `id`'s body entries as the text holds them, star first.
fn entries(text: &str, session: &Session, id: u32) -> Vec<String> {
    let details = session.details().expect("details");
    details
        .raw(id)
        .expect("the system's details")
        .planets
        .iter()
        .map(|p| {
            let head = format!("\n\t\t{}=\n\t\t{{\n", p.id);
            let start = text.find(&head).expect("the body's entry") + 1;
            let end = start + text[start..].find("\n\t\t}\n").expect("its end");
            text[start..end].to_owned()
        })
        .collect()
}

#[test]
fn each_special_layout_is_written_as_the_game_writes_it() {
    for (label, special) in SPECIALS {
        for (mut session, at, id) in samples() {
            let result = session.apply(add(special(&at))).expect("add the system");
            common::snapshot(
                &format!("add_{label}_{}", sample_name(id)),
                &report(&session, &result),
            );
        }
    }
}

#[test]
fn undo_puts_back_the_bytes_of_each_special_layout() {
    for (_, special) in SPECIALS {
        for (session, at, _) in samples() {
            round_trip(session, add(special(&at)));
        }
    }
}

#[test]
fn a_removal_after_each_add_gives_back_the_file_as_opened() {
    for (label, special) in SPECIALS {
        for (mut session, at, id) in samples() {
            round_trip_step(&mut session, "add", add(special(&at)));
            let result = round_trip_step(&mut session, "remove", Op::RemoveSystem { id });
            assert_eq!(current(&session), session.doc.original(), "{label} on {id}");
            assert_eq!(result.inverse, add(special(&at)), "{label} on {id}");
        }
    }
}

#[test]
fn all_of_them_added_and_removed_together_give_back_the_file_as_opened() {
    for (mut session, at, id) in samples() {
        let spots = free_spots(&session, &at, SPECIALS.len());
        let mut ids = Vec::new();
        for ((label, special), (x, y)) in SPECIALS.into_iter().zip(spots) {
            let mut spec = special(&at);
            (spec.x, spec.y) = (x, y);
            round_trip_step(&mut session, label, add(spec));
            ids.push(id + ids.len() as u32);
        }
        let result = round_trip_step(&mut session, "remove all", Op::RemoveSystems { ids });
        assert_eq!(current(&session), session.doc.original(), "{id}");
        session.apply(result.inverse).expect("add them back");
        for (i, (label, special)) in SPECIALS.into_iter().enumerate() {
            let back = session.system(id + i as u32).expect("the system");
            assert_eq!(back.initializer, special(&at).initializer, "{label}");
        }
    }
}

#[test]
fn a_saved_special_system_reopens_with_its_names_flags_and_modifiers() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for (mut session, at, id) in samples() {
        let before = findings(&session);
        let specs = [trappist(&at), {
            let mut spec = larionessi(&at);
            (spec.x, spec.y) = (at.x + 20.0, at.y + 20.0);
            spec.lanes = vec![id];
            spec
        }];
        for spec in specs {
            session.apply(add(spec)).expect("add the system");
        }
        let mut spec = terraformed(&at);
        (spec.x, spec.y) = (at.x - 20.0, at.y + 20.0);
        spec.lanes = vec![id];
        session.apply(add(spec)).expect("add the system");
        let path = dir.path().join(format!("{id}.sav"));
        session.save_as(&path).expect("save");

        let reopened = Session::open(&path).expect("reopen");
        assert_eq!(findings(&reopened), before, "{id}: the save's own findings");
        let saved = text(&reopened);

        let trappist = names(&reopened, id);
        assert_eq!(trappist, names(&session, id), "{id}: before the save");
        assert_eq!(
            trappist[0],
            ("pc_m_star".into(), "NAME_Trappist".into(), vec![])
        );
        assert_eq!(
            trappist[4],
            (
                "pc_barren".into(),
                "PLANET_NAME_FORMAT".into(),
                vec!["NAME_Trappist".into(), "IV".into()]
            )
        );
        let bodies = entries(&saved, &reopened, id);
        assert!(!bodies[0].contains("	binary_flags"), "{}", bodies[0]);
        assert!(bodies[4].contains("\t\t\tbombardment_damage=0\n\t\t\ttimed_modifier=\n\t\t\t{\n\t\t\t\titems=\n\t\t\t\t{\n\t\t\t\t\t\n\t\t\t\t\t{\n\t\t\t\t\t\tmodifier=\"terraforming_candidate\"\n\t\t\t\t\t\tdays=-1\n\t\t\t\t\t}\n \n\t\t\t\t}\n\t\t\t}\n\t\t\tentity=1"), "{}", bodies[4]);
        assert!(!saved.contains("planet_modifier=\"terraforming_candidate\""));

        let refuge = names(&reopened, id + 1);
        let keys: Vec<&str> = refuge.iter().map(|(_, key, _)| key.as_str()).collect();
        assert_eq!(
            keys,
            [
                "STAR_NAME_1_OF_1",
                "PLANET_NAME_FORMAT",
                "ASTEROID_NAME_FORMAT",
                "ASTEROID_NAME_FORMAT",
                "NAME_Unique_System_2_Planet",
                "SUBPLANET_NAME_FORMAT",
                "SUBPLANET_NAME_FORMAT"
            ]
        );
        assert_eq!(refuge[5].2, ["NAME_Unique_System_2_Planet", "a"]);
        assert_eq!(refuge[6].2, ["NAME_Unique_System_2_Planet", "b"]);
        let bodies = entries(&saved, &reopened, id + 1);
        assert!(bodies[0].contains("\t\t\tcarrier_binary_flags=3\n"));
        assert!(
            bodies[4].contains("\t\t\tbinary_flags=65\n"),
            "{}",
            bodies[4]
        );
        assert!(
            bodies[5].contains("\t\t\tbinary_flags=576\n"),
            "{}",
            bodies[5]
        );

        let world = &entries(&saved, &reopened, id + 2)[1];
        assert!(world.contains("\t\t\tbinary_flags=322\n"), "{world}");
        assert!(
            world.contains(
                "\t\t\tentity=0\n\t\t\tentity_name=\"previously_terraformed_planet_entity\""
            ),
            "{world}"
        );
        let star = &entries(&saved, &reopened, id + 2)[0];
        assert!(star.contains("\t\t\torbit=40\n"), "{star}");
        assert!(!star.contains("\t\t\t\tx=0\n"), "{star}");

        let counts = initializer_counts(&reopened.doc);
        let opened = initializer_counts(&open_again(id).doc);
        assert_eq!(
            counts.get("trappist_initializer"),
            opened.get("trappist_initializer").map(|n| n + 1).as_ref()
        );
        assert_eq!(counts.get("unique_system_initializer_02"), Some(&1));
        assert!(!opened.contains_key("unique_system_initializer_02"));
    }
}

#[test]
fn a_fixed_name_moon_takes_no_letter_and_an_entity_override_alone_is_66() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for (mut session, at, id) in samples() {
        session.apply(add(wenkwort(&at))).expect("add the system");
        let path = dir.path().join(format!("{id}.sav"));
        session.save_as(&path).expect("save");
        let reopened = Session::open(&path).expect("reopen");
        let listed = names(&reopened, id);
        assert_eq!(listed, names(&session, id), "{id}: before the save");
        let keys: Vec<&str> = listed.iter().map(|(_, key, _)| key.as_str()).collect();
        assert_eq!(
            keys,
            [
                "STAR_NAME_1_OF_1",
                "PLANET_NAME_FORMAT",
                "PLANET_NAME_FORMAT",
                "NAME_wenkwort_moon",
                "SUBPLANET_NAME_FORMAT",
                "PLANET_NAME_FORMAT"
            ]
        );
        assert_eq!(listed[4].2, ["PLANET_NAME_FORMAT", "a"], "{listed:?}");
        assert_eq!(listed[5].2, ["Sgf_Wenkwort", "III"]);

        let bodies = entries(&text(&reopened), &reopened, id);
        let flags = |body: &str| {
            body.lines()
                .find_map(|line| line.strip_prefix("\t\t\tbinary_flags="))
                .map(str::to_owned)
        };
        let found: Vec<Option<String>> = bodies.iter().map(|b| flags(b)).collect();
        let expected = [None, None, None, Some("577"), Some("576"), Some("66")];
        assert_eq!(found, expected.map(|f| f.map(str::to_owned)));
        assert!(bodies[5].contains("\t\t\tentity=0\n\t\t\tentity_name=\"gas_giant_02_entity\""));
    }
}

#[test]
fn two_capped_systems_of_one_layout_each_count_and_uncount_one() {
    for (mut session, at, id) in samples() {
        let opened = initializer_counts(&session.doc);
        let before = opened.get("trappist_initializer").copied().unwrap_or(0);
        let spots = free_spots(&session, &at, 2);
        for (i, &(x, y)) in spots.iter().enumerate() {
            let spec = SystemSpec {
                name: format!("Sgf_Trappist_{i}"),
                x,
                y,
                ..trappist(&at)
            };
            round_trip_step(&mut session, "add", add(spec));
        }
        let count = |session: &Session| initializer_counts(&session.doc)["trappist_initializer"];
        assert_eq!(count(&session), before + 2);
        let result = round_trip_step(&mut session, "remove one", Op::RemoveSystem { id });
        assert_eq!(count(&session), before + 1);
        let Op::AddSaveSystem { spec } = &result.inverse else {
            panic!("{:?}", result.inverse);
        };
        assert!(spec.capped);
        round_trip_step(&mut session, "remove the other", Op::RemoveSystem { id });
        assert_eq!(initializer_counts(&session.doc), opened);
        assert_eq!(current(&session), session.doc.original());
    }
}

#[test]
fn a_layout_added_capped_and_uncapped_in_one_session_is_refused() {
    for (mut session, at, id) in samples() {
        let spots = free_spots(&session, &at, 2);
        let at_spot = |spec: SystemSpec, (x, y): (f64, f64), name: &str| SystemSpec {
            name: name.to_owned(),
            x,
            y,
            ..spec
        };
        session
            .apply(add(trappist(&at)))
            .expect("add a capped Trappist");
        let written = current(&session);
        let uncapped = SystemSpec {
            capped: false,
            ..at_spot(trappist(&at), spots[1], "Sgf_Uncapped")
        };
        let refused = |error: &OpError| {
            matches!(error, OpError::CappedMismatch { initializer, other, capped: true }
                if initializer == "trappist_initializer" && *other == id)
        };
        let error = session.apply(add(uncapped.clone())).expect_err("refused");
        assert!(refused(&error), "{error:?}");
        assert_eq!(current(&session), written, "a refusal writes nothing");

        session
            .apply(add(at_spot(black_hole(&at), spots[1], "Sgf_Plain")))
            .expect("add another layout");
        let written = current(&session);
        let error = session
            .apply(Op::ReplaceSaveSystem {
                system: id + 1,
                spec: SystemSpec {
                    name: "Sgf_Plain".to_owned(),
                    ..uncapped
                },
            })
            .expect_err("refused");
        assert!(refused(&error), "{error:?}");
        assert_eq!(current(&session), written, "a refusal writes nothing");

        session
            .apply(Op::ReplaceSaveSystem {
                system: id,
                spec: SystemSpec {
                    capped: false,
                    ..black_hole(&at)
                },
            })
            .expect("the only Trappist may become another layout");
    }
}

#[test]
fn only_a_capped_layout_is_counted_and_a_removal_uncounts_it() {
    for (mut session, at, id) in samples() {
        let opened = initializer_counts(&session.doc);
        assert!(!opened.is_empty());
        session.apply(add(black_hole(&at))).expect("add");
        assert_eq!(initializer_counts(&session.doc), opened, "special_init_01");
        session.apply(Op::RemoveSystem { id }).expect("remove");

        let mut changed = opened.clone();
        for (i, spec) in [larionessi(&at), larionessi(&at)].into_iter().enumerate() {
            let mut spec = spec;
            spec.x += 20.0 * i as f64;
            spec.name = format!("Sgf_Refuge_{i}");
            session.apply(add(spec)).expect("add");
            changed.insert("unique_system_initializer_02".to_owned(), i as u32 + 1);
            assert_eq!(initializer_counts(&session.doc), changed);
        }
        let text = text(&session);
        let counter = &text[text.find("\nsystem_initializer_counter=").unwrap()..];
        let counter = &counter[..counter.find("\n}\n").unwrap()];
        assert!(
            counter.contains(" 2 \n\t}\n\tinitializer=\n")
                && counter.ends_with("\t\t\"unique_system_initializer_02\"\n\t}"),
            "{counter}"
        );
        session.apply(Op::RemoveSystem { id }).expect("remove one");
        changed.insert("unique_system_initializer_02".to_owned(), 1);
        assert_eq!(initializer_counts(&session.doc), changed);
        session
            .apply(Op::RemoveSystem { id })
            .expect("remove the other");
        assert_eq!(initializer_counts(&session.doc), opened);
        assert_eq!(current(&session), session.doc.original());
    }
}

#[test]
fn the_reroll_inverse_writes_back_the_special_text() {
    for (_, special) in SPECIALS {
        for (mut session, at, id) in samples() {
            let spec = special(&at);
            round_trip_step(&mut session, "add", add(spec.clone()));
            let added = current(&session);
            let plain = SystemSpec {
                name: spec.name.clone(),
                ..rerolled(at.clone())
            };
            let result = round_trip_step(
                &mut session,
                "reroll plain",
                Op::ReplaceSaveSystem {
                    system: id,
                    spec: plain,
                },
            );
            let Op::ReplaceSaveSystem { spec: back, .. } = &result.inverse else {
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
                .apply(Op::ReplaceSaveSystem {
                    system: id,
                    spec: again,
                })
                .expect("reroll as itself");
            assert_eq!(current(&session), added, "{}: as itself", spec.initializer);
            assert_eq!(
                initializer_counts(&session.doc),
                initializer_counts(
                    &{
                        let mut fresh = open_again(id);
                        fresh.apply(add(special(&at))).expect("add");
                        fresh
                    }
                    .doc
                )
            );
            round_trip_step(&mut session, "remove", Op::RemoveSystem { id });
            assert_eq!(current(&session), session.doc.original());
        }
    }
}

#[test]
fn a_fixed_system_name_outside_the_pool_takes_nothing_from_it() {
    for (mut session, at, _) in samples() {
        assert!(!text(&session).contains("\t\t\"NAME_Trappist\"\n"));
        let pool = |bytes: &[u8]| {
            let text = String::from_utf8_lossy(bytes).into_owned();
            let start = text.find("\nrandom_name_database=").expect("the pool");
            text[start..start + 200_000].to_owned()
        };
        session.apply(add(trappist(&at))).expect("add");
        assert_eq!(pool(&current(&session)), pool(session.doc.original()));
    }
}

#[test]
fn a_rename_leaves_fixed_names_alone_and_renames_a_star_named_by_class() {
    for (mut session, at, id) in samples() {
        round_trip_step(&mut session, "refuge", add(larionessi(&at)));
        let mut spec = trappist(&at);
        (spec.x, spec.y) = (at.x + 20.0, at.y + 20.0);
        spec.lanes = vec![id];
        round_trip_step(&mut session, "trappist", add(spec));
        let opened = names(&session, id);

        let rename = |system: u32, name: &str| Op::RenameSaveSystem {
            system,
            name: name.to_owned(),
        };
        round_trip_step(&mut session, "rename refuge", rename(id, "Sgf_Refuge"));
        let renamed = names(&session, id);
        for (before, after) in opened.iter().zip(&renamed) {
            let expected = match before.1.as_str() {
                "STAR_NAME_1_OF_1" | "PLANET_NAME_FORMAT" => {
                    let mut values = before.2.clone();
                    values[0] = "Sgf_Refuge".to_owned();
                    (before.0.clone(), before.1.clone(), values)
                }
                _ => before.clone(),
            };
            assert_eq!(after, &expected);
        }
        assert_eq!(renamed[4].1, "NAME_Unique_System_2_Planet");
        assert_eq!(renamed[5].2[0], "NAME_Unique_System_2_Planet");

        round_trip_step(
            &mut session,
            "rename trappist",
            rename(id + 1, "Sgf_Trappist"),
        );
        let trappist = names(&session, id + 1);
        assert_eq!(trappist[0].1, "Sgf_Trappist");
        assert_eq!(trappist[1].2[0], "Sgf_Trappist");

        let result = round_trip_step(&mut session, "remove", Op::RemoveSystem { id: id + 1 });
        let Op::AddSaveSystem { spec } = &result.inverse else {
            panic!("{:?}", result.inverse);
        };
        assert!(spec.star_named_by_class && spec.capped);
        assert_eq!(spec.name, "Sgf_Trappist");
        while session.undo().expect("undo").is_some() {}
        assert_eq!(current(&session), session.doc.original());
    }
}

/// A change to the spec, and whether an error is the refusal it should meet.
type Case = (fn(&mut SystemSpec), fn(&OpError) -> bool);

#[test]
fn what_the_op_refuses_of_the_new_fields() {
    let cases: Vec<Case> = vec![
        (
            |s| s.star.name = Some("NAME_Star".to_owned()),
            |e| matches!(e, OpError::FixedNameNotAllowed("the star")),
        ),
        (
            |s| s.planets[1].name = Some("NAME_Rock".to_owned()),
            |e| matches!(e, OpError::FixedNameNotAllowed(_)),
        ),
        (
            |s| s.planets[0].name = Some(String::new()),
            |e| matches!(e, OpError::EmptyName),
        ),
        (
            |s| s.planets[0].modifiers = vec![String::new()],
            |e| matches!(e, OpError::EmptyKey("a modifier")),
        ),
        (
            |s| s.planets[0].modifiers = vec!["a\"b".to_owned()],
            |e| matches!(e, OpError::InvalidKey(_)),
        ),
        (
            |s| s.planets[3].moons[0].entity_name = Some(String::new()),
            |e| matches!(e, OpError::EmptyKey("an entity name")),
        ),
        (
            |s| s.planets[3].moons[1].ring = true,
            |e| matches!(e, OpError::RingNotAllowed("a moon")),
        ),
    ];
    for (edit, expected) in cases {
        let mut spec = larionessi(&dorellion());
        edit(&mut spec);
        let mut session = open();
        let error = session.apply(add(spec.clone())).expect_err("refused");
        assert!(!session.doc.is_dirty(), "{error}");
        assert!(expected(&error), "{spec:?}: {error:?}");
    }
}

/// A save without `system_initializer_counter` takes an uncapped layout and refuses a
/// capped one.
#[test]
fn a_save_without_a_counter_refuses_only_a_capped_layout() {
    let without = || {
        common::open_edited(|bytes| {
            let text = String::from_utf8(bytes.clone()).expect("utf-8");
            let start = text
                .find("\nsystem_initializer_counter=")
                .expect("the counter")
                + 1;
            let end = start + text[start..].find("\n}\n").expect("its end") + 3;
            *bytes = format!("{}{}", &text[..start], &text[end..]).into_bytes();
        })
    };
    let at = dorellion();
    round_trip(without(), add(black_hole(&at)));
    let mut session = without();
    assert!(initializer_counts(&session.doc).is_empty());
    let error = session.apply(add(trappist(&at))).expect_err("refused");
    assert!(matches!(
        error,
        OpError::MissingSaveKey("system_initializer_counter")
    ));
    assert_eq!(BTreeMap::new(), initializer_counts(&session.doc));
}
