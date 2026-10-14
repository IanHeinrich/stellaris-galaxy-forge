//! The slots a save's added entries hold, as the next add reads them: after a removal is
//! undone and redone, and after a batch rolls back, an add takes the ids the slot rules
//! give; and how long a bulk add takes as the added planets pile up.

use std::time::Instant;

use sgf_core::ops::{Op, OpError, SystemSpec};
use sgf_core::session::Session;

use crate::common;
use crate::ops_deposits::{GENERATION, page};
use crate::ops_remove_added_system::{add, remove};
use common::spec::{SAMPLE_4_5, mura, small};
use common::{current, free_spots, holds, open_4_5, planet_ids};

/// The place of the fourth system, clear of the spike's and of both spots.
const FOURTH: (f64, f64) = (-280.0, -150.0);

/// Each body of system `id`, star first, with the deposits it holds.
fn slots(session: &Session, id: u32) -> Vec<(u32, Vec<u32>)> {
    planet_ids(session, id)
        .into_iter()
        .map(|planet| {
            let deposits = page(session, planet).into_iter().map(|d| d.0).collect();
            (planet, deposits)
        })
        .collect()
}

/// The id the slot of `id` takes once a removal has freed it and an add takes it again.
fn taken_again(id: u32) -> u32 {
    match id >> 24 {
        0 => id | GENERATION,
        _ => id,
    }
}

/// Mura, then two small systems, the second of which is removed.
fn three_then_remove_the_second() -> (Session, Vec<(u32, Vec<u32>)>) {
    let sample = SAMPLE_4_5;
    let first = sample.id;
    let mut session = open_4_5();
    session.apply(add(mura())).expect("add a");
    let b = small("Sgf_B", sample.spots[0], vec![first, sample.near[0]]);
    session.apply(add(b)).expect("add b");
    let freed = slots(&session, first + 1);
    let c = small("Sgf_C", sample.spots[1], vec![first, sample.near[1]]);
    session.apply(add(c)).expect("add c");
    session.apply(remove(first + 1)).expect("remove b");
    (session, freed)
}

fn fourth() -> SystemSpec {
    small("Sgf_D", FOURTH, vec![SAMPLE_4_5.id])
}

/// A removal undone and redone leaves the slots as the removal alone left them, so the
/// next add takes the slots the removed system freed, one generation on.
#[test]
fn an_add_after_a_removal_is_undone_and_redone_takes_the_freed_slots() {
    let (mut session, freed) = three_then_remove_the_second();
    session.undo().expect("undo").expect("an edit to undo");
    session.redo().expect("redo").expect("an edit to redo");
    session.apply(add(fourth())).expect("add d");
    let d = SAMPLE_4_5.id + 2;
    let expected: Vec<(u32, Vec<u32>)> = freed
        .iter()
        .map(|(planet, deposits)| {
            let deposits = deposits.iter().copied().map(taken_again).collect();
            (taken_again(*planet), deposits)
        })
        .collect();
    assert_eq!(slots(&session, d), expected);

    let (mut straight, _) = three_then_remove_the_second();
    straight.apply(add(fourth())).expect("add d");
    assert!(
        holds(&session, &current(&straight)),
        "the undo and redo change nothing the next add writes"
    );
}

/// A batch whose third add is refused rolls back, and the next add takes the ids an add to
/// the save as opened takes.
#[test]
fn an_add_after_a_batch_rolls_back_takes_a_fresh_sessions_ids() {
    let sample = SAMPLE_4_5;
    let mut session = open_4_5();
    let (x, y) = sample.spots[0];
    let batch = Op::Batch {
        description: "Added three systems".to_owned(),
        ops: vec![
            add(mura()),
            add(small("Sgf_B", (x, y), vec![sample.id])),
            add(small("Sgf_C", (x + 5.0, y), vec![sample.id])),
        ],
    };
    let refused = session.apply(batch).expect_err("the third is too close");
    assert!(
        matches!(refused, OpError::TooClose { id, .. } if id == sample.id + 1),
        "{refused:?}"
    );
    assert!(holds(&session, session.doc().original()));

    session.apply(add(mura())).expect("add after the rollback");
    let mut fresh = open_4_5();
    fresh.apply(add(mura())).expect("add to the save as opened");
    assert!(holds(&session, &current(&fresh)));
}

/// Release-build times to apply and to undo one batch of `n` copies of the spike's system,
/// on a lattice 12 apart and linked in a ring. Run with `--release -- --ignored
/// --nocapture`.
#[test]
#[ignore = "a timing to read, not a check"]
fn bulk_add_timing() {
    println!("{:>6} {:>10} {:>10}", "n", "apply s", "undo s");
    for n in [100, 200, 300, 1000] {
        let mut session = open_4_5();
        let first = SAMPLE_4_5.id;
        let spots = free_spots(&session, n, 12.0);
        let ops = spots
            .iter()
            .enumerate()
            .map(|(i, &(x, y))| {
                let mut spec = mura();
                spec.name = format!("Sgf_Shape_{i}");
                (spec.x, spec.y) = (x, y);
                let i = i as u32;
                spec.lanes = match i {
                    0 => Vec::new(),
                    _ if i + 1 == n as u32 => vec![first + i - 1, first],
                    _ => vec![first + i - 1],
                };
                add(spec)
            })
            .collect();
        let batch = Op::Batch {
            description: format!("Added {n} systems"),
            ops,
        };
        let started = Instant::now();
        session.apply(batch).expect("apply the batch");
        let applied = started.elapsed().as_secs_f64();
        let started = Instant::now();
        session.undo().expect("undo").expect("an edit to undo");
        let undone = started.elapsed().as_secs_f64();
        println!("{n:>6} {applied:>10.2} {undone:>10.2}");
    }
}
