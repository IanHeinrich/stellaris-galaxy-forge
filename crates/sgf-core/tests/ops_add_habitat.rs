//! Adding a habitat round a body of the 4.5 sample and deleting it again: the diff, the
//! flags the host and the system take and give back, and what is refused.

use sgf_core::entity::views::EntityKind;
use sgf_core::ops::{NewHabitat, Op};
use sgf_core::session::Session;
use sgf_core::views::OrbitPlacement;

use crate::common;
use common::diff::snapshot_step;
use common::examples::sol_habitat;
use common::{
    SAMPLE_4_5, assert_refusals, current, entity_text, open_3_4, open_4_5, open_edited_sample,
};

/// The 4.5 sample's capital system, Alari: star 0, the capital 2 with its moon 3, and barren
/// planet 4, which has neither moons nor flags.
const SOL: u32 = 169;
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
        at: OrbitPlacement {
            radius,
            angle: 315.0,
        },
        ..habitat
    }
}
fn add(body: u32, habitat: NewHabitat) -> Op {
    Op::AddHabitat { body, habitat }
}

fn added_id(result: &sgf_core::session::OpResult) -> u32 {
    match &result.inverse {
        Op::RemoveBody { body } => *body,
        Op::Batch { ops, .. } => match ops.first() {
            Some(Op::RemoveBody { body }) => *body,
            other => panic!("{other:?}"),
        },
        other => panic!("{other:?}"),
    }
}

fn system_text(session: &Session, system: u32) -> String {
    entity_text(session, EntityKind::System, system)
}

fn planet_text(session: &Session, planet: u32) -> String {
    entity_text(session, EntityKind::Planet, planet)
}

#[test]
fn what_an_add_refuses() {
    let mut session = open_4_5();
    let first = session
        .apply(sol_habitat())
        .expect("a habitat round planet 4");
    let id = added_id(&first);
    let no_size = NewHabitat {
        size: 0,
        ..habitat_at(9.899)
    };
    let twice = NewHabitat {
        flags: ["habitat", "habitat"].map(str::to_owned).to_vec(),
        ..habitat_at(9.899)
    };
    let nan = NewHabitat {
        at: OrbitPlacement {
            radius: 9.899,
            angle: f64::NAN,
        },
        ..habitat_at(9.899)
    };
    let model = NewHabitat {
        model: Some("two words".to_owned()),
        ..habitat_at(9.899)
    };
    assert_refusals(
        &mut session,
        [
            (
                add(3, habitat_at(9.899)),
                "a habitat cannot be added there: planet 3 orbits planet 2, and Galaxy Forge puts nothing round a body that orbits a planet",
            ),
            (
                add(6268, habitat_at(9.899)),
                "a habitat cannot be added there: planet 6268 orbits planet 6267, and Galaxy Forge puts nothing round a body that orbits a planet",
            ),
            (
                add(id, habitat_at(9.899)),
                &format!(
                    "a habitat cannot be added there: planet {id} orbits planet 4, and Galaxy Forge puts nothing round a body that orbits a planet"
                ),
            ),
            (
                add(4, habitat_at(9.899)),
                &format!(
                    "a habitat cannot be added there: planet 4 has a habitat already (habitat{id})"
                ),
            ),
            (add(5, no_size), "a planet size may not be zero"),
            (
                add(5, twice),
                "\"habitat\" cannot be written as a planet flag listed once",
            ),
            (add(5, nan), "value is not a finite number"),
            (add(5, model), "\"two words\" cannot be written as a model"),
            (
                add(999_999, habitat_at(9.899)),
                "planet 999999 does not exist",
            ),
        ],
    );
    let mut old = open_3_4();
    let error = old.apply(sol_habitat()).expect_err("a 3.4 save");
    assert!(error.to_string().contains("3.4"), "{error}");
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
    assert_eq!(result.details_stale, [SOL]);
    let host = planet_text(&session, 4);
    assert!(host.contains(&format!("habitat{id}=")), "{host}");
    assert!(system_text(&session, SOL).contains("has_habitat="));
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
    let mut session = open_edited_sample(SAMPLE_4_5, |gamestate, _| {
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
    assert!(!system_text(&session, SOL).contains("flags="));
    snapshot_step(&mut session, "habitat_system_flags_created", sol_habitat());
    let system = system_text(&session, SOL);
    let flags = system.find("\t\tflags=").expect("a flags block");
    assert!(
        flags < system.find("initializer=").expect("initializer"),
        "{system}"
    );
}
