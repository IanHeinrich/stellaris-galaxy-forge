//! Special systems whose script spawns megastructures, on the real install: which layouts the
//! Special menu offers for them and which stay refused, each one added to the 4.5 sample with
//! its rows on the bodies the add gave their ids, and none of them without extras.

use crate::common;

use std::collections::BTreeSet;

use sgf_core::ops::{NewMegastructurePlace, Op};
use sgf_core::session::Session;
use sgf_gamedata::generate::special_op;
use sgf_gamedata::layouts::{Eligibility, Unsupported};
use sgf_gamedata::menu::special_layouts;

use common::layouts::of;
use common::{INSTALL, SPOT, open_4_5};

/// The layouts whose spawned megastructures an add writes, and the rows each leaves: one row
/// on a body, or a ring world's four.
const ADDABLE: [(&str, &[&str]); 9] = [
    ("dyson_sphere_init_01", &["dyson_sphere_ruined"]),
    ("science_nexus_init_01", &["think_tank_ruined"]),
    ("sentry_array_init_01", &["spy_orb_ruined"]),
    ("mega_shipyard_init_01", &["mega_shipyard_ruined"]),
    ("quantum_catapult_init_01", &["quantum_catapult_ruined"]),
    (
        "megacorp_matter_decompressor_init_01",
        &["matter_decompressor_ruined"],
    ),
    (
        "megacorp_strategic_coordination_center_init_01",
        &["strategic_coordination_center_ruined"],
    ),
    ("ring_world_init_01", &["ring_world_ruined"; 4]),
    ("cybrex_system", &["ring_world_ruined"; 4]),
];

/// The layouts with megastructures that stay refused, and why.
fn refused() -> Vec<(&'static str, Unsupported)> {
    vec![
        (
            "ruined_arc_furnace_system",
            Unsupported::Effect("set_planet_entity".to_owned()),
        ),
        ("orbital_ring_init_01", Unsupported::MultiStar),
        (
            "megacorp_mega_art_installation_init_01",
            Unsupported::MultiStar,
        ),
        (
            "megacorp_interstellar_assembly_init_01",
            Unsupported::Body("ideal_planet_class".to_owned()),
        ),
        ("unique_system_initializer_01", Unsupported::PreFtl),
        ("yuhtaan_system", Unsupported::Usage),
        ("sanctuary_system", Unsupported::PreFtl),
        ("cybrex_beta", Unsupported::Usage),
        ("hostile_init_14", Unsupported::Linked),
    ]
}

fn kinds(op: &Op) -> Vec<&'static str> {
    match op {
        Op::Batch { ops, .. } => ops.iter().map(Op::name).collect(),
        other => vec![other.name()],
    }
}

#[test]
fn megastructure_layouts_are_offered_or_refused_with_the_reason() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let session = open_4_5();
    let menu: BTreeSet<String> = special_layouts(gd, &session)
        .into_iter()
        .map(|entry| entry.key)
        .collect();
    for (key, _) in ADDABLE {
        assert_eq!(of(gd, key), Eligibility::Special, "{key}");
        assert!(menu.contains(key), "{key} is offered");
    }
    for (key, why) in refused() {
        assert_eq!(of(gd, key), Eligibility::Unsupported(why), "{key}");
        assert!(!menu.contains(key), "{key} is not offered");
    }
}

/// Each layout goes in as one batch whose rows are those its script spawns, every row tied to
/// a body standing on a body of the new system, and undo puts the save back byte for byte.
#[test]
fn each_megastructure_layout_writes_its_rows_and_undoes() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let mut session = open_4_5();
    let original = current(&session);
    for (key, rows) in ADDABLE {
        let op = special_op(gd, &session, 1, SPOT, key, true).expect(key);
        let tied: Vec<bool> = match &op {
            Op::Batch { ops, .. } => ops
                .iter()
                .filter_map(|op| match op {
                    Op::AddMegastructure { spec, .. } => {
                        Some(!matches!(spec.at, NewMegastructurePlace::Free { .. }))
                    }
                    _ => None,
                })
                .collect(),
            other => panic!("{key}: a batch, not {}", other.name()),
        };
        session.apply(op).unwrap_or_else(|e| panic!("{key}: {e}"));
        let system = *session.graph().systems.keys().max().expect("a system");
        let details = session.details().expect("details");
        let written = details.raw(system).expect("the new system");
        let mut written_kinds: Vec<&str> = written
            .megastructures
            .iter()
            .map(|row| row.kind.as_str())
            .collect();
        written_kinds.sort_unstable();
        assert_eq!(written_kinds, rows, "{key}");
        let bodies: BTreeSet<u32> = written.planets.iter().map(|p| p.id).collect();
        let on_bodies: Vec<bool> = written
            .megastructures
            .iter()
            .filter(|row| row.kind != "ring_world_ruined")
            .map(|row| row.planet.is_some_and(|id| bodies.contains(&id)))
            .collect();
        assert_eq!(on_bodies, tied, "{key}: each tied row names a new body");
        session.undo().expect("undo").expect("the add");
        assert_eq!(current(&session), original, "{key}: undo");
    }
}

#[test]
fn without_extras_no_megastructure_is_written() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let session = open_4_5();
    for (key, _) in ADDABLE {
        let op = special_op(gd, &session, 1, SPOT, key, false).expect(key);
        assert_eq!(kinds(&op), ["AddSystemFromSpec"], "{key}");
    }
}

fn current(session: &Session) -> Vec<u8> {
    session.doc().pieces().collect::<Vec<_>>().concat()
}
