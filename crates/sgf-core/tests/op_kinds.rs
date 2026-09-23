//! What each document kind takes and what an op reports about its own reach, checked
//! by applying one op of every variant to the sample save and to a scenario: the ops a
//! kind refuses, the systems whose details an op stales, and whether it reclassifies.

use std::collections::{BTreeMap, BTreeSet};

use sgf_core::format::save::details::RawSystemDetails;
use sgf_core::ops::{Op, OpError};
use sgf_core::projections::galaxy::GalaxyGraph;
use sgf_core::session::Session;
use sgf_core::views::DocumentKind;

mod common;
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
        .graph
        .systems
        .keys()
        .filter_map(|&id| Some((id, details.raw(id)?.clone())))
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
    let error = session.apply(op.clone()).expect_err("refused");
    assert!(
        matches!(&error, OpError::Unsupported { op: name, kind: k } if *name == op.name() && *k == kind),
        "{}: {error:?}",
        op.name()
    );
    assert!(!session.doc.is_dirty(), "{}", op.name());
}

#[test]
fn each_kind_refuses_exactly_the_ops_it_has_no_statement_for() {
    for example in one_of_each() {
        let name = example.name();
        assert!(
            example.save.is_some() || example.scenario.is_some(),
            "{name}: some kind takes it"
        );
        match &example.save {
            Some(op) => {
                (example.open_save)()
                    .apply(op.clone())
                    .unwrap_or_else(|e| panic!("{name}: {e}"));
            }
            None => assert_refused(examples::save(), example.op(), DocumentKind::Save),
        }
        match &example.scenario {
            Some(op) => {
                examples::scenario()
                    .apply(op.clone())
                    .unwrap_or_else(|e| panic!("{name}: {e}"));
            }
            None => assert_refused(examples::scenario(), example.op(), DocumentKind::Scenario),
        }
    }
}

#[test]
fn an_op_stales_details_and_reclassifies_exactly_where_it_changes_what_they_come_from() {
    let renamed_in_a_batch = Op::Batch {
        description: "Moved and renamed system 0".to_owned(),
        ops: vec![
            Op::MoveSystem {
                id: 0,
                x: -150.0,
                y: 60.0,
            },
            Op::SetSystemName {
                id: 0,
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
    for (mut session, op) in cases {
        let name = format!("{} on a {:?}", op.name(), session.kind());
        session.warm_details().expect("build details");
        let before = session.graph.clone();
        let before_raw = raw_details(&session);
        let result = session.apply(op).unwrap_or_else(|e| panic!("{name}: {e}"));
        let mut changed: BTreeSet<u32> = details_changed(&before, &session.graph)
            .into_iter()
            .collect();
        changed.extend(raw_details_changed(&before_raw, &raw_details(&session)));
        assert_eq!(
            result.details_stale,
            changed.into_iter().collect::<Vec<_>>(),
            "{name}: details stale"
        );
        let reclassified = every_id(&before, &session.graph)
            .into_iter()
            .any(|id| classification(&before, id) != classification(&session.graph, id));
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
    }
}

/// A scenario system's details come from its initializer, so the three ops that write one
/// stale them and the app refetches; nothing else does.
#[test]
fn the_ops_that_write_an_initializer_stale_the_systems_details() {
    let mut session = GRAMMAR.open();

    let set = session
        .apply(Op::SetInitializer {
            id: 16,
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
        .apply(Op::AddSystem {
            id: Some(77),
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
        .apply(Op::RemoveSystem { id: 16 })
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
        .apply(Op::MoveSystem {
            id: 2,
            x: 1.0,
            y: 2.0,
        })
        .expect("move");
    assert!(
        moved.details_stale.is_empty(),
        "a move leaves the initializer alone"
    );
    let named = session
        .apply(Op::SetSystemName {
            id: 2,
            name: "Renamed".into(),
        })
        .expect("rename");
    assert!(named.details_stale.is_empty());
}
