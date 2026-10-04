//! The ring op on the 4.5 sample: the diff each change produces is snapshotted, the
//! details read the ring back in place, and undo puts the original bytes back.

use sgf_core::ops::Op;
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::{current, open_4_5, text};

fn set(planet: u32, ring: bool) -> Op {
    Op::SetBodyRing { body: planet, ring }
}

/// Whether system 1's `planet` has a ring, as the details built before the edit read it.
fn ring(session: &Session, planet: u32) -> bool {
    let details = session.built_details().expect("the details kept");
    let system = details.raw(1).expect("system 1's details");
    let body = system.planets.iter().find(|p| p.id == planet);
    body.expect("the planet").ring
}

/// Planet `id`'s `binary_flags`, as the session's bytes now hold it.
fn flags(session: &Session, id: u32) -> Option<String> {
    let text = text(session);
    let planets = text.find("\nplanets=\n").expect("the planets");
    let start = planets
        + text[planets..]
            .find(&format!("\n\t\t{id}=\n\t\t{{\n"))
            .unwrap_or_else(|| panic!("planet {id}"));
    let end = start + 1 + text[start + 1..].find("\n\t\t}\n").expect("its end");
    let entity = &text[start..end];
    let at = entity.find("\n\t\t\tbinary_flags=")? + "\n\t\t\tbinary_flags=".len();
    Some(entity[at..].lines().next().unwrap_or_default().to_owned())
}

/// Round-trip and snapshot `ring` on system 1's `planet`, with the details built first, and
/// check they read it back without being built again, through undo and redo too.
fn change(planet: u32, on: bool, snapshot: &str) -> Session {
    let mut session = open_4_5();
    session.warm_details().expect("build details");
    assert_eq!(ring(&session, planet), !on, "{snapshot}: before");
    let result = snapshot_step(&mut session, snapshot, set(planet, on));
    assert_eq!(result.inverse, set(planet, !on));
    assert_eq!(result.details_stale, [1]);
    assert!(!result.reclassifies);
    assert_eq!(ring(&session, planet), on, "{snapshot}: after");

    session.undo().expect("undo").expect("something to undo");
    assert_eq!(
        current(&session),
        session.doc.original(),
        "{snapshot}: undo"
    );
    assert_eq!(ring(&session, planet), !on, "{snapshot}: undone");
    session.redo().expect("redo").expect("something to redo");
    assert_eq!(ring(&session, planet), on, "{snapshot}: redone");
    session
}

/// Barren 585 writes no `binary_flags`, so the statement is new.
#[test]
fn a_planet_without_flags_is_given_a_ring() {
    let session = change(585, true, "ring_on_bare_planet_4_5");
    assert_eq!(flags(&session, 585).as_deref(), Some("320"));
}

/// Moon 586 holds 576, the moon bit beside 64.
#[test]
fn a_moon_is_given_a_ring_beside_its_moon_bit() {
    let session = change(586, true, "ring_on_moon_4_5");
    assert_eq!(flags(&session, 586).as_deref(), Some("832"));
}

/// Gas giant 589 holds 320, so taking its ring leaves only 64 and the statement goes.
#[test]
fn a_ring_is_taken_off_and_the_statement_goes() {
    let mut session = change(589, false, "ring_off_4_5");
    assert_eq!(flags(&session, 589), None);

    let result = session.apply(set(589, true)).expect("give the ring back");
    assert_eq!(result.entry.description, "Gave planet #589 a ring");
    assert_eq!(flags(&session, 589).as_deref(), Some("320"));
}

#[test]
fn a_ring_round_trips_from_the_file_as_opened() {
    round_trip(open_4_5(), set(585, true));
    round_trip(open_4_5(), set(586, true));
    round_trip(open_4_5(), set(589, false));
}

#[test]
fn a_ring_is_refused_for_an_unknown_planet_or_no_change() {
    let mut session = open_4_5();
    let refusals = [
        (set(99_999, true), "planet 99999 does not exist"),
        (set(589, true), "planet 589 already has a ring"),
        (set(585, false), "planet 585 has no ring"),
    ];
    for (op, message) in refusals {
        let error = session.apply(op).expect_err(message);
        assert_eq!(error.to_string(), message);
    }
    assert!(!session.doc.is_dirty());
    assert!(session.history().undo.is_empty());
}
