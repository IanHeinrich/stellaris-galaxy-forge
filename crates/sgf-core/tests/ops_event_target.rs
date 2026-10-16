//! The global event target ops on the 4.5 sample: the block each writes after the save's
//! last, the diff snapshotted, what each refuses, and undo and the inverse putting the
//! original bytes back.

use sgf_core::ops::{EventTargetOf, Op, OpError};
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip_step, snapshot_step};
use common::{current, open_3_4, open_4_5};

/// Xu Nur I, a barren planet of the 4.5 sample.
const BARREN: u32 = 585;
/// A target the 4.5 sample holds, on the Junk Ratlings' capital.
const HELD: &str = "ratling_capital";

fn add(name: &str, target: EventTargetOf) -> Op {
    Op::AddEventTarget {
        name: name.to_owned(),
        target,
    }
}

fn remove(name: &str) -> Op {
    Op::RemoveEventTarget {
        name: name.to_owned(),
    }
}

fn holds(session: &Session, name: &str) -> bool {
    session
        .save("reading event targets")
        .expect("a 4.x save")
        .holds_event_target(name)
}

fn refused(session: &mut Session, op: Op) -> OpError {
    let error = session.apply_inverse(op).expect_err("refused");
    assert!(!session.doc().is_dirty(), "{error}");
    error
}

#[test]
fn a_target_on_a_planet_is_written_after_the_last_and_its_inverse_takes_it_out() {
    let mut session = open_4_5();
    assert!(!holds(&session, "sgf_story"));
    let result = snapshot_step(
        &mut session,
        "planet_4_5",
        add("sgf_story", EventTargetOf::Body { body: BARREN }),
    );
    assert_eq!(
        result.entry.description,
        "Added event target sgf_story for Xu Nur I #585"
    );
    assert_eq!(result.inverse, remove("sgf_story"));
    assert!(result.touched.is_empty(), "{:?}", result.touched);
    assert!(holds(&session, "sgf_story"));

    let removed = session.apply_inverse(result.inverse).expect("the inverse");
    assert_eq!(removed.entry.description, "Removed event target sgf_story");
    assert_eq!(
        removed.inverse,
        add("sgf_story", EventTargetOf::Body { body: BARREN })
    );
    assert_eq!(current(&session), session.doc().original());
    assert!(!holds(&session, "sgf_story"));
}

#[test]
fn a_system_and_a_country_target_follow_each_other_in_the_order_added() {
    let mut session = open_4_5();
    round_trip_step(
        &mut session,
        "system",
        add("sgf_system", EventTargetOf::System { system: 46 }),
    );
    let result = snapshot_step(
        &mut session,
        "system_then_country_4_5",
        add("sgf_country", EventTargetOf::Country { country: 0 }),
    );
    assert_eq!(
        result.entry.description,
        "Added event target sgf_country for empire 0"
    );
    let text = String::from_utf8(current(&session)).expect("utf-8");
    let system = text.find("name=\"sgf_system\"").expect("the system's");
    let country = text.find("name=\"sgf_country\"").expect("the country's");
    assert!(system < country, "the later add comes after");
}

#[test]
fn a_held_name_an_unwritable_name_and_a_missing_target_are_refused() {
    let mut session = open_4_5();
    let body = EventTargetOf::Body { body: BARREN };
    assert!(holds(&session, HELD));
    let error = refused(&mut session, add(HELD, body));
    assert_eq!(
        error.to_string(),
        "event target ratling_capital is already saved"
    );
    assert!(matches!(
        refused(&mut session, add("", body)),
        OpError::EmptyText { .. }
    ));
    assert!(matches!(
        refused(&mut session, add("two words", body)),
        OpError::InvalidText { .. }
    ));
    assert!(matches!(
        refused(
            &mut session,
            add("sgf", EventTargetOf::Body { body: 9_999_999 })
        ),
        OpError::UnknownPlanet(9_999_999)
    ));
    assert!(matches!(
        refused(
            &mut session,
            add("sgf", EventTargetOf::System { system: 9_999 })
        ),
        OpError::UnknownSystem(9_999)
    ));
    assert!(matches!(
        refused(
            &mut session,
            add("sgf", EventTargetOf::Country { country: 9_999 })
        ),
        OpError::UnknownCountry(9_999)
    ));
    assert!(matches!(
        refused(&mut session, remove("sgf_never_saved")),
        OpError::UnknownEventTarget(name) if name == "sgf_never_saved"
    ));
}

#[test]
fn a_save_before_stellaris_4_is_refused() {
    let mut session = open_3_4();
    let error = refused(
        &mut session,
        add("sgf", EventTargetOf::System { system: 0 }),
    );
    assert!(matches!(error, OpError::VersionTooOld { .. }), "{error}");
}

#[test]
fn a_target_the_file_held_is_not_removed() {
    let mut session = open_4_5();
    let error = refused(&mut session, remove(HELD));
    assert!(matches!(error, OpError::Unchanged { .. }), "{error}");
}

/// The 4.4 sample with every top-level `saved_event_target` block taken out, and with
/// `rename_flags` its global `flags` renamed too.
fn without_targets(rename_flags: bool) -> Session {
    common::open_edited(|gamestate| {
        while let Some(start) = gamestate.find("\nsaved_event_target=\n{\n") {
            let end = start + 1 + gamestate[start + 1..].find("\n}\n").expect("its end") + 2;
            gamestate.replace_range(start..end, "");
        }
        if rename_flags {
            *gamestate = gamestate.replacen("\nflags=\n{\n", "\nsgf_flags=\n{\n", 1);
        }
    })
}

/// A save with no targets takes one after its global flags, and one with no global flags
/// either after its last section.
#[test]
fn a_save_without_targets_or_flags_still_takes_one() {
    for (rename_flags, after) in [(false, "\nflags=\n{\n"), (true, "")] {
        let mut session = without_targets(rename_flags);
        session
            .apply(add("sgf", EventTargetOf::System { system: 0 }))
            .expect("the target");
        let text = String::from_utf8(current(&session)).expect("utf-8");
        let at = text.find("saved_event_target=\n{\n").expect("the block");
        match after.is_empty() {
            false => assert!(text.find(after).is_some_and(|flags| flags < at)),
            true => assert!(text[at..].trim_end().ends_with('}'), "last in the file"),
        }
    }
}
