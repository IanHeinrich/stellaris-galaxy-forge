//! History on the sample save and a scenario: every op undoes to the document as it was
//! opened and redoes to the edit, undo steps one op at a time, dirty follows the saved
//! position, and an edit survives a save and a reload from disk.

use std::collections::BTreeMap;

use sgf_core::document::Document;
use sgf_core::format::save::details::RawSystemDetails;
use sgf_core::ops::Op;
use sgf_core::projections::galaxy::GalaxyGraph;
use sgf_core::projections::galaxy::SystemNode;
use sgf_core::session::Session;
use sgf_core::validate::Severity;
use sgf_core::views::DocumentKind;

use crate::common;
use common::diff::{round_trip, round_trip_step};
use common::examples::{self, one_of_each};
use common::{NEBULA_0_CENTRE, current, open};

#[test]
fn every_op_undoes_to_the_original_and_redoes_to_the_edit() {
    for example in one_of_each() {
        let name = example.name();
        if let Some(op) = example.save {
            let mut session = (example.open_save)();
            // A removal needs a system the session added, so it starts from that edit.
            if session.is_dirty() {
                round_trip_step(&mut session, name, op);
            } else {
                round_trip(session, op);
            }
        }
        if let Some(op) = example.scenario {
            round_trip(examples::scenario(), op);
        }
    }
    for op in [
        Op::RemoveLane { a: 708, b: 154 },
        Op::MoveSystem {
            system: 108,
            x: 200.0,
            y: -50.0,
        },
        Op::MoveSystem {
            system: 455,
            x: NEBULA_0_CENTRE.0,
            y: NEBULA_0_CENTRE.1,
        },
        Op::SetNebulaRadius {
            index: 0,
            radius: 15.0,
        },
    ] {
        round_trip(open(), op);
    }
}

/// Each system's details as a save projects them, none for a scenario.
fn details_of(session: &mut Session) -> BTreeMap<u32, RawSystemDetails> {
    if session.kind() != DocumentKind::Save {
        return BTreeMap::new();
    }
    session.warm_details().expect("build details");
    let details = session.details().expect("details");
    session
        .graph()
        .systems
        .keys()
        .filter_map(|&id| Some((id, details.raw(id)?.clone())))
        .collect()
}

/// The galaxy as the map reads it, with what an inverse may write in another order put in
/// one: a system's lanes, the nebulae, and the nebula a system is in, named by what it is
/// rather than where it stands in the list.
#[derive(Debug, PartialEq)]
struct Settled {
    systems: BTreeMap<u32, SystemNode>,
    nebula_of: BTreeMap<u32, String>,
    nebulae: Vec<String>,
    header: Vec<(String, String)>,
}

fn settled(session: &Session) -> Settled {
    let graph = session.graph();
    let mut nebulae: Vec<String> = graph
        .nebulae
        .iter()
        .map(|nebula| format!("{nebula:?}"))
        .collect();
    let mut systems = BTreeMap::new();
    let mut nebula_of = BTreeMap::new();
    for (&id, system) in &graph.systems {
        let mut system = system.clone();
        system.lanes.sort_by_key(|lane| lane.to);
        if let Some(index) = system.nebula.take() {
            nebula_of.insert(id, nebulae[index].clone());
        }
        systems.insert(id, system);
    }
    nebulae.sort();
    // A header statement's line is where the file as opened had it, which a statement
    // written back has none of.
    let header = graph
        .header
        .iter()
        .map(|field| (field.key.clone(), field.value.clone()))
        .collect();
    Settled {
        systems,
        nebula_of,
        nebulae,
        header,
    }
}

/// The galaxy without the ids an inverse may write an entry back under. A system's
/// `bypasses` list goes with them: the game writes it on load.
fn without_ids(mut galaxy: Settled) -> Settled {
    galaxy
        .systems
        .values_mut()
        .for_each(|system| system.bypass_ids.clear());
    galaxy
}

/// The details without the ids an inverse may write an entry back under.
fn details_without_ids(
    mut details: BTreeMap<u32, RawSystemDetails>,
) -> BTreeMap<u32, RawSystemDetails> {
    for system in details.values_mut() {
        for wormhole in &mut system.wormholes {
            (wormhole.id, wormhole.bypass) = (0, 0);
        }
        system.sites.iter_mut().for_each(|site| site.id = 0);
    }
    details
}

const LANE_LAST: &str = "a lane comes back last in its system or the scenario";
const ORBIT_AGAIN: &str = "the orbit is worked out again from the coordinate put back";

/// Ops whose inverse writes other bytes than the op took away, and why. Only these are
/// checked by what the galaxy and the details read back, without the ids.
const BYTES_DIFFER: [(&str, &str); 17] = [
    ("RemoveLane", LANE_LAST),
    ("RemoveLanes", LANE_LAST),
    ("IsolateSystem", LANE_LAST),
    ("RemoveLanePairs", LANE_LAST),
    ("IsolateSystems", LANE_LAST),
    ("Batch", LANE_LAST),
    ("AllowLane", "a prevented lane comes back last"),
    ("RemoveNebula", "a nebula comes back last"),
    ("RemoveSystem", "a system comes back last in the scenario"),
    ("RemoveSystems", "a system comes back last in the scenario"),
    ("RemoveAnomaly", "the body comes back last in the list"),
    ("RemoveDeposit", "a deposit comes back under a new id"),
    ("RemoveDigSite", "a site comes back under a new id"),
    (
        "RemoveWormholePair",
        "a pair comes back under new ids, without the bypasses lists the game writes on load",
    ),
    ("MoveBody", ORBIT_AGAIN),
    ("SetBodyParent", ORBIT_AGAIN),
    (
        "MoveBodyToSystem",
        "the orbit and the system's radii are worked out again from the body put back",
    ),
];

/// Ops whose inverse puts a body back at its coordinate and works its orbit out from it,
/// so the details read back near, not equal.
const DETAILS_READ_BACK_NEAR: [&str; 3] = ["MoveBody", "SetBodyParent", "MoveBodyToSystem"];

/// The inverse an op returns is itself an op: applied, it puts back the bytes and `meta`
/// the op changed, and the galaxy and the details read back as they were.
#[test]
fn every_ops_inverse_applied_as_an_op_puts_the_document_back() {
    let mut failed = Vec::new();
    let mut differed = Vec::new();
    for example in one_of_each() {
        let name = example.name();
        let mut cases = vec![];
        if let Some(op) = example.save {
            cases.push(((example.open_save)(), op));
        }
        if let Some(op) = example.scenario {
            cases.push((examples::scenario(), op));
        }
        for (mut session, op) in cases {
            let label = format!("{name} on a {:?}", session.kind());
            let bytes = current(&session);
            let meta = session.doc().meta().to_vec();
            let galaxy = settled(&session);
            let details = details_of(&mut session);
            let result = session
                .apply_inverse(op)
                .unwrap_or_else(|e| panic!("{label}: {e}"));
            session
                .apply_inverse(result.inverse)
                .unwrap_or_else(|e| panic!("{label}: the inverse: {e}"));
            if session.doc().meta() != meta {
                failed.push(format!("{label}: meta"));
            }
            if current(&session) == bytes {
                if settled(&session) != galaxy {
                    failed.push(format!("{label}: galaxy"));
                }
                if details_of(&mut session) != details {
                    failed.push(format!("{label}: details"));
                }
                continue;
            }
            let Some((_, why)) = BYTES_DIFFER.iter().find(|(listed, _)| *listed == name) else {
                failed.push(format!("{label}: bytes"));
                continue;
            };
            differed.push(name);
            if without_ids(settled(&session)) != without_ids(galaxy) {
                failed.push(format!("{label}: galaxy, beyond what differs ({why})"));
            }
            if !DETAILS_READ_BACK_NEAR.contains(&name)
                && details_without_ids(details_of(&mut session)) != details_without_ids(details)
            {
                failed.push(format!("{label}: details, beyond what differs ({why})"));
            }
        }
    }
    failed.extend(
        BYTES_DIFFER
            .iter()
            .filter(|(name, _)| !differed.contains(name))
            .map(|(name, _)| format!("{name}: listed, but its inverse puts the bytes back")),
    );
    assert!(failed.is_empty(), "{failed:#?}");
}

#[test]
fn two_ops_on_one_entity_undo_one_at_a_time() {
    let mut session = open();
    session
        .apply(Op::MoveSystem {
            system: 0,
            x: -150.0,
            y: 60.0,
        })
        .unwrap();
    let moved = current(&session);
    session.apply(Op::RemoveLane { a: 0, b: 752 }).unwrap();
    assert_ne!(current(&session), moved);

    session.undo().unwrap().expect("undo remove");
    assert_eq!(current(&session), moved);
    assert!(session.graph().lane(0, 752).is_some());
    session.undo().unwrap().expect("undo move");
    assert_eq!(current(&session), session.doc().original());
    assert!(session.undo().unwrap().is_none());
}

#[test]
fn dirty_follows_the_saved_position_in_history() {
    let mut session = open();
    assert!(!session.is_dirty());
    session
        .apply(Op::AddLane {
            a: 0,
            b: 1,
            bridge: false,
        })
        .unwrap();
    assert!(session.is_dirty());
    session.undo().unwrap().unwrap();
    assert!(!session.is_dirty());
    session.redo().unwrap().unwrap();
    assert!(session.is_dirty());

    let dir = tempfile::tempdir().unwrap();
    session.save_as(dir.path().join("saved.sav")).unwrap();
    assert!(!session.is_dirty());
    session.undo().unwrap().unwrap();
    assert!(session.is_dirty());
    session.redo().unwrap().unwrap();
    assert!(!session.is_dirty());

    // A new op after an undo discards the saved state for good.
    session.undo().unwrap().unwrap();
    session.apply(Op::RemoveLane { a: 0, b: 752 }).unwrap();
    assert!(session.is_dirty());
    session.undo().unwrap().unwrap();
    assert!(session.is_dirty());
}

#[test]
fn moved_system_projection_matches_a_reload_of_the_saved_file() {
    let mut session = open();
    session
        .apply(Op::MoveSystem {
            system: 0,
            x: -150.0,
            y: 60.0,
        })
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("moved.sav");
    session.save_as(&path).unwrap();
    assert!(!session.is_dirty());

    let reloaded = GalaxyGraph::build(&Document::load(&path).unwrap()).unwrap();
    let zero = &session.graph().systems[&0];
    assert_eq!((zero.x, zero.y), (-150.0, 60.0));
    assert_eq!(zero, &reloaded.systems[&0]);
    for lane in &zero.lanes {
        assert_eq!(
            session.graph().systems[&lane.to],
            reloaded.systems[&lane.to],
            "neighbour {}",
            lane.to
        );
        let other = &reloaded.systems[&lane.to];
        let dist = (zero.x - other.x).hypot(zero.y - other.y);
        assert_eq!(lane.length, dist.floor(), "lane 0 -> {}", lane.to);
        assert_eq!(reloaded.lane(lane.to, 0).unwrap().length, dist.floor());
    }
}

#[test]
fn added_lane_survives_save_and_reload() {
    let mut session = open();
    session
        .apply(Op::AddLane {
            a: 0,
            b: 1,
            bridge: false,
        })
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("lane.sav");
    session.save_as(&path).unwrap();

    let reopened = Session::open(&path).unwrap();
    let (a, b) = (&reopened.graph().systems[&0], &reopened.graph().systems[&1]);
    let dist = (a.x - b.x).hypot(a.y - b.y);
    let lane = reopened.graph().lane(0, 1).expect("lane 0 -> 1");
    assert_eq!(lane.length, dist.floor());
    assert!(!lane.bridge);
    assert_eq!(reopened.graph().lane(1, 0).unwrap().length, dist.floor());
    assert!(
        reopened
            .validate()
            .iter()
            .all(|i| i.severity != Severity::Error),
        "{:?}",
        reopened.validate()
    );
}
