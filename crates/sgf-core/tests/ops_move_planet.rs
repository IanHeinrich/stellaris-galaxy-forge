//! Moving a save planet and its moons into another system, on the 4.x samples: each move's
//! diff, where the bodies read back, the colony lists, byte-exact undo, and what is refused.

use sgf_core::format::save::details::RawPlanet;
use sgf_core::ops::{Op, OpError};
use sgf_core::session::Session;
use sgf_core::views::{
    OrbitPlacement, PlanetMoveTargets, PlanetMoveWarning, PlanetMoveWarningKind,
};

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::spec::mura;
use common::{
    current, findings, open, open_3_4, open_4_5, open_edited_sample, planet_ids, planets,
};

fn move_planet(planet: u32, to: u32) -> Op {
    Op::MoveSavePlanet {
        planet,
        to,
        at: None,
    }
}

/// Planet `id`'s entity in the 4.5 sample's `planets` section, as `edit` rewrites it.
fn with_planet(id: u32, edit: impl Fn(&str) -> String) -> Session {
    open_edited_sample(common::SAMPLE_4_5, |gamestate, _| {
        let planets = gamestate.find("\nplanets=\n").expect("the planets");
        let start = planets
            + gamestate[planets..]
                .find(&format!("\n\t\t{id}=\n"))
                .expect("the planet");
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
    assert!(
        matches!(
            ops[0],
            Op::MoveSavePlanet {
                planet: 99,
                to: 140,
                at: Some(_)
            }
        ),
        "{:?}",
        ops[0]
    );
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
            move_planet(936, 216),
            "planet 936 has a megastructure, so it cannot move to another system",
        ),
        (
            move_planet(619, 216),
            "planet 619 is a star: only a planet can move to another system",
        ),
        (
            move_planet(1140, 216),
            "planet 1140 is a star: only a planet can move to another system",
        ),
    ];
    for (op, message) in refusals {
        let error = session.apply(op).expect_err(message);
        assert_eq!(error.to_string(), message);
    }
    assert!(!session.doc.is_dirty());
    assert!(session.history().undo.is_empty());
}

/// Colony 402 of country 16777226 goes to system 216, which nobody owns. Country 11 owns
/// system 174, and colony 402 moved there under country 11 comes from system 449, which
/// country 11 does not own.
#[test]
fn a_colony_moves_to_any_system() {
    round_trip(open_4_5(), move_planet(402, 216));
    let session = with_planet(402, |entity| {
        entity
            .replace("owner=16777226", "owner=11")
            .replace("controller=16777226", "controller=11")
    });
    round_trip(session, move_planet(402, 174));
}

#[test]
fn an_occupied_planet_is_refused() {
    let mut session = with_planet(402, |entity| {
        entity.replace("controller=16777226", "controller=11")
    });
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

/// Country 3, which owns moon 61, does not own system 0.
#[test]
fn a_colonised_moon_moves_outside_its_owners_systems() {
    round_trip(open(), move_planet(59, 0));
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
fn fleets(session: &Session, id: u32) -> Vec<u32> {
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

/// The point the details give body `id` of system `system`.
fn point_of(session: &Session, system: u32, id: u32) -> (f64, f64) {
    body(session, system, id).at.expect("a point")
}

fn body(session: &Session, system: u32, id: u32) -> RawPlanet {
    planets(session, system)
        .into_iter()
        .find(|p| p.id == id)
        .unwrap_or_else(|| panic!("body {id} in system {system}"))
}

#[track_caller]
fn assert_near(a: (f64, f64), b: (f64, f64)) {
    assert!(
        (a.0 - b.0).abs() < 1e-3 && (a.1 - b.1).abs() < 1e-3,
        "{a:?} is not {b:?}"
    );
}

/// Moon 100 of gas giant 99 in system 140, moved to system 216 without 99.
#[test]
fn a_moon_moved_alone_becomes_a_planet() {
    let mut session = open_4_5();
    let result = snapshot_step(&mut session, "moon_alone", move_planet(100, 216));
    assert!(
        result
            .entry
            .description
            .starts_with("Moved moon #100 from system #140 to system #216 as a planet, at orbit "),
        "{}",
        result.entry.description
    );
    let moved = body(&session, 216, 100);
    assert!(!moved.moon && moved.parent.is_none(), "{moved:?}");
    assert!(planet_ids(&session, 140).contains(&101));
}

/// Planet 808 orbits companion star 807, and moon 58's planet 57 is gone from the save.
#[test]
fn a_planet_of_a_companion_star_and_a_moon_without_its_planet_move() {
    for planet in [808, 58] {
        round_trip(open_4_5(), move_planet(planet, 216));
        let mut session = open_4_5();
        session
            .apply(move_planet(planet, 216))
            .unwrap_or_else(|e| panic!("move {planet}: {e}"));
        let moved = body(&session, 216, planet);
        assert!(!moved.moon && moved.parent.is_none(), "{moved:?}");
    }
}

/// Gas giant 99 of system 140 put at orbit 120, 315 degrees, in system 216; its moons 100
/// and 101 keep their places about it.
#[test]
fn a_planet_goes_where_it_is_placed() {
    let place = |radius, angle| Op::MoveSavePlanet {
        planet: 99,
        to: 216,
        at: Some(OrbitPlacement { radius, angle }),
    };
    let mut session = open_4_5();
    let old = point_of(&session, 140, 99);
    let offsets = |session: &Session, system, from: (f64, f64)| {
        [100, 101].map(|moon| {
            let at = point_of(session, system, moon);
            (at.0 - from.0, at.1 - from.1)
        })
    };
    let moons = offsets(&session, 140, old);

    let result = session.apply(place(120.0, -45.0)).expect("place 99");
    assert_eq!(
        result.entry.description,
        "Moved planet #99 and its 2 moons from system #140 to system #216, at orbit 120"
    );
    let angle = 315f64.to_radians();
    let new = point_of(&session, 216, 99);
    assert_near(new, (120.0 * angle.cos(), 120.0 * angle.sin()));
    assert_eq!(body(&session, 216, 99).orbit, Some(120.0));
    for (moved, was) in offsets(&session, 216, new).into_iter().zip(moons) {
        assert_near(moved, was);
    }

    assert!(
        matches!(
            result.inverse,
            Op::MoveSavePlanet {
                planet: 99,
                to: 140,
                at: Some(_)
            }
        ),
        "{:?}",
        result.inverse
    );
    session.apply(result.inverse).expect("the inverse applies");
    assert_near(point_of(&session, 140, 99), old);
    round_trip(open_4_5(), place(120.0, -45.0));

    let mut session = open_4_5();
    let error = session.apply(place(0.0, 90.0)).expect_err("radius 0");
    assert!(matches!(error, OpError::InvalidRadius { .. }), "{error:?}");
    let error = session.apply(place(120.0, f64::NAN)).expect_err("no angle");
    assert!(matches!(error, OpError::NotFinite), "{error:?}");
}

/// The systems the targets list, in order.
fn ids(targets: &PlanetMoveTargets) -> Vec<u32> {
    targets.systems.iter().map(|t| t.system).collect()
}

fn refusals(targets: &PlanetMoveTargets) -> Vec<(u32, &str)> {
    targets
        .refused
        .iter()
        .map(|r| (r.planet, r.reason.as_str()))
        .collect()
}

/// System 169 is country 0's home: gas giant 10 with moons 11, 12 and 13, and planets 8
/// and 14, have stations and no owner, and planet 2 is country 0's colony. Planet 402 is
/// country 16777226's colony in system 449.
#[test]
fn move_targets_drop_what_moves_with_its_parent_and_list_the_systems() {
    let session = open_4_5();

    let stations = session.planet_move_targets(&[11, 10, 13, 10, 14]);
    assert_eq!(stations.planets, [10, 14]);
    assert!(stations.refused.is_empty());
    let listed = ids(&stations);
    assert!(listed.contains(&2) && listed.contains(&216) && !listed.contains(&169));
    assert!(listed.is_sorted());

    assert_eq!(session.planet_move_targets(&[100]).planets, [100]);

    let colonies = session.planet_move_targets(&[402, 2]);
    assert!(colonies.refused.is_empty());
    let listed = ids(&colonies);
    for (to, expected) in [
        (378, true),
        (216, true),
        (2, true),
        (449, false),
        (169, false),
    ] {
        assert_eq!(listed.contains(&to), expected, "system {to}");
    }

    let refused = session.planet_move_targets(&[86, 936, 99, 99_999]);
    assert_eq!(refused.planets, [86, 936, 99, 99_999]);
    assert_eq!(
        refusals(&refused),
        [
            (
                86,
                "planet 86 is a star: only a planet can move to another system"
            ),
            (
                936,
                "planet 936 has a megastructure, so it cannot move to another system"
            ),
            (99_999, "planet 99999 does not exist"),
        ]
    );
    assert!(refused.systems.is_empty());
}

/// Every system the targets list takes the op the dry run passes, and no other, for a
/// neutral planet with moons, a moon, a colony, station planets, a star and colonies of
/// two countries. Every seventh system is checked, and every system with an owner.
#[test]
fn the_dry_run_agrees_with_the_targets() {
    for (session, sets) in [
        (
            open_4_5(),
            &[
                &[99][..],
                &[100],
                &[402],
                &[8, 10, 14],
                &[2],
                &[86],
                &[402, 2],
            ][..],
        ),
        (open(), &[&[59][..]][..]),
    ] {
        let bytes = current(&session);
        let mut systems: Vec<u32> = session.graph.systems.keys().copied().collect();
        systems.sort_unstable();
        for &set in sets {
            let targets = session.planet_move_targets(set);
            let checked = systems
                .iter()
                .enumerate()
                .filter(|&(i, id)| i % 7 == 0 || session.graph.systems[id].owner.is_some());
            for (_, &to) in checked {
                let check = session.planet_move_check(set, to, None);
                let target = targets.systems.iter().find(|t| t.system == to);
                assert_eq!(
                    check.refusal.is_none(),
                    target.is_some(),
                    "{set:?} to {to}: {check:?}"
                );
                let warnings = target.map(|t| t.warnings.clone()).unwrap_or_default();
                assert_eq!(check.warnings, warnings, "{set:?} to {to}");
            }
        }
        assert_eq!(current(&session), bytes);
        assert!(session.history().undo.is_empty() && !session.is_dirty());
    }
}

/// Station planets 8 and 14 and gas giant 10 of system 169 (moon 13 has station 364, 10
/// has 365 and 14 has 363) move into system 2 as one batch.
#[test]
fn a_batch_moves_station_planets_together() {
    let mut session = open_4_5();
    session.warm_details().expect("build details");
    let original = current(&session);
    let home = fleets(&session, 169);
    let before = findings(&session);

    let op = session.planet_move_op(&[8, 10, 14], 2, None);
    let Op::Batch { description, ops } = &op else {
        panic!("a batch, not {op:?}");
    };
    assert_eq!(description, "Moved 3 planets to system #2");
    assert_eq!(ops.len(), 3);
    snapshot_step(&mut session, "batch_of_station_planets", op);

    let orbits = [8, 10, 14].map(|id| body(&session, 2, id).orbit.expect("an orbit"));
    assert!(orbits[0] < orbits[1] && orbits[1] < orbits[2], "{orbits:?}");
    let new: Vec<_> = findings(&session).difference(&before).cloned().collect();
    assert!(new.is_empty(), "new findings: {new:?}");
    let left = fleets(&session, 169);
    let mut moved: Vec<u32> = home.into_iter().filter(|f| !left.contains(f)).collect();
    let mut joined = fleets(&session, 2);
    moved.sort_unstable();
    joined.sort_unstable();
    assert_eq!(joined, moved);
    assert!(
        [363, 364, 365].iter().all(|f| moved.contains(f)),
        "{moved:?}"
    );

    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), original);
}

/// Planet 86 is a star: the batch moves 8, 10 and 14 and then is refused.
#[test]
fn a_batch_with_a_refused_planet_changes_nothing() {
    let mut session = open_4_5();
    let original = current(&session);
    let systems = [2, 169].map(|id| session.system(id).cloned());
    let set = [8, 10, 14, 86];
    let refusal = "planet 86 is a star: only a planet can move to another system";
    assert_eq!(
        session.planet_move_check(&set, 2, None).refusal.as_deref(),
        Some(refusal)
    );

    let op = session.planet_move_op(&set, 2, None);
    let error = session.apply(op).expect_err("86 is a star");
    assert_eq!(error.to_string(), refusal);
    assert_eq!(current(&session), original);
    assert!(session.history().undo.is_empty() && !session.is_dirty());
    assert_eq!([2, 169].map(|id| session.system(id).cloned()), systems);
}

/// Colony 402 is country 16777226's; system 169 is country 0's and 216 nobody's. Country 0
/// controls planet 14 of system 169 through research station 363, and country 16777226
/// owns system 378.
#[test]
fn a_move_into_another_countrys_system_warns() {
    let session = open_4_5();
    let warning = |planet, kind, owner, new_owner| PlanetMoveWarning {
        planet,
        kind,
        owner,
        new_owner,
    };
    let colony = session.planet_move_check(&[402], 169, None);
    assert_eq!(colony.refusal, None);
    assert_eq!(
        colony.warnings,
        [warning(402, PlanetMoveWarningKind::Colony, 16_777_226, 0)]
    );
    assert!(
        session
            .planet_move_check(&[402], 216, None)
            .warnings
            .is_empty()
    );
    assert_eq!(
        session.planet_move_check(&[14], 378, None).warnings,
        [warning(14, PlanetMoveWarningKind::Station, 0, 16_777_226)]
    );
    let targets = session.planet_move_targets(&[402]);
    let into = |to| {
        targets
            .systems
            .iter()
            .find(|t| t.system == to)
            .expect("listed")
    };
    assert_eq!(into(169).warnings, colony.warnings);
    assert!(into(216).warnings.is_empty());
}
