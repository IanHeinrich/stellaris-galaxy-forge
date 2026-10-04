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
        .graph
        .systems
        .keys()
        .filter_map(|&id| Some((id, details.raw(id)?.clone())))
        .collect()
}

/// The galaxy as the map reads it, with what an inverse may write in another order (a
/// system's lanes, the nebulae) put in one.
fn settled(session: &Session) -> (BTreeMap<u32, SystemNode>, Vec<String>, String) {
    let mut systems: BTreeMap<u32, SystemNode> =
        session.graph.systems.clone().into_iter().collect();
    systems
        .values_mut()
        .for_each(|system| system.lanes.sort_by_key(|lane| lane.to));
    let mut nebulae: Vec<String> = session
        .graph
        .nebulae
        .iter()
        .map(|nebula| format!("{nebula:?}"))
        .collect();
    nebulae.sort();
    (systems, nebulae, format!("{:?}", session.graph.header))
}

/// Ops whose inverse restores the body it moved or the site it removed under another
/// stored value (an orbit's slack, the next free id, a pair's numbers), so their details
/// read back near, not equal.
const DETAILS_READ_BACK_NEAR: [&str; 5] = [
    "MoveBody",
    "SetBodyParent",
    "MoveBodyToSystem",
    "RemoveDigSite",
    "RemoveWormholePair",
];

/// Ops whose inverse writes the galaxy back in another shape: a nebula comes back last and
/// renumbers the ones after it, a header list comes back in another order, a wormhole pair
/// takes another bypass number, and the initializer a seat was given stays when the seat
/// is cleared.
const GALAXY_READS_BACK_NEAR: [&str; 4] = [
    "RemoveNebula",
    "SetHeaderList",
    "RemoveWormholePair",
    "SetSpawnScript",
];

/// The inverse an op returns is itself an op: applied, it puts back the bytes and `meta`
/// the op changed. Where it writes the same statements in another order, as lanes and
/// restored entities do, the galaxy and the details read back as they were.
#[test]
fn every_ops_inverse_applied_as_an_op_puts_the_document_back() {
    let mut failed = Vec::new();
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
            let meta = session.doc.meta().to_vec();
            let galaxy = settled(&session);
            let details = details_of(&mut session);
            let result = session
                .apply_inverse(op)
                .unwrap_or_else(|e| panic!("{label}: {e}"));
            session
                .apply_inverse(result.inverse)
                .unwrap_or_else(|e| panic!("{label}: the inverse: {e}"));
            if session.doc.meta() != meta {
                failed.push(format!("{label}: meta"));
            } else if current(&session) != bytes {
                if !GALAXY_READS_BACK_NEAR.contains(&name) && settled(&session) != galaxy {
                    failed.push(format!("{label}: galaxy"));
                } else if !DETAILS_READ_BACK_NEAR.contains(&name)
                    && details_of(&mut session) != details
                {
                    failed.push(format!("{label}: details"));
                }
            } else if !GALAXY_READS_BACK_NEAR.contains(&name) && settled(&session) != galaxy {
                failed.push(format!("{label}: galaxy"));
            }
        }
    }
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
    assert!(session.graph.lane(0, 752).is_some());
    session.undo().unwrap().expect("undo move");
    assert_eq!(current(&session), session.doc.original());
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
    let zero = &session.graph.systems[&0];
    assert_eq!((zero.x, zero.y), (-150.0, 60.0));
    assert_eq!(zero, &reloaded.systems[&0]);
    for lane in &zero.lanes {
        assert_eq!(
            session.graph.systems[&lane.to], reloaded.systems[&lane.to],
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
    let (a, b) = (&reopened.graph.systems[&0], &reopened.graph.systems[&1]);
    let dist = (a.x - b.x).hypot(a.y - b.y);
    let lane = reopened.graph.lane(0, 1).expect("lane 0 -> 1");
    assert_eq!(lane.length, dist.floor());
    assert!(!lane.bridge);
    assert_eq!(reopened.graph.lane(1, 0).unwrap().length, dist.floor());
    assert!(
        reopened
            .validate()
            .iter()
            .all(|i| i.severity != Severity::Error),
        "{:?}",
        reopened.validate()
    );
}
