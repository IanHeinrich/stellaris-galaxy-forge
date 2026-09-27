//! A save system's asteroid belts and inner radius on the 4.5 sample: a belt added, removed,
//! and given a new radius or kind, and the inner radius set, with each edit's diff, byte-exact
//! undo, and what is refused.

use sgf_core::ops::rules::bodies::{BELT_SCATTER, drawn_radius};
use sgf_core::ops::{Op, OpError};

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::{current, open_4_5};

fn add_belt(system: u32, kind: &str, radius: f64) -> Op {
    Op::AddSaveBelt {
        system,
        kind: kind.to_owned(),
        radius,
    }
}

fn remove_belt(system: u32, index: usize) -> Op {
    Op::RemoveSaveBelt { system, index }
}

fn set_belt_radius(system: u32, index: usize, radius: f64) -> Op {
    Op::SetSaveBeltRadius {
        system,
        index,
        radius,
    }
}

fn set_belt_kind(system: u32, index: usize, kind: &str) -> Op {
    Op::SetSaveBeltKind {
        system,
        index,
        kind: kind.to_owned(),
    }
}

fn set_inner_radius(system: u32, radius: f64) -> Op {
    Op::SetSaveInnerRadius { system, radius }
}

/// System `id`'s own `galactic_object` entry, as the session's bytes now hold it.
fn system_entity(session: &sgf_core::session::Session, id: u32) -> String {
    let text = common::text(session);
    let table = text
        .find("\ngalactic_object=\n")
        .expect("the galactic_object table");
    let start = table
        + text[table..]
            .find(&format!("\n\t{id}=\n\t{{\n"))
            .unwrap_or_else(|| panic!("system {id}"));
    let end = start + 1 + text[start + 1..].find("\n\t}\n").expect("its end");
    text[start..end].to_owned()
}

/// System 1 has no belts, `discovery` or `asteroid_belts`: the block lands after
/// `hyperlane`, before `arm`, as the game writes one.
#[test]
fn a_belt_added_to_a_system_without_one() {
    let mut session = open_4_5();
    let result = snapshot_step(
        &mut session,
        "belt_added_to_system_1",
        add_belt(1, "rocky_asteroid_belt", 120.0),
    );
    assert_eq!(
        result.entry.description,
        "Added a rocky_asteroid_belt belt at radius 120 to system #1"
    );
    assert_eq!(result.inverse, remove_belt(1, 0));
}

/// System 140 already lists a rocky belt at 40 and an icy one at 90. A third joins them
/// last, then each of the three goes, the block leaving with the last.
#[test]
fn a_third_belt_added_then_every_belt_of_140_is_removed() {
    let mut session = open_4_5();
    let added = snapshot_step(
        &mut session,
        "third_belt_added_to_140",
        add_belt(140, "rocky_asteroid_belt", 150.0),
    );
    assert_eq!(added.inverse, remove_belt(140, 2));

    let removed_2 = snapshot_step(&mut session, "140_belt_2_removed", remove_belt(140, 2));
    assert_eq!(
        removed_2.entry.description,
        "Removed the belt at radius 150 from system #140"
    );
    assert_eq!(
        removed_2.inverse,
        add_belt(140, "rocky_asteroid_belt", 150.0)
    );

    snapshot_step(&mut session, "140_belt_1_removed", remove_belt(140, 1));
    snapshot_step(&mut session, "140_belt_0_removed", remove_belt(140, 0));
    assert!(
        !system_entity(&session, 140).contains("asteroid_belts"),
        "the block leaves with the last belt"
    );
}

#[test]
fn a_belts_radius_is_set() {
    let mut session = open_4_5();
    let result = snapshot_step(
        &mut session,
        "140_belt_radius_set",
        set_belt_radius(140, 0, 55.0),
    );
    assert_eq!(
        result.entry.description,
        "Moved the belt at radius 40 in system #140 to 55"
    );
    assert_eq!(result.inverse, set_belt_radius(140, 0, 40.0));
}

#[test]
fn a_belts_kind_is_set() {
    let mut session = open_4_5();
    let result = snapshot_step(
        &mut session,
        "140_belt_kind_set",
        set_belt_kind(140, 0, "icy_asteroid_belt"),
    );
    assert_eq!(
        result.entry.description,
        "Set the belt at radius 40 in system #140 from rocky_asteroid_belt to icy_asteroid_belt"
    );
    assert_eq!(result.inverse, set_belt_kind(140, 0, "rocky_asteroid_belt"));
}

#[test]
fn belt_edits_are_refused() {
    let mut session = open_4_5();
    let refusals = [
        (
            set_belt_radius(140, 0, 40.0),
            "belt 0 of system 140 is already that way",
        ),
        (
            set_belt_kind(140, 0, "rocky_asteroid_belt"),
            "belt 0 of system 140 is already that way",
        ),
        (set_belt_radius(140, 5, 60.0), "system 140 has no belt 5"),
        (remove_belt(140, 5), "system 140 has no belt 5"),
        (
            set_belt_kind(140, 0, "bad kind"),
            "\"bad kind\" cannot be written as a belt type",
        ),
        (set_belt_kind(140, 0, ""), "a belt type may not be empty"),
        (
            add_belt(1, "rocky_asteroid_belt", 0.0),
            "radius 0 is invalid: a belt's inner radius must be greater than zero",
        ),
    ];
    for (op, message) in refusals {
        let error = session.apply(op).expect_err(message);
        assert_eq!(error.to_string(), message);
    }
    assert!(!session.doc.is_dirty());
    assert!(session.history().undo.is_empty());
}

/// System 1's bodies reach 157.41 at most, so its inner radius (186.71) can shrink toward
/// that, but not past it.
#[test]
fn the_inner_radius_is_refused_below_the_bodies_reach_and_accepted_above_it() {
    let mut session = open_4_5();
    let error = session
        .apply(set_inner_radius(1, 150.0))
        .expect_err("below the reach");
    match error {
        OpError::InnerRadiusTooSmall { least } => {
            assert!((least - 157.41).abs() < 0.01, "{least}");
        }
        other => panic!("InnerRadiusTooSmall, not {other}"),
    }

    let unchanged = session
        .apply(set_inner_radius(1, 186.71))
        .expect_err("unchanged");
    assert_eq!(
        unchanged.to_string(),
        "system 1 already has that inner radius"
    );

    let result = snapshot_step(
        &mut session,
        "system_1_inner_radius_shrunk",
        set_inner_radius(1, 160.0),
    );
    assert_eq!(
        result.entry.description,
        "Set the inner radius of system #1 from 186.71 to 160"
    );
    assert_eq!(result.inverse, set_inner_radius(1, 186.71));
}

/// System 148's inner radius (155) sits below its bodies' reach only because of 6331, a
/// `pc_astral_scar` event body carrying `orbit=0` while it stands 210.8 from the star: not
/// a place a player put it, and not what the rule counts. Its real reach, from planet 1944,
/// is about 125. It can still be raised, and undo takes it back to its own value rather
/// than getting stuck on the rule.
#[test]
fn a_below_rule_systems_inner_radius_can_be_raised_and_undone() {
    round_trip(open_4_5(), set_inner_radius(148, 300.0));
}

/// The same case as an op, not just an undo: raising system 148's inner radius, then
/// applying the returned inverse as a fresh op, is accepted and puts the value back. Undo
/// replays bytes and never refuses, so only reapplying the inverse through `apply` proves
/// the floor does not trap a system 6331 already puts below the plain rule.
#[test]
fn a_below_rule_systems_inner_radius_inverse_reapplies_as_an_op() {
    let mut session = open_4_5();
    let raised = session
        .apply(set_inner_radius(148, 300.0))
        .expect("raise it");
    assert_eq!(raised.inverse, set_inner_radius(148, 155.0));
    session
        .apply(raised.inverse)
        .expect("the inverse takes it back");
    assert_eq!(current(&session), session.doc.original());
}

/// A move that grows system 148 past 6331's old, inflated reach: the batched inverse moves
/// the body home and then sets the inner radius back to 155, its own below-rule value.
/// Reapplying that batch as a fresh op (not undo) must not be refused by the reach 6331
/// leaves behind once the move is reverted.
#[test]
fn a_grown_below_rule_systems_inverse_batch_reapplies_as_an_op() {
    let mut session = open_4_5();
    let planets = common::planets(&session, 148);
    let far = planets.iter().find(|p| p.id == 1944).expect("planet 1944");
    let at = far.at.expect("a point");
    let angle = at.1.atan2(at.0).to_degrees();
    let grown = session
        .apply(Op::MoveSaveBody {
            system: 148,
            body: 1944,
            radius: 300.0,
            angle,
        })
        .expect("grow the system");
    let Op::Batch { ref ops, .. } = grown.inverse else {
        panic!("a batch, not {:?}", grown.inverse);
    };
    assert!(
        matches!(
            ops[..],
            [
                Op::MoveSaveBody { body: 1944, .. },
                Op::SetSaveInnerRadius {
                    system: 148,
                    radius: 155.0
                }
            ]
        ),
        "{ops:?}"
    );
    session
        .apply(grown.inverse)
        .expect("the batch inverse takes it back");
    let details = session.details().expect("details");
    assert_eq!(
        details.raw(148).expect("system 148").inner_radius,
        Some(155.0)
    );
}

/// System 8's belt sits at 270, with its eleven asteroids scattered within
/// [`BELT_SCATTER`] of it. Moving the belt to 280 is one `Batch` of the belt's own radius
/// and a `MoveSaveBody` per asteroid, each by the same step, its angle kept.
#[test]
fn a_belts_radius_move_takes_its_scattered_asteroids_with_it() {
    let mut session = open_4_5();
    let old_radius = 270.0;
    let step = 10.0;
    let planets = common::planets(&session, 8);
    let mut moved = Vec::new();
    let mut ops = vec![set_belt_radius(8, 0, old_radius + step)];
    for p in &planets {
        let (Some(at), Some(orbit)) = (p.at, p.orbit) else {
            continue;
        };
        if p.parent.is_some() {
            continue;
        }
        let radius = drawn_radius(at, (0.0, 0.0), Some(orbit));
        if (radius - old_radius).abs() > BELT_SCATTER {
            continue;
        }
        let angle = at.1.atan2(at.0).to_degrees();
        ops.push(Op::MoveSaveBody {
            system: 8,
            body: p.id,
            radius: radius + step,
            angle,
        });
        moved.push(p.id);
    }
    assert!(moved.len() >= 4, "{moved:?}");

    let batch = Op::Batch {
        description: "Moved the belt at radius 270 in system #8 to 280".to_owned(),
        ops,
    };
    snapshot_step(&mut session, "belt_8_and_its_asteroids_moved", batch);
    assert_eq!(session.history().undo.len(), 1, "one undo step");

    let after = common::planets(&session, 8);
    for &id in &moved {
        let p = after.iter().find(|p| p.id == id).expect("the asteroid");
        let at = p.at.expect("a point");
        let radius = drawn_radius(at, (0.0, 0.0), p.orbit);
        assert!(
            (radius - (old_radius + step)).abs() < 1.0,
            "asteroid {id}: {radius}"
        );
    }
}

#[test]
fn a_belt_round_trips() {
    round_trip(open_4_5(), add_belt(1, "rocky_asteroid_belt", 120.0));
    round_trip(open_4_5(), remove_belt(140, 0));
    round_trip(open_4_5(), set_belt_radius(140, 0, 55.0));
    round_trip(open_4_5(), set_belt_kind(140, 0, "icy_asteroid_belt"));
    round_trip(open_4_5(), set_inner_radius(1, 160.0));
}

/// System 15 has no belts, but does have a `discovery` block and an `arm`: the new block
/// lands right before `discovery`, not merely before `arm`.
#[test]
fn a_belt_added_to_a_system_with_discovery_lands_before_it() {
    let mut session = open_4_5();
    let before = system_entity(&session, 15);
    assert!(
        !before.contains("asteroid_belts")
            && before.contains("discovery=")
            && before.contains("arm="),
        "{before}"
    );
    snapshot_step(
        &mut session,
        "belt_added_before_discovery",
        add_belt(15, "rocky_asteroid_belt", 500.0),
    );
    let after = system_entity(&session, 15);
    let belts_at = after.find("\n\t\tasteroid_belts=").expect("asteroid_belts");
    let discovery_at = after.find("\n\t\tdiscovery=").expect("discovery");
    let arm_at = after.find("\n\t\tarm=").expect("arm");
    assert!(belts_at < discovery_at && discovery_at < arm_at, "{after}");
}
