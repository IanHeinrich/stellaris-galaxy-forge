//! Adding a star system to a save, on the 4.5 and the 4.4 sample: the new system, its
//! bodies and their deposits stand as first-class entities for the projection, the
//! details, search and later ops; undo is byte-exact; a saved file reopens with the same
//! findings; slots are reused lowest first; belts and asteroids are written as the game
//! writes them; and what the op refuses.

use std::collections::BTreeSet;

use sgf_core::entity::{EntityAddr, EntityKind, get_entity};
use sgf_core::ops::{BeltSpec, Op, OpError, StarBody, SystemSpec};
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;
use sgf_core::views::Capabilities;

use crate::common;
use common::diff::{report, round_trip, round_trip_step};
use common::spec::{belted, body, dorellion, mura, star};
use common::{current, open, open_3_4, open_4_5, open_edited, text};

const GENERATION: u32 = 1 << 24;

/// Both samples, each with the spike's system for it and the id it takes.
fn samples() -> [(Session, SystemSpec, u32); 2] {
    [(open_4_5(), mura(), 601), (open(), dorellion(), 791)]
}

fn add(spec: SystemSpec) -> Op {
    Op::AddSaveSystem { spec }
}

fn findings(session: &Session) -> BTreeSet<(IssueCode, Vec<u32>, String)> {
    session
        .validate()
        .into_iter()
        .map(|issue| (issue.code, issue.systems, issue.message))
        .collect()
}

/// The planets the details list for system `id`, as (planet, class, deposit keys).
fn bodies(session: &Session, id: u32) -> Vec<(u32, String, Vec<String>)> {
    let details = session.details().expect("details");
    details
        .raw(id)
        .expect("the system's details")
        .planets
        .iter()
        .map(|p| {
            let deposits = p
                .deposits
                .iter()
                .map(|(k, n)| format!("{k} x{n}"))
                .collect();
            (p.id, p.class.clone(), deposits)
        })
        .collect()
}

#[test]
fn the_spike_system_is_written_as_the_game_spawns_one() {
    for (mut session, spec, _) in samples() {
        let name = spec.name.clone();
        let result = session.apply(add(spec)).expect("add the system");
        common::snapshot(
            &format!("add_{}", name.to_lowercase()),
            &report(&session, &result),
        );
    }
}

#[test]
fn a_saved_system_reopens_with_its_lanes_bodies_and_the_saves_findings() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for (mut session, spec, id) in samples() {
        let home = spec.lanes[0];
        let before = findings(&session);
        session.apply(add(spec)).expect("add the system");
        let path = dir.path().join(format!("{id}.sav"));
        session.save_as(&path).expect("save");

        let reopened = Session::open(&path).expect("reopen");
        let system = reopened.system(id).expect("the system");
        assert_eq!(system.star_class, "sc_g");
        assert_eq!(system.initializer, "basic_init_01");
        assert_eq!(system.planet_count, 9);
        assert_eq!(system.lanes.len(), 1);
        assert_eq!(system.lanes[0].to, home);
        assert!(
            !system.lanes[0].stale,
            "the length is the floor of the distance"
        );
        let back = reopened.graph.lane(home, id).expect("the lane's other end");
        assert_eq!(back.length, system.lanes[0].length);
        let classes: Vec<String> = system
            .bodies
            .as_ref()
            .expect("a save system lists its bodies")
            .iter()
            .map(|b| b.class.clone())
            .collect();
        assert_eq!(classes[0], "pc_g_star");
        assert_eq!(classes[4], "pc_gas_giant");
        assert_eq!(findings(&reopened), before, "{id}: the save's own findings");

        let listed = bodies(&reopened, id);
        assert_eq!(
            listed,
            bodies(&session, id),
            "{id}: details before the save"
        );
        assert_eq!(listed.len(), 9);
        assert_eq!(listed[0].2, ["d_energy_5 x1"]);
        let held: u32 = listed
            .iter()
            .flat_map(|(.., deposits)| deposits)
            .map(|d| d.rsplit_once(" x").unwrap().1.parse::<u32>().unwrap())
            .sum();
        assert_eq!(held, 5, "{listed:?}");
        let moons = reopened.details().unwrap().raw(id).unwrap().planets.clone();
        assert_eq!(moons.iter().filter(|p| p.moon).count(), 2);
    }
}

#[test]
fn a_belted_system_is_written_as_the_game_spawns_one() {
    for (mut session, spec, _) in samples() {
        let name = spec.name.clone();
        let result = session.apply(add(belted(spec))).expect("add the system");
        common::snapshot(
            &format!("add_{}_belted", name.to_lowercase()),
            &report(&session, &result),
        );
    }
}

/// A body the spec marks a star gets a star's `carrier_binary_flags`, whatever its class is
/// called, as a mod's star class may be named.
#[test]
fn a_body_the_spec_marks_a_star_is_written_as_one() {
    let mut session = open_4_5();
    let mut spec = mura();
    spec.planets
        .push(star(body("pc_modded_sun", 20, 240.0, 90.0, 0)));
    session.apply(add(spec)).expect("add the system");
    let text = text(&session);
    let class = text
        .find("\tplanet_class=\"pc_modded_sun\"\n")
        .expect("the body's entry");
    let entry = &text[class..class + text[class..].find("\tname=").expect("its name")];
    assert!(entry.contains("\tcarrier_binary_flags=3\n"), "{entry}");
}

/// Each body the details list for system `id`, as its name's key and what it shows: a
/// planet's numeral, an asteroid's prefix and suffix joined.
fn body_names(session: &Session, id: u32) -> Vec<(String, String)> {
    let details = session.details().expect("details");
    let raw = details.raw(id).expect("the system's details");
    raw.planets
        .iter()
        .map(|p| {
            let variables = p.name.variables.iter();
            let shown = match p.name.key.as_str() {
                "ASTEROID_NAME_FORMAT" => variables.map(|v| v.value.key.as_str()).collect(),
                _ => variables
                    .filter(|v| v.name == "NUMERAL")
                    .map(|v| v.value.key.clone())
                    .collect(),
            };
            (p.name.key.clone(), shown)
        })
        .collect()
}

/// The pool block of suffixes still free for `prefix`, as the text holds it.
fn suffixes(text: &str, prefix: &str) -> Vec<String> {
    let names = |block: &str| -> Vec<String> {
        block[..block.find("\n\t}").expect("the block's end")]
            .lines()
            .filter(|line| line.starts_with("\t\t"))
            .map(|line| line.trim().trim_matches('"').to_owned())
            .collect()
    };
    let pool = &text[text.find("\nrandom_name_database=").expect("the pool")..];
    let prefixes = names(&pool[pool.find("\tasteroid_prefix=").expect("the prefixes")..]);
    let at = prefixes
        .iter()
        .position(|held| held == prefix)
        .expect("the prefix");
    names(
        pool.split("\tasteroid_postfix=")
            .nth(at + 1)
            .expect("its block"),
    )
}

/// The sample system `id` is added to, as opened.
fn open_again(id: u32) -> Session {
    match id {
        601 => open_4_5(),
        _ => open(),
    }
}

#[test]
fn a_saved_belted_system_reopens_with_its_belts_and_named_asteroids() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for (mut session, spec, id) in samples() {
        let before = findings(&session);
        session.apply(add(belted(spec))).expect("add the system");
        let path = dir.path().join(format!("{id}.sav"));
        session.save_as(&path).expect("save");

        let reopened = Session::open(&path).expect("reopen");
        let saved = text(&reopened);
        let systems = &saved[saved.find("\ngalactic_object=").expect("the systems")..];
        let entry = &systems[systems
            .find(&format!("\n\t{id}=\n\t{{\n"))
            .expect("the entry")..];
        let entry = &entry[..entry.find("\n\t}\n").expect("its end")];
        assert!(entry.contains("\t\tasteroid_belts=\n\t\t{\n\t\t\t\n\t\t\t{\n\t\t\t\ttype=\"rocky_asteroid_belt\"\n\t\t\t\tinner_radius=95\n\t\t\t}\n \n\t\t\t{\n\t\t\t\ttype=\"icy_asteroid_belt\"\n\t\t\t\tinner_radius=240\n\t\t\t}\n \n\t\t}\n\t\tinitializer=\"basic_init_05\"\n\t\tinner_radius=270\n\t\touter_radius=370\n"), "{entry}");
        assert_eq!(reopened.system(id).expect("the system").planet_count, 13);

        let names = body_names(&reopened, id);
        assert_eq!(names, body_names(&session, id), "{id}: before the save");
        let keys: Vec<&str> = names.iter().map(|(key, _)| key.as_str()).collect();
        assert_eq!(
            keys[1..6],
            [
                "PLANET_NAME_FORMAT",
                "PLANET_NAME_FORMAT",
                "ASTEROID_NAME_FORMAT",
                "ASTEROID_NAME_FORMAT",
                "PLANET_NAME_FORMAT"
            ]
        );
        let numerals: Vec<&str> = names
            .iter()
            .filter(|(key, _)| key == "PLANET_NAME_FORMAT")
            .map(|(_, numeral)| numeral.as_str())
            .collect();
        assert_eq!(numerals, ["I", "II", "III", "IV", "V", "VI"], "{names:?}");

        let opened = text(&open_again(id));
        let details = reopened.details().expect("details");
        let raw = details.raw(id).expect("the system's details");
        let asteroids: Vec<_> = raw
            .planets
            .iter()
            .filter(|p| p.name.key == "ASTEROID_NAME_FORMAT")
            .collect();
        assert_eq!(asteroids.len(), 4);
        let mut seen = BTreeSet::new();
        for asteroid in asteroids {
            assert!(asteroid.class.ends_with("asteroid"), "{}", asteroid.class);
            assert_eq!(asteroid.size, Some(5));
            let [prefix, suffix] = &asteroid.name.variables[..] else {
                panic!("{:?}", asteroid.name);
            };
            assert_eq!(
                (prefix.name.as_str(), suffix.name.as_str()),
                ("prefix", "suffix")
            );
            let (prefix, suffix) = (&prefix.value.key, &suffix.value.key);
            assert!(seen.insert((prefix.clone(), suffix.clone())), "a name once");
            assert!(
                suffixes(&opened, prefix).contains(suffix),
                "{prefix}{suffix} was free in the pool"
            );
            assert!(
                !suffixes(&saved, prefix).contains(suffix),
                "{prefix}{suffix} leaves the pool"
            );
        }
        assert_eq!(findings(&reopened), before, "{id}: the save's own findings");
    }
}

#[test]
fn undo_puts_back_the_bytes_of_a_belted_system() {
    for (session, spec, _) in samples() {
        round_trip(session, add(belted(spec)));
    }
}

#[test]
fn belted_systems_take_different_asteroid_names() {
    for (mut session, spec, id) in samples() {
        let mut other = belted(spec.clone());
        other.name = "Sgf_Second".to_owned();
        (other.x, other.y) = (spec.x + 20.0, spec.y + 20.0);
        other.lanes = vec![id];
        let mut twin = belted(spec.clone());
        (twin.x, twin.y) = match id {
            601 => (-300.0, -120.0),
            _ => (420.0, -222.0),
        };
        twin.lanes = vec![id];
        round_trip_step(&mut session, "first", add(belted(spec)));
        round_trip_step(&mut session, "other", add(other));
        round_trip_step(&mut session, "twin", add(twin));
        let asteroids = |system: u32| -> BTreeSet<String> {
            body_names(&session, system)
                .into_iter()
                .filter(|(key, _)| key == "ASTEROID_NAME_FORMAT")
                .map(|(_, name)| name)
                .collect()
        };
        let (first, other, twin) = (asteroids(id), asteroids(id + 1), asteroids(id + 2));
        assert_eq!((first.len(), other.len(), twin.len()), (4, 4, 4));
        assert!(first.is_disjoint(&other), "{first:?} {other:?}");
        assert!(
            first.is_disjoint(&twin),
            "the same system name: {first:?} {twin:?}"
        );
    }
}

#[test]
fn undo_puts_back_the_bytes_and_redo_writes_them_again() {
    for (session, spec, _) in samples() {
        round_trip(session, add(spec));
    }
}

#[test]
fn the_new_system_is_found_by_search_and_the_inspector() {
    for (mut session, spec, id) in samples() {
        session.apply(add(spec.clone())).expect("add the system");
        session.warm_details().expect("details");
        let no_loc = |_: &str| None;
        let no_special = |_: u32| Vec::new();
        let hits = session.search(&spec.name, 20, &no_loc, &no_special).hits;
        assert!(hits.iter().any(|h| h.id == id), "{hits:?}");

        let star = bodies(&session, id)[0].0;
        let system = get_entity(&session.doc, EntityAddr::new(EntityKind::System, id), &[])
            .expect("the system's entity");
        assert_eq!(system.addr.id, id);
        get_entity(&session.doc, EntityAddr::new(EntityKind::Planet, star), &[])
            .expect("the star's entity");
    }
}

#[test]
fn two_adds_take_consecutive_ids_and_share_no_slot() {
    for (mut session, spec, id) in samples() {
        let mut second = spec.clone();
        second.name = "Sgf_Second".to_owned();
        second.x += 20.0;
        second.y += 20.0;
        second.lanes = vec![id];
        round_trip_step(&mut session, "first", add(spec));
        round_trip_step(&mut session, "second", add(second));
        assert!(session.system(id + 1).is_some());
        assert_eq!(
            session.graph.order[session.graph.order.len() - 2..],
            [id, id + 1]
        );
        let lane = session
            .graph
            .lane(id, id + 1)
            .expect("the lane between them");
        assert!(!lane.stale);

        let first: Vec<u32> = bodies(&session, id).iter().map(|b| b.0).collect();
        let next: Vec<u32> = bodies(&session, id + 1).iter().map(|b| b.0).collect();
        assert!(
            first.iter().all(|p| !next.contains(p)),
            "{first:?} {next:?}"
        );
        let deposits = |id: u32| -> BTreeSet<String> {
            let doc = &session.doc;
            bodies(&session, id)
                .iter()
                .flat_map(|&(planet, ..)| {
                    let addr = EntityAddr::new(EntityKind::Planet, planet);
                    let view = get_entity(doc, addr, &["deposits".to_owned()]).ok();
                    view.into_iter()
                        .flat_map(|v| v.nodes.into_iter().map(|n| format!("{:?}", n.value)))
                })
                .collect()
        };
        let (held, next_held) = (deposits(id), deposits(id + 1));
        assert_eq!((held.len(), next_held.len()), (5, 5), "{held:?}");
        assert!(held.is_disjoint(&next_held), "{held:?} {next_held:?}");

        session.undo().unwrap().unwrap();
        session.undo().unwrap().unwrap();
        assert_eq!(current(&session), session.doc.original());
        assert!(session.system(id).is_none());
    }
}

#[test]
fn later_ops_work_on_the_new_system_and_undo_back_to_the_original() {
    for (mut session, spec, id) in samples() {
        let home = spec.lanes[0];
        round_trip_step(&mut session, "add", add(spec.clone()));
        let star = bodies(&session, id)[0].0;
        let far = *session
            .graph
            .order
            .iter()
            .find(|&&other| other != home && other != id && session.graph.lane(id, other).is_none())
            .expect("a system to link");
        let x = spec.x + 3.0;
        let steps = [
            Op::MoveSystem { id, x, y: spec.y },
            Op::AddLane {
                a: far,
                b: id,
                bridge: false,
            },
            Op::RemoveLane { a: id, b: home },
            Op::SetStarClass {
                id,
                class: "sc_m".to_owned(),
                bodies: vec![StarBody {
                    planet: star,
                    class: "pc_m_star".to_owned(),
                }],
            },
            Op::SetPlanetSize { id: star, size: 30 },
        ];
        for op in steps {
            let label = format!("{op:?}");
            round_trip_step(&mut session, &label, op);
        }
        let system = session.system(id).unwrap();
        assert_eq!((system.x, system.star_class.as_str()), (x, "sc_m"));
        assert_eq!(bodies(&session, id)[0].1, "pc_m_star");
        while session.undo().expect("undo").is_some() {}
        assert_eq!(current(&session), session.doc.original());
        assert!(session.system(id).is_none());
        assert!(!session.doc.is_dirty());
    }
}

#[test]
fn the_name_leaves_the_pool_only_when_the_pool_holds_it() {
    for (mut session, spec, _) in samples() {
        let entry = format!("\t\t\"{}\"\n", spec.name);
        assert!(text(&session).contains(&entry));
        session.apply(add(spec)).expect("add the system");
        assert!(!text(&session).contains(&entry), "the name leaves the pool");
    }
    for (mut session, mut spec, _) in samples() {
        spec.name = "Sgf_Unpooled".to_owned();
        session.apply(add(spec)).expect("add the system");
        let pool = |bytes: &[u8]| {
            let text = String::from_utf8_lossy(bytes).into_owned();
            let start = text.find("\nrandom_name_database=").expect("the pool");
            text[start..start + 200_000].to_owned()
        };
        assert_eq!(pool(&current(&session)), pool(session.doc.original()));
        assert!(text(&session).contains("key=\"Sgf_Unpooled\""));
    }
}

#[test]
fn the_lowest_dead_slots_are_taken_first_one_generation_on() {
    let mut session = open_4_5();
    assert!(text(&session).contains("\n\t\t57=none\n"));
    assert!(text(&session).contains("\n\t0=none\n"));
    session.apply(add(mura())).expect("add the system");
    let text = text(&session);
    let star = 57 | GENERATION;
    assert!(!text.contains("\n\t\t57=none\n"), "the tombstone is taken");
    assert!(text.contains("\n\t\t56="));
    assert!(text.contains(&format!(
        "\n\t\t{star}=\n\t\t{{\n\t\t\tplanet_class=\"pc_g_star\""
    )));
    let listed = bodies(&session, 601);
    assert_eq!(listed[0].0, star);
    assert_eq!(
        listed[1].0, 6375,
        "then past the highest slot, generation 0"
    );
    let table = &text[text
        .find(
            "
deposit=
{",
        )
        .expect("the deposit table")..];
    for (slot, deposit) in [(0, "d_energy_5"), (1, "d_black_soil")] {
        let id = slot | GENERATION;
        assert!(
            table.starts_with(
                "
deposit=
{
	"
            ) && !table[..200].contains(&format!(
                "
	{slot}=none
"
            ))
        );
        assert!(table.contains(&format!(
            "
	{id}=
	{{
		type=\"{deposit}\""
        )));
    }
    let deposit = get_entity(
        &session.doc,
        EntityAddr::new(EntityKind::Deposit, GENERATION),
        &[],
    )
    .expect("the reused deposit's entity");
    assert_eq!(deposit.addr.id, GENERATION);
}

/// A change to the spec, and whether an error is the refusal it should meet.
type Case = (fn(&mut SystemSpec), fn(&OpError) -> bool);

fn refused(mut session: Session, spec: SystemSpec) -> OpError {
    let error = session.apply(add(spec)).expect_err("refused");
    assert!(!session.doc.is_dirty(), "{error}");
    error
}

#[test]
fn what_the_op_refuses() {
    let old = open_3_4();
    assert!(matches!(refused(old, dorellion()), OpError::SaveTooOld(v) if v.contains("v3.4")));

    let gap = open_edited(|bytes| {
        let text = String::from_utf8(bytes.clone()).unwrap();
        *bytes = text
            .replace("\nlast_created_system=790\n", "\nlast_created_system=795\n")
            .into_bytes();
    });
    assert!(matches!(
        refused(gap, dorellion()),
        OpError::SystemIdsNotDense {
            last: 795,
            count: 791
        }
    ));

    let cases: Vec<Case> = vec![
        (|s| s.x = f64::NAN, |e| matches!(e, OpError::NotFinite)),
        (
            |s| s.x = 700.0,
            |e| matches!(e, OpError::OutsideGalaxy { .. }),
        ),
        (
            |s| (s.x, s.y) = (397.39 + 6.0, -180.25),
            |e| matches!(e, OpError::TooClose { id: 217, .. }),
        ),
        (
            |s| s.name = String::new(),
            |e| matches!(e, OpError::EmptyText { what: "a name" }),
        ),
        (
            |s| s.lanes = vec![9999],
            |e| matches!(e, OpError::UnknownSystem(9999)),
        ),
        (
            |s| s.lanes = vec![217, 217],
            |e| matches!(e, OpError::DuplicateLane(791, 217)),
        ),
        (
            |s| s.star_class = String::new(),
            |e| {
                matches!(
                    e,
                    OpError::EmptyText {
                        what: "a star class"
                    }
                )
            },
        ),
        (
            |s| s.planets[0].class = String::new(),
            |e| {
                matches!(
                    e,
                    OpError::EmptyText {
                        what: "a planet class"
                    }
                )
            },
        ),
        (
            |s| s.planets[0].size = 0,
            |e| matches!(e, OpError::ZeroPlanetSize),
        ),
        (
            |s| s.planets[0].deposits = vec!["d_\"x".to_owned()],
            |e| matches!(e, OpError::InvalidText { .. }),
        ),
        (
            |s| s.star.moons = vec![body("pc_barren", 5, 10.0, 0.0, 1)],
            |e| matches!(e, OpError::MoonsNotAllowed("the star")),
        ),
        (
            |s| s.planets[3].moons[0].moons = vec![body("pc_barren", 5, 10.0, 0.0, 1)],
            |e| matches!(e, OpError::MoonsNotAllowed("a moon")),
        ),
        (
            |s| {
                s.planets[1].asteroid = true;
                s.planets[1].moons = vec![body("pc_barren", 5, 10.0, 0.0, 1)];
            },
            |e| matches!(e, OpError::MoonsNotAllowed("an asteroid")),
        ),
        (
            |s| s.star.asteroid = true,
            |e| matches!(e, OpError::AsteroidNotAllowed("the star")),
        ),
        (
            |s| s.planets[3].moons[0].asteroid = true,
            |e| matches!(e, OpError::AsteroidNotAllowed("a moon")),
        ),
        (
            |s| {
                s.belts = vec![BeltSpec {
                    kind: String::new(),
                    inner_radius: 95.0,
                }]
            },
            |e| {
                matches!(
                    e,
                    OpError::EmptyText {
                        what: "a belt type"
                    }
                )
            },
        ),
        (
            |s| s.flags = vec!["unique system".to_owned()],
            |e| {
                matches!(
                    e,
                    OpError::InvalidText {
                        what: "a star flag",
                        ..
                    }
                )
            },
        ),
        (
            |s| s.flags = vec![String::new()],
            |e| {
                matches!(
                    e,
                    OpError::EmptyText {
                        what: "a star flag"
                    }
                )
            },
        ),
        (
            |s| {
                s.belts = vec![BeltSpec {
                    kind: "rocky_asteroid_belt".to_owned(),
                    inner_radius: f64::INFINITY,
                }]
            },
            |e| matches!(e, OpError::NotFinite),
        ),
    ];
    for (edit, expected) in cases {
        let mut spec = dorellion();
        edit(&mut spec);
        let error = refused(open(), spec.clone());
        assert!(expected(&error), "{spec:?}: {error:?}");
    }
}

#[test]
fn a_scenario_refuses_it() {
    let mut session = common::examples::scenario();
    let error = session.apply(add(dorellion())).expect_err("refused");
    assert!(matches!(
        error,
        OpError::Unsupported {
            op: "AddSaveSystem",
            ..
        }
    ));
}

#[test]
fn two_adds_in_one_batch_undo_as_one_step() {
    for (session, spec, id) in samples() {
        let mut second = spec.clone();
        second.name = "Sgf_Second".to_owned();
        second.x += 20.0;
        second.y += 20.0;
        second.lanes = vec![id];
        round_trip(
            session,
            Op::Batch {
                description: "Added two systems".to_owned(),
                ops: vec![add(spec), add(second)],
            },
        );
    }
}

#[test]
fn an_add_after_an_undone_one_takes_the_same_ids() {
    for (mut session, spec, id) in samples() {
        session.apply(add(spec.clone())).expect("add");
        let first = current(&session);
        session.undo().expect("undo").expect("an op to undo");
        session.apply(add(spec)).expect("add again");
        assert!(session.system(id).is_some());
        assert_eq!(current(&session), first, "the same ids and the same text");
    }
}

/// A refused member rolls back the batch, and the entities the first member wrote leave
/// the document's list of added ones with its bytes: the next add takes the same ids.
#[test]
fn a_refused_batch_forgets_the_system_it_wrote() {
    for (mut session, spec, id) in samples() {
        let fresh = {
            let mut fresh = match id {
                601 => open_4_5(),
                _ => open(),
            };
            fresh.apply(add(spec.clone())).expect("add");
            current(&fresh)
        };
        let mut refused_member = spec.clone();
        refused_member.name = String::new();
        let error = session
            .apply(Op::Batch {
                description: "Added two systems".to_owned(),
                ops: vec![add(spec.clone()), add(refused_member)],
            })
            .expect_err("the second member is refused");
        assert!(
            matches!(error, OpError::EmptyText { what: "a name" }),
            "{error}"
        );
        assert!(!session.doc.is_dirty());
        assert!(session.system(id).is_none());
        let planet = EntityAddr::new(EntityKind::System, id);
        assert!(get_entity(&session.doc, planet, &[]).is_err());
        session.apply(add(spec)).expect("add");
        assert_eq!(current(&session), fresh);
    }
}

/// The 4.4 sample with its asteroid name pool, the prefix list and every suffix block,
/// swapped for `pool`.
fn with_asteroid_pool(pool: &str) -> Session {
    open_edited(|bytes| {
        let text = String::from_utf8(bytes.clone()).expect("utf-8");
        let start = text.find("\n\tasteroid_prefix=\n").expect("the prefixes") + 1;
        let last = text.rfind("\n\tasteroid_postfix=\n").expect("the suffixes") + 1;
        let end = last + text[last..].find("\n\t}\n").expect("the last block's end") + 4;
        *bytes = format!("{}{pool}{}", &text[..start], &text[end..]).into_bytes();
    })
}

#[test]
fn a_save_without_an_asteroid_pool_takes_no_asteroids() {
    round_trip(with_asteroid_pool(""), add(dorellion()));
    assert!(matches!(
        refused(with_asteroid_pool(""), belted(dorellion())),
        OpError::MissingSaveKey("asteroid_prefix")
    ));
}

/// AA- has no suffix left and BB- one: the first asteroid takes it, the rest use it again.
const SPENT_POOL: &str = "\tasteroid_prefix=\n\t{\n\t\t\"AA-\"\n\t\t\"BB-\"\n\t}\n\tasteroid_postfix=\n\t{\n\t}\n\tasteroid_postfix=\n\t{\n\t\t\"1\"\n\t}\n";

#[test]
fn a_spent_asteroid_pool_names_asteroids_again() {
    round_trip(with_asteroid_pool(SPENT_POOL), add(belted(dorellion())));
    let mut session = with_asteroid_pool(SPENT_POOL);
    session.apply(add(belted(dorellion()))).expect("add");
    let asteroids: Vec<String> = body_names(&session, 791)
        .into_iter()
        .filter(|(key, _)| key == "ASTEROID_NAME_FORMAT")
        .map(|(_, name)| name)
        .collect();
    assert_eq!(asteroids, ["BB-1"; 4]);
    let spent = SPENT_POOL.replace("\t\t\"1\"\n", "");
    assert!(
        text(&session).contains(&spent),
        "the one suffix leaves the pool"
    );

    session.apply(Op::RemoveSystem { id: 791 }).expect("remove");
    assert_eq!(current(&session), session.doc.original());
}

/// The 4.4 sample with a top-level section swapped for `replacement`, which is empty
/// when the section goes.
fn without_section(key: &str, replacement: &str) -> Session {
    let head = format!("\n{key}=\n{{\n");
    open_edited(|bytes| {
        let text = String::from_utf8(bytes.clone()).expect("utf-8");
        let start = text.find(&head).expect("the section") + 1;
        let end = start + text[start..].find("\n}\n").expect("its closing brace") + 3;
        *bytes = format!("{}{replacement}{}", &text[..start], &text[end..]).into_bytes();
    })
}

#[test]
fn a_save_without_a_deposit_table_takes_a_system_without_deposits() {
    let mut spec = dorellion();
    let mut bare = spec.clone();
    bare.star.deposits.clear();
    for planet in &mut bare.planets {
        planet.deposits.clear();
    }
    round_trip(without_section("deposit", ""), add(bare));
    spec.name = "Sgf_Deposits".to_owned();
    assert!(matches!(
        refused(without_section("deposit", ""), spec),
        OpError::MissingSaveKey("deposit")
    ));
}

#[test]
fn entries_land_inside_a_table_whose_closing_brace_shares_a_line() {
    let mut session = without_section("deposit", "deposit={ }\n");
    let mut second = dorellion();
    second.name = "Sgf_Second".to_owned();
    second.x += 20.0;
    second.y += 20.0;
    second.lanes = vec![791];
    round_trip_step(&mut session, "first", add(dorellion()));
    round_trip_step(&mut session, "second", add(second));
    let text = text(&session);
    let start = text.find("\ndeposit={ \n").expect("the table") + 1;
    let table = &text[start..start + text[start..].find("\n}\n").expect("its end") + 3];
    assert!(table.starts_with("deposit={ \n\t0=\n\t{\n\t\ttype=\"d_energy_5\"\n"));
    assert!(table.contains("\t}\n\t5=\n\t{\n"), "{table}");
    assert!(table.ends_with("\t\t\tid=8416\n\t\t}\n\t}\n}\n"), "{table}");
    assert!(table.lines().all(|line| !line.trim().is_empty()), "{table}");
    assert_eq!(bodies(&session, 792)[0].2, ["d_energy_5 x1"]);
    let planets = "planets=\n{\n\tplanet={ }\n}\n";
    let mut session = without_section("planets", planets);
    // Every other system still lists planets this table no longer holds, and the new ones
    // take their ids, so only the text is checked here.
    session.apply(add(dorellion())).expect("add");
    let text = self::text(&session);
    assert!(
        text.contains("planets=\n{\n\tplanet={ \n\t\t0=\n\t\t{\n\t\t\tplanet_class=\"pc_g_star\""),
        "the entry takes the table's indentation"
    );
    assert!(text.contains("\t\t\tentity=1\n\t\t}\n\t}\n}\n"));
}

/// The 4.4 sample with its `meta` rewritten by `edit`.
fn with_meta(edit: impl FnOnce(String) -> String) -> Session {
    let raw = sgf_core::archive::read_sav(common::SAMPLE).expect("read the sample");
    let meta = edit(String::from_utf8(raw.meta).expect("utf-8"));
    let doc = sgf_core::document::Document::from_bytes(raw.gamestate, meta.into_bytes())
        .expect("index the sample");
    Session::from_document(None, doc).expect("project the sample")
}

/// The 4.4 sample with its `meta` version written as `version`.
fn with_version(version: &str) -> Session {
    with_meta(|meta| {
        meta.replace(
            "version=\"Pegasus v4.4.6\"",
            &format!("version=\"{version}\""),
        )
    })
}

#[test]
fn the_version_is_read_with_or_without_a_release_name() {
    with_version("4.1.0")
        .apply(add(dorellion()))
        .expect("a bare 4.x version");
    assert!(matches!(
        refused(with_version("v3.14.1"), dorellion()),
        OpError::SaveTooOld(v) if v == "v3.14.1"
    ));
    assert!(matches!(
        refused(with_version("Pegasus"), dorellion()),
        OpError::UnknownSaveVersion(v) if v == "Pegasus"
    ));
}

#[test]
fn a_save_that_refuses_the_add_offers_no_added_systems_but_keeps_bodies() {
    let offered = |session: &Session| {
        let capabilities = Capabilities::of(&session.doc);
        (
            capabilities.added_systems,
            capabilities.bodies,
            capabilities.deposits,
        )
    };
    assert_eq!(offered(&open()), (true, true, true));
    assert_eq!(offered(&open_3_4()), (false, true, false));

    let ironman = with_meta(|meta| meta + "ironman=yes\n");
    assert_eq!(offered(&ironman), (false, true, true));
    assert!(matches!(refused(ironman, dorellion()), OpError::Ironman));
}
