//! The details of a save system whose bodies, belts or inner radius an op rewrote, reread in
//! place: after apply, undo and redo they equal the details a fresh build reads.

use sgf_core::format::save::details::DetailsProjection;
use sgf_core::ops::{DetailsReach, Op};
use sgf_core::session::Session;

use crate::common::examples::one_of_each;
use crate::common::open_4_5;

/// Warm the details, then apply `op` (which must touch only `system`), undo it and redo
/// it. After each step the projection is still built, system 26's details stand as they
/// were (unless `system` is 26 itself), and `system`'s equal what a fresh build reads from
/// the bytes.
fn refreshed_in_place(op: Op, system: u32) -> Session {
    let mut session = open_4_5();
    session.warm_details().expect("build details");
    let other = session
        .details()
        .unwrap()
        .raw(26)
        .cloned()
        .expect("system 26's details");
    let check = |session: &Session, step: &str| {
        let details = session
            .built_details()
            .unwrap_or_else(|| panic!("{step} dropped the details"));
        if system != 26 {
            assert_eq!(details.raw(26), Some(&other), "{step}: system 26");
        }
        let fresh = DetailsProjection::build(&session.doc, &session.graph).expect("a fresh build");
        assert_eq!(
            details.raw(system),
            fresh.raw(system),
            "{step}: system {system}"
        );
    };

    let applied = session.apply(op).expect("apply");
    assert_eq!(applied.details_stale, [system]);
    check(&session, "the apply");
    let undone = session.undo().expect("undo").expect("something to undo");
    assert_eq!(undone.details_stale, [system]);
    check(&session, "the undo");
    session.redo().expect("redo").expect("something to redo");
    check(&session, "the redo");
    session
}

#[test]
fn a_move_that_grows_the_inner_radius_is_read_in_place() {
    let session = refreshed_in_place(
        Op::MoveSaveBody {
            system: 1,
            body: 585,
            radius: 180.0,
            angle: 40.0,
        },
        1,
    );
    let details = session.built_details().expect("the details kept");
    assert_eq!(details.raw(1).unwrap().inner_radius, Some(225.0));
}

#[test]
fn a_planet_made_a_moon_is_read_in_place() {
    refreshed_in_place(
        Op::SetSaveBodyParent {
            system: 1,
            body: 588,
            parent: Some(589),
            star: false,
            radius: 20.0,
            angle: 90.0,
        },
        1,
    );
}

#[test]
fn a_moon_made_a_planet_is_read_in_place() {
    refreshed_in_place(
        Op::SetSaveBodyParent {
            system: 1,
            body: 590,
            parent: None,
            star: false,
            radius: 100.0,
            angle: 200.0,
        },
        1,
    );
}

#[test]
fn a_belt_added_is_read_in_place() {
    refreshed_in_place(
        Op::AddSaveBelt {
            system: 140,
            kind: "rocky_asteroid_belt".to_owned(),
            radius: 150.0,
        },
        140,
    );
}

#[test]
fn a_belt_removed_is_read_in_place() {
    refreshed_in_place(
        Op::RemoveSaveBelt {
            system: 140,
            index: 0,
        },
        140,
    );
}

#[test]
fn a_belts_radius_set_is_read_in_place() {
    refreshed_in_place(
        Op::SetSaveBeltRadius {
            system: 140,
            index: 0,
            radius: 55.0,
        },
        140,
    );
}

#[test]
fn a_belts_kind_set_is_read_in_place() {
    refreshed_in_place(
        Op::SetSaveBeltKind {
            system: 140,
            index: 0,
            kind: "icy_asteroid_belt".to_owned(),
        },
        140,
    );
}

#[test]
fn the_inner_radius_set_is_read_in_place() {
    refreshed_in_place(
        Op::SetSaveInnerRadius {
            system: 1,
            radius: 200.0,
        },
        1,
    );
}

/// Every op that rereads the details in place, applied, undone and redone, leaves each
/// system it names stale as a fresh build reads it.
#[test]
fn every_op_read_in_place_matches_a_fresh_build() {
    for example in one_of_each() {
        let Some(op) = example.save.clone() else {
            continue;
        };
        if op.reach().details != DetailsReach::InPlace {
            continue;
        }
        let name = op.name();
        let mut session = (example.open_save)();
        session.warm_details().expect("build details");
        let applied = session.apply(op).expect("apply");
        assert!(!applied.details_stale.is_empty(), "{name} names no system");
        matches_a_fresh_build(&session, &applied.details_stale, name, "apply");
        let undone = session.undo().expect("undo").expect("something to undo");
        matches_a_fresh_build(&session, &undone.details_stale, name, "undo");
        let redone = session.redo().expect("redo").expect("something to redo");
        matches_a_fresh_build(&session, &redone.details_stale, name, "redo");
    }
}

fn matches_a_fresh_build(session: &Session, systems: &[u32], name: &str, step: &str) {
    let details = session
        .built_details()
        .unwrap_or_else(|| panic!("{name}: the {step} dropped the details"));
    let fresh = DetailsProjection::build(&session.doc, &session.graph).expect("a fresh build");
    for &system in systems {
        assert_eq!(
            details.raw(system),
            fresh.raw(system),
            "{name}: the {step}, system {system}"
        );
    }
}
