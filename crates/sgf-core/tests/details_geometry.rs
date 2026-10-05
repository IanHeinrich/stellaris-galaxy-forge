//! The details of a save system whose bodies, belts or inner radius an op rewrote, reread in
//! place: after apply, undo and redo they equal the details a fresh build reads.

use std::sync::Arc;

use sgf_core::format::save::details::DetailsProjection;
use sgf_core::ops::{Op, Parent};
use sgf_core::session::Session;

use crate::common::{open_4_5, warm};

/// Warm the details, then apply `op` (which must touch only `system`), undo it and redo
/// it. After each step the projection is still built, system 26's details stand as they
/// were (unless `system` is 26 itself), and `system`'s equal what a fresh build reads from
/// the bytes.
fn refreshed_in_place(op: Op, system: u32) -> Session {
    let mut session = warm(open_4_5());
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
        let fresh = DetailsProjection::build(
            session.doc(),
            session.graph(),
            Arc::clone(session.star_classes()),
        )
        .expect("a fresh build");
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
        Op::MoveBody {
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
fn a_moon_made_a_planet_is_read_in_place() {
    refreshed_in_place(
        Op::SetBodyParent {
            system: 1,
            body: 590,
            parent: Parent::Centre,
            radius: 100.0,
            angle: 200.0,
        },
        1,
    );
}

#[test]
fn a_belt_added_is_read_in_place() {
    refreshed_in_place(
        Op::AddBelt {
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
        Op::RemoveBelt {
            system: 140,
            index: 0,
        },
        140,
    );
}
