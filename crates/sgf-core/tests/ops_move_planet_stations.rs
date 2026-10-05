//! The stations a planet moved to another system takes along, and the fleet lists of the
//! systems they leave and join.

use sgf_core::ops::Op;

use crate::common;
use crate::ops_move_planet::{fleets, move_planet, with_planet};
use common::diff::{round_trip, snapshot_step};
use common::spec::{dorellion, mura};
use common::{current, open_4_5, text};

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
            "Moved planet #10 and its 3 moons, with 2 stations, from Alari system #169 to Millistamu #2"
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
    let mut session = open_4_5();
    let result = session.apply(move_planet(14, 216)).expect("move 14");
    assert!(
        result.entry.description.starts_with(
            "Moved planet #14 and its station from Alari system #169 to Kazam system #216"
        ),
        "{}",
        result.entry.description
    );
    assert_eq!(fleets(&session, 216), [329, 363]);
    round_trip(open_4_5(), move_planet(14, 216));
}

/// Planet 14's station 363 stands in system 169, and fleet 329 in system 216.
/// `shipclass_orbital_station` is pointed at a fleet the save lacks, then at 329: neither
/// fleet moves, and neither system's `fleet_presence` changes.
#[test]
fn a_station_that_is_gone_or_elsewhere_stays_out_of_the_move() {
    for station in ["4000000", "329"] {
        let mut session = with_planet(14, |entity| {
            entity.replace(
                "shipclass_orbital_station=363",
                &format!("shipclass_orbital_station={station}"),
            )
        });
        let before = [169, 216, 2].map(|id| fleets(&session, id));
        session.apply(move_planet(14, 2)).expect("move 14");
        assert_eq!([169, 216, 2].map(|id| fleets(&session, id)), before);
    }
}

/// Mura and Dorellion are added to the 4.5 sample as systems 601 and 602, and gas giant 10
/// with its stations 364 and 365 moves into 602. Removing 601 makes 602 system 601, and
/// every coordinate that named 602 now names 601.
#[test]
fn a_renumbered_system_takes_its_stations_along() {
    let mut session = open_4_5();
    for spec in [mura(), dorellion()] {
        session.apply(Op::AddSystemFromSpec { spec }).expect("add");
    }
    session.apply(move_planet(10, 602)).expect("move 10");
    assert!(fleets(&session, 602).contains(&364));
    let before = current(&session);
    assert!(text(&session).contains("origin=602\n"));

    session
        .apply(Op::RemoveSystem { system: 601 })
        .expect("remove 601");
    let after = text(&session);
    assert!(
        !after.contains("origin=602\n"),
        "a coordinate still names 602"
    );
    let moved = fleets(&session, 601);
    assert!(moved.contains(&364) && moved.contains(&365), "{moved:?}");

    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), before);
}
