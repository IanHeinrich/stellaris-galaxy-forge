//! Entity views on the real sample save: one level per kind, a drill, and what a
//! missing entity or section reads as.

use std::fmt::Write as _;

use sgf_core::document::Document;
use sgf_core::entity::views::{EntityAddr, EntityKind, EntityView, NodeValue};
use sgf_core::entity::{EntityError, FieldType, get_entity, get_entity_schema, get_entity_source};

use crate::common;

/// One entity of each kind the address table names, chosen for a readable snapshot.
const SAMPLES: [(EntityKind, u32); 12] = [
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
    (EntityKind::Wormhole, 1),
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

/// The game writes some systems' radii with a fractional part.
#[test]
fn a_system_with_fractional_radii_keeps_them() {
    let doc = common::load();
    let view = get_entity(&doc, addr(EntityKind::System, 33), &[]).expect("Baxom");
    let fact = |label: &str| {
        view.overview
            .iter()
            .find(|f| f.label == label)
            .unwrap_or_else(|| panic!("no {label} row"))
            .clone()
    };
    assert_eq!(fact("Inner radius").value, "299.11");
    assert_eq!(fact("Outer radius").value, "399.11");
    common::snapshot("system_33", &report(&view));
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

/// A natural wormhole reads its bypass's type and the system at the other end beside its own
/// position; a shroud tunnel reads as its kind, with no other end. On the 4.5 sample, wormhole
/// 1 stands in Ferragon (489) linked to Aulderaan (152), and shroud tunnel 0 in system 24.
#[test]
fn a_wormhole_reads_its_kind_system_partner_and_position() {
    let doc = common::load_4_5();
    let rows = |id: u32| {
        let view = get_entity(&doc, addr(EntityKind::Wormhole, id), &[]).expect("read wormhole");
        view.overview
            .iter()
            .map(|f| (f.label.clone(), f.value.clone(), f.link))
            .collect::<Vec<_>>()
    };
    let row = |label: &str, value: &str, link: Option<EntityAddr>| {
        (label.to_owned(), value.to_owned(), link)
    };
    assert_eq!(
        rows(1),
        [
            row("Type", "wormhole", None),
            row("System", "489", Some(addr(EntityKind::System, 489))),
            row("Linked to", "152", Some(addr(EntityKind::System, 152))),
            row("Distance", "459.55", None),
            row("Angle", "89.48°", None),
            row("Bypass", "9", None),
        ]
    );
    assert_eq!(
        rows(0),
        [
            row("Type", "shroud_tunnel", None),
            row("System", "24", Some(addr(EntityKind::System, 24))),
            row("Distance", "190.86", None),
            row("Angle", "179.93°", None),
            row("Bypass", "1", None),
        ]
    );

    let source = get_entity_source(&doc, addr(EntityKind::Wormhole, 1)).expect("read source");
    assert!(source.text.starts_with("1="), "{}", source.text);
    assert!(source.text.contains("bypass=9"), "{}", source.text);

    let err = get_entity(&doc, addr(EntityKind::Wormhole, 999_999), &[]).unwrap_err();
    assert!(matches!(err, EntityError::NotFound(_)), "{err}");
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

/// The Data tab opens a reference as the schema's kind at the id the node holds. Nekkar
/// VIII's station is fleet 498, its mining station; ship 498 is a Tiyanki elsewhere.
#[test]
fn a_planets_orbital_station_opens_the_station_fleet() {
    let doc = common::load();
    let schema = get_entity_schema(EntityKind::Planet);
    let field = schema
        .fields
        .iter()
        .find(|f| f.key == "shipclass_orbital_station")
        .expect("the station is in the schema");
    let planet = get_entity(&doc, addr(EntityKind::Planet, 744), &[]).expect("Nekkar VIII");
    let id = planet
        .nodes
        .iter()
        .find_map(|n| match (&n.key, &n.value) {
            (Some(key), NodeValue::Scalar { text, .. }) if key == "shipclass_orbital_station" => {
                text.parse::<u32>().ok()
            }
            _ => None,
        })
        .expect("Nekkar VIII has a station");
    let kind = field.reference.expect("the station is a reference");
    let station = get_entity(&doc, addr(kind, id), &[]).expect("the station");
    assert_eq!(station.addr, addr(EntityKind::Fleet, 498));
    assert_eq!(station.label, "shipclass_mining_station_name");
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

/// A section that will not scan fails its own lookups and nobody else's: with a scalar
/// `starbase_mgr` shadowing the real one, the planets still read.
#[test]
fn a_section_that_will_not_scan_fails_only_its_own_entities() {
    let mut gamestate = common::load().original().to_vec();
    gamestate.splice(0..0, *b"starbase_mgr=0\n");
    let doc = Document::from_bytes(gamestate, Vec::new()).expect("index the edited gamestate");

    let earth = get_entity(&doc, addr(EntityKind::Planet, 3), &[]).expect("Earth");
    assert_eq!(earth.addr, addr(EntityKind::Planet, 3));

    let err = get_entity(&doc, addr(EntityKind::Starbase, 0), &[]).expect_err("the shadowed one");
    assert!(err.to_string().contains("starbase_mgr"), "{err}");
}
