//! A save system's height above the galactic plane: rewritten in place on the 4.5 sample,
//! added to the 3.4 sample's coordinates, which write none, and refused for a scenario.

use sgf_core::ops::{Op, OpError, SystemHeight};
use sgf_core::views::Capabilities;

use crate::common;
use common::diff::snapshot_step;
use common::fixture::PAINTED;
use common::{Refused, current, open, open_3_4, open_4_5, spec};

fn heights(entries: &[(u32, Option<f64>)]) -> Op {
    Op::SetSystemHeights {
        heights: entries
            .iter()
            .map(|&(id, height)| SystemHeight { system: id, height })
            .collect(),
    }
}

/// Dristmak (0) and Meissa (408) stand at the generator's 3.65056, and 593 at the 5.11847
/// a script gave it. A height of 0 is written as 0.00001, which the game keeps.
#[test]
fn heights_are_rewritten_in_place_and_zero_is_written_as_the_least_height() {
    let mut session = open_4_5();
    assert_eq!(session.graph.systems[&0].height, Some(3.65056));
    assert_eq!(session.graph.systems[&593].height, Some(5.11847));

    let op = heights(&[(0, Some(12.5)), (408, Some(0.0)), (593, Some(-2.25))]);
    let applied = snapshot_step(&mut session, "set_system_heights_4_5", op);
    assert_eq!(applied.entry.description, "Set the height of 3 systems");
    assert_eq!(
        applied.inverse,
        heights(&[
            (0, Some(3.65056)),
            (408, Some(3.65056)),
            (593, Some(5.11847))
        ])
    );
    assert_eq!(session.graph.systems[&0].height, Some(12.5));
    assert_eq!(session.graph.systems[&408].height, Some(0.00001));
    assert_eq!(session.graph.systems[&593].height, Some(-2.25));
}

#[test]
fn one_system_is_described_by_name_with_the_height_it_had() {
    let mut session = open_4_5();
    let name = session.graph.systems[&0].display_name();
    let applied = session
        .apply(heights(&[(0, Some(0.000004))]))
        .expect("set the height");
    assert_eq!(
        applied.entry.description,
        format!("Set the height of {name} (#0) from 3.65056 to 0.00001")
    );
}

/// A 3.4 save writes no `visual_height` in a system's coordinate: the op adds it as the
/// block's last key, and its inverse takes it out again.
#[test]
fn a_3_4_system_gets_the_height_it_lacked_and_the_inverse_takes_it_out() {
    let mut session = open_3_4();
    assert_eq!(session.graph.systems[&0].height, None);
    assert_eq!(session.graph.systems[&1].height, None);

    let op = heights(&[(0, Some(7.5)), (1, Some(-3.0))]);
    let applied = snapshot_step(&mut session, "set_system_heights_3_4", op);
    assert_eq!(applied.inverse, heights(&[(0, None), (1, None)]));
    assert_eq!(session.graph.systems[&0].height, Some(7.5));
    assert_eq!(session.graph.systems[&1].height, Some(-3.0));

    let name = session.graph.systems[&0].display_name();
    let undone = session.apply(applied.inverse).expect("apply the inverse");
    assert_eq!(undone.entry.description, "Set the height of 2 systems");
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(session.graph.systems[&0].height, None);

    let added = session
        .apply(heights(&[(0, Some(1.0))]))
        .expect("add a height");
    assert_eq!(
        added.entry.description,
        format!("Set the height of {name} (#0) to 1")
    );
    let cleared = session.apply(added.inverse).expect("take it out");
    assert_eq!(
        cleared.entry.description,
        format!("Cleared the height of {name} (#0)")
    );
    assert_eq!(current(&session), session.doc.original());
}

/// Dorellion, added as 791, comes back from a spec, which the game writes at 4.31213: the
/// removal's inverse puts back the height it was given.
#[test]
fn removing_an_added_system_inverts_to_the_height_it_was_given() {
    let mut session = open();
    session
        .apply(Op::AddSystemFromSpec {
            spec: spec::dorellion(),
        })
        .expect("add Dorellion");
    session
        .apply(heights(&[(791, Some(20.0))]))
        .expect("set its height");
    let removed = session
        .apply(Op::RemoveSystem { system: 791 })
        .expect("remove it");
    session.apply(removed.inverse).expect("add it back");
    assert_eq!(session.graph.systems[&791].height, Some(20.0));
}

#[test]
fn an_empty_list_a_repeated_or_unknown_system_and_a_height_that_is_no_number_are_refused() {
    let cases: [Refused<Op>; 5] = [
        (heights(&[]), |e| matches!(e, OpError::NoEntries)),
        (heights(&[(0, Some(1.0)), (0, Some(2.0))]), |e| {
            matches!(e, OpError::DuplicateSystem(0))
        }),
        (heights(&[(0, Some(1.0)), (99_999, Some(1.0))]), |e| {
            matches!(e, OpError::UnknownSystem(99_999))
        }),
        (heights(&[(0, Some(f64::NAN))]), |e| {
            matches!(e, OpError::NotFinite)
        }),
        (heights(&[(0, Some(f64::INFINITY))]), |e| {
            matches!(e, OpError::NotFinite)
        }),
    ];
    for (op, refusal) in cases {
        let mut session = open_4_5();
        let error = session.apply(op.clone()).expect_err("refused");
        assert!(refusal(&error), "{op:?}: {error:?}");
        assert!(!session.is_dirty(), "{op:?}");
    }
}

#[test]
fn a_save_of_any_version_takes_heights_and_a_scenario_does_not() {
    assert!(Capabilities::of(&open_4_5().doc).system_heights);
    assert!(Capabilities::of(&open_3_4().doc).system_heights);
    let mut scenario = PAINTED.open();
    assert!(!Capabilities::of(&scenario.doc).system_heights);
    assert!(scenario.graph.systems.values().all(|s| s.height.is_none()));
    let error = scenario
        .apply(heights(&[(0, Some(1.0))]))
        .expect_err("a scenario");
    assert!(matches!(error, OpError::Unsupported { .. }), "{error:?}");
}
