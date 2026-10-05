//! Entity views after an edit: the source bytes, the nodes and spans an op marks as
//! changed, and a scenario's systems.

use sgf_core::entity::views::{EntityAddr, EntityKind, NodeValue};
use sgf_core::entity::{EntityError, get_entity, get_entity_source};
use sgf_core::ops::Op;

use crate::common;
use common::fixture::GRAMMAR;

fn addr(kind: EntityKind, id: u32) -> EntityAddr {
    EntityAddr::new(kind, id)
}

fn path(segments: &[&str]) -> Vec<String> {
    segments.iter().map(|s| (*s).to_owned()).collect()
}

#[test]
fn the_source_is_the_entity_bytes() {
    let session = common::open();
    let view = get_entity(session.doc(), addr(EntityKind::Planet, 0), &[]).expect("read planet");
    let source =
        get_entity_source(session.doc(), addr(EntityKind::Planet, 0)).expect("read source");
    let bytes = &session.doc().original()[view.span[0]..view.span[1]];
    assert_eq!(source.text.as_bytes(), bytes);
    assert_eq!(source.text.len(), view.bytes as usize);
    assert!(source.changed.is_empty());
    assert!(!source.truncated);
    assert!(source.text.starts_with("0="));
}

#[test]
fn an_op_marks_the_nodes_and_spans_it_changed() {
    let mut session = common::open();
    let system = addr(EntityKind::System, 0);
    session
        .apply(Op::MoveSystem {
            system: 0,
            x: -150.0,
            y: 60.0,
        })
        .expect("move the system");

    let view = get_entity(session.doc(), system, &[]).expect("read the moved system");
    assert!(view.dirty);
    let changed: Vec<&str> = view
        .nodes
        .iter()
        .filter(|n| n.changed)
        .filter_map(|n| n.key.as_deref())
        .collect();
    assert_eq!(changed, ["coordinate", "x", "y", "hyperlane"]);

    let coordinate = get_entity(session.doc(), system, &path(&["coordinate"])).expect("drill");
    let changed: Vec<&str> = coordinate
        .nodes
        .iter()
        .filter(|n| n.changed)
        .filter_map(|n| n.key.as_deref())
        .collect();
    assert_eq!(changed, ["x", "y"]);

    let source = get_entity_source(session.doc(), system).expect("read source");
    let ranges: Vec<&str> = source
        .changed
        .iter()
        .map(|r| &source.text[r[0]..r[1]])
        .collect();
    assert!(
        ranges[0].contains("x=-150") && ranges[0].contains("y=60"),
        "{ranges:?}"
    );
    assert_eq!(
        ranges.iter().filter(|r| r.contains("length=")).count(),
        5,
        "{ranges:?}"
    );
    common::snapshot("system_0_moved_spans", &format!("{ranges:#?}"));

    session.undo().expect("undo").expect("an op to undo");
    let view = get_entity(session.doc(), system, &[]).expect("read the restored system");
    assert!(!view.dirty);
    assert!(view.nodes.iter().all(|n| !n.changed));
    let source = get_entity_source(session.doc(), system).expect("read source");
    assert!(source.changed.is_empty());
}

#[test]
fn a_block_an_op_created_marks_every_node_in_it_changed() {
    let mut session = common::open();
    let isolated = session
        .graph()
        .systems
        .values()
        .find(|s| s.lanes.is_empty())
        .map(|s| s.id)
        .expect("the sample holds a system without lanes");
    session
        .apply(Op::AddLane {
            a: isolated,
            b: 0,
            bridge: false,
        })
        .expect("connect it");

    let lanes = get_entity(
        session.doc(),
        addr(EntityKind::System, isolated),
        &path(&["hyperlane"]),
    )
    .expect("drill into the new block");
    assert!(!lanes.nodes.is_empty());
    assert!(lanes.nodes.iter().all(|n| n.changed), "{:?}", lanes.nodes);
}

// ---- scenario documents ----------------------------------------------------------

#[test]
fn a_scenario_system_reads_its_own_nodes() {
    let session = GRAMMAR.open();
    let system = addr(EntityKind::System, 3018);
    let view = get_entity(session.doc(), system, &[]).expect("read the scenario system");

    let keys: Vec<&str> = view
        .nodes
        .iter()
        .filter(|n| n.path.len() == 1)
        .filter_map(|n| n.key.as_deref())
        .collect();
    assert_eq!(
        keys,
        [
            "id",
            "name",
            "position",
            "initializer",
            "spawn_weight",
            "effect"
        ]
    );
    assert_eq!(view.label, "Iridonia");
    assert!(!view.dirty);
    assert!(view.nodes.iter().all(|n| !n.changed));
    // A scenario carries none of the keys the curated rows read.
    assert!(view.overview.is_empty() && view.contents.is_empty());

    let position = get_entity(session.doc(), system, &path(&["position"])).expect("drill");
    let keys: Vec<&str> = position
        .nodes
        .iter()
        .filter_map(|n| n.key.as_deref())
        .collect();
    assert_eq!(keys, ["x", "y"]);
    assert_eq!(position.path, path(&["position"]));

    // System 111 writes `x = { min = 20 max = 30 }`, which the projection collapses to a
    // midpoint: here the range stands as a block of its own that drills one level further.
    let ranged = addr(EntityKind::System, 111);
    let position = get_entity(session.doc(), ranged, &path(&["position"])).expect("drill");
    let x = position
        .nodes
        .iter()
        .find(|n| n.path == path(&["position", "x"]))
        .expect("the range block");
    assert!(
        matches!(x.value, NodeValue::Block { count: 2 }),
        "{:?}",
        x.value
    );

    let range = get_entity(session.doc(), ranged, &path(&["position", "x"])).expect("drill again");
    let bounds: Vec<(&str, &str)> = range
        .nodes
        .iter()
        .filter_map(|n| match &n.value {
            NodeValue::Scalar { text, .. } => Some((n.key.as_deref()?, text.as_str())),
            _ => None,
        })
        .collect();
    assert_eq!(bounds, [("min", "20"), ("max", "30")]);
}

#[test]
fn a_scenario_systems_source_marks_what_a_move_changed() {
    let mut session = GRAMMAR.open();
    let system = addr(EntityKind::System, 3018);

    let before = get_entity_source(session.doc(), system).expect("read source");
    assert!(before.text.starts_with("system = {"), "{}", before.text);
    assert!(before.changed.is_empty());
    assert!(!before.truncated);

    session
        .apply(Op::MoveSystem {
            system: 3018,
            x: 41.0,
            y: 75.0,
        })
        .expect("move the system");

    let after = get_entity_source(session.doc(), system).expect("read source");
    let ranges: Vec<&str> = after
        .changed
        .iter()
        .map(|r| &after.text[r[0]..r[1]])
        .collect();
    assert_eq!(ranges.len(), 1, "{ranges:?}");
    assert!(ranges[0].contains("x = 41"), "{ranges:?}");

    let view = get_entity(session.doc(), system, &[]).expect("read the moved system");
    assert!(view.dirty);
    let changed: Vec<&str> = view
        .nodes
        .iter()
        .filter(|n| n.changed)
        .filter_map(|n| n.key.as_deref())
        .collect();
    assert_eq!(changed, ["position", "x"]);

    session.undo().expect("undo").expect("an op to undo");
    assert!(
        get_entity_source(session.doc(), system)
            .expect("read source")
            .changed
            .is_empty()
    );
}

#[test]
fn a_scenario_system_an_op_added_reads_as_new() {
    let mut session = GRAMMAR.open();
    session
        .apply(Op::AddSystem {
            system: Some(4242),
            x: 5.0,
            y: -5.0,
            name: Some("Fresh".to_owned()),
            initializer: Some("misc_system_init_01".to_owned()),
            spawn_weight: Some(3.0),
            spawn_script: None,
        })
        .expect("add a system");

    let system = addr(EntityKind::System, 4242);
    let view = get_entity(session.doc(), system, &[]).expect("read the new system");
    assert!(view.dirty);
    assert!(view.nodes.iter().all(|n| n.changed), "{:?}", view.nodes);
    // An inserted statement stands at one offset, holding none of the original bytes.
    assert_eq!(view.span[0], view.span[1]);

    let source = get_entity_source(session.doc(), system).expect("read source");
    assert!(source.text.contains("id = \"4242\""), "{}", source.text);
    assert_eq!(source.changed, [[0, source.text.len()]]);
}

#[test]
fn only_a_scenarios_systems_are_addressable() {
    let session = GRAMMAR.open();
    for kind in EntityKind::ALL
        .into_iter()
        .filter(|k| *k != EntityKind::System)
    {
        let err = get_entity(session.doc(), addr(kind, 1), &[]).unwrap_err();
        assert!(matches!(err, EntityError::NotFound(_)), "{kind}: {err}");
    }
    let err = get_entity(session.doc(), addr(EntityKind::System, 999_999), &[]).unwrap_err();
    assert!(matches!(err, EntityError::NotFound(_)), "{err}");
}
