//! The two fixtures built to raise as many findings as one document can, so every kind the
//! Issues tab shows has something real behind it. `issues.sav` carries the faults a save can
//! hold, including the three no op can write; `issues.paint.txt` carries the Paint a Galaxy
//! ones. Between them they cover every code but the five that a plain open of one stored file
//! cannot raise: `disconnected` needs an edit in the session, `export_dropped` and
//! `home_initializer` are made at export, `fe_zone_no_automatic` cannot share a file with the
//! other zone codes, and `bodies_overlap` reads the system details, which an open does not build.
//! `header_empire_count` reports only its first mismatch, so the fixture shows one of them.
//!
//! How they were made, so either can be rebuilt. `issues.sav` is `4.4-early.sav` with
//! system 789 moved beyond the galaxy radius and into a nebula's list, 108 moved out of
//! one, and then four hand-spliced `hyperlane` entries the editor will not write: a lane
//! to a system that does not exist, a lane to itself, and a lane written at one end only.
//! `issues.paint.txt` is `4.5-day-one.sav` exported with the Paint a Galaxy profile, with
//! sixteen `system = { ... }` statements replaced to move zones, seats and marauder clans
//! into the states each check looks for, and a `coordinate_transform` added to the header.

use sgf_core::ops::Parent;
use std::collections::BTreeSet;

use sgf_core::document::Document;
use sgf_core::ops::Op;
use sgf_core::ops::rules::bodies;
use sgf_core::session::Session;
use sgf_core::validate::{IssueCode, Severity};

use crate::common;

const SAVE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/issues.sav");
const SCENARIO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/issues.paint.txt"
);

fn codes(path: &str) -> Vec<(Severity, IssueCode)> {
    let session = Session::open(path).expect("open the fixture");
    let mut seen = BTreeSet::new();
    session
        .validate()
        .into_iter()
        .filter(|issue| seen.insert((issue.severity, issue.code)))
        .map(|issue| (issue.severity, issue.code))
        .collect()
}

#[test]
fn the_save_fixture_raises_every_fault_a_save_can_hold() {
    use IssueCode::*;
    use Severity::*;
    assert_eq!(
        codes(SAVE),
        [
            (Error, LaneAsymmetric),
            (Error, LaneEndpointMissing),
            (Error, LaneSelf),
            (Info, LaneDuplicate),
            (Warning, SystemIsolated),
            (Warning, OutOfBounds),
            (Warning, NebulaMembership),
        ]
    );
}

#[test]
fn the_scenario_fixture_raises_every_paint_a_galaxy_fault() {
    use IssueCode::*;
    use Severity::*;
    assert_eq!(
        codes(SCENARIO),
        [
            (Warning, SystemIsolated),
            (Warning, CoordinateTransform),
            (Warning, PositionRange),
            (Warning, FeZoneBlocked),
            (Warning, FeZoneOverlap),
            (Warning, FeZoneOffMap),
            (Warning, FeLinkIsolated),
            (Warning, FeLinkDangling),
            (Warning, FeLinkShared),
            (Info, FeLinkFar),
            (Warning, HeaderEmpireCount),
            (Warning, SeatLetterDuplicate),
            (Warning, PlayerSeatDuplicate),
            (Warning, LClusterSystem),
            (Warning, MarauderHomeDuplicate),
            (Warning, MarauderBaseOrphan),
            (Warning, MarauderBasesMissing),
            (Info, MarauderBasesMissing),
            (Info, MarauderNearSeat),
        ]
    );
}

/// The point of the fixtures: a reader can tell two findings of one kind apart.
#[test]
fn no_two_findings_of_the_scenario_read_the_same() {
    let session = Session::open(SCENARIO).expect("open the fixture");
    let issues = session.validate();
    let mut seen = BTreeSet::new();
    for issue in &issues {
        assert!(
            seen.insert(issue.message.clone()),
            "two findings share a sentence: {}",
            issue.message
        );
    }
}

/// Both fixtures round-trip, so neither is a file the editor can open but not write back.
#[test]
fn both_fixtures_rebuild_from_their_own_pieces() {
    for path in [SAVE, SCENARIO] {
        let doc = Document::load(path).expect("load the fixture");
        let joined: Vec<u8> = doc.pieces().flatten().copied().collect();
        assert_eq!(joined, doc.original(), "{path} changed");
    }
}

/// Every code `IssueCode` declares, as its derived deserialiser lists them when refusing an
/// unknown one.
fn declared_codes() -> Vec<String> {
    let error = serde_json::from_str::<IssueCode>(r#""?""#).expect_err("no such code");
    let message = error.to_string();
    let (_, listed) = message
        .split_once("expected one of ")
        .unwrap_or_else(|| panic!("{message}"));
    listed
        .split('`')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

#[test]
fn each_code_names_itself_as_serde_does() {
    let declared = declared_codes();
    assert!(declared.len() > 20, "{declared:?}");
    for name in declared {
        let code: IssueCode = serde_json::from_value(serde_json::Value::String(name.clone()))
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(code.as_str(), name);
    }
}

/// System 1 planet 587's drawn radius and angle in the 4.5 sample, from the details as
/// they now stand.
fn radius_and_angle(session: &Session, system: u32, body: u32) -> (f64, f64) {
    let planet = common::planets(session, system)
        .into_iter()
        .find(|p| p.id == body)
        .unwrap_or_else(|| panic!("planet {body}"));
    let at = planet
        .at
        .unwrap_or_else(|| panic!("planet {body} has a point"));
    let centre = (0.0, 0.0);
    (
        bodies::drawn_radius(at, centre, planet.orbit),
        bodies::angle_about(centre, at),
    )
}

/// Neither sample raises `bodies_overlap` once its details are warmed: the game-written
/// near-overlaps (asteroids scattered about a belt) all sit within `BELT_SCATTER` of their
/// belt's radius.
#[test]
fn neither_sample_raises_bodies_overlap_with_details_warmed() {
    for mut session in [common::open(), common::open_4_5()] {
        session.warm_details().expect("build details");
        let issues = session.validate();
        assert!(
            common::coded(&issues, IssueCode::BodiesOverlap).is_empty(),
            "{:?}",
            common::coded(&issues, IssueCode::BodiesOverlap)
        );
    }
}

/// Without the details built, `validate` never raises `bodies_overlap`, since it has
/// nothing to read the positions from.
#[test]
fn validate_raises_no_overlap_before_details_are_built() {
    let session = common::open_4_5();
    assert!(common::coded(&session.validate(), IssueCode::BodiesOverlap).is_empty());
}

/// Moving planet 588 onto planet 587's drawn radius and angle raises the overlap for
/// system 1 in the apply result's own issues; undo clears it, and redo raises it again.
#[test]
fn moving_a_body_onto_another_raises_the_overlap() {
    let mut session = common::open_4_5();
    session.warm_details().expect("build details");
    let (radius, angle) = radius_and_angle(&session, 1, 587);

    let applied = session
        .apply(Op::MoveBody {
            system: 1,
            body: 588,
            radius,
            angle,
        })
        .expect("move 588 onto 587");
    let overlap = common::coded(&applied.issues, IssueCode::BodiesOverlap);
    assert_eq!(overlap.len(), 1, "{:?}", applied.issues);
    assert_eq!(overlap[0].systems, vec![1]);
    assert!(
        overlap[0].message.contains("#587"),
        "{}",
        overlap[0].message
    );
    assert!(
        overlap[0].message.contains("#588"),
        "{}",
        overlap[0].message
    );

    let undone = session.undo().expect("undo").expect("something to undo");
    assert!(common::coded(&undone.issues, IssueCode::BodiesOverlap).is_empty());

    let redone = session.redo().expect("redo").expect("something to redo");
    assert_eq!(
        common::coded(&redone.issues, IssueCode::BodiesOverlap).len(),
        1
    );
}

/// A move one degree away from 587 does not overlap: past `OVERLAP_TOLERANCE`.
#[test]
fn a_move_one_degree_away_does_not_overlap() {
    let mut session = common::open_4_5();
    session.warm_details().expect("build details");
    let (radius, angle) = radius_and_angle(&session, 1, 587);

    let applied = session
        .apply(Op::MoveBody {
            system: 1,
            body: 588,
            radius,
            angle: angle + 1.0,
        })
        .expect("move 588 near 587");
    assert!(common::coded(&applied.issues, IssueCode::BodiesOverlap).is_empty());
}

/// The asteroids scattered about system 8's belt sit within tolerance of each other but
/// raise nothing: they are within `BELT_SCATTER` of the belt's own radius.
#[test]
fn belt_asteroids_within_tolerance_do_not_overlap() {
    let mut session = common::open_4_5();
    session.warm_details().expect("build details");
    let issues = session.validate();
    let on_system_8 = issues
        .iter()
        .filter(|i| i.code == IssueCode::BodiesOverlap && i.systems == vec![8])
        .count();
    assert_eq!(on_system_8, 0);
}

/// Two moons stacked about planet 589 at radius 20 overlap though a belt lies at 20 from
/// the centre: only bodies about the centre scatter with a belt.
#[test]
fn moons_stacked_near_a_belts_radius_overlap() {
    let mut session = common::open_4_5();
    session.warm_details().expect("build details");
    for op in [
        Op::AddBelt {
            system: 1,
            kind: "rocky_asteroid_belt".to_owned(),
            radius: 20.0,
        },
        Op::SetBodyParent {
            system: 1,
            body: 588,
            parent: Parent::Body(589),
            radius: 20.0,
            angle: 90.0,
        },
        Op::MoveBody {
            system: 1,
            body: 590,
            radius: 20.0,
            angle: 90.0,
        },
    ] {
        session.apply(op).expect("apply");
    }
    let issues = session.validate();
    let overlap = common::coded(&issues, IssueCode::BodiesOverlap);
    assert_eq!(overlap.len(), 1, "{overlap:?}");
    assert!(overlap[0].message.contains("#588 and #590"), "{overlap:?}");
}

/// `warm_details` returns the issues once it has built the projection, the overlap a
/// preceding move made among them.
#[test]
fn warm_details_returns_the_overlap_after_a_move() {
    let mut session = common::open_4_5();
    let (radius, angle) = radius_and_angle(&session, 1, 587);
    session
        .apply(Op::MoveBody {
            system: 1,
            body: 588,
            radius,
            angle,
        })
        .expect("move 588 onto 587");

    let issues = session.warm_details().expect("warm the details");
    assert_eq!(common::coded(&issues, IssueCode::BodiesOverlap).len(), 1);
}

/// The codes a plain open of one stored file cannot raise, as the module doc explains.
const RAISED_ELSEWHERE: [&str; 5] = [
    "disconnected",
    "export_dropped",
    "home_initializer",
    "fe_zone_no_automatic",
    "bodies_overlap",
];

#[test]
fn every_code_is_raised_by_a_fixture_or_named_as_raised_elsewhere() {
    let raised: BTreeSet<&str> = codes(SAVE)
        .into_iter()
        .chain(codes(SCENARIO))
        .map(|(_, code)| code.as_str())
        .collect();
    let missing: Vec<String> = declared_codes()
        .into_iter()
        .filter(|name| {
            !raised.contains(name.as_str()) && !RAISED_ELSEWHERE.contains(&name.as_str())
        })
        .collect();
    assert!(
        missing.is_empty(),
        "no fixture raises {missing:?}: add it to one, or to RAISED_ELSEWHERE with the reason"
    );
    for name in RAISED_ELSEWHERE {
        assert!(!raised.contains(name), "{name} is raised");
    }
}
