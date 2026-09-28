//! Moving a save planet and its moons into another system, on the 4.x samples: each move's
//! diff, where the bodies read back, the colony lists, byte-exact undo, and what is refused.

use sgf_core::ops::{Op, OpError};

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::spec::mura;
use common::{findings, open, open_3_4, open_4_5, open_edited_sample, planet_ids};

fn move_planet(planet: u32, to: u32) -> Op {
    Op::MoveSavePlanet { planet, to }
}

/// Planet 402's entity in the 4.5 sample's `planets` section, as `edit` rewrites it.
fn with_planet_402(edit: impl Fn(&str) -> String) -> sgf_core::session::Session {
    open_edited_sample(common::SAMPLE_4_5, |gamestate, _| {
        let planets = gamestate.find("\nplanets=\n").expect("the planets");
        let start = planets
            + gamestate[planets..]
                .find("\n\t\t402=\n")
                .expect("planet 402");
        let end = start + 1 + gamestate[start + 1..].find("\n\t\t}\n").expect("its end");
        let rewritten = edit(&gamestate[start..end]);
        gamestate.replace_range(start..end, &rewritten);
    })
}

/// Gas giant 99 of the 4.5 sample's system 140 has moons 100 and 101 and no owner. System
/// 216, which nobody owns, reaches 200.33 with its outermost planet 41, and its inner
/// radius is 230.
#[test]
fn a_neutral_planet_with_moons_moves_to_an_unowned_system() {
    let mut session = open_4_5();
    session.warm_details().expect("build details");
    let before = findings(&session);
    let counts = [140, 216].map(|id| session.graph.systems[&id].planet_count);

    let result = snapshot_step(&mut session, "neutral_with_moons", move_planet(99, 216));
    assert_eq!(
        result.entry.description,
        "Moved planet #99 and its 2 moons from system #140 to system #216, at orbit 246; \
         set the inner radius of system #216 from 230 to 291.02"
    );
    let Op::Batch { ops, .. } = &result.inverse else {
        panic!("a batch, not {:?}", result.inverse);
    };
    assert_eq!(ops[0], move_planet(99, 140));
    assert_eq!(result.details_stale, [140, 216]);

    assert!(!planet_ids(&session, 140).contains(&99));
    assert!(planet_ids(&session, 216).ends_with(&[99, 100, 101]));
    assert_eq!(session.graph.systems[&140].planet_count, counts[0] - 3);
    assert_eq!(session.graph.systems[&216].planet_count, counts[1] + 3);
    let after = findings(&session);
    let new: Vec<_> = after.difference(&before).collect();
    assert!(new.is_empty(), "new findings: {new:?}");
}

/// Planet 402 is the only colony (13) of system 449; system 378 has no `colonies`. Both
/// are owned by country 16777226, which owns and controls 402.
#[test]
fn a_colony_moves_to_a_system_without_colonies() {
    let mut session = open_4_5();
    let result = snapshot_step(
        &mut session,
        "colony_to_a_system_without_colonies",
        move_planet(402, 378),
    );
    assert!(
        result
            .entry
            .description
            .starts_with("Moved planet #402 from system #449 to system #378, at orbit "),
        "{}",
        result.entry.description
    );
    assert!(planet_ids(&session, 378).contains(&402));
}

/// Planet 318 is colony 11 of system 400, whose `colonies` also lists 10; system 449
/// lists 13.
#[test]
fn a_colony_moves_between_two_colonised_systems() {
    let mut session = open_4_5();
    snapshot_step(
        &mut session,
        "colony_between_colonised_systems",
        move_planet(318, 449),
    );
    assert!(planet_ids(&session, 449).contains(&318));
    assert!(!planet_ids(&session, 400).contains(&318));
}

#[test]
fn a_move_and_its_undo_round_trip() {
    round_trip(open_4_5(), move_planet(99, 216));
    round_trip(open_4_5(), move_planet(402, 378));
}

#[test]
fn moves_are_refused() {
    let mut session = open_4_5();
    let refusals = [
        (move_planet(99_999, 216), "planet 99999 does not exist"),
        (move_planet(99, 99_999), "system 99999 does not exist"),
        (
            move_planet(99, 140),
            "planet 99 is already a body of system 140",
        ),
        (
            move_planet(86, 216),
            "planet 86 is a star: only a planet can move to another system",
        ),
        (
            move_planet(807, 216),
            "planet 807 is a star: only a planet can move to another system",
        ),
        (
            move_planet(100, 216),
            "planet 100 orbits planet 99: move planet 99 instead",
        ),
        (
            move_planet(808, 216),
            "planet 808 orbits planet 807: move planet 807 instead",
        ),
        (
            move_planet(936, 216),
            "planet 936 has a megastructure, so it cannot move to another system",
        ),
        (
            move_planet(402, 216),
            "planet 402 is owned by country 16777226, which does not own system 216",
        ),
        (
            move_planet(619, 216),
            "planet 619 is a star: only a planet can move to another system",
        ),
        (
            move_planet(1140, 216),
            "planet 1140 is a star: only a planet can move to another system",
        ),
        (
            move_planet(58, 216),
            "planet 58 is a moon of planet 57, which the save does not hold: make it a planet first",
        ),
    ];
    for (op, message) in refusals {
        let error = session.apply(op).expect_err(message);
        assert_eq!(error.to_string(), message);
    }
    assert!(!session.doc.is_dirty());
    assert!(session.history().undo.is_empty());
}

/// Country 11 owns system 174 but not 449, where planet 402 stands.
#[test]
fn an_owned_planet_outside_its_owners_systems_is_refused() {
    let mut session = with_planet_402(|entity| {
        entity
            .replace("owner=16777226", "owner=11")
            .replace("controller=16777226", "controller=11")
    });
    let error = session
        .apply(move_planet(402, 174))
        .expect_err("449 is not 11's");
    assert_eq!(
        error.to_string(),
        "planet 402 is owned by country 11, which does not own system 449"
    );
}

#[test]
fn an_occupied_planet_is_refused() {
    let mut session =
        with_planet_402(|entity| entity.replace("controller=16777226", "controller=11"));
    let error = session.apply(move_planet(402, 378)).expect_err("occupied");
    assert!(matches!(error, OpError::PlanetOccupied { .. }), "{error:?}");
    assert_eq!(
        error.to_string(),
        "planet 402 is owned by country 16777226 but controlled by country 11"
    );
}

#[test]
fn a_3_4_save_refuses_a_planet_move() {
    let mut session = open_3_4();
    let error = session.apply(move_planet(2, 1)).expect_err("a 3.4 save");
    assert!(
        error
            .to_string()
            .starts_with("this edit needs a save from Stellaris 4.0 or later"),
        "{error}"
    );
}

/// Gas giant 59 of the 4.4 sample's system 189 has no owner, but its moon 61 is colony 3
/// of country 3, which owns systems 189 and 718. System 189 lists only colony 3; 718
/// lists 37.
#[test]
fn a_planet_with_a_colonised_moon_moves_between_its_owners_systems() {
    let mut session = open();
    let result = snapshot_step(&mut session, "colonised_moon", move_planet(59, 718));
    assert!(
        result
            .entry
            .description
            .starts_with("Moved planet #59 and its 2 moons from system #189 to system #718"),
        "{}",
        result.entry.description
    );
    assert!(planet_ids(&session, 718).contains(&61));
}

#[test]
fn a_colonised_moon_outside_its_owners_systems_is_refused() {
    let mut session = open();
    let error = session.apply(move_planet(59, 0)).expect_err("0 is not 3's");
    assert_eq!(
        error.to_string(),
        "planet 61 is owned by country 3, which does not own system 0"
    );
    assert!(!session.doc.is_dirty());
}

/// System 216 of the 4.5 sample with its `planet=` lines taken out.
#[test]
fn a_system_without_bodies_is_refused() {
    let mut session = open_edited_sample(common::SAMPLE_4_5, |gamestate, _| {
        let systems = gamestate.find("\ngalactic_object=\n").expect("the systems");
        let start = systems + gamestate[systems..].find("\n\t216=\n").expect("system 216");
        let end = start + 1 + gamestate[start + 1..].find("\n\t}\n").expect("its end");
        let kept: Vec<&str> = gamestate[start..end]
            .split('\n')
            .filter(|line| !line.starts_with("\t\tplanet="))
            .collect();
        let kept = kept.join("\n");
        gamestate.replace_range(start..end, &kept);
    });
    let error = session.apply(move_planet(99, 216)).expect_err("no bodies");
    assert_eq!(
        error.to_string(),
        "system 216 lists no bodies, so a planet cannot join it"
    );
}

/// Mura, added to the 4.5 sample as system 601, takes planet 99 from the save.
#[test]
fn an_added_system_holding_a_planet_from_the_save_is_not_removed() {
    let mut session = open_4_5();
    session
        .apply(Op::AddSaveSystem { spec: mura() })
        .expect("add Mura");
    session.apply(move_planet(99, 601)).expect("move 99 in");
    for op in [
        Op::RemoveSystem { id: 601 },
        Op::RemoveSystems { ids: vec![601] },
    ] {
        let error = session.apply(op).expect_err("it holds 99");
        assert_eq!(
            error.to_string(),
            "system 601 holds planet 99 from the save; move it out first"
        );
    }
    assert_eq!(session.history().undo.len(), 2);
}

/// The fleets the details list as present in system `id`.
fn fleets(session: &sgf_core::session::Session, id: u32) -> Vec<u32> {
    let details = session.details().expect("details");
    let raw = details.raw(id).unwrap_or_else(|| panic!("system {id}"));
    raw.fleets.iter().map(|f| f.id).collect()
}

/// Gas giant 10 of the 4.5 sample's home system 169 has moons 11, 12 and 13 and no owner.
/// Country 0 controls it through research station fleet 365, and moon 13 through mining
/// station 364. System 2 has no fleets, so no `fleet_presence`.
#[test]
fn a_planet_with_stations_takes_them_along() {
    let mut session = open_4_5();
    assert!(fleets(&session, 169).contains(&365));
    assert!(fleets(&session, 2).is_empty());
    let result = snapshot_step(&mut session, "stations", move_planet(10, 2));
    assert!(
        result.entry.description.starts_with(
            "Moved planet #10 and its 3 moons, with 2 stations, from system #169 to system #2"
        ),
        "{}",
        result.entry.description
    );
    assert_eq!(fleets(&session, 2), [365, 364]);
    let home = fleets(&session, 169);
    assert!(!home.contains(&365) && !home.contains(&364), "{home:?}");

    session.undo().expect("undo").expect("an op to undo");
    assert!(fleets(&session, 2).is_empty());
    assert!(fleets(&session, 169).contains(&365));
}

/// Planet 14 of system 169 has research station 363; system 216 lists fleet 329.
#[test]
fn a_station_joins_a_systems_fleets() {
    round_trip(open_4_5(), move_planet(10, 2));
    let mut session = open_4_5();
    let result = session.apply(move_planet(14, 216)).expect("move 14");
    assert!(
        result
            .entry
            .description
            .starts_with("Moved planet #14 and its station from system #169 to system #216"),
        "{}",
        result.entry.description
    );
    assert_eq!(fleets(&session, 216), [329, 363]);
    round_trip(open_4_5(), move_planet(14, 216));
}
