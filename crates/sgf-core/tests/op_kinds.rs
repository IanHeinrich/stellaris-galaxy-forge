//! What each document kind takes and what an op reports about its own reach, checked
//! by applying one op of every variant to the sample saves and to a scenario: the ops a
//! kind refuses, the ops a save before Stellaris 4.0 refuses, the systems whose details an
//! op stales, whether it reclassifies, and that details reread in place equal a fresh build.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use sgf_core::format::save::details::{DetailsProjection, RawSystemDetails};
use sgf_core::ops::{DetailsReach, Op, OpError};
use sgf_core::projections::galaxy::GalaxyGraph;
use sgf_core::projections::geometry;
use sgf_core::session::Session;
use sgf_core::validate::{Issue, IssueCode};
use sgf_core::views::{Capabilities, DocumentKind};

use crate::common;
use common::examples::{self, one_of_each};
use common::fixture::GRAMMAR;

/// What classifies a system: whether it is there, the initializer it is built from, the
/// name it is labelled by and the wormhole its star flags place.
fn classification(graph: &GalaxyGraph, id: u32) -> Option<(String, String, Option<u32>)> {
    graph.systems.get(&id).map(|system| {
        (
            system.initializer.clone(),
            format!("{:?}", system.name),
            system.wormhole_pair,
        )
    })
}

/// Every system id either graph holds, ascending.
fn every_id(before: &GalaxyGraph, after: &GalaxyGraph) -> Vec<u32> {
    let ids: BTreeSet<u32> = before
        .systems
        .keys()
        .chain(after.systems.keys())
        .copied()
        .collect();
    ids.into_iter().collect()
}

/// The systems `before` and `after` hold differently in what their details come from:
/// whether they are there, their initializer, and their star, whose bodies a save's
/// details list.
fn details_changed(before: &GalaxyGraph, after: &GalaxyGraph) -> Vec<u32> {
    let source = |graph: &GalaxyGraph, id: u32| {
        graph
            .systems
            .get(&id)
            .map(|s| (s.initializer.clone(), s.star_class.clone()))
    };
    every_id(before, after)
        .into_iter()
        .filter(|&id| source(before, id) != source(after, id))
        .collect()
}

/// Each system's raw details as a save projects them, empty for a scenario, which has
/// none of its own.
fn raw_details(session: &Session) -> BTreeMap<u32, RawSystemDetails> {
    if session.kind() != DocumentKind::Save {
        return BTreeMap::new();
    }
    let details = session.details().expect("details");
    session
        .graph()
        .systems
        .keys()
        .filter_map(|&id| Some((id, details.raw(id)?.clone())))
        .collect()
}

/// Each system's raw details as a build from the session's bytes reads them.
fn fresh_details(session: &Session) -> BTreeMap<u32, RawSystemDetails> {
    let fresh = DetailsProjection::build(
        session.doc(),
        session.graph(),
        Arc::clone(session.star_classes()),
    )
    .expect("a fresh build");
    session
        .graph()
        .systems
        .keys()
        .filter_map(|&id| Some((id, fresh.raw(id)?.clone())))
        .collect()
}

/// The systems whose raw details differ between `before` and `after`.
fn raw_details_changed(
    before: &BTreeMap<u32, RawSystemDetails>,
    after: &BTreeMap<u32, RawSystemDetails>,
) -> BTreeSet<u32> {
    before
        .keys()
        .chain(after.keys())
        .filter(|id| before.get(id) != after.get(id))
        .copied()
        .collect()
}

fn assert_refused(mut session: Session, op: &Op, kind: DocumentKind) {
    let message = format!("{} is not supported for a {kind} document", op.name());
    assert_eq!(session.check_op(op), Some(message.clone()), "{}", op.name());
    let error = session.apply_inverse(op.clone()).expect_err("refused");
    assert!(
        matches!(&error, OpError::Unsupported { op: name, kind: k } if *name == op.name() && *k == kind),
        "{}: {error:?}",
        op.name()
    );
    assert_eq!(error.to_string(), message);
    assert!(!session.doc().is_dirty(), "{}", op.name());
}

#[test]
fn each_kind_refuses_exactly_the_ops_its_row_leaves_out() {
    for example in one_of_each() {
        let name = example.name();
        let kinds = example.op().reach().kinds;
        assert!(!kinds.is_empty(), "{name}: some kind takes it");
        assert_eq!(
            example.save.is_some(),
            kinds.contains(&DocumentKind::Save),
            "{name}: a save example where the row names a save"
        );
        assert_eq!(
            example.scenario.is_some(),
            kinds.contains(&DocumentKind::Scenario),
            "{name}: a scenario example where the row names a scenario"
        );
        if example.save.is_none() {
            assert_refused(examples::save(), example.op(), DocumentKind::Save);
        }
        if example.scenario.is_none() {
            assert_refused(examples::scenario(), example.op(), DocumentKind::Scenario);
        }
    }
}

/// An op that rereads a save's details in place keeps them built, and they equal a fresh
/// build after its apply. Undo and redo stale the systems the apply did, and read back the
/// details from before and after it.
#[test]
fn an_op_stales_details_and_reclassifies_exactly_where_it_changes_what_they_come_from() {
    let renamed_in_a_batch = Op::Batch {
        description: "Moved and renamed system 0".to_owned(),
        ops: vec![
            Op::MoveSystem {
                system: 0,
                x: -150.0,
                y: 60.0,
            },
            Op::RenameSystem {
                system: 0,
                name: "Renamed".to_owned(),
            },
        ],
    };
    let cases = one_of_each()
        .into_iter()
        .flat_map(|example| {
            let open_save = example.open_save;
            let save = example.save.map(|op| (open_save(), op));
            let scenario = example.scenario.map(|op| (examples::scenario(), op));
            save.into_iter().chain(scenario)
        })
        .chain([(examples::scenario(), renamed_in_a_batch)]);
    for (session, op) in cases {
        let name = format!("{} on a {:?}", op.name(), session.kind());
        let in_place =
            session.kind() == DocumentKind::Save && op.reach().details == DetailsReach::InPlace;
        let mut session = common::warm(session);
        let before = session.graph().clone();
        let before_raw = raw_details(&session);
        let result = session
            .apply_inverse(op)
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(
            !in_place || session.built_details().is_some(),
            "{name}: the apply dropped the details"
        );
        let applied_raw = raw_details(&session);
        let mut changed: BTreeSet<u32> = details_changed(&before, session.graph())
            .into_iter()
            .collect();
        changed.extend(raw_details_changed(&before_raw, &applied_raw));
        assert_eq!(
            result.details_stale,
            changed.into_iter().collect::<Vec<_>>(),
            "{name}: details stale"
        );
        let reclassified = every_id(&before, session.graph())
            .into_iter()
            .any(|id| classification(&before, id) != classification(session.graph(), id));
        assert_eq!(result.reclassifies, reclassified, "{name}: reclassifies");
        let edit = session.edit_result(result.clone());
        assert_eq!(
            edit.details_stale, result.details_stale,
            "{name}: reaches the app"
        );
        assert_eq!(
            edit.reclassifies, result.reclassifies,
            "{name}: reaches the app"
        );
        if in_place {
            assert!(!result.details_stale.is_empty(), "{name} names no system");
            assert_eq!(applied_raw, fresh_details(&session), "{name}: the apply");
            let read = [&before_raw, &applied_raw];
            assert_undo_and_redo_read(&mut session, &name, &result.details_stale, read);
        }
    }
}

/// `session`, an in-place op just applied, undone and redone: each keeps the details
/// built, stales `stale` again, and reads back the details from before and after the apply.
fn assert_undo_and_redo_read(
    session: &mut Session,
    name: &str,
    stale: &[u32],
    [before, applied]: [&BTreeMap<u32, RawSystemDetails>; 2],
) {
    let undone = session.undo().expect("undo").expect("something to undo");
    assert_eq!(
        undone.details_stale, stale,
        "{name}: the undo's stale systems"
    );
    assert!(
        session.built_details().is_some(),
        "{name}: the undo dropped the details"
    );
    assert_eq!(&raw_details(session), before, "{name}: the undo");
    let redone = session.redo().expect("redo").expect("something to redo");
    assert_eq!(
        redone.details_stale, stale,
        "{name}: the redo's stale systems"
    );
    assert!(
        session.built_details().is_some(),
        "{name}: the redo dropped the details"
    );
    assert_eq!(&raw_details(session), applied, "{name}: the redo");
}

/// A scenario system's details come from its initializer, so the three ops that write one
/// stale them and the app refetches; nothing else does.
#[test]
fn the_ops_that_write_an_initializer_stale_the_systems_details() {
    let mut session = GRAMMAR.open();

    let set = session
        .apply_inverse(Op::SetInitializer {
            system: 16,
            initializer: Some("sol_system_initializer".into()),
        })
        .expect("set the initializer");
    assert_eq!(set.details_stale, [16]);
    assert_eq!(
        session.edit_result(set).details_stale,
        [16],
        "and it reaches the app"
    );

    let added = session
        .apply_inverse(Op::AddSystem {
            system: Some(77),
            x: 10.0,
            y: 10.0,
            name: Some("Fresh".into()),
            initializer: Some("basic_init_01".into()),
            spawn_weight: None,
            spawn_script: None,
        })
        .expect("add a system");
    assert_eq!(added.details_stale, [77]);

    let removed = session
        .apply_inverse(Op::RemoveSystem { system: 16 })
        .expect("remove system 16");
    assert_eq!(
        removed.details_stale,
        [16],
        "the lanes it took with it name no system of their own"
    );

    let undone = session.undo().expect("undo").expect("something to undo");
    assert_eq!(undone.details_stale, [16]);
    let redone = session.redo().expect("redo").expect("something to redo");
    assert_eq!(redone.details_stale, [16]);

    let moved = session
        .apply_inverse(Op::MoveSystem {
            system: 2,
            x: 1.0,
            y: 2.0,
        })
        .expect("move");
    assert!(
        moved.details_stale.is_empty(),
        "a move leaves the initializer alone"
    );
    let named = session
        .apply_inverse(Op::RenameSystem {
            system: 2,
            name: "Renamed".into(),
        })
        .expect("rename");
    assert!(named.details_stale.is_empty());
}

/// Every op that writes whole entries is refused on the 3.4 sample, with nothing written,
/// and no other op is refused for its version. The capabilities of those ops are off there.
#[test]
fn a_save_before_stellaris_4_refuses_the_ops_that_write_whole_entries() {
    for example in one_of_each() {
        let Some(op) = example.save else {
            continue;
        };
        let name = op.name();
        let mut session = common::open_3_4();
        let applied = session.apply_inverse(op.clone());
        if op.reach().whole_entries {
            let error = applied.expect_err(name);
            assert!(
                matches!(&error, OpError::VersionTooOld(version) if version.contains("3.4")),
                "{name}: {error:?}"
            );
            assert!(!session.doc().is_dirty(), "{name}");
        } else if let Err(error) = applied {
            assert!(
                !matches!(
                    error,
                    OpError::VersionTooOld(_) | OpError::UnknownVersion(_)
                ),
                "{name}: {error:?}"
            );
        }
    }
    let four = Capabilities::of(common::open().doc());
    assert_eq!(four, Capabilities::of(common::open_4_5().doc()));
    assert_eq!(
        Capabilities::of(common::open_3_4().doc()),
        Capabilities {
            added_systems: false,
            deposits: false,
            geometry: false,
            wormhole_pairs: false,
            planet_moves: false,
            add_bodies: false,
            remove_bodies: false,
            planet_classes: false,
            modifiers: false,
            anomalies: false,
            dig_sites: false,
            ..four
        }
    );
}

/// Planet 588 moved onto 587 in the 4.5 sample overlaps it; adding a planet to Meissa then
/// rebuilds the details, and the overlap stays in every result.
#[test]
fn an_op_that_rebuilds_the_details_keeps_the_overlap_findings() {
    let mut session = common::open_4_5();
    session.warm_details().expect("build details");
    let planet = common::planets(&session, 1)
        .into_iter()
        .find(|p| p.id == 587)
        .expect("planet 587");
    let at = planet.at.expect("587 has a point");
    let centre = (0.0, 0.0);
    session
        .apply_inverse(Op::MoveBody {
            system: 1,
            body: 588,
            radius: geometry::drawn_radius(at, centre, planet.orbit),
            angle: geometry::angle_about(centre, at),
        })
        .expect("move 588 onto 587");
    let overlaps = |issues: &[Issue]| common::coded(issues, IssueCode::BodiesOverlap).len();

    let added = session
        .apply_inverse(examples::meissa_v())
        .expect("add Meissa V");
    assert_eq!(overlaps(&added.issues), 1, "{:?}", added.issues);
    let undone = session.undo().expect("undo").expect("something to undo");
    assert_eq!(overlaps(&undone.issues), 1, "{:?}", undone.issues);
    let redone = session.redo().expect("redo").expect("something to redo");
    assert_eq!(overlaps(&redone.issues), 1, "{:?}", redone.issues);
}
