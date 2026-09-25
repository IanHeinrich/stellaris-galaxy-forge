//! The pool of unused black hole names on the 4.5 sample: a new system named from it takes
//! the name out, a removal gives it back, a rename puts the old name back in the pool it
//! came from and takes the new one out of whichever pool holds it, and undo is
//! byte-exact. The diff of each forward edit is snapshotted.

use sgf_core::ops::{Op, SystemSpec, free_star_names};
use sgf_core::session::Session;

use crate::common;
use common::diff::{report, round_trip_step, step_report};
use common::spec::{body, mura, star};
use common::{current, open_4_5, pooled};

const UNPOOLED: &str = "Sgf_Renamed";
/// The id a new system takes on the 4.5 sample, and where a second one fits.
const ADDED: u32 = 601;
const TWIN_AT: (f64, f64) = (-270.0, -130.0);

/// A lone black hole where the spike's system stands, linked to the player's home.
fn black_hole(name: &str) -> SystemSpec {
    SystemSpec {
        name: name.to_owned(),
        star_class: "sc_black_hole".to_owned(),
        initializer: "special_init_01".to_owned(),
        star: star(body("pc_black_hole", 30, 0.0, 0.0, 0)),
        planets: Vec::new(),
        ..mura()
    }
}

fn add(spec: SystemSpec) -> Op {
    Op::AddSaveSystem { spec }
}

fn rename(system: u32, name: &str) -> Op {
    Op::RenameSaveSystem {
        system,
        name: name.to_owned(),
    }
}

fn black_holes(session: &Session, name: &str) -> usize {
    pooled(session, "black_hole_names", name)
}

fn stars(session: &Session, name: &str) -> usize {
    pooled(session, "star_names", name)
}

/// The names left in the black hole pool.
fn holes_free(session: &Session) -> Vec<String> {
    common::pool_names(session, "black_hole_names")
}

/// Two names the black hole pool holds.
fn two_free(session: &Session) -> (String, String) {
    let free = holes_free(session);
    (free[0].clone(), free[1].clone())
}

#[test]
fn a_new_system_takes_its_name_from_the_black_hole_pool_and_a_removal_gives_it_back() {
    let mut session = open_4_5();
    let (name, _) = two_free(&session);
    let holes = holes_free(&session);
    let star_names = free_star_names(&session.doc);
    assert!(!star_names.contains(&name));

    round_trip_step(&mut session, "add", add(black_hole(&name)));
    assert_eq!(black_holes(&session, &name), 0);
    let left = holes_free(&session);
    assert_eq!(left.len(), holes.len() - 1);
    assert!(!left.contains(&name));
    assert_eq!(free_star_names(&session.doc), star_names);

    let mut twin = black_hole(&name);
    (twin.x, twin.y) = TWIN_AT;
    round_trip_step(&mut session, "add a namesake", add(twin));
    assert_eq!(holes_free(&session), left, "the pool held it once");

    round_trip_step(&mut session, "remove one", Op::RemoveSystem { id: ADDED });
    assert_eq!(
        black_holes(&session, &name),
        0,
        "the namesake still holds it"
    );

    round_trip_step(
        &mut session,
        "remove the other",
        Op::RemoveSystem { id: ADDED },
    );
    assert_eq!(black_holes(&session, &name), 1);
    assert_eq!(holes_free(&session), holes);
    assert_eq!(current(&session), session.doc.original());
}

#[test]
fn a_rename_puts_the_old_name_back_in_its_pool_and_takes_the_new_one_from_its_own() {
    let mut session = open_4_5();
    let (first, second) = two_free(&session);
    let star = free_star_names(&session.doc)[0].clone();
    let holes = holes_free(&session);
    let star_names = free_star_names(&session.doc);
    session.apply(add(black_hole(&first))).expect("add");

    let result = round_trip_step(&mut session, "rename", rename(ADDED, &second));
    assert_eq!(result.inverse, rename(ADDED, &first));
    assert_eq!(black_holes(&session, &first), 1);
    assert_eq!(black_holes(&session, &second), 0);

    round_trip_step(&mut session, "rename to a star name", rename(ADDED, &star));
    assert_eq!(black_holes(&session, &second), 1);
    assert_eq!(stars(&session, &star), 0);
    assert_eq!(holes_free(&session), holes);

    round_trip_step(
        &mut session,
        "rename off the pools",
        rename(ADDED, UNPOOLED),
    );
    assert_eq!(stars(&session, &star), 1);
    assert_eq!(holes_free(&session), holes);
    assert_eq!(free_star_names(&session.doc), star_names);

    round_trip_step(&mut session, "rename back", rename(ADDED, &first));
    assert_eq!(black_holes(&session, &first), 0);
    session
        .apply(Op::RemoveSystem { id: ADDED })
        .expect("remove the system");
    assert_eq!(current(&session), session.doc.original());
}

#[test]
fn a_system_named_from_the_star_pool_can_take_a_black_hole_name() {
    let mut session = open_4_5();
    let (name, _) = two_free(&session);
    let spike = mura();
    session.apply(add(spike.clone())).expect("add");
    assert_eq!(stars(&session, &spike.name), 0);

    round_trip_step(&mut session, "rename", rename(ADDED, &name));
    assert_eq!(stars(&session, &spike.name), 1);
    assert_eq!(black_holes(&session, &name), 0);

    round_trip_step(&mut session, "remove", Op::RemoveSystem { id: ADDED });
    assert_eq!(black_holes(&session, &name), 1);
    assert_eq!(current(&session), session.doc.original());
}

#[test]
fn the_diffs_a_black_hole_name_writes() {
    let mut session = open_4_5();
    let (first, second) = two_free(&session);
    let added = session.apply(add(black_hole(&first))).expect("add");
    common::snapshot("add_black_hole_pooled", &report(&session, &added));
    common::snapshot(
        "rename_black_hole_pooled",
        &step_report(&mut session, rename(ADDED, &second)),
    );
    common::snapshot(
        "remove_black_hole_pooled",
        &step_report(&mut session, Op::RemoveSystem { id: ADDED }),
    );
}
