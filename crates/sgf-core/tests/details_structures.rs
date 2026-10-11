//! Details projection on the sample saves: where each megastructure and starbase stands,
//! and the graphical culture its model is drawn in.
use std::fmt::Write as _;

use sgf_core::format::save::details::{DetailsProjection, HeuristicResolver};
use sgf_core::session::Session;

use crate::common;

fn point(at: Option<(f64, f64)>) -> String {
    at.map_or_else(|| "-".to_owned(), |(x, y)| format!("({x}, {y})"))
}

/// Every system the session's galaxy holds, in id order.
fn systems(session: &Session) -> Vec<u32> {
    let mut ids: Vec<u32> = session.graph().systems.keys().copied().collect();
    ids.sort_unstable();
    ids
}

/// One line per megastructure: its system, id, type, point and culture.
fn megastructures(session: &Session, details: &DetailsProjection) -> String {
    let mut report = String::new();
    for id in systems(session) {
        for m in &details
            .raw(id)
            .expect("system in projection")
            .megastructures
        {
            writeln!(
                report,
                "system {id} #{} {} at {} culture {}",
                m.id,
                m.kind,
                point(m.at),
                m.culture.as_deref().unwrap_or("-"),
            )
            .unwrap();
        }
    }
    report
}

#[test]
fn a_megastructure_stands_at_its_row_coordinate_in_its_own_culture_or_its_owners() {
    let session = common::open_4_5();
    let details = session.details().expect("build details");
    let raw = |id: u32| details.raw(id).expect("system in projection");

    let seal = &raw(14).megastructures[0];
    assert_eq!(seal.kind, "shroud_seal");
    assert_eq!(seal.at, Some((-60.2718, 0.0)));
    assert_eq!(seal.culture.as_deref(), Some("mindwarden_01"), "its own");
    let ring = &raw(38).megastructures[0];
    assert_eq!(ring.kind, "orbital_ring_ruined");
    assert_eq!(
        ring.at,
        Some((47.58375, 115.66625)),
        "its planet's own coordinate"
    );
    assert_eq!(ring.culture, None, "no owner and none of its own");
    common::snapshot("megastructures_4_5", &megastructures(&session, &details));

    let session = common::warmed();
    let details = session.details().expect("build details");
    let quadrant = &details.raw(311).expect("system 311").megastructures[0];
    assert_eq!(quadrant.at, Some((45.20385, -0.00045)));
    assert_eq!(
        quadrant.culture.as_deref(),
        Some("mammalian_01"),
        "its owner's, as the row names none"
    );
    common::snapshot("megastructures_4_4", &megastructures(&session, &details));
}

#[test]
fn a_starbase_stands_where_its_station_fleet_does_in_its_station_ships_culture() {
    let session = common::warmed();
    let details = session.details().expect("build details");
    let resolved = details
        .resolve(217, &HeuristicResolver, false)
        .expect("Sol resolved");
    let sol = resolved.starbase.expect("Sol's starbase");
    assert_eq!(sol.at, Some((21.6, -21.6)));
    assert_eq!(sol.culture.as_deref(), Some("humanoid_01"));
    let orbited = sol.planet.expect("the planet its station fleet orbits");
    assert!(
        resolved.planets.iter().any(|p| p.id == orbited),
        "a body of Sol"
    );

    let starbases: Vec<_> = systems(&session)
        .into_iter()
        .flat_map(|id| &details.raw(id).expect("system in projection").starbases)
        .collect();
    assert!(
        starbases
            .iter()
            .all(|s| s.at.is_some() && s.culture.is_some())
    );

    let session = common::open_4_5();
    let details = session.details().expect("build details");
    let mut report = String::new();
    for id in systems(&session) {
        for s in &details.raw(id).expect("system in projection").starbases {
            writeln!(
                report,
                "system {id} #{} {} at {} orbiting {} culture {}",
                s.id,
                s.level,
                point(s.at),
                s.planet.map_or_else(|| "-".to_owned(), |p| format!("#{p}")),
                s.culture.as_deref().unwrap_or("-"),
            )
            .unwrap();
        }
    }
    common::snapshot("starbases_4_5", &report);
}
