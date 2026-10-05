//! A nebula added to or removed from the 4.4 sample: an added nebula takes the systems it
//! covers from their clouds, a removed one releases every member, and the two undo each
//! other byte for byte.

use sgf_core::ops::Op;
use sgf_core::validate::IssueCode;

use crate::common;
use common::diff::section_report;
use common::{NEW_NEBULA, current, open, reprojected};

#[test]
fn add_nebula_takes_the_systems_it_covers_from_their_clouds() {
    let mut session = open();
    let (x, y, radius) = NEW_NEBULA;
    assert_eq!(session.graph().systems[&134].nebula, Some(6));
    let result = session
        .apply(Op::AddNebula {
            x,
            y,
            radius,
            name: Some("SGF_Test_Nebula".to_owned()),
        })
        .unwrap();

    assert_eq!(session.graph().nebulae.len(), 10);
    let added = &session.graph().nebulae[9];
    assert_eq!((added.x, added.y, added.radius), (x, y, radius));
    assert_eq!(added.systems, [113, 134, 600, 688]);
    assert_eq!(session.graph().systems[&134].nebula, Some(9));
    assert!(!session.graph().nebulae[6].systems.contains(&134));
    assert!(
        result
            .issues
            .iter()
            .all(|i| i.code != IssueCode::NebulaMembership),
        "{:?}",
        result.issues
    );
    common::snapshot("add_nebula", &section_report(&session, &result, "nebula"));
}

#[test]
fn adding_a_nebula_and_removing_it_again_is_byte_identical() {
    let mut session = open();
    let (x, y, radius) = NEW_NEBULA;
    session
        .apply(Op::AddNebula {
            x,
            y,
            radius,
            name: Some("SGF_Test_Nebula".to_owned()),
        })
        .unwrap();
    let removed = session.apply(Op::RemoveNebula { index: 9 }).unwrap();

    assert_eq!(current(&session), session.doc().original());
    assert_eq!(session.graph().nebulae.len(), 9);
    assert_eq!(
        session.graph().systems[&134].nebula,
        Some(6),
        "134 goes back to the cloud the new one took it from"
    );
    assert!(
        removed.entry.description.contains("1 joined Demons Eye"),
        "{}",
        removed.entry.description
    );
}

#[test]
fn a_nebula_edited_earlier_can_still_be_removed() {
    let mut session = open();
    session
        .apply(Op::SetNebulaRadius {
            index: 0,
            radius: 45.0,
        })
        .expect("resize");
    let resized = current(&session);
    session
        .apply(Op::RemoveNebula { index: 0 })
        .expect("remove a nebula an earlier op rewrote");
    let edited = current(&session);

    assert_eq!(session.graph().nebulae.len(), 8);
    assert_eq!(session.graph().nebulae[0].name.key, "Jimorban_Dust_Clouds");
    let fresh = reprojected(&session);
    assert_eq!(session.graph().systems, fresh.systems);
    assert_eq!(session.graph().nebulae, fresh.nebulae);

    session.undo().unwrap().expect("undo the removal");
    assert_eq!(current(&session), resized);
    session.undo().unwrap().expect("undo the resize");
    assert_eq!(current(&session), session.doc().original());
    session.redo().unwrap().expect("redo the resize");
    session.redo().unwrap().expect("redo the removal");
    assert_eq!(current(&session), edited);
}

#[test]
fn remove_nebula_0_releases_every_member() {
    let mut session = open();
    let before = session.graph().nebulae[0].clone();
    let result = session.apply(Op::RemoveNebula { index: 0 }).unwrap();

    assert_eq!(session.graph().nebulae.len(), 8);
    assert_eq!(session.graph().nebulae[0].name.key, "Jimorban_Dust_Clouds");
    for &id in &before.systems {
        assert_eq!(session.graph().systems[&id].nebula, None, "system {id}");
    }
    let Op::Batch { ops, .. } = &result.inverse else {
        panic!("{:?}", result.inverse);
    };
    assert_eq!(
        ops[0],
        Op::AddNebula {
            x: before.x,
            y: before.y,
            radius: before.radius,
            name: Some("Phantom_Streak_Miasma".to_owned()),
        }
    );
    common::snapshot(
        "remove_nebula_0",
        &section_report(&session, &result, "nebula"),
    );
}
