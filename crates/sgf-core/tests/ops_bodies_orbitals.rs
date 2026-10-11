//! What a save body moved in its system takes along, on the 4.5 sample: the fleets parked in
//! orbit of it and of its moons, their ships, and the megastructure rows built at them.

use sgf_core::entity::EntityKind;
use sgf_core::session::Session;

use crate::common;
use crate::ops_bodies::{assert_near, at, drawn, move_body, set_parent};
use common::diff::snapshot_step;
use common::open_4_5;

/// The point of the first `coordinate` block after the line `after`, or of the first one when
/// `after` is `None`.
fn point_in(text: &str, after: Option<&str>) -> (f64, f64) {
    let mut lines = text.lines().map(str::trim);
    if let Some(after) = after {
        lines.find(|l| *l == after).expect("the block");
    }
    lines.find(|l| *l == "coordinate=").expect("a coordinate");
    let mut axis = |key: &str| {
        lines
            .find_map(|l| l.strip_prefix(key))
            .and_then(|v| v.parse().ok())
            .expect("an axis")
    };
    let x = axis("x=");
    (x, axis("y="))
}

/// Where fleet `id`'s `movement_manager` stands.
fn fleet_at(session: &Session, id: u32) -> (f64, f64) {
    let text = common::entity_text(session, EntityKind::Fleet, id);
    point_in(&text, Some("movement_manager="))
}

fn ship_at(session: &Session, id: u32) -> (f64, f64) {
    point_in(&common::entity_text(session, EntityKind::Ship, id), None)
}

/// Where fleet `fleet` stands from body `body` of system `system`.
fn from_body(session: &Session, system: u32, fleet: u32, body: u32) -> (f64, f64) {
    let (fx, fy) = fleet_at(session, fleet);
    let (bx, by) = at(session, system, body);
    (fx - bx, fy - by)
}

/// Gas giant 10 of the 4.5 sample's home system 169 has moons 11, 12 and 13. Mining station
/// 365 (ship 2047) orbits 10, and mining station 364 (ship 2046) orbits moon 13.
#[test]
fn a_planet_moved_in_its_system_takes_its_stations_along() {
    let mut session = open_4_5();
    let stations = [(365, 2047, 10), (364, 2046, 13)];
    let offsets = stations.map(|(fleet, _, body)| from_body(&session, 169, fleet, body));
    let radius = drawn(&session, 169, 10);
    let result = snapshot_step(
        &mut session,
        "with_stations",
        move_body(169, 10, radius, 200.0),
    );
    assert_eq!(
        result.entry.description,
        "Moved planet #10 from orbit 160.08 at 203.99° to orbit 160.08 at 200°, \
         with its moons #11, #12 and #13"
    );
    for ((fleet, ship, body), offset) in stations.into_iter().zip(offsets) {
        let what = format!("station {fleet} from body {body}");
        assert_near(from_body(&session, 169, fleet, body), offset, &what);
        assert_eq!(
            ship_at(&session, ship),
            fleet_at(&session, fleet),
            "ship {ship}"
        );
    }
    session.apply(result.inverse).expect("move it back");
    assert_eq!(common::current(&session), session.doc().original());
}

/// Moon 13 moved on its own takes its station 364 and leaves planet 10's station 365, and
/// made a planet of the star, it still takes 364.
#[test]
fn a_moon_moved_alone_takes_only_its_own_station() {
    let mut session = open_4_5();
    let planets_station = fleet_at(&session, 365);
    let offset = from_body(&session, 169, 364, 13);
    session
        .apply(move_body(169, 13, 30.0, 90.0))
        .expect("move 13");
    assert_near(from_body(&session, 169, 364, 13), offset, "364 from 13");
    assert_eq!(fleet_at(&session, 365), planets_station);

    session
        .apply(set_parent(169, 13, None, 260.0, 10.0))
        .expect("13 made a planet");
    assert_near(from_body(&session, 169, 364, 13), offset, "364 from 13");
}

/// Fleets orbiting gas giant 832 of system 28: 177 is parked there, and 181 and 182 are on
/// their way across the system. In system 400 the station fleet 38 of one of its starbases
/// orbits planet 316.
#[test]
fn a_fleet_parked_at_a_body_moves_with_it_and_one_on_its_way_stays() {
    let mut session = open_4_5();
    let parked = from_body(&session, 28, 177, 832);
    let moving = [181, 182].map(|f| common::entity_text(&session, EntityKind::Fleet, f));
    let radius = drawn(&session, 28, 832);
    session
        .apply(move_body(28, 832, radius, 10.0))
        .expect("move 832");
    assert_near(from_body(&session, 28, 177, 832), parked, "177 from 832");
    let after = [181, 182].map(|f| common::entity_text(&session, EntityKind::Fleet, f));
    assert_eq!(after, moving);

    let starbases = |session: &Session| {
        let details = session.details().expect("details");
        let raw = details.raw(400).expect("system 400");
        raw.starbases
            .iter()
            .filter_map(|s| s.at)
            .collect::<Vec<_>>()
    };
    assert!(starbases(&session).contains(&fleet_at(&session, 38)));
    let starbase = from_body(&session, 400, 38, 316);
    let radius = drawn(&session, 400, 316);
    session
        .apply(move_body(400, 316, radius, 300.0))
        .expect("move 316");
    assert_near(from_body(&session, 400, 38, 316), starbase, "38 from 316");
    assert!(starbases(&session).contains(&fleet_at(&session, 38)));
}

/// Planet 936 of system 38 has the ruined orbital ring, megastructure 4, whose row stands at
/// the planet's own point, (47.58375, 115.66625).
#[test]
fn a_planet_moved_in_its_system_takes_its_megastructure_along() {
    let mut session = open_4_5();
    let row = |session: &Session| {
        let details = session.details().expect("details");
        let raw = details.raw(38).expect("system 38");
        let row = raw
            .megastructures
            .iter()
            .find(|m| m.id == 4)
            .expect("row 4");
        row.at.expect("a point")
    };
    assert_eq!(row(&session), at(&session, 38, 936));
    snapshot_step(
        &mut session,
        "with_a_megastructure",
        move_body(38, 936, 140.0, 45.0),
    );
    assert_eq!(row(&session), (98.99495, 98.99495));
    assert_eq!(row(&session), at(&session, 38, 936));

    session.undo().expect("undo").expect("the move");
    assert_eq!(row(&session), (47.58375, 115.66625));
}
