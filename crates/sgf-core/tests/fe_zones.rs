//! What keeps a fallen empire zone's ring empty: the refusals that stop a zone landing
//! on a system, the issues that say when a move put one there, and Paint a Galaxy's
//! own rule for the zones it places by itself.

use sgf_core::document::Document;
use sgf_core::format::scenario::fe_zone::{self, FeDirection, FeKind, FeZone, Site};
use sgf_core::ops::{Op, OpError};
use sgf_core::session::Session;
use sgf_core::validate::{Issue, IssueCode};

mod common;
use common::diff::{plain_snapshot, round_trip};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/paint_a_galaxy.txt"
);
const PREFERRED_FLAG: &str = " set_star_flag = painted_galaxy_fe_spawn_preferred";

fn open() -> Session {
    Session::open(FIXTURE).expect("open the painted fixture")
}

/// The fixture with system 9's zone made automatic: its `preferred` flag dropped.
fn open_with_automatic_9() -> Session {
    let text = std::fs::read_to_string(FIXTURE).expect("read the fixture");
    let (before, after) = text.split_once(PREFERRED_FLAG).expect("system 9's flag");
    let doc =
        Document::from_scenario_bytes(format!("{before}{after}").into_bytes()).expect("index");
    let session = Session::from_document(None, doc).expect("open");
    assert!(
        !session.graph.systems[&9]
            .fe_zone
            .as_ref()
            .unwrap()
            .preferred
    );
    session
}

fn zone(direction: FeDirection, kind: FeKind, distance: u16, preferred: bool) -> FeZone {
    FeZone {
        direction,
        kind,
        distance,
        preferred,
        fallback: false,
    }
}

fn automatic(direction: FeDirection) -> FeZone {
    zone(direction, FeKind::Random, 40, false)
}

fn set_zone(id: u32, zone: Option<FeZone>) -> Op {
    Op::SetFeZone { id, zone }
}

fn move_system(id: u32, x: f64, y: f64) -> Op {
    Op::MoveSystem { id, x, y }
}

fn site(id: u32, x: f64, y: f64) -> Site<'static> {
    Site {
        id,
        x,
        y,
        zone: None,
        linked: false,
    }
}

fn coded(issues: &[Issue], code: IssueCode) -> Vec<&Issue> {
    issues.iter().filter(|issue| issue.code == code).collect()
}

fn zone_issues(issues: &[Issue]) -> Vec<&Issue> {
    issues
        .iter()
        .filter(|issue| {
            matches!(
                issue.code,
                IssueCode::FeZoneBlocked | IssueCode::FeZoneOverlap | IssueCode::FeZoneOffMap
            )
        })
        .collect()
}

#[test]
fn a_zone_whose_ring_holds_a_system_or_lies_off_the_map_is_refused() {
    let mut session = open();
    let over_sol = zone(FeDirection::Nw, FeKind::Spiritualist, 120, true);
    let error = session
        .apply(set_zone(11, Some(over_sol.clone())))
        .expect_err("Sol stands in the ring");
    assert!(matches!(error, OpError::FeZoneBlocked { .. }), "{error}");
    assert_eq!(
        error.to_string(),
        "Fallen empire zone from system 11 is blocked by Sol: the mod needs the ring empty"
    );
    let error = session
        .apply(Op::SetFeZones {
            entries: vec![(9, None), (11, Some(over_sol))],
        })
        .expect_err("one refused entry refuses the op");
    assert!(matches!(error, OpError::FeZoneBlocked { .. }), "{error}");
    assert!(!session.is_dirty());

    session
        .apply(move_system(10, 300.0, -30.0))
        .expect("move Void towards the edge");
    let error = session
        .apply(set_zone(
            10,
            Some(zone(FeDirection::W, FeKind::Random, 200, true)),
        ))
        .expect_err("the centre lies past the edge");
    assert!(matches!(error, OpError::FeZoneOffMap { .. }), "{error}");
    assert_eq!(
        error.to_string(),
        "Fallen empire zone from Void is off the map"
    );
    session
        .apply(set_zone(
            10,
            Some(zone(FeDirection::E, FeKind::Random, 200, true)),
        ))
        .expect("the other way lies on the map");

    session
        .apply(move_system(7, 10.0, -210.0))
        .expect("a move into a ring is allowed");
    assert!(!coded(&session.validate(), IssueCode::FeZoneBlocked).is_empty());
    session
        .apply(set_zone(9, None))
        .expect("taking a blocked zone away is always allowed");
    assert!(coded(&session.validate(), IssueCode::FeZoneBlocked).is_empty());
}

#[test]
fn a_system_moved_into_a_ring_is_reported_against_its_anchor() {
    let mut session = open();
    assert!(zone_issues(&session.validate()).is_empty());
    let result = session
        .apply(move_system(7, 10.0, -210.0))
        .expect("move Ingress into Old Seat's ring");
    let blocked = coded(&result.issues, IssueCode::FeZoneBlocked);
    assert_eq!(blocked.len(), 1, "{:?}", result.issues);
    assert_eq!(
        blocked[0].message,
        "Fallen empire zone from Old Seat is blocked by Ingress: the mod needs the ring empty."
    );
    assert_eq!(blocked[0].systems, [9, 7]);
    assert_eq!(
        coded(&session.validate(), IssueCode::FeZoneBlocked).len(),
        1
    );
    session.undo().expect("undo").expect("an op to undo");
    assert!(zone_issues(&session.validate()).is_empty());

    let mut session = open_with_automatic_9();
    let result = session
        .apply(move_system(7, 10.0, -210.0))
        .expect("move Ingress into the automatic ring");
    let blocked = coded(&result.issues, IssueCode::FeZoneBlocked);
    assert_eq!(blocked.len(), 1, "{:?}", result.issues);
    assert_eq!(
        blocked[0].message,
        "Fallen empire zone from Old Seat is blocked by Ingress: the mod needs the ring empty. Recompute automatic zones to clear it."
    );
}

#[test]
fn two_rings_that_share_space_are_reported_once_lower_anchor_first() {
    let mut session = open();
    session
        .apply(move_system(10, 50.0, -180.0))
        .expect("move Void beside Old Seat");
    let result = session
        .apply(set_zone(10, Some(automatic(FeDirection::N))))
        .expect("a zone 50 from Old Seat's is written");
    let overlap = coded(&result.issues, IssueCode::FeZoneOverlap);
    assert_eq!(overlap.len(), 1, "{:?}", result.issues);
    assert_eq!(
        overlap[0].message,
        "Fallen empire zones from Old Seat and Void overlap: the mod cannot fill both. Recompute automatic zones to clear it."
    );
    assert_eq!(overlap[0].systems, [9, 10]);
    assert!(coded(&result.issues, IssueCode::FeZoneBlocked).is_empty());

    session
        .apply(set_zone(
            10,
            Some(zone(FeDirection::N, FeKind::Hive, 40, true)),
        ))
        .expect("placed by hand");
    let issues = session.validate();
    let overlap = coded(&issues, IssueCode::FeZoneOverlap);
    assert_eq!(overlap.len(), 1);
    assert_eq!(
        overlap[0].message,
        "Fallen empire zones from Old Seat and Void overlap: the mod cannot fill both."
    );
}

#[test]
fn an_anchor_moved_so_its_centre_leaves_the_map_is_reported() {
    let mut session = open();
    session
        .apply(set_zone(
            10,
            Some(zone(FeDirection::W, FeKind::Random, 200, true)),
        ))
        .expect("a zone reaching 350 east");
    assert!(zone_issues(&session.validate()).is_empty());
    let result = session
        .apply(move_system(10, 300.0, -30.0))
        .expect("move the anchor");
    let off = coded(&result.issues, IssueCode::FeZoneOffMap);
    assert_eq!(off.len(), 1, "{:?}", result.issues);
    assert_eq!(
        off[0].message,
        "Fallen empire zone from Void is off the map."
    );
    assert_eq!(off[0].systems, [10]);
}

#[test]
fn a_candidate_keeps_clear_of_the_core_the_l_cluster_the_edge_systems_and_other_zones() {
    let e = |id| (id, automatic(FeDirection::E));
    assert_eq!(fe_zone::candidates(&[site(1, 200.0, 0.0)]), [e(1)]);

    // Inside the core guide the first three directions fall short of 130; south-west is
    // the first to clear it.
    assert_eq!(
        fe_zone::candidates(&[site(1, 100.0, 0.0)]),
        [(1, automatic(FeDirection::Sw))]
    );

    // On the L-Cluster guide every direction stays within 100 of it.
    assert_eq!(fe_zone::candidates(&[site(1, -380.0, -420.0)]), []);
    assert_eq!(
        fe_zone::candidates(&[site(1, -320.0, -420.0)]),
        [(1, automatic(FeDirection::S))]
    );

    // East of a system near the west edge lies past 470.
    assert_eq!(
        fe_zone::candidates(&[site(1, -440.0, 0.0)]),
        [(1, automatic(FeDirection::Se))]
    );

    // A system in the ring blocks the direction; the next clear one is taken, and the
    // second system keeps its own centre a zone's width from the first.
    assert_eq!(
        fe_zone::candidates(&[site(1, 200.0, 0.0), site(2, 160.0, 10.0)]),
        [
            (1, automatic(FeDirection::S)),
            (2, automatic(FeDirection::Se))
        ]
    );
    assert_eq!(
        fe_zone::candidates(&[site(1, 200.0, 0.0), site(2, 200.0, 50.0)]),
        [e(1), (2, automatic(FeDirection::Se))]
    );

    // A zone placed by hand is kept, anchors no candidate, and pushes its neighbour's
    // centre away as an accepted one does.
    let placed = zone(FeDirection::E, FeKind::Hive, 40, true);
    let sites = [
        Site {
            zone: Some(&placed),
            ..site(1, 200.0, 0.0)
        },
        site(2, 200.0, 50.0),
    ];
    assert_eq!(
        fe_zone::candidates(&sites),
        [(2, automatic(FeDirection::Se))]
    );
}

fn centre_of(sites: &[Site<'_>], id: u32, zone: &FeZone) -> (f64, f64) {
    let site = sites.iter().find(|site| site.id == id).expect("the anchor");
    fe_zone::centre((site.x, site.y), zone)
}

fn distance(a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.0 - b.0).hypot(a.1 - b.1)
}

#[test]
fn fitting_every_candidate_keeps_the_placed_zones_and_replaces_the_automatic_ones() {
    let session = open();
    let sites = fe_zone::sites(&session.graph);
    assert_eq!(fe_zone::candidate_count(&sites), 9);
    let entries = fe_zone::fit(&sites, usize::MAX);
    assert_eq!(entries.len(), 9);
    assert_eq!(entries, fe_zone::fit(&sites, 9));
    assert!(entries.iter().all(|(id, zone)| {
        *id != 9 && *id != 12 && zone.as_ref().is_some_and(|z| !z.preferred)
    }));
    let mut ids: Vec<u32> = entries.iter().map(|(id, _)| *id).collect();
    ids.dedup();
    assert_eq!(ids.len(), entries.len());
    plain_snapshot(
        "recompute",
        open(),
        Op::SetFeZones {
            entries: entries.clone(),
        },
    );
    round_trip(open(), Op::SetFeZones { entries });

    let session = open_with_automatic_9();
    let entries = fe_zone::fit(&fe_zone::sites(&session.graph), usize::MAX);
    assert_eq!(
        entries.iter().find(|(id, _)| *id == 9),
        Some(&(9, Some(automatic(FeDirection::E)))),
        "{entries:?}"
    );
    assert_eq!(entries.iter().filter(|(id, _)| *id == 9).count(), 1);
    assert!(entries.iter().all(|(id, _)| *id != 12));

    let mut session = open();
    let entries = fe_zone::fit(&fe_zone::sites(&session.graph), usize::MAX);
    session
        .apply(Op::SetFeZones { entries })
        .expect("fit applies");
    assert!(
        fe_zone::fit(&fe_zone::sites(&session.graph), usize::MAX).is_empty(),
        "a second pass has nothing left to change"
    );
}

#[test]
fn fitting_a_count_spreads_that_many_candidates_away_from_the_placed_zones() {
    let mut session = open();
    session
        .apply(Op::SetFeZones {
            entries: fe_zone::fit(&fe_zone::sites(&session.graph), usize::MAX),
        })
        .expect("fill the map with automatic zones");
    let sites = fe_zone::sites(&session.graph);
    let cleared = fe_zone::fit(&sites, 0);
    assert_eq!(cleared.len(), 9, "{cleared:?}");
    assert!(cleared.iter().all(|(_, zone)| zone.is_none()));

    let session = open();
    let sites = fe_zone::sites(&session.graph);
    let two = fe_zone::fit(&sites, 2);
    assert_eq!(two, fe_zone::fit(&sites, 2), "deterministic");
    assert_eq!(two.len(), 2, "{two:?}");
    assert!(
        two.iter()
            .all(|(id, zone)| *id != 9 && *id != 12 && zone.is_some())
    );
    let centres: Vec<(f64, f64)> = two
        .iter()
        .map(|(id, zone)| centre_of(&sites, *id, zone.as_ref().unwrap()))
        .collect();
    assert!(
        distance(centres[0], centres[1]) > 60.0,
        "{two:?} lie {} apart",
        distance(centres[0], centres[1])
    );

    // The first pick is the candidate whose centre lies farthest from the placed zone.
    let placed = zone(FeDirection::E, FeKind::Hive, 40, true);
    let sites = [
        Site {
            zone: Some(&placed),
            ..site(1, 200.0, 0.0)
        },
        site(2, 200.0, 100.0),
        site(3, -200.0, 0.0),
        site(4, 200.0, -100.0),
    ];
    assert_eq!(
        fe_zone::fit(&sites, 1),
        [(3, Some(automatic(FeDirection::E)))]
    );

    // With no placed zone the first pick is the candidate farthest from the origin,
    // and the second the one farthest from the first.
    let sites = [
        site(1, 200.0, 0.0),
        site(2, 200.0, 150.0),
        site(3, -200.0, 0.0),
        site(4, -300.0, 50.0),
    ];
    assert_eq!(
        fe_zone::fit(&sites, 2),
        [
            (2, Some(automatic(FeDirection::E))),
            (4, Some(automatic(FeDirection::E)))
        ]
    );
}
