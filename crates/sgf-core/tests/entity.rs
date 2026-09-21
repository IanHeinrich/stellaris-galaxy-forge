//! Entity views on the real sample save: one level per kind, a drill, the source bytes
//! and what an op marks as changed.

use std::fmt::Write as _;

use sgf_core::document::Document;
use sgf_core::entity::views::{EntityAddr, EntityKind, EntityView, NodeValue};
use sgf_core::entity::{EntityError, FieldType, get_entity, get_entity_schema, get_entity_source};
use sgf_core::ops::Op;
use sgf_core::session::Session;

mod common;

/// One entity of each kind the address table names, chosen for a readable snapshot.
const SAMPLES: [(EntityKind, u32); 11] = [
    // Sol, whose 24 `planet=` statements make the repeated-key case the rule rather than
    // the exception: a row naming `planet` alone would resolve to no node.
    (EntityKind::System, 217),
    (EntityKind::Planet, 0),
    (EntityKind::Colony, 0),
    (EntityKind::Fleet, 0),
    (EntityKind::Ship, 0),
    (EntityKind::Starbase, 0),
    (EntityKind::Megastructure, 1),
    (EntityKind::Country, 0),
    (EntityKind::PopGroup, 29),
    (EntityKind::Sector, 0),
    (EntityKind::Deposit, 21),
];

fn addr(kind: EntityKind, id: u32) -> EntityAddr {
    EntityAddr::new(kind, id)
}

fn path(segments: &[&str]) -> Vec<String> {
    segments.iter().map(|s| (*s).to_owned()).collect()
}

fn report(view: &EntityView) -> String {
    let mut out = String::new();
    writeln!(out, "{} at {:?}", view.addr, view.path).unwrap();
    writeln!(out, "label: {}", view.label).unwrap();
    writeln!(
        out,
        "bytes: {} dirty: {} span: {}..{}",
        view.bytes, view.dirty, view.span[0], view.span[1]
    )
    .unwrap();
    for fact in &view.overview {
        let link = fact.link.map_or(String::new(), |l| format!(" -> {l}"));
        let at = fact.path.as_ref().map_or_else(
            || " (borrowed)".to_owned(),
            |p| format!(" @{}", p.join(".")),
        );
        writeln!(out, "= {}: {}{link}{at}", fact.label, fact.value).unwrap();
    }
    for row in &view.contents {
        let of = row.of.map_or(String::new(), |k| format!(" of {k}"));
        let at = row
            .path
            .as_ref()
            .map_or(String::new(), |p| format!(" @{}", p.join(".")));
        writeln!(out, "> {} x{}{of}{at}", row.label, row.count).unwrap();
    }
    for node in &view.nodes {
        let value = match &node.value {
            NodeValue::Scalar { text, form } => {
                let mut text = text.replace('\n', "\\n");
                text.truncate(60);
                format!("{form:?} {text}")
            }
            NodeValue::List { count } => format!("list[{count}]"),
            NodeValue::Block { count } => format!("block[{count}]"),
        };
        writeln!(
            out,
            "{} {} = {} @{}..{}",
            if node.changed { "*" } else { " " },
            node.path.join("."),
            value,
            node.span[0],
            node.span[1]
        )
        .unwrap();
    }
    out
}

#[test]
fn every_kind_reads_one_level() {
    let doc = common::load();
    let mut kinds: Vec<EntityKind> = SAMPLES.iter().map(|(kind, _)| *kind).collect();
    kinds.sort_unstable();
    assert_eq!(kinds, EntityKind::ALL);

    for (kind, id) in SAMPLES {
        let view = get_entity(&doc, addr(kind, id), &[]).expect("read entity");
        assert_eq!(view.addr, addr(kind, id));
        assert!(!view.nodes.is_empty(), "{kind} {id} has no nodes");
        // Every curated row points at a node this entity actually wrote, or at another
        // entity's bytes and so at no path of its own.
        for path in view
            .overview
            .iter()
            .filter_map(|f| f.path.as_ref())
            .chain(view.contents.iter().filter_map(|r| r.path.as_ref()))
        {
            assert!(
                view.nodes.iter().any(|n| &n.path == path),
                "{kind} {id}: no node at {}",
                path.join(".")
            );
        }
        assert!(!view.dirty);
        assert!(view.nodes.iter().all(|n| !n.changed));
        common::snapshot(&format!("{kind}_{id}"), &report(&view));
    }
}

/// The kinds with a curated Overview, on entities rich enough to fill one: Earth carries
/// an owner, a colony and its pops; fleet 801 is under orders to colonise a planet; the
/// interstellar assembly orbits one.
#[test]
fn the_overview_reads_what_the_entity_is_doing() {
    let doc = common::load();
    for (kind, id) in [
        (EntityKind::Planet, 3),
        (EntityKind::Fleet, 801),
        (EntityKind::Megastructure, 11),
    ] {
        let view = get_entity(&doc, addr(kind, id), &[]).expect("read entity");
        common::snapshot(&format!("{kind}_{id}_overview"), &report(&view));
    }

    // The pops are the one fact a planet keeps in another entity, and the order's target
    // is the planet it is aimed at.
    let earth = get_entity(&doc, addr(EntityKind::Planet, 3), &[]).expect("Earth");
    let fact = |view: &EntityView, label: &str| {
        view.overview
            .iter()
            .find(|f| f.label == label)
            .unwrap_or_else(|| panic!("no {label} row"))
            .clone()
    };
    let pops = fact(&earth, "Pops");
    assert_eq!(pops.value, "5445");
    assert!(pops.path.is_none(), "the pops are read from the colony");
    assert_eq!(
        fact(&earth, "Colony").link,
        Some(addr(EntityKind::Colony, 0))
    );

    let fleet = get_entity(&doc, addr(EntityKind::Fleet, 801), &[]).expect("fleet 801");
    let order = fact(&fleet, "Order");
    assert_eq!(order.value, "colonize_planet_order");
    assert_eq!(order.link, Some(addr(EntityKind::Planet, 254)));
    let ships = fleet
        .contents
        .iter()
        .find(|r| r.label == "Ships")
        .expect("a Ships row");
    assert_eq!(ships.of, Some(EntityKind::Ship));
    assert_eq!(ships.path, Some(path(&["ships"])));

    // A drill is standing on a level of the entity, not on the entity, so it curates
    // nothing of its own.
    let drill =
        get_entity(&doc, addr(EntityKind::Planet, 3), &path(&["coordinate"])).expect("drill");
    assert!(drill.overview.is_empty() && drill.contents.is_empty());
}

#[test]
fn the_schema_matches_the_bytes_it_labels() {
    let doc = common::load();
    for (kind, id) in SAMPLES {
        let schema = get_entity_schema(kind);
        assert_eq!(schema.kind, kind);
        let mut keys: Vec<&str> = schema.fields.iter().map(|f| f.key.as_str()).collect();
        let named = keys.len();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), named, "{kind} names a key twice");
        assert!(
            schema.fields.iter().all(|f| !f.editable),
            "{kind} is editable"
        );

        let view = get_entity(&doc, addr(kind, id), &[]).expect("read entity");
        for node in view.nodes.iter().filter(|n| n.path.len() == 1) {
            let Some(field) = node
                .key
                .as_deref()
                .and_then(|key| schema.fields.iter().find(|f| f.key == key))
            else {
                continue;
            };
            let composite = matches!(field.ty, FieldType::List | FieldType::Block);
            let written = !matches!(node.value, NodeValue::Scalar { .. });
            assert_eq!(
                composite, written,
                "{kind}.{} is {:?} in the schema and {:?} in the save",
                field.key, field.ty, node.value
            );
        }
    }
    assert!(get_entity_schema(EntityKind::Country).fields.is_empty());
}

#[test]
fn a_child_block_drills_one_level() {
    let doc = common::load();
    let view =
        get_entity(&doc, addr(EntityKind::System, 0), &path(&["coordinate"])).expect("drill");
    let keys: Vec<&str> = view.nodes.iter().filter_map(|n| n.key.as_deref()).collect();
    assert_eq!(keys, ["x", "y", "origin", "randomized", "visual_height"]);
    assert_eq!(view.path, path(&["coordinate"]));
    assert_eq!(view.label, "NAME_Gamma_Refuge");
    common::snapshot("system_0_coordinate", &report(&view));
}

#[test]
fn a_repeated_key_drills_by_its_ordinal() {
    let doc = common::load();
    let ship = addr(EntityKind::Ship, 0);
    let root = get_entity(&doc, ship, &[]).expect("read the ship");
    let sections = root
        .nodes
        .iter()
        .filter(|n| n.key.as_deref() == Some("section") && n.path.len() == 2)
        .count();
    assert_eq!(sections, 3);

    let section = get_entity(&doc, ship, &path(&["section", "1"])).expect("drill");
    let second: Vec<String> = section
        .nodes
        .iter()
        .find(|n| n.path == path(&["section", "1", "weapon", "2"]))
        .expect("a second weapon")
        .path
        .clone();
    let weapon = get_entity(&doc, ship, &second).expect("drill into the second weapon");
    let index = weapon
        .nodes
        .iter()
        .find(|n| n.key.as_deref() == Some("index"))
        .expect("the weapon's index");
    assert!(matches!(&index.value, NodeValue::Scalar { text, .. } if text == "22"));
}

#[test]
fn a_tombstone_reads_as_the_scalar_none() {
    let doc = common::load();
    let view = get_entity(&doc, addr(EntityKind::PopGroup, 0), &[]).expect("read tombstone");
    assert_eq!(view.nodes.len(), 1);
    assert!(matches!(
        &view.nodes[0].value,
        NodeValue::Scalar { text, .. } if text == "none"
    ));
    assert_eq!(view.label, "pop_group #0");
    let err = get_entity(&doc, addr(EntityKind::PopGroup, 0), &path(&["type"])).unwrap_err();
    assert!(matches!(err, EntityError::NoPath { .. }), "{err}");
}

#[test]
fn an_absent_entity_is_not_found() {
    let doc = common::load();
    let err = get_entity(&doc, addr(EntityKind::Planet, 999_999), &[]).unwrap_err();
    assert!(matches!(err, EntityError::NotFound(_)), "{err}");
    let err = get_entity_source(&doc, addr(EntityKind::Fleet, 999_999)).unwrap_err();
    assert!(matches!(err, EntityError::NotFound(_)), "{err}");

    let err = get_entity(&doc, addr(EntityKind::System, 0), &path(&["nonesuch"])).unwrap_err();
    assert!(matches!(err, EntityError::NoPath { .. }), "{err}");
}

#[test]
fn a_document_without_the_section_is_not_found() {
    let doc = Document::from_bytes(b"version=\"Pegasus v4.4.6\"\n".to_vec(), Vec::new())
        .expect("scan a minimal document");
    for kind in EntityKind::ALL {
        let err = get_entity(&doc, addr(kind, 0), &[]).unwrap_err();
        assert!(matches!(err, EntityError::NotFound(_)), "{kind}: {err}");
    }
}

#[test]
fn the_source_is_the_entity_bytes() {
    let session = common::open();
    let view = get_entity(&session.doc, addr(EntityKind::Planet, 0), &[]).expect("read planet");
    let source = get_entity_source(&session.doc, addr(EntityKind::Planet, 0)).expect("read source");
    let bytes = &session.doc.original()[view.span[0]..view.span[1]];
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
            id: 0,
            x: -150.0,
            y: 60.0,
        })
        .expect("move the system");

    let view = get_entity(&session.doc, system, &[]).expect("read the moved system");
    assert!(view.dirty);
    let changed: Vec<&str> = view
        .nodes
        .iter()
        .filter(|n| n.changed)
        .filter_map(|n| n.key.as_deref())
        .collect();
    assert_eq!(changed, ["coordinate", "x", "y", "hyperlane"]);

    let coordinate = get_entity(&session.doc, system, &path(&["coordinate"])).expect("drill");
    let changed: Vec<&str> = coordinate
        .nodes
        .iter()
        .filter(|n| n.changed)
        .filter_map(|n| n.key.as_deref())
        .collect();
    assert_eq!(changed, ["x", "y"]);

    let source = get_entity_source(&session.doc, system).expect("read source");
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
    let view = get_entity(&session.doc, system, &[]).expect("read the restored system");
    assert!(!view.dirty);
    assert!(view.nodes.iter().all(|n| !n.changed));
    let source = get_entity_source(&session.doc, system).expect("read source");
    assert!(source.changed.is_empty());
}

#[test]
fn a_block_an_op_created_marks_every_node_in_it_changed() {
    let mut session = common::open();
    let isolated = session
        .graph
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
        &session.doc,
        addr(EntityKind::System, isolated),
        &path(&["hyperlane"]),
    )
    .expect("drill into the new block");
    assert!(!lanes.nodes.is_empty());
    assert!(lanes.nodes.iter().all(|n| n.changed), "{:?}", lanes.nodes);
}

// ---- scenario documents ----------------------------------------------------------

const SCENARIO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/scenario_grammar.txt"
);

fn scenario() -> Session {
    Session::open(SCENARIO).expect("open the scenario fixture")
}

#[test]
fn a_scenario_system_reads_its_own_nodes() {
    let session = scenario();
    let system = addr(EntityKind::System, 3018);
    let view = get_entity(&session.doc, system, &[]).expect("read the scenario system");

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

    let position = get_entity(&session.doc, system, &path(&["position"])).expect("drill");
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
    let position = get_entity(&session.doc, ranged, &path(&["position"])).expect("drill");
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

    let range = get_entity(&session.doc, ranged, &path(&["position", "x"])).expect("drill again");
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
    let mut session = scenario();
    let system = addr(EntityKind::System, 3018);

    let before = get_entity_source(&session.doc, system).expect("read source");
    assert!(before.text.starts_with("system = {"), "{}", before.text);
    assert!(before.changed.is_empty());
    assert!(!before.truncated);

    session
        .apply(Op::MoveSystem {
            id: 3018,
            x: 41.0,
            y: 75.0,
        })
        .expect("move the system");

    let after = get_entity_source(&session.doc, system).expect("read source");
    let ranges: Vec<&str> = after
        .changed
        .iter()
        .map(|r| &after.text[r[0]..r[1]])
        .collect();
    assert_eq!(ranges.len(), 1, "{ranges:?}");
    assert!(ranges[0].contains("x = 41"), "{ranges:?}");

    let view = get_entity(&session.doc, system, &[]).expect("read the moved system");
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
        get_entity_source(&session.doc, system)
            .expect("read source")
            .changed
            .is_empty()
    );
}

#[test]
fn a_scenario_system_an_op_added_reads_as_new() {
    let mut session = scenario();
    session
        .apply(Op::AddSystem {
            id: Some(4242),
            x: 5.0,
            y: -5.0,
            name: Some("Fresh".to_owned()),
            initializer: Some("misc_system_init_01".to_owned()),
            spawn_weight: Some(3.0),
            spawn_script: None,
        })
        .expect("add a system");

    let system = addr(EntityKind::System, 4242);
    let view = get_entity(&session.doc, system, &[]).expect("read the new system");
    assert!(view.dirty);
    assert!(view.nodes.iter().all(|n| n.changed), "{:?}", view.nodes);
    // An inserted statement stands at one offset, holding none of the original bytes.
    assert_eq!(view.span[0], view.span[1]);

    let source = get_entity_source(&session.doc, system).expect("read source");
    assert!(source.text.contains("id = \"4242\""), "{}", source.text);
    assert_eq!(source.changed, [[0, source.text.len()]]);
}

#[test]
fn only_a_scenarios_systems_are_addressable_and_the_save_path_is_unchanged() {
    let session = scenario();
    for kind in EntityKind::ALL
        .into_iter()
        .filter(|k| *k != EntityKind::System)
    {
        let err = get_entity(&session.doc, addr(kind, 1), &[]).unwrap_err();
        assert!(matches!(err, EntityError::NotFound(_)), "{kind}: {err}");
    }
    let err = get_entity(&session.doc, addr(EntityKind::System, 999_999), &[]).unwrap_err();
    assert!(matches!(err, EntityError::NotFound(_)), "{err}");

    let doc = common::load();
    let view = get_entity(&doc, addr(EntityKind::System, 217), &[]).expect("a save's system");
    assert!(
        view.nodes
            .iter()
            .any(|n| n.key.as_deref() == Some("coordinate"))
    );
}

/// A section that will not scan fails its own lookups and nobody else's: with a scalar
/// `starbase_mgr` shadowing the real one, the planets still read.
#[test]
fn a_section_that_will_not_scan_fails_only_its_own_entities() {
    let mut gamestate = common::gamestate();
    gamestate.splice(0..0, *b"starbase_mgr=0\n");
    let doc = Document::from_bytes(gamestate, Vec::new()).expect("index the edited gamestate");

    let earth = get_entity(&doc, addr(EntityKind::Planet, 3), &[]).expect("Earth");
    assert_eq!(earth.addr, addr(EntityKind::Planet, 3));

    let err = get_entity(&doc, addr(EntityKind::Starbase, 0), &[]).expect_err("the shadowed one");
    assert!(err.to_string().contains("starbase_mgr"), "{err}");
}
