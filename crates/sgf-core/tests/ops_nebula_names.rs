//! The pool of unused nebula names on the 4.5 and the 4.4 sample: a new nebula takes its
//! name out of the pool, a removal gives it back, a rename swaps the two, undo is
//! byte-exact, and a name the pool lacks takes nothing. The diff of each forward edit is
//! snapshotted on the 4.4 sample. A scenario has no pool.

use std::fmt::Write as _;

use sgf_core::document::Document;
use sgf_core::ops::{Op, free_nebula_names};
use sgf_core::session::Session;
use similar::{Algorithm, TextDiff};

use crate::common;
use common::diff::{report, round_trip_step};
use common::{NEW_NEBULA, current, open, open_4_5, text};

const UNPOOLED: &str = "Sea of Ghosts";

/// Apply `op` and describe it: its description, its inverse and the diff it wrote against
/// the bytes it found.
fn step(session: &mut Session, op: Op) -> String {
    let before = text(session);
    let result = session.apply(op).expect("apply");
    let after = text(session);
    let mut report = String::new();
    writeln!(report, "{}", result.entry.description).unwrap();
    writeln!(report, "inverse: {:?}", result.inverse).unwrap();
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(&before, &after);
    write!(
        report,
        "{}",
        diff.unified_diff()
            .context_radius(3)
            .header("before", "after")
    )
    .unwrap();
    report
}

fn samples() -> [Session; 2] {
    [open_4_5(), open()]
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

/// How many entries of the pool's block hold `name`.
fn pooled(session: &Session, name: &str) -> usize {
    let text = text(session);
    let start = text.find("\tnebula_names=").expect("the pool");
    let end = start + text[start..].find("\t}\n").expect("the pool's end");
    text[start..end]
        .matches(&format!("\t\t\"{name}\"\n"))
        .count()
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

        round_trip_step(&mut session, "remove", Op::RemoveNebula { index });
        assert_eq!(pooled(&session, &name), 1);
        assert_eq!(free_nebula_names(&session.doc), free);
        assert_eq!(current(&session), session.doc.original());
    }
}

#[test]
fn a_rename_puts_the_old_name_back_and_takes_the_new_one() {
    for mut session in samples() {
        let (first, second) = two_free(&session);
        let free = free_nebula_names(&session.doc);
        let index = session.graph.nebulae.len();
        session.apply(add(&first)).expect("add");

        let result = round_trip_step(&mut session, "rename", rename(index, &second));
        assert_eq!(result.inverse, rename(index, &first));
        assert_eq!(pooled(&session, &first), 1);
        assert_eq!(pooled(&session, &second), 0);

        round_trip_step(&mut session, "rename off the pool", rename(index, UNPOOLED));
        assert_eq!(pooled(&session, &second), 1);
        assert_eq!(free_nebula_names(&session.doc), free);

        round_trip_step(&mut session, "rename back", rename(index, &first));
        session
            .apply(Op::RemoveNebula { index })
            .expect("remove the nebula");
        assert_eq!(current(&session), session.doc.original());
    }
}

#[test]
fn a_nebula_the_galaxy_held_takes_a_pooled_name_and_gives_it_back() {
    for mut session in samples() {
        let (name, _) = two_free(&session);
        let result = round_trip_step(&mut session, "rename", rename(0, &name));
        assert_eq!(pooled(&session, &name), 0);
        assert_eq!(session.graph.nebulae[0].name.key, name);

        session.apply(result.inverse).expect("rename it back");
        assert_eq!(pooled(&session, &name), 1);
        assert_eq!(current(&session), session.doc.original());
    }
}

#[test]
fn a_name_outside_the_pool_takes_nothing() {
    for mut session in samples() {
        let free = free_nebula_names(&session.doc);
        let index = session.graph.nebulae.len();
        round_trip_step(&mut session, "add", add(UNPOOLED));
        assert_eq!(free_nebula_names(&session.doc), free);
        assert!(session.graph.nebulae[index].name.literal);

        round_trip_step(&mut session, "remove", Op::RemoveNebula { index });
        assert_eq!(current(&session), session.doc.original());
    }
}

#[test]
fn a_pooled_name_stays_taken_while_another_nebula_holds_it() {
    for mut session in samples() {
        let (name, _) = two_free(&session);
        let index = session.graph.nebulae.len();
        session.apply(add(&name)).expect("the first");
        session.apply(add(&name)).expect("the second");
        assert_eq!(pooled(&session, &name), 0);

        round_trip_step(&mut session, "remove one", Op::RemoveNebula { index });
        assert_eq!(pooled(&session, &name), 0, "the other still holds it");

        session
            .apply(Op::RemoveNebula { index })
            .expect("remove the other");
        assert_eq!(pooled(&session, &name), 1);
        assert_eq!(current(&session), session.doc.original());
    }
}

#[test]
fn a_scenario_has_no_pool_and_names_its_nebula_all_the_same() {
    let doc = Document::load(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../testdata/2206.11.16.scenario.txt"
    ))
    .expect("load the scenario");
    let mut session = Session::from_document(None, doc).expect("open the scenario");
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
        &step(&mut session, rename(index, &second)),
    );
    common::snapshot(
        "remove_nebula_pooled",
        &step(&mut session, Op::RemoveNebula { index }),
    );
}

#[test]
fn removing_a_nebula_the_file_held_leaves_the_pool_as_it_was() {
    for mut session in samples() {
        let free = free_nebula_names(&session.doc);
        let held = session.graph.nebulae[0].name.key.clone();
        round_trip_step(&mut session, "remove", Op::RemoveNebula { index: 0 });
        assert_eq!(free_nebula_names(&session.doc), free);
        assert_eq!(pooled(&session, &held), 0, "its own name is not added");
    }
}

#[test]
fn removing_a_nebula_the_file_held_after_a_rename_gives_the_pooled_name_back() {
    for mut session in samples() {
        let free = free_nebula_names(&session.doc);
        let (name, _) = two_free(&session);
        let held = session.graph.nebulae[0].name.key.clone();
        session.apply(rename(0, &name)).expect("rename");
        assert_eq!(pooled(&session, &name), 0);

        round_trip_step(&mut session, "remove", Op::RemoveNebula { index: 0 });
        assert_eq!(pooled(&session, &name), 1);
        assert_eq!(pooled(&session, &held), 0);
        assert_eq!(free_nebula_names(&session.doc), free);
    }
}

#[test]
fn renaming_onto_a_name_another_nebula_holds_takes_nothing_more() {
    for mut session in samples() {
        let (name, _) = two_free(&session);
        let index = session.graph.nebulae.len();
        let held = session.graph.nebulae[0].name.key.clone();
        session.apply(add(&name)).expect("add");
        let free = free_nebula_names(&session.doc);

        round_trip_step(&mut session, "rename onto it", rename(0, &name));
        assert_eq!(free_nebula_names(&session.doc), free);

        round_trip_step(
            &mut session,
            "remove the added one",
            Op::RemoveNebula { index },
        );
        assert_eq!(
            pooled(&session, &name),
            0,
            "the file's nebula still holds it"
        );

        session.apply(rename(0, &held)).expect("rename back");
        assert_eq!(pooled(&session, &name), 1);
        assert_eq!(current(&session), session.doc.original());
    }
}

#[test]
fn renaming_onto_a_name_only_the_file_holds_gives_the_pooled_one_back() {
    for mut session in samples() {
        let (name, _) = two_free(&session);
        let free = free_nebula_names(&session.doc);
        let index = session.graph.nebulae.len();
        let other = session.graph.nebulae[1].name.key.clone();
        session.apply(add(&name)).expect("add");

        round_trip_step(&mut session, "rename onto it", rename(index, &other));
        assert_eq!(free_nebula_names(&session.doc), free);
        assert_eq!(pooled(&session, &other), 0);
    }
}

/// Unlike a star name, a pooled nebula name can be held by a nebula the file held, which
/// took it by a rename; that nebula keeps the entry taken when a namesake goes.
#[test]
fn a_nebula_the_file_held_keeps_its_pooled_name_taken_when_a_namesake_goes() {
    for mut session in samples() {
        let (name, _) = two_free(&session);
        let index = session.graph.nebulae.len();
        let held = session.graph.nebulae[0].name.key.clone();
        session.apply(rename(0, &name)).expect("rename");
        session.apply(add(&name)).expect("add a namesake");
        assert_eq!(pooled(&session, &name), 0);

        round_trip_step(
            &mut session,
            "remove the namesake",
            Op::RemoveNebula { index },
        );
        assert_eq!(
            pooled(&session, &name),
            0,
            "the file's nebula holds the entry"
        );

        session.apply(rename(0, &held)).expect("rename back");
        assert_eq!(pooled(&session, &name), 1);
        assert_eq!(current(&session), session.doc.original());
    }
}
