//! The two fixtures built to raise as many findings as one document can, so every kind the
//! Issues tab shows has something real behind it. `issues.sav` carries the faults a save can
//! hold, including the three no op can write; `issues.paint.txt` carries the Paint a Galaxy
//! ones. Between them they cover every code but the four that no single stored file can raise:
//! `disconnected` needs an edit in the session, `export_dropped` and `home_initializer` are
//! made at export, and `fe_zone_no_automatic` cannot share a file with the other zone codes.
//! `header_empire_count` reports only its first mismatch, so the fixture shows one of them.
//!
//! How they were made, so either can be rebuilt. `issues.sav` is `2206.11.16.sav` with
//! system 789 moved beyond the galaxy radius and into a nebula's list, 108 moved out of
//! one, and then four hand-spliced `hyperlane` entries the editor will not write: a lane
//! to a system that does not exist, a lane to itself, and a lane written at one end only.
//! `issues.paint.txt` is `2201.03.25.sav` exported with the Paint a Galaxy profile, with
//! sixteen `system = { ... }` statements replaced to move zones, seats and marauder clans
//! into the states each check looks for, and a `coordinate_transform` added to the header.

use std::collections::BTreeSet;

use sgf_core::document::Document;
use sgf_core::session::Session;
use sgf_core::validate::{IssueCode, Severity};

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
            (Warning, SolSeatMismatch),
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

/// The codes no single stored file can raise, as the module doc explains.
const RAISED_ELSEWHERE: [&str; 4] = [
    "disconnected",
    "export_dropped",
    "home_initializer",
    "fe_zone_no_automatic",
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
