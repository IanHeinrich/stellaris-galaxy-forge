//! The pool of unused nebula names on the 4.5 and the 4.4 sample: a new nebula takes its
//! name out of the pool, a removal gives it back, a rename swaps the two, undo is
//! byte-exact, and a name the pool lacks takes nothing. The diff of each forward edit is
//! snapshotted on the 4.4 sample. A scenario has no pool.

use sgf_core::ops::{Op, free_nebula_names};
use sgf_core::session::Session;

use crate::common;
use common::diff::{report, round_trip_step, step_report};
use common::fixture::EXPORTED;
use common::spec::SAMPLES;
use common::{NEW_NEBULA, current, open};

const UNPOOLED: &str = "Sea of Ghosts";

fn samples() -> impl Iterator<Item = Session> {
    SAMPLES.iter().map(|sample| (sample.open)())
}

fn add(name: &str) -> Op {
    let (x, y, radius) = NEW_NEBULA;
    Op::AddNebula {
        x,
        y,
        radius,
        name: Some(name.to_owned()),
    }
}

fn rename(index: usize, name: &str) -> Op {
    Op::SetNebulaName {
        index,
        name: name.to_owned(),
    }
}

fn remove(index: usize) -> Op {
    Op::RemoveNebula { index }
}

fn pooled(session: &Session, name: &str) -> usize {
    common::pooled(session, "nebula_names", name)
}

/// Two names the pool holds.
fn two_free(session: &Session) -> (String, String) {
    let free = free_nebula_names(&session.doc);
    (free[0].clone(), free[1].clone())
}

#[test]
fn the_pool_holds_the_names_no_nebula_of_the_galaxy_took() {
    for session in samples() {
        let free = free_nebula_names(&session.doc);
        assert!(!free.is_empty());
        for nebula in &session.graph.nebulae {
            assert!(!free.contains(&nebula.name.key), "{}", nebula.name.key);
        }
    }
}

/// A new nebula takes its name from the pool as a key the game looks up; a namesake takes
/// nothing more; the name goes back once neither holds it; and a name outside the pool
/// takes nothing and is written as it stands.
#[test]
fn a_new_nebula_takes_its_name_from_the_pool_and_a_removal_gives_it_back() {
    for mut session in samples() {
        let (name, _) = two_free(&session);
        let free = free_nebula_names(&session.doc);
        let index = session.graph.nebulae.len();

        round_trip_step(&mut session, "add", add(&name));
        assert_eq!(pooled(&session, &name), 0);
        let left = free_nebula_names(&session.doc);
        assert_eq!(left.len(), free.len() - 1);
        assert!(!left.contains(&name));
        let added = &session.graph.nebulae[index];
        assert_eq!(added.name.key, name);
        assert!(
            !added.name.literal,
            "a pool name is a key the game looks up"
        );

        session.apply(add(&name)).expect("a namesake");
        assert_eq!(pooled(&session, &name), 0);
        round_trip_step(&mut session, "remove one", remove(index));
        assert_eq!(pooled(&session, &name), 0, "the other still holds it");
        session.apply(remove(index)).expect("remove the other");
        assert_eq!(pooled(&session, &name), 1);
        assert_eq!(free_nebula_names(&session.doc), free);
        assert_eq!(current(&session), session.doc.original());

        session.apply(add(UNPOOLED)).expect("add off the pool");
        assert_eq!(free_nebula_names(&session.doc), free);
        assert!(session.graph.nebulae[index].name.literal);
    }
}

/// A rename puts the old name back and takes the new one, whether the nebula was added or
/// the file held it; a rename onto a name another nebula holds, or only the file holds,
/// takes nothing more; and a nebula the file held keeps a pooled name it took when a
/// namesake goes.
#[test]
fn a_rename_puts_the_old_name_back_and_takes_the_new_one() {
    for mut session in samples() {
        let (first, second) = two_free(&session);
        let free = free_nebula_names(&session.doc);
        let index = session.graph.nebulae.len();
        let held = session.graph.nebulae[0].name.key.clone();
        let only_the_file = session.graph.nebulae[1].name.key.clone();
        session.apply(add(&first)).expect("add");

        let result = round_trip_step(&mut session, "rename", rename(index, &second));
        assert_eq!(result.inverse, rename(index, &first));
        assert_eq!(pooled(&session, &first), 1);
        assert_eq!(pooled(&session, &second), 0);
        session
            .apply(rename(index, UNPOOLED))
            .expect("rename off the pool");
        assert_eq!(pooled(&session, &second), 1);
        assert_eq!(free_nebula_names(&session.doc), free);
        session
            .apply(rename(index, &only_the_file))
            .expect("rename onto a name only the file holds");
        assert_eq!(free_nebula_names(&session.doc), free);
        assert_eq!(pooled(&session, &only_the_file), 0);

        session.apply(rename(index, &first)).expect("rename back");
        let taken = free_nebula_names(&session.doc);
        round_trip_step(
            &mut session,
            "rename the file's nebula onto it",
            rename(0, &first),
        );
        assert_eq!(session.graph.nebulae[0].name.key, first);
        assert_eq!(free_nebula_names(&session.doc), taken);
        session.apply(remove(index)).expect("remove the added one");
        assert_eq!(
            pooled(&session, &first),
            0,
            "the file's nebula still holds it"
        );
        session.apply(rename(0, &held)).expect("rename back");
        assert_eq!(pooled(&session, &first), 1);
        assert_eq!(current(&session), session.doc.original());

        session
            .apply(rename(0, &first))
            .expect("take it by a rename");
        session.apply(add(&first)).expect("add a namesake");
        session.apply(remove(index)).expect("remove the namesake");
        assert_eq!(
            pooled(&session, &first),
            0,
            "the file's nebula holds the entry"
        );
        session.apply(rename(0, &held)).expect("rename back");
        assert_eq!(pooled(&session, &first), 1);
        assert_eq!(current(&session), session.doc.original());
    }
}

/// Removing a nebula the file held leaves the pool as it was, and gives back a pooled name
/// it took by a rename rather than its own.
#[test]
fn removing_a_nebula_the_file_held_gives_back_only_a_pooled_name() {
    for mut session in samples() {
        let free = free_nebula_names(&session.doc);
        let (name, _) = two_free(&session);
        let held = session.graph.nebulae[0].name.key.clone();
        round_trip_step(&mut session, "remove", remove(0));
        assert_eq!(free_nebula_names(&session.doc), free);
        assert_eq!(pooled(&session, &held), 0, "its own name is not added");
        session.undo().expect("undo").expect("the removal");

        session.apply(rename(0, &name)).expect("rename");
        assert_eq!(pooled(&session, &name), 0);
        session.apply(remove(0)).expect("remove");
        assert_eq!(pooled(&session, &name), 1);
        assert_eq!(pooled(&session, &held), 0);
        assert_eq!(free_nebula_names(&session.doc), free);
    }
}

#[test]
fn a_scenario_has_no_pool_and_names_its_nebula_all_the_same() {
    let mut session = EXPORTED.open();
    assert!(free_nebula_names(&session.doc).is_empty());
    let index = session.graph.nebulae.len();
    round_trip_step(&mut session, "add", add("Yinarim_Nebula"));
    assert_eq!(session.graph.nebulae[index].name.key, "Yinarim_Nebula");
}

#[test]
fn the_diffs_a_pooled_name_writes() {
    let mut session = open();
    let (first, second) = two_free(&session);
    let index = session.graph.nebulae.len();
    let added = session.apply(add(&first)).expect("add");
    common::snapshot("add_nebula_pooled", &report(&session, &added));
    common::snapshot(
        "rename_nebula_pooled",
        &step_report(&mut session, rename(index, &second)),
    );
    common::snapshot(
        "remove_nebula_pooled",
        &step_report(&mut session, remove(index)),
    );
}
