//! Where a scenario system's megastructures and starbase stand and who owns them, read from
//! its initializer: on the fixture install, and against the 4.4 sample save's own rows.

use crate::common;

use sgf_core::document::Document;
use sgf_core::format::save::details::{
    ClassPool, HeuristicResolver, MegastructureSummary, PlanetSummary, SpawnClass, SpawnPlace,
    StarbaseSummary, StructureSpawn, SystemDetails,
};
use sgf_core::session::Session;
use sgf_gamedata::GameData;
use sgf_gamedata::initializers::{self, Initializer};
use sgf_gamedata::scripts::ScenarioSystem;
use sgf_gamedata::views::SystemRoll;

use common::scripts::sys;
use common::{INSTALL, fixed, range};

const SCENARIO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/4.4-early.scenario.txt"
);

fn spawn(row: &MegastructureSummary) -> &StructureSpawn {
    row.spawn
        .as_ref()
        .expect("a scenario row says how it was spawned")
}

fn near(a: (f64, f64), b: (f64, f64), within: f64) -> bool {
    (a.0 - b.0).hypot(a.1 - b.1) <= within
}

fn polar((x, y): (f64, f64), radius: f64, angle: f64) -> (f64, f64) {
    let angle = angle.to_radians();
    (x + radius * angle.cos(), y + radius * angle.sin())
}

/// Each body's point about the centre in `roll`, by its id.
fn rolled_points(details: &SystemDetails, roll: &SystemRoll) -> Vec<(u32, (f64, f64))> {
    let mut points: Vec<(u32, (f64, f64))> = Vec::new();
    for (planet, body) in details.planets.iter().zip(&roll.bodies) {
        assert_eq!(planet.id, body.id);
        let centre = planet
            .parent
            .and_then(|p| points.iter().find(|(id, _)| *id == p))
            .map_or((0.0, 0.0), |(_, at)| *at);
        points.push((planet.id, polar(centre, body.orbit, body.angle)));
    }
    points
}

fn point_of(points: &[(u32, (f64, f64))], body: u32) -> (f64, f64) {
    points
        .iter()
        .find(|(id, _)| *id == body)
        .map(|(_, at)| *at)
        .expect("a rolled body")
}

#[test]
fn every_way_an_initializer_places_a_megastructure_gives_a_row_where_it_stands() {
    let gd = common::cached_fixture();
    let owners = gd.scenario_owners(&[sys(3, "fallen_home"), sys(7, "structures_init")]);
    let fallen = owners
        .territory_of("fixture_fallen")
        .expect("the fallen empire's territory");
    let details = gd
        .initializer_details(7, "structures_init", Some(&owners))
        .expect("the structures fixture");
    let body = |i: usize| details.planets[i].id;
    let unknown = |written: &str| SpawnPlace::Unknown {
        written: written.to_owned(),
    };

    let rows: Vec<(&str, Option<u32>, &SpawnPlace, bool)> = details
        .megastructures
        .iter()
        .map(|m| (m.kind.as_str(), m.planet, &spawn(m).place, spawn(m).always))
        .collect();
    let orbit = |distance, angle| SpawnPlace::Orbit { distance, angle };
    let tied = |i: usize| SpawnPlace::Body { body: body(i) };
    let expected: Vec<(&str, Option<u32>, SpawnPlace, bool)> = vec![
        ("fixture_core", None, SpawnPlace::Centre, true),
        (
            "fixture_arc",
            None,
            orbit(range(40.0, 50.0), fixed(225.0)),
            true,
        ),
        ("fixture_ring", Some(body(1)), tied(1), true),
        ("fixture_shipyard", Some(body(0)), tied(0), true),
        (
            "fixture_near",
            None,
            SpawnPlace::NearBody { body: body(1) },
            true,
        ),
        ("fixture_gateway", None, SpawnPlace::Random, true),
        ("fixture_relay_ruined", None, SpawnPlace::Random, true),
        (
            "fixture_lost",
            None,
            unknown("event_target:fixture_saved_by_an_event"),
            true,
        ),
        ("fixture_maybe", None, orbit(fixed(30.0), fixed(0.0)), false),
        ("fixture_on_a_maybe_planet", Some(body(5)), tied(5), false),
        (
            "fixture_any_angle",
            None,
            orbit(fixed(35.0), range(0.0, 360.0)),
            true,
        ),
        (
            "fixture_unread",
            None,
            unknown("orbit_distance = @fixture_no_such_distance"),
            true,
        ),
        (
            "fixture_per_planet",
            None,
            unknown("every_system_planet"),
            false,
        ),
        ("fixture_named_from_a_planet", Some(body(1)), tied(1), false),
        ("fixture_tank", Some(body(2)), tied(2), true),
        ("fixture_tank", Some(body(3)), tied(3), true),
        ("fixture_system_itself", None, unknown("this"), true),
    ];
    let expected: Vec<(&str, Option<u32>, &SpawnPlace, bool)> = expected
        .iter()
        .map(|(kind, planet, place, always)| (*kind, *planet, place, *always))
        .collect();
    assert_eq!(
        rows, expected,
        "system rows in file order, then one per copy of the block that spawns one; nothing \
         written for a neighbour, every system or a country; one for each body scope, never \
         certain"
    );

    let roll = gd.system_roll(7, "structures_init", "", 0, 150.0);
    let bodies = rolled_points(&details, &roll);
    let inner = details
        .spawn
        .as_ref()
        .and_then(|s| s.inner_radius)
        .map(|b| (b.min + b.max) / 2.0)
        .expect("an inner radius");
    let at_body = |i: usize| Some(point_of(&bodies, body(i)));
    let expected_points = [
        Some((0.0, 0.0)),
        Some(polar((0.0, 0.0), 45.0, 225.0 + 180.0)),
        at_body(1),
        at_body(0),
        at_body(1),
        Some(polar((0.0, 0.0), 1.24 * inner, 135.0)),
        Some(polar((0.0, 0.0), 1.05 * inner, 225.0)),
        None,
        Some((-30.0, 0.0)),
        at_body(5),
        Some((35.0, 0.0)),
        None,
        None,
        at_body(1),
        at_body(2),
        at_body(3),
        None,
    ];
    for (row, want) in details.megastructures.iter().zip(expected_points) {
        match (row.at, want) {
            (Some(got), Some(want)) => assert!(
                near(got, want, 1e-4),
                "{} at {got:?}, not {want:?}",
                row.kind
            ),
            (got, want) => assert_eq!(got, want, "{}", row.kind),
        }
    }

    let arc = &details.megastructures[1];
    assert_eq!(
        arc.owner,
        Some(fallen),
        "owner = event_target:fixture_fallen"
    );
    assert_eq!(arc.culture.as_deref(), Some("fixture_culture"));
    let ring = &details.megastructures[2];
    assert_eq!(ring.owner, None);
    assert_eq!(spawn(ring).owner_written.as_deref(), Some("root"));
    assert_eq!(
        details.megastructures[0].owner,
        Some(fallen),
        "no owner written: the territory the system joins, as its starbase is the fallen \
         empire's"
    );
    assert_eq!(spawn(&details.megastructures[0]).owner_written, None);
    let line = spawn(arc).at.as_ref().expect("its line");
    assert!(line.file.ends_with("00_a.txt") && line.line > 0, "{line:?}");

    let starbase = details.starbase.expect("create_starbase");
    assert_eq!(starbase.owner, Some(fallen));
    assert_eq!(starbase.at, Some((18.3, -18.3)), "a = 11.7 + 0.33 × 20");
    assert_eq!(
        starbase.spawn.as_ref().map(|s| &s.place),
        Some(&SpawnPlace::Starbase {
            star_size: fixed(20.0)
        })
    );

    let script = |planet: &PlanetSummary| -> Vec<String> {
        let spawn = planet.spawn.as_ref().expect("a body's spawn");
        spawn.script.iter().map(|s| s.key.clone()).collect()
    };
    assert!(
        script(&details.planets[2]).is_empty() && script(&details.planets[4]).is_empty(),
        "a spawn_megastructure in solar_system = {{ }} is read, so not a script line"
    );
}

/// The system view draws a scenario body where a roll of its initializer lands it; each row
/// that stands at a body stands there in every roll, and the details' own points are roll 0's.
#[test]
fn a_structure_at_a_body_stands_where_each_roll_lands_the_body() {
    let gd = common::cached_fixture();
    let details = gd
        .initializer_details(7, "structures_init", None)
        .expect("the structures fixture");
    let anchored: Vec<&MegastructureSummary> = details
        .megastructures
        .iter()
        .filter(|m| {
            matches!(
                spawn(m).place,
                SpawnPlace::Body { .. } | SpawnPlace::NearBody { .. }
            )
        })
        .collect();
    let mut ring_points = Vec::new();
    for n in 0..4 {
        let roll = gd.system_roll(7, "structures_init", "", n, 150.0);
        let bodies = rolled_points(&details, &roll);
        let ids: Vec<u32> = roll.structures.iter().map(|s| s.id).collect();
        assert_eq!(
            ids,
            anchored.iter().map(|m| m.id).collect::<Vec<_>>(),
            "every row at a body, and no other"
        );
        for (rolled, row) in roll.structures.iter().zip(&anchored) {
            let body = match spawn(row).place {
                SpawnPlace::Body { body } | SpawnPlace::NearBody { body } => body,
                _ => unreachable!(),
            };
            assert!(
                near(rolled.at, point_of(&bodies, body), 1e-9),
                "{}",
                row.kind
            );
            if n == 0 {
                assert_eq!(row.at, Some(rolled.at), "the details' point is roll 0's");
            }
        }
        ring_points.push(roll.structures[0].at);
    }
    assert!(
        ring_points.windows(2).any(|w| w[0] != w[1]),
        "the ring planet's ranged angle moves its megastructure from roll to roll"
    );
}

#[test]
fn a_parameterless_scripted_effect_gives_the_starbase_it_creates() {
    let gd = common::cached_fixture();
    let details = gd
        .initializer_details(8, "citadel_init", None)
        .expect("the citadel fixture");
    let starbase = details.starbase.expect("create_fixture_citadel = yes");
    assert_eq!(
        starbase.level, "starbase_level_fixture",
        "the level of its ship size"
    );
    assert!(starbase.shipyard);
    assert_eq!(starbase.at, Some((21.6, -21.6)), "a = 11.7 + 0.33 × 30");
    let spawned = starbase.spawn.as_ref().expect("its spawn");
    assert!(spawned.always);
    let line = spawned.at.as_ref().expect("its line");
    assert!(
        line.file
            .replace('\\', "/")
            .ends_with("scripted_effects/00_fixture.txt"),
        "{line:?}"
    );
    assert!(
        details.megastructures.is_empty(),
        "an effect that takes a parameter is not read"
    );
    let script: Vec<&str> = details
        .spawn
        .as_ref()
        .expect("a spawn")
        .script
        .iter()
        .map(|s| s.key.as_str())
        .collect();
    assert_eq!(
        script,
        ["create_fixture_platform"],
        "the call the starbase was read from is not a script line"
    );

    let wrapped = gd
        .initializer_details(9, "citadel_if_init", None)
        .expect("the wrapped citadel fixture");
    let starbase = wrapped.starbase.expect("the citadel under an if");
    assert!(!starbase.spawn.expect("its spawn").always);
    let script = &wrapped.spawn.expect("a spawn").script;
    assert_eq!(script.len(), 1);
    assert_eq!(
        (script[0].key.as_str(), script[0].modelled),
        ("if", 1),
        "the call counts as modelled inside its wrapper"
    );
}

/// The 4.4 sample and its galaxy exported as a scenario, both open.
fn sample_pair() -> (Session, Session) {
    let save = common::open_4_4();
    let doc = Document::load(SCENARIO).expect("load the scenario");
    let scenario = Session::from_document(None, doc).expect("open the scenario");
    (save, scenario)
}

/// One line per row: its type, the body it is tied to, its point and its owner.
fn describe(rows: &[MegastructureSummary], starbase: Option<&StarbaseSummary>) -> String {
    let mut out: Vec<String> = rows
        .iter()
        .map(|m| {
            format!(
                "{} planet {:?} at {:?} owner {:?}",
                m.kind, m.planet, m.at, m.owner
            )
        })
        .collect();
    out.extend(starbase.map(|s| format!("starbase {} at {:?} owner {:?}", s.level, s.at, s.owner)));
    out.join("\n")
}

/// Whether the scenario body `body` can be a body of the save's `class`.
fn can_be(gd: &GameData, body: &PlanetSummary, class: &str) -> bool {
    let star = gd.planet_classes.get(class).is_some_and(|c| c.star);
    let drawn = |colonizable| {
        gd.planet_classes
            .drawable(colonizable)
            .any(|c| c.key == class)
    };
    match &body.spawn.as_ref().expect("a scenario body's spawn").class {
        _ if body.star_class.is_some() => star,
        SpawnClass::Fixed { class: fixed } => fixed == class,
        SpawnClass::Rolled {
            pool: ClassPool::Random { draw, .. },
        } => drawn(match draw.as_str() {
            "random_colonizable" => Some(true),
            "random_non_colonizable" => Some(false),
            _ => None,
        }),
        SpawnClass::Rolled {
            pool: ClassPool::StarList { .. },
        } => star,
        _ => true,
    }
}

/// How far body `i`'s orbit about the centre can lie inside its layout's: the instances the
/// blocks before its own may not spawn, and their ranged `change_orbit`.
fn count_spread(init: &Initializer, i: usize) -> f64 {
    let expanded: Vec<_> = initializers::expand(&init.planets).collect();
    let own = expanded[i].block;
    let mut spread = 0.0;
    for block in &init.planets {
        spread += block.change_orbit.max - block.change_orbit.min;
        if std::ptr::eq(block, own) {
            break;
        }
        let copies = block.copies();
        let step = block.orbit_distance.map_or(20.0, |d| d.max);
        spread += f64::from(copies.max - copies.min) * step;
    }
    spread
}

/// For each 4.4 system whose initializer places a megastructure, the scenario's rows are the
/// save's: the same types; each point within 0.25 of the save's for a row about the centre;
/// for a row tied to a body, a body that can be the save's planet and lies where it does;
/// the starbase within the reach of the star sizes the system can draw; and the owner the
/// scenario gives the system, where it gives it one.
#[test]
fn a_scenario_systems_megastructures_stand_where_the_saves_do() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let (save, scenario) = sample_pair();
    let owners = ScenarioSystem::of_session(&scenario, |systems, _| gd.scenario_owners(systems));
    let save_details = save.details().expect("the save's details");
    for id in [0, 6, 9, 41, 246, 311, 672] {
        let saved = save_details
            .resolve(id, &HeuristicResolver, false)
            .expect("a save system");
        let initializer = &scenario.system(id).expect("a scenario system").initializer;
        let init = gd.initializers.get(initializer).expect("an initializer");
        let details = gd
            .initializer_details(id, initializer, Some(&owners))
            .unwrap_or_else(|| panic!("{initializer}"));
        let report = format!(
            "system {id} ({initializer})\nsave:\n{}\nscenario:\n{}",
            describe(&saved.megastructures, saved.starbase.as_ref()),
            describe(&details.megastructures, details.starbase.as_ref()),
        );
        println!("{report}\n");

        for row in &saved.megastructures {
            let found = details.megastructures.iter().any(|m| {
                m.kind == row.kind
                    && match (row.planet, m.planet) {
                        (Some(_), tied) => tied.is_some(),
                        (None, _) => match (row.at, m.at) {
                            (Some(a), Some(b)) => near(a, b, 0.25),
                            _ => false,
                        },
                    }
            });
            assert!(found, "no scenario row for {row:?}\n{report}");
            let Some(planet) = row.planet else {
                continue;
            };
            let held = saved
                .planets
                .iter()
                .find(|p| p.id == planet)
                .expect("the save's planet");
            let tied = details
                .megastructures
                .iter()
                .filter(|m| m.kind == row.kind)
                .find_map(|m| m.planet)
                .expect("a tied row");
            let index = details
                .planets
                .iter()
                .position(|p| p.id == tied)
                .expect("a scenario body");
            let body = &details.planets[index];
            assert!(
                can_be(gd, body, &held.class),
                "{} cannot be {}\n{report}",
                body.class,
                held.class
            );
            let at = held
                .layout
                .as_ref()
                .and_then(|l| l.at)
                .expect("a save planet's point");
            let orbit = body
                .layout
                .as_ref()
                .and_then(|l| l.orbit)
                .expect("a scenario orbit");
            let radius = at.0.hypot(at.1);
            let spread = count_spread(init, index);
            assert!(
                body.parent.is_none()
                    && orbit.min - spread - 1.0 <= radius
                    && radius <= orbit.max + 1.0,
                "{} lies {radius} out, the scenario's {orbit:?} less {spread}\n{report}",
                held.class
            );
        }
        // Shattered Ring writes two quadrants, and the origin builds the ring over one.
        if id != 311 {
            assert_eq!(
                details.megastructures.len(),
                saved.megastructures.len(),
                "{report}"
            );
        }

        if let (Some(made), Some(held)) = (&details.starbase, &saved.starbase) {
            assert_eq!(held.level, made.level, "{report}");
            let Some(SpawnPlace::Starbase { star_size }) = made.spawn.as_ref().map(|s| &s.place)
            else {
                panic!("a starbase beside the star\n{report}");
            };
            let a = |size: f64| 11.7 + 0.33 * size;
            let (x, y) = held.at.expect("the save's station");
            assert!(
                a(star_size.min) - 0.01 <= x
                    && x <= a(star_size.max) + 0.01
                    && near((x, y), (x, -x), 0.01),
                "the save's starbase at {:?} is out of reach of {star_size:?}\n{report}",
                held.at
            );
        }

        let territory = owners
            .owners
            .iter()
            .find(|o| o.system == id)
            .map(|o| o.territory);
        match territory {
            Some(territory) => assert!(
                details
                    .megastructures
                    .iter()
                    .all(|m| m.owner == Some(territory)),
                "{report}"
            ),
            None if saved.megastructures.iter().all(|m| m.owner.is_none()) => assert!(
                details.megastructures.iter().all(|m| m.owner.is_none()),
                "{report}"
            ),
            // A fallen empire's system and the player's start join no territory yet.
            None => {}
        }
    }
}
