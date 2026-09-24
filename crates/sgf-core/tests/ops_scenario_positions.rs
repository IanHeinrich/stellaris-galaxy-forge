//! Systems and nebulae moved on the grammar fixture: the diff each op produces is
//! snapshotted, and the membership a nebula edit rewrites is checked against the map.

use sgf_core::ops::{Op, SystemMove};
use sgf_core::session::OpResult;

use crate::common;
use common::current;
use common::diff::{report, round_trip, snapshot};
use common::fixture::GRAMMAR;

#[test]
fn move_system_2_writes_decimals_over_an_integer_position() {
    snapshot(
        "move_system_2",
        GRAMMAR.open(),
        Op::MoveSystem {
            id: 2,
            x: 12.5,
            y: -60.25,
        },
    );
}

#[test]
fn move_system_111_fixes_a_range_axis_to_a_point() {
    snapshot(
        "move_system_111",
        GRAMMAR.open(),
        Op::MoveSystem {
            id: 111,
            x: 30.0,
            y: 20.0,
        },
    );
}

#[test]
fn move_systems_moves_several_at_once() {
    snapshot(
        "move_systems_2_and_16",
        GRAMMAR.open(),
        Op::MoveSystems {
            moves: vec![
                SystemMove {
                    id: 2,
                    x: 1.0,
                    y: -50.0,
                },
                SystemMove {
                    id: 16,
                    x: -50.0,
                    y: -80.0,
                },
            ],
        },
    );
}

#[test]
fn move_nebula_1_moves_the_centre_only() {
    snapshot(
        "move_nebula_1",
        GRAMMAR.open(),
        Op::MoveNebula {
            index: 1,
            x: -54.0,
            y: -88.5,
        },
    );
}

#[test]
fn add_nebula_takes_coruscant_from_the_heart_of_the_galaxy() {
    let mut session = GRAMMAR.open();
    assert_eq!(session.graph.systems[&2].nebula, Some(0));
    let result = session
        .apply(Op::AddNebula {
            x: 0.0,
            y: -56.0,
            radius: 20.0,
            name: Some("Test Cloud".to_owned()),
        })
        .expect("add");
    assert_eq!(session.graph.nebulae.len(), 3);
    assert_eq!(session.graph.nebulae[2].systems, [2]);
    assert_eq!(session.graph.nebulae[0].systems, [1, 111]);
    assert_eq!(session.graph.systems[&2].nebula, Some(2));
    common::snapshot("add_nebula", &report(&session, &result));
}

#[test]
fn remove_nebula_1_releases_the_lonely_system() {
    let mut session = GRAMMAR.open();
    let result = session
        .apply(Op::RemoveNebula { index: 1 })
        .expect("remove");
    assert_eq!(session.graph.nebulae.len(), 1);
    assert_eq!(session.graph.systems[&9].nebula, None);
    assert_eq!(
        result.inverse,
        Op::AddNebula {
            x: -90.0,
            y: 90.0,
            radius: 20.0,
            name: Some("Far Cloud".to_owned()),
        }
    );
    common::snapshot("remove_nebula_1", &report(&session, &result));
}

#[test]
fn shrinking_the_heart_of_the_galaxy_lets_two_systems_go() {
    let mut session = GRAMMAR.open();
    let result = session
        .apply(Op::SetNebulaRadius {
            index: 0,
            radius: 30.0,
        })
        .expect("shrink");
    assert_eq!(session.graph.nebulae[0].systems, [1]);
    assert_eq!(session.graph.systems[&2].nebula, None);
    assert_eq!(session.graph.systems[&111].nebula, None);
    common::snapshot("set_nebula_radius_0", &report(&session, &result));
}

#[test]
fn renaming_a_nebula_writes_the_literal_over_its_loc_key() {
    let mut session = GRAMMAR.open();
    assert_eq!(session.graph.nebulae[0].name.key, "NAME_N_Heart_Galaxy");
    let result = session
        .apply(Op::SetNebulaName {
            index: 0,
            name: "Heart of the Galaxy".to_owned(),
        })
        .expect("rename");

    assert_eq!(session.graph.nebulae[0].name.key, "Heart of the Galaxy");
    assert!(session.graph.nebulae[0].name.literal);
    assert_eq!(session.graph.nebulae[0].systems, [1, 2, 111]);
    common::snapshot("set_nebula_name", &report(&session, &result));
}

/// A scenario derives membership from the radii, so an op that changes a cloud's
/// geometry owes the map every system the rebuild reassigned.
#[test]
fn a_nebula_edit_reports_every_system_whose_membership_changed() {
    let systems = |result: &OpResult| {
        let mut ids: Vec<u32> = result.touched.clone();
        ids.sort_unstable();
        ids
    };

    let mut session = GRAMMAR.open();
    let moved = session
        .apply(Op::MoveNebula {
            index: 1,
            x: -54.0,
            y: -88.5,
        })
        .expect("move");
    assert_eq!(systems(&moved), [9, 16]);
    assert_eq!(session.graph.systems[&16].nebula, Some(1));
    assert_eq!(session.graph.systems[&9].nebula, None);
    assert!(
        session.edit_result(moved).delta.nebulae.is_some(),
        "the map is told the nebulae changed"
    );

    let mut session = GRAMMAR.open();
    let added = session
        .apply(Op::AddNebula {
            x: 0.0,
            y: -56.0,
            radius: 20.0,
            name: None,
        })
        .expect("add");
    assert_eq!(systems(&added), [2]);

    let mut session = GRAMMAR.open();
    let resized = session
        .apply(Op::SetNebulaRadius {
            index: 0,
            radius: 30.0,
        })
        .expect("shrink");
    assert_eq!(systems(&resized), [2, 111]);

    let removed = session
        .apply(Op::RemoveNebula { index: 1 })
        .expect("remove");
    assert_eq!(systems(&removed), [9]);
    let delta = session.edit_result(removed).delta;
    assert_eq!(
        delta.nebulae.as_deref().map(<[_]>::len),
        Some(1),
        "the map is told which nebulae are left"
    );
}

#[test]
fn the_nebula_ops_undo_and_redo_byte_for_byte() {
    let ops = [
        Op::MoveNebula {
            index: 1,
            x: -80.0,
            y: 80.0,
        },
        Op::AddNebula {
            x: 0.0,
            y: -56.0,
            radius: 20.0,
            name: Some("Test Cloud".to_owned()),
        },
        Op::RemoveNebula { index: 1 },
        Op::SetNebulaRadius {
            index: 0,
            radius: 30.0,
        },
        Op::SetNebulaName {
            index: 0,
            name: "Heart of the Galaxy".to_owned(),
        },
    ];
    for op in ops {
        round_trip(GRAMMAR.open(), op);
    }
}

#[test]
fn a_nebula_edited_earlier_can_still_be_removed() {
    let fixture = GRAMMAR.bytes();
    let mut session = GRAMMAR.open();
    session
        .apply(Op::SetNebulaRadius {
            index: 0,
            radius: 30.0,
        })
        .expect("resize");
    session
        .apply(Op::RemoveNebula { index: 0 })
        .expect("remove a nebula an earlier op rewrote");
    assert_eq!(session.graph.nebulae.len(), 1);
    assert_eq!(session.graph.nebulae[0].name.key, "Far Cloud");

    session.undo().unwrap().expect("undo the removal");
    session.undo().unwrap().expect("undo the resize");
    assert_eq!(current(&session), fixture);
}

#[test]
fn adding_a_nebula_and_removing_it_again_is_byte_identical() {
    let fixture = GRAMMAR.bytes();
    let mut session = GRAMMAR.open();
    session
        .apply(Op::AddNebula {
            x: 0.0,
            y: -56.0,
            radius: 20.0,
            name: Some("Test Cloud".to_owned()),
        })
        .expect("add");
    session
        .apply(Op::RemoveNebula { index: 2 })
        .expect("remove the nebula just added");
    assert_eq!(current(&session), fixture);
    assert_eq!(session.graph.nebulae.len(), 2);
    assert_eq!(session.graph.systems[&2].nebula, Some(0));
}
