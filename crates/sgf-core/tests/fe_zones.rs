//! Fallen empire zones: what each reads and writes as, what keeps its ring empty (the
//! refusals that stop a zone landing on a system and the issues that say when a move
//! put one there), and Paint a Galaxy's own rule for the zones it places by itself.

use sgf_core::format::scenario::fe_zone::{
    self, FE_ZONE_DISTANCES, FeDirection, FeKind, FeZone, Site,
};
use sgf_core::ops::rules::fe_zone as placement;
use sgf_core::ops::{Op, OpError};
use sgf_core::session::Session;
use sgf_core::validate::{Issue, IssueCode};

use crate::common;
use common::Refused;
use common::coded;
use common::diff::snapshot_step;
use common::fixture::{PAINTED, from_scenario_text};
use common::paint::PREFERRED_FLAG;

/// The fixture with system 9's zone made automatic: its `preferred` flag dropped.
fn open_with_automatic_9() -> Session {
    let session = PAINTED.open_edited(&[(PREFERRED_FLAG, "")]);
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
    let mut session = PAINTED.open();
    let over_sol = zone(FeDirection::Nw, FeKind::Spiritualist, 120, true);
    let error = session
        .apply(set_zone(11, Some(over_sol.clone())))
        .expect_err("Sol stands in the ring");
    assert!(matches!(error, OpError::FeZoneBlocked { .. }), "{error}");
    assert_eq!(
        error.to_string(),
        "Fallen empire zone from #11 is blocked by Sol: the mod needs the ring empty"
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
    let mut session = PAINTED.open();
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
    let mut session = PAINTED.open();
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
    let mut session = PAINTED.open();
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
    assert_eq!(placement::candidates(&[site(1, 200.0, 0.0)]), [e(1)]);

    // Inside the core guide the first three directions fall short of 130; south-west is
    // the first to clear it.
    assert_eq!(
        placement::candidates(&[site(1, 100.0, 0.0)]),
        [(1, automatic(FeDirection::Sw))]
    );

    // On the L-Cluster guide every direction stays within 100 of it.
    assert_eq!(placement::candidates(&[site(1, -380.0, -420.0)]), []);
    assert_eq!(
        placement::candidates(&[site(1, -320.0, -420.0)]),
        [(1, automatic(FeDirection::S))]
    );

    // East of a system near the west edge lies past 470.
    assert_eq!(
        placement::candidates(&[site(1, -440.0, 0.0)]),
        [(1, automatic(FeDirection::Se))]
    );

    // A system in the ring blocks the direction; the next clear one is taken, and the
    // second system keeps its own centre a zone's width from the first.
    assert_eq!(
        placement::candidates(&[site(1, 200.0, 0.0), site(2, 160.0, 10.0)]),
        [
            (1, automatic(FeDirection::S)),
            (2, automatic(FeDirection::Se))
        ]
    );
    assert_eq!(
        placement::candidates(&[site(1, 200.0, 0.0), site(2, 200.0, 50.0)]),
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
        placement::candidates(&sites),
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
    let session = PAINTED.open();
    let sites = placement::sites(&session.graph);
    assert_eq!(placement::candidate_count(&sites), 9);
    let entries = placement::fit(&sites, usize::MAX);
    assert_eq!(entries.len(), 9);
    assert_eq!(entries, placement::fit(&sites, 9));
    assert!(entries.iter().all(|(id, zone)| {
        *id != 9 && *id != 12 && zone.as_ref().is_some_and(|z| !z.preferred)
    }));
    let mut ids: Vec<u32> = entries.iter().map(|(id, _)| *id).collect();
    ids.dedup();
    assert_eq!(ids.len(), entries.len());
    snapshot_step(
        &mut PAINTED.open(),
        "recompute",
        Op::SetFeZones {
            entries: entries.clone(),
        },
    );

    let session = open_with_automatic_9();
    let entries = placement::fit(&placement::sites(&session.graph), usize::MAX);
    assert_eq!(
        entries.iter().find(|(id, _)| *id == 9),
        Some(&(9, Some(automatic(FeDirection::E)))),
        "{entries:?}"
    );
    assert_eq!(entries.iter().filter(|(id, _)| *id == 9).count(), 1);
    assert!(entries.iter().all(|(id, _)| *id != 12));

    let mut session = PAINTED.open();
    let entries = placement::fit(&placement::sites(&session.graph), usize::MAX);
    session
        .apply(Op::SetFeZones { entries })
        .expect("fit applies");
    assert!(
        placement::fit(&placement::sites(&session.graph), usize::MAX).is_empty(),
        "a second pass has nothing left to change"
    );
}

#[test]
fn fitting_a_count_spreads_that_many_candidates_away_from_the_placed_zones() {
    let mut session = PAINTED.open();
    session
        .apply(Op::SetFeZones {
            entries: placement::fit(&placement::sites(&session.graph), usize::MAX),
        })
        .expect("fill the map with automatic zones");
    let sites = placement::sites(&session.graph);
    let cleared = placement::fit(&sites, 0);
    assert_eq!(cleared.len(), 9, "{cleared:?}");
    assert!(cleared.iter().all(|(_, zone)| zone.is_none()));

    let session = PAINTED.open();
    let sites = placement::sites(&session.graph);
    let two = placement::fit(&sites, 2);
    assert_eq!(two, placement::fit(&sites, 2), "deterministic");
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
        placement::fit(&sites, 1),
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
        placement::fit(&sites, 2),
        [
            (2, Some(automatic(FeDirection::E))),
            (4, Some(automatic(FeDirection::E)))
        ]
    );
}

fn rounded((x, y): (f64, f64)) -> (f64, f64) {
    ((x * 1e5).round() / 1e5, (y * 1e5).round() / 1e5)
}

#[test]
fn each_zone_reads_back_with_its_centre() {
    let session = PAINTED.open();
    let systems = &session.graph.systems;
    let old_seat = zone(FeDirection::N, FeKind::Random, 40, true);
    assert_eq!(systems[&9].fe_zone, Some(old_seat.clone()));
    let high_seat = FeZone {
        fallback: true,
        ..zone(FeDirection::Se, FeKind::Materialist, 60, true)
    };
    assert_eq!(systems[&12].fe_zone, Some(high_seat.clone()));
    for id in (0..=8).chain([10, 11, 13]) {
        assert_eq!(systems[&id].fe_zone, None, "system {id}");
    }
    let anchor = |id: u32| (systems[&id].x, systems[&id].y);
    assert_eq!(
        rounded(fe_zone::centre(anchor(9), &old_seat)),
        (0.0, -220.0)
    );
    assert_eq!(
        rounded(fe_zone::centre(anchor(12), &high_seat)),
        (77.57359, 192.42641)
    );

    let save = common::open();
    assert!(save.graph.systems.values().all(|s| s.fe_zone.is_none()));
}

#[test]
fn a_zone_is_written_at_the_end_of_the_effect_and_the_other_flags_stay() {
    let cases: [(&str, u32, Option<FeZone>, &str); 5] = [
        (
            "zone_10_no_effect",
            10,
            Some(zone(FeDirection::W, FeKind::Hive, 80, true)),
            "name = \"Void\" effect = { set_star_flag = painted_galaxy_fe_spawn set_star_flag = painted_galaxy_fe_spawn_w set_star_flag = painted_galaxy_fe_spawn_hive set_star_flag = painted_galaxy_fe_spawn_distance_80 set_star_flag = painted_galaxy_fe_spawn_preferred } }",
        ),
        (
            "zone_7_beside_wormhole",
            7,
            Some(zone(FeDirection::E, FeKind::Random, 30, true)),
            "effect = { set_star_flag = painted_galaxy_wormhole_1 set_star_flag = empire_cluster set_star_flag = painted_galaxy_fe_spawn set_star_flag = painted_galaxy_fe_spawn_e set_star_flag = painted_galaxy_fe_spawn_random set_star_flag = painted_galaxy_fe_spawn_distance_30 set_star_flag = painted_galaxy_fe_spawn_preferred } }",
        ),
        (
            "zone_12_change",
            12,
            Some(FeZone {
                fallback: true,
                ..zone(FeDirection::Se, FeKind::Machine, 100, true)
            }),
            "effect = { set_star_flag = painted_galaxy_automatic_initializer set_star_flag = painted_galaxy_wormhole_2 set_star_flag = empire_cluster set_star_flag = painted_galaxy_fe_spawn set_star_flag = painted_galaxy_fe_spawn_se set_star_flag = painted_galaxy_fe_spawn_machine set_star_flag = painted_galaxy_fe_spawn_distance_100 set_star_flag = painted_galaxy_fe_spawn_preferred set_star_flag = painted_galaxy_fe_spawn_fallback } }",
        ),
        (
            "zone_12_remove",
            12,
            None,
            "effect = { set_star_flag = painted_galaxy_automatic_initializer set_star_flag = painted_galaxy_wormhole_2 set_star_flag = empire_cluster } }",
        ),
        ("zone_9_remove", 9, None, "name = \"Old Seat\" }"),
    ];
    for (name, id, zone, written) in cases {
        let mut session = PAINTED.open();
        snapshot_step(&mut session, name, set_zone(id, zone.clone()));
        assert_eq!(session.graph.systems[&id].fe_zone, zone, "{name}");
        assert!(
            common::text(&session).contains(written),
            "{name}: {}",
            common::text(&session)
        );
    }

    let mut session = PAINTED.open();
    session
        .apply(set_zone(10, None))
        .expect("nothing to remove");
    assert_eq!(common::current(&session), PAINTED.bytes());
    let error = session
        .apply(set_zone(99, None))
        .expect_err("no such system");
    assert!(matches!(error, OpError::UnknownSystem(99)), "{error}");
}

#[test]
fn several_zones_are_one_undo_step() {
    let entries = vec![
        (9, None),
        (
            11,
            Some(zone(FeDirection::Nw, FeKind::Spiritualist, 160, true)),
        ),
        (
            12,
            Some(zone(FeDirection::Ne, FeKind::Xenophobe, 200, false)),
        ),
    ];
    snapshot_step(
        &mut PAINTED.open(),
        "zones",
        Op::SetFeZones {
            entries: entries.clone(),
        },
    );

    let mut session = PAINTED.open();
    let cases: [Refused<_>; 2] = [
        (vec![], |e| matches!(e, OpError::NoEntries)),
        (vec![(9, None), (9, None)], |e| {
            matches!(e, OpError::DuplicateSystem(9))
        }),
    ];
    for (entries, expected) in cases {
        let label = format!("{entries:?}");
        let error = session.apply(Op::SetFeZones { entries }).expect_err(&label);
        assert!(expected(&error), "{label}: {error:?}");
    }
    assert!(!session.is_dirty());
}

#[test]
fn every_zone_round_trips_through_its_flags_and_the_defaults_fill_the_rest() {
    for direction in FeDirection::ALL {
        for kind in FeKind::ALL {
            for distance in FE_ZONE_DISTANCES {
                for (preferred, fallback) in [(false, false), (true, false), (true, true)] {
                    let zone = FeZone {
                        direction,
                        kind,
                        distance,
                        preferred,
                        fallback,
                    };
                    let flags = fe_zone::flags(&zone);
                    assert!(flags.iter().all(|f| fe_zone::is_zone_flag(f)), "{flags:?}");
                    assert_eq!(
                        fe_zone::parse(flags.iter().map(String::as_str)),
                        Some(zone.clone()),
                        "{flags:?}"
                    );
                }
            }
        }
    }
    assert_eq!(
        fe_zone::flags(&zone(FeDirection::Sw, FeKind::Xenophile, 70, true)),
        [
            "painted_galaxy_fe_spawn",
            "painted_galaxy_fe_spawn_sw",
            "painted_galaxy_fe_spawn_xenophile",
            "painted_galaxy_fe_spawn_distance_70",
            "painted_galaxy_fe_spawn_preferred",
        ]
    );

    let parsed = |flags: &[&str]| fe_zone::parse(flags.iter().copied());
    assert_eq!(
        parsed(&["painted_galaxy_fe_spawn"]),
        Some(FeZone {
            direction: FeDirection::E,
            kind: FeKind::Random,
            distance: 40,
            preferred: false,
            fallback: false,
        })
    );
    assert_eq!(
        parsed(&[
            "empire_cluster",
            "painted_galaxy_fe_spawn_distance_1",
            "painted_galaxy_fe_spawn_north",
            "painted_galaxy_fe_spawn_s",
            "painted_galaxy_fe_spawn",
            "painted_galaxy_fe_custom_connection_id_0",
        ]),
        Some(FeZone {
            direction: FeDirection::S,
            kind: FeKind::Random,
            distance: 40,
            preferred: false,
            fallback: false,
        })
    );
    assert_eq!(
        parsed(&[
            "painted_galaxy_fe_spawn_n",
            "painted_galaxy_fe_spawn_preferred"
        ]),
        None
    );
    for flag in [
        "painted_galaxy_fe_custom_connections",
        "painted_galaxy_fe_custom_connection_id_0",
        "painted_galaxy_fe_custom_connection_to_0",
        "painted_galaxy_wormhole_1",
        "empire_cluster",
    ] {
        assert!(!fe_zone::is_zone_flag(flag), "{flag}");
    }
}

#[test]
fn a_custom_connection_flag_survives_a_removal_on_its_own_line() {
    let multi_line = "static_galaxy_scenario = {
	name = \"lines\"
	system = {
		id = \"7\"
		position = { x = 1 y = 2 }
		effect = {
			set_star_flag = painted_galaxy_fe_custom_connections
			set_star_flag = painted_galaxy_fe_spawn
			set_star_flag = painted_galaxy_fe_spawn_w
			set_star_flag = painted_galaxy_fe_custom_connection_id_0
			set_star_flag = painted_galaxy_fe_spawn_distance_50
		}
	}
	system = {
		id = \"8\"
		position = { x = 3 y = 4 }
	}
}
";
    let mut session = from_scenario_text(multi_line);
    assert_eq!(
        session.graph.systems[&7].fe_zone,
        Some(zone(FeDirection::W, FeKind::Random, 50, false))
    );
    session.apply(set_zone(7, None)).expect("remove 7");
    session
        .apply(set_zone(
            8,
            Some(zone(FeDirection::N, FeKind::Hive, 40, true)),
        ))
        .expect("add 8");
    assert_eq!(
        common::text(&session),
        "static_galaxy_scenario = {
	name = \"lines\"
	system = {
		id = \"7\"
		position = { x = 1 y = 2 }
		effect = {
			set_star_flag = painted_galaxy_fe_custom_connections
			set_star_flag = painted_galaxy_fe_custom_connection_id_0
		}
	}
	system = {
		id = \"8\"
		position = { x = 3 y = 4 }
		effect = { set_star_flag = painted_galaxy_fe_spawn set_star_flag = painted_galaxy_fe_spawn_n set_star_flag = painted_galaxy_fe_spawn_hive set_star_flag = painted_galaxy_fe_spawn_distance_40 set_star_flag = painted_galaxy_fe_spawn_preferred }
	}
}
"
    );
    session
        .apply(set_zone(
            7,
            Some(zone(FeDirection::S, FeKind::Machine, 40, true)),
        ))
        .expect("add 7 back on its own lines");
    assert!(common::text(&session).contains(
        "			set_star_flag = painted_galaxy_fe_custom_connection_id_0
			set_star_flag = painted_galaxy_fe_spawn
			set_star_flag = painted_galaxy_fe_spawn_s
			set_star_flag = painted_galaxy_fe_spawn_machine
			set_star_flag = painted_galaxy_fe_spawn_distance_40
			set_star_flag = painted_galaxy_fe_spawn_preferred
		}"
    ));
    for _ in 0..3 {
        session.undo().expect("undo").expect("an op to undo");
    }
    assert_eq!(common::text(&session), multi_line);
}
