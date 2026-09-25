//! The terraforming candidate op on the 4.5 sample: the diff each change produces is
//! snapshotted, the planet page reads the modifier back, and undo puts the original bytes
//! back.

use sgf_core::entity::get_planet_page;
use sgf_core::ops::Op;
use sgf_core::session::{OpResult, Session};

use crate::common;
use common::diff::{round_trip, round_trip_step, snapshot_step};
use common::{current, open_4_5};

const CANDIDATE: &str = "terraforming_candidate";
const FROZEN: &str = "frozen_terraforming_candidate";

fn set(id: u32, modifier: &str, on: bool) -> Op {
    Op::SetTerraformCandidate {
        id,
        modifier: modifier.to_owned(),
        on,
    }
}

/// The timed modifiers planet `id`'s page lists, as (modifier, days).
fn page(session: &Session, id: u32) -> Vec<(String, i32)> {
    get_planet_page(&session.doc, id)
        .unwrap_or_else(|e| panic!("planet {id}: {e}"))
        .timed_modifiers
        .into_iter()
        .map(|m| (m.modifier, m.days))
        .collect()
}

/// Round-trip and snapshot `modifier` added to `planet`, and check its page lists it last.
fn mark(session: &mut Session, planet: u32, modifier: &str, snapshot: &str) -> OpResult {
    let before = page(session, planet);
    let result = snapshot_step(session, snapshot, set(planet, modifier, true));
    let mut expected = before;
    expected.push((modifier.to_owned(), -1));
    assert_eq!(page(session, planet), expected, "{snapshot}: the page");
    result
}

#[test]
fn a_barren_planet_without_timed_modifiers_becomes_a_candidate_and_back() {
    let mut session = open_4_5();
    assert!(page(&session, 585).is_empty());
    let result = mark(&mut session, 585, CANDIDATE, "barren_4_5");
    assert_eq!(
        result.entry.description,
        "Make planet #585 a terraforming candidate"
    );
    assert_eq!(result.inverse, set(585, CANDIDATE, false));
    assert!(result.details_stale.is_empty());
    assert!(!result.reclassifies);

    let removed = session.apply(result.inverse).expect("remove the candidate");
    assert_eq!(
        removed.entry.description,
        "Stop planet #585 being a terraforming candidate"
    );
    assert_eq!(removed.inverse, set(585, CANDIDATE, true));
    assert_eq!(current(&session), session.doc.original(), "the block goes");
    assert!(page(&session, 585).is_empty());

    session.undo().expect("undo").expect("something to undo");
    session.undo().expect("undo").expect("something to undo");
    assert_eq!(current(&session), session.doc.original());
}

#[test]
fn a_frozen_moon_with_a_timed_modifier_takes_the_candidate_last() {
    let mut session = open_4_5();
    let harvested = ("harvested_resources_mining".to_owned(), 3426);
    assert_eq!(page(&session, 40), std::slice::from_ref(&harvested));
    mark(&mut session, 40, FROZEN, "frozen_moon_4_5");

    round_trip_step(&mut session, "remove the candidate", set(40, FROZEN, false));
    assert_eq!(page(&session, 40), [harvested]);
    assert_eq!(current(&session), session.doc.original());
}

#[test]
fn a_candidate_round_trips_from_the_file_as_opened() {
    round_trip(open_4_5(), set(585, CANDIDATE, true));
    round_trip(open_4_5(), set(40, FROZEN, true));
}

#[test]
fn a_candidate_is_refused_for_a_star_an_unknown_planet_or_no_change() {
    let mut session = open_4_5();
    let refusals = [
        (set(99_999, CANDIDATE, true), "planet 99999 does not exist"),
        (
            set(584, CANDIDATE, true),
            "planet 584 is its system's star, which cannot be a terraforming candidate",
        ),
        (
            set(585, CANDIDATE, false),
            "planet 585 does not have terraforming_candidate",
        ),
        (
            set(40, "harvested_resources_mining", true),
            "planet 40 already has harvested_resources_mining",
        ),
        (
            set(40, "harvested_resources_mining", false),
            "planet 40's harvested_resources_mining has 3426 days left: only a permanent modifier can be removed",
        ),
        (set(585, "", true), "a modifier may not be empty"),
    ];
    for (op, message) in refusals {
        let error = session.apply(op).expect_err(message);
        assert_eq!(error.to_string(), message);
    }
    assert!(!session.doc.is_dirty());
    assert!(session.history().undo.is_empty());
}
