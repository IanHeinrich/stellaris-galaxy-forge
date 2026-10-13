//! Adding a habitat round a body of the 4.5 sample and deleting it again: the diff, the
//! flags the host and the system take and give back, and what is refused.

use sgf_core::ops::{HabitatOrbital, NewHabitat, NewMegastructurePlace, NewPlanet, Op};
use sgf_core::views::OrbitPlacement;

use crate::common;
use common::diff::snapshot_step;
use common::edit::{ALARI, open_4_5_edited, planet_text, system_text};
use common::examples::{ADDED_MEGASTRUCTURE, sol_habitat, sol_nexus};
use common::{SAMPLE_4_5, assert_refusals, current, open_4_5, open_edited_sample, text};

/// Ithomes Gate, whose three habitats the event that made them left with no `habitat<id>`
/// flag on their hosts and no `has_habitat` on the system. Habitat 6268 orbits gas giant
/// 6267; gas giant 6269 orbits the black hole.
const ITHOMES_GATE: u32 = 596;

/// The habitat [`sol_habitat`] adds, standing `radius` out.
fn habitat_at(radius: f64) -> NewHabitat {
    let Op::AddHabitat { habitat, .. } = sol_habitat() else {
        unreachable!("sol_habitat adds a habitat");
    };
    NewHabitat {
        planet: NewPlanet {
            at: OrbitPlacement {
                radius,
                angle: 315.0,
            },
            ..habitat.planet
        },
        ..habitat
    }
}
fn add(body: u32, habitat: NewHabitat) -> Op {
    Op::AddHabitat { body, habitat }
}

/// [`sol_habitat`] as the restored Habitat Central Complex leaves it round `body`: with the
/// major orbital owned by country 0, which owns Alari.
fn restored(body: u32) -> Op {
    let Op::AddHabitat { habitat, .. } = sol_habitat() else {
        unreachable!("sol_habitat adds a habitat");
    };
    add(
        body,
        NewHabitat {
            orbital: Some(HabitatOrbital {
                kind: "habitat_major_orbital".to_owned(),
                owner: Some(0),
                name: Some("TARGET_ORBITAL_NAME".to_owned()),
                system_name: Some("prevprev.GetName".to_owned()),
            }),
            ..habitat
        },
    )
}

fn added_id(result: &sgf_core::session::OpResult) -> u32 {
    result.created.planets[0]
}

#[test]
fn what_an_add_refuses() {
    let mut session = open_4_5();
    let first = session
        .apply(sol_habitat())
        .expect("a habitat round planet 4");
    let id = added_id(&first);
    let mut no_size = habitat_at(9.899);
    no_size.planet.size = 0;
    let mut twice = habitat_at(9.899);
    twice.planet.flags = ["habitat", "habitat"].map(str::to_owned).to_vec();
    let mut nan = habitat_at(9.899);
    nan.planet.at.angle = f64::NAN;
    let mut model = habitat_at(9.899);
    model.planet.model = Some("two words".to_owned());
    assert_refusals(
        &mut session,
        [
            (
                add(3, habitat_at(9.899)),
                "a habitat cannot be added there: planet #3 orbits Alari planet #2, and Galaxy Forge puts nothing round a body that orbits a planet",
            ),
            (
                add(6268, habitat_at(9.899)),
                "a habitat cannot be added there: paradisiacal habitat science #6268 orbits Ithomes Gate I #6267, and Galaxy Forge puts nothing round a body that orbits a planet",
            ),
            (
                add(id, habitat_at(9.899)),
                &format!(
                    "a habitat cannot be added there: Alari system #{id} orbits planet #4, and Galaxy Forge puts nothing round a body that orbits a planet"
                ),
            ),
            (
                add(4, habitat_at(9.899)),
                &format!(
                    "a habitat cannot be added there: planet #4 has a habitat already (habitat{id})"
                ),
            ),
            (add(5, no_size), "a planet size may not be zero"),
            (
                add(5, twice),
                "\"habitat\" cannot be written as a flag listed once",
            ),
            (add(5, nan), "value is not a finite number"),
            (add(5, model), "\"two words\" cannot be written as a model"),
            (
                add(999_999, habitat_at(9.899)),
                "planet 999999 does not exist",
            ),
        ],
    );
}

/// Deleting an added habitat takes its host's flag and the system's `has_habitat` with it,
/// so the save is as it was opened, and its inverse adds the same habitat back.
#[test]
fn deleting_an_added_habitat_leaves_the_save_as_it_was() {
    for removal in [Op::DeleteBody { body: 0 }, Op::RemoveBody { body: 0 }] {
        let mut session = open_4_5();
        let added = session.apply(sol_habitat()).expect("the add");
        let id = added_id(&added);
        let removal = match removal {
            Op::DeleteBody { .. } => Op::DeleteBody { body: id },
            _ => Op::RemoveBody { body: id },
        };
        let removed = session.apply(removal.clone()).expect("the removal");
        assert_eq!(current(&session), session.doc().original(), "{removal:?}");
        assert_eq!(removed.inverse, sol_habitat(), "{removal:?}");
    }
}

/// Round a planet with neither moons nor flags, both blocks are written; the system's flags
/// gain `has_habitat`. Undo puts the bytes back.
#[test]
fn a_habitat_round_a_planet() {
    let mut session = open_4_5();
    let result = snapshot_step(&mut session, "habitat_round_a_planet", sol_habitat());
    let id = added_id(&result);
    assert_eq!(result.details_stale, [ALARI]);
    let host = planet_text(&session, 4);
    assert!(host.contains(&format!("habitat{id}=")), "{host}");
    assert!(system_text(&session, ALARI).contains("has_habitat="));
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), session.doc().original());
}

/// Round a star the habitat stands twice as far out, and the star's flags gain the host
/// flag after its own.
#[test]
fn a_habitat_round_a_star() {
    let mut session = open_4_5();
    snapshot_step(
        &mut session,
        "habitat_round_a_star",
        add(0, habitat_at(19.798)),
    );
}

/// Ithomes Gate keeps `has_habitat` while the added habitat stands, though its file-held
/// habitat goes; deleting the added one, the last, takes the flag and the host's flag.
#[test]
fn the_last_habitat_deleted_takes_the_systems_flag() {
    let mut session = open_4_5();
    let added = session
        .apply(add(6269, habitat_at(9.899)))
        .expect("a habitat round gas giant 6269");
    let id = added_id(&added);
    for held in [6268, 6270, 6272] {
        session
            .apply(Op::DeleteBody { body: held })
            .expect("a habitat the file held");
        assert!(system_text(&session, ITHOMES_GATE).contains("has_habitat="));
    }
    session
        .apply(Op::DeleteBody { body: id })
        .expect("the added habitat");
    let system = system_text(&session, ITHOMES_GATE);
    assert!(!system.contains("has_habitat"), "{system}");
    let host = planet_text(&session, 6269);
    assert!(!host.contains("habitat"), "{host}");
}

/// The game dates a flag in hours on a 360-day year of twelve 30-day months, from
/// 2200.01.01 at 62808000. The 4.5 sample was saved on 2201.03.25, which is 62818656, and
/// 2202.09.19 is 62831472.
#[test]
fn the_flags_are_dated_in_the_games_360_day_years() {
    for (date, hours) in [("2201.03.25", "62818656"), ("2202.09.19", "62831472")] {
        let mut session = open_edited_sample(SAMPLE_4_5, |_, meta| {
            *meta = meta.replace("date=\"2201.03.25\"", &format!("date=\"{date}\""));
        });
        session.apply(sol_habitat()).expect("the habitat");
        let host = planet_text(&session, 4);
        assert!(host.contains(&format!("={hours}")), "{date}: {host}");
    }
}

/// Alari with its `flags` block taken out: the system's new block of `has_habitat` goes
/// where the game writes one, after `arm`'s neighbours and before `initializer`.
#[test]
fn a_system_with_no_flags_gets_its_block() {
    let mut session = open_4_5_edited(|gamestate| {
        let objects = gamestate
            .find("\ngalactic_object=\n")
            .expect("galactic_object");
        let system = objects + gamestate[objects..].find("\n\t169=\n").expect("Alari");
        let start = system
            + gamestate[system..]
                .find("\n\t\tflags=\n")
                .expect("its flags");
        let end = start + gamestate[start..].find("\n\t\t}\n").expect("their end") + 4;
        gamestate.replace_range(start..end, "");
    });
    assert!(!system_text(&session, ALARI).contains("flags="));
    snapshot_step(&mut session, "habitat_system_flags_created", sol_habitat());
    let system = system_text(&session, ALARI);
    let flags = system.find("\t\tflags=").expect("a flags block");
    assert!(
        flags < system.find("initializer=").expect("initializer"),
        "{system}"
    );
}

/// A restored complex's habitat round planet 4 also writes its major orbital: a row at
/// planet 4's coordinates named from Alari, in country 0's culture, listed by Alari and
/// country 0, with planet 4 naming it and flagged `has_orbital`. Undo puts the bytes back.
#[test]
fn a_restored_habitat_has_its_orbital() {
    let mut session = open_4_5();
    let result = snapshot_step(&mut session, "habitat_restored_with_orbital", restored(4));
    let id = added_id(&result);
    assert!(
        result.entry.description.contains(", with orbital #"),
        "{}",
        result.entry.description
    );
    let host = planet_text(&session, 4);
    for key in [format!("habitat{id}="), "has_orbital=".to_owned()] {
        assert!(host.contains(&key), "{key}: {host}");
    }
    let [orbital] = result.created.megastructures[..] else {
        panic!("one orbital: {:?}", result.created);
    };
    assert_eq!(result.created.planets, [id]);
    assert!(
        host.contains(&format!(
            "megastructure={orbital}
"
        )),
        "{host}"
    );
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), session.doc().original());
}

/// Deleting a restored complex's habitat takes its orbital row, the lists naming it and the
/// host's link and flag with it, and its inverse adds both back.
#[test]
fn deleting_a_restored_habitat_takes_its_orbital() {
    for delete in [true, false] {
        let mut session = open_4_5();
        let added = session.apply(restored(4)).expect("the add");
        let id = added_id(&added);
        let removal = match delete {
            true => Op::DeleteBody { body: id },
            false => Op::RemoveBody { body: id },
        };
        let removed = session.apply(removal.clone()).expect("the removal");
        assert_eq!(current(&session), session.doc().original(), "{removal:?}");
        assert_eq!(removed.inverse, restored(4), "{removal:?}");
        session.undo().expect("undo").expect("the removal to undo");
        assert!(planet_text(&session, 4).contains("has_orbital="));
    }
}

/// A planet names one megastructure, so a restored habitat round the Science Nexus's gas
/// giant is added without its orbital. Undo puts the bytes back.
#[test]
fn a_restored_habitat_round_a_megastructure_has_no_orbital() {
    let mut session = open_4_5();
    session
        .apply(sol_nexus())
        .expect("the Science Nexus on planet 6");
    let before = current(&session);
    let added = session.apply(restored(6)).expect("the habitat");
    assert!(
        !added.entry.description.contains("orbital"),
        "{}",
        added.entry.description
    );
    let host = planet_text(&session, 6);
    assert!(!host.contains("has_orbital"), "{host}");
    assert!(
        !text(&session).contains("habitat_major_orbital"),
        "no orbital row"
    );
    session.undo().expect("undo").expect("the add to undo");
    assert_eq!(current(&session), before);
}

/// Removing a restored habitat's orbital on its own takes the host's `has_orbital` with it,
/// and its inverse writes the row back as it stood, name and flag included. The habitat can
/// then be deleted, which leaves the save as it was opened, and undo puts each step back.
#[test]
fn a_restored_habitats_orbital_removed_on_its_own() {
    let mut session = open_4_5();
    session.apply(restored(4)).expect("the add");
    let after_add = current(&session);
    let orbital = Op::RemoveMegastructure {
        megastructure: ADDED_MEGASTRUCTURE,
        construction: None,
        left_out: 0,
    };
    let removed = session.apply(orbital.clone()).expect("the orbital");
    let host = planet_text(&session, 4);
    assert!(
        !host.contains("has_orbital") && !host.contains("megastructure="),
        "{host}"
    );
    assert!(host.contains("habitat16777273="), "{host}");
    let Op::AddMegastructure { spec, .. } = &removed.inverse else {
        panic!("{:?}", removed.inverse);
    };
    assert_eq!(spec.kind, "habitat_major_orbital");
    assert!(
        matches!(&spec.at, NewMegastructurePlace::Body { body_flags, .. } if body_flags == &["has_orbital"]),
        "{:?}",
        spec.at
    );
    let after_orbital = current(&session);

    let deleted = session
        .apply(Op::DeleteBody { body: 16777273 })
        .expect("the habitat");
    assert_eq!(current(&session), session.doc().original());
    assert_eq!(deleted.inverse, sol_habitat());
    session.undo().expect("undo").expect("the delete to undo");
    assert_eq!(current(&session), after_orbital);
    session.undo().expect("undo").expect("the removal to undo");
    assert_eq!(current(&session), after_add);

    session.apply(orbital).expect("the orbital again");
    session.apply(removed.inverse).expect("its inverse");
    assert_eq!(current(&session), after_add);
}

/// Planet 4 with a `has_orbital` the file held and no megastructure: the restored habitat
/// is added without its orbital, and deleting it leaves the file's flag and the save as it
/// was opened.
#[test]
fn a_restored_habitat_round_an_orphan_orbital_flag_has_no_orbital() {
    let mut session = open_edited_sample(SAMPLE_4_5, |gamestate, _| {
        let planets = gamestate
            .find(
                "
planets=
",
            )
            .expect("planets");
        let planet = planets
            + gamestate[planets..]
                .find(
                    "
		4=
",
                )
                .expect("planet 4");
        let at = planet
            + gamestate[planet..]
                .find(
                    "			bombardment_damage=0
",
                )
                .expect("its bombardment damage")
            + "			bombardment_damage=0
"
            .len();
        gamestate.insert_str(
            at,
            "			flags=
			{
				has_orbital=62808000
			}
",
        );
    });
    assert!(planet_text(&session, 4).contains("has_orbital=62808000"));
    let added = session.apply(restored(4)).expect("the habitat");
    assert!(
        !added.entry.description.contains("orbital"),
        "{}",
        added.entry.description
    );
    assert!(!text(&session).contains("habitat_major_orbital"));
    let id = added_id(&added);
    session
        .apply(Op::DeleteBody { body: id })
        .expect("the habitat");
    assert_eq!(current(&session), session.doc().original());
}
