//! The anomaly ops on both 4.x samples: the diff an add and a removal produce is
//! snapshotted, the planet page reads the anomaly and its finders back, and undo and the
//! inverse put the original bytes back.

use sgf_core::entity::PlanetPageAnomaly;
use sgf_core::entity::get_planet_page;
use sgf_core::ops::Op;
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::{current, open, open_3_4, open_4_5};

const ASTEROID: &str = "asteroid_uninhabitable_category";
const PLAYER: u32 = 0;

fn add(planet: u32, category: &str) -> Op {
    Op::AddAnomaly {
        planet,
        category: category.to_owned(),
        found_by: None,
    }
}

fn remove(planet: u32) -> Op {
    Op::RemoveAnomaly { planet }
}

/// The anomaly planet `id`'s page shows.
fn anomaly(session: &Session, id: u32) -> Option<PlanetPageAnomaly> {
    get_planet_page(&session.doc, id)
        .unwrap_or_else(|e| panic!("planet {id}: {e}"))
        .anomaly
}

fn waiting(category: &str, found_by: &[u32]) -> Option<PlanetPageAnomaly> {
    Some(PlanetPageAnomaly {
        category: category.to_owned(),
        found_by: found_by.to_vec(),
    })
}

#[test]
fn a_planet_no_one_has_surveyed_takes_the_key_alone() {
    // 4.5: Olbers' barren 585; 4.4: 749, which only country 17 has surveyed.
    for (mut session, planet, name) in [
        (open_4_5(), 585, "unsurveyed_4_5"),
        (open(), 749, "unsurveyed_4_4"),
    ] {
        assert_eq!(anomaly(&session, planet), None);
        let result = snapshot_step(&mut session, name, add(planet, ASTEROID));
        assert_eq!(
            result.entry.description,
            format!("Add anomaly {ASTEROID} to planet #{planet}")
        );
        assert_eq!(result.inverse, remove(planet));
        assert_eq!(anomaly(&session, planet), waiting(ASTEROID, &[]));
        assert!(result.details_stale.is_empty());
    }
}

#[test]
fn a_planet_the_player_has_surveyed_is_listed_for_the_player() {
    // Planet 3 of the 4.5 home system, surveyed at the start, is in the player's
    // `surveyed_deposit_holders` but names no `surveyed_by`; the player's `events` is empty.
    // Planet 1 of the 4.4 home system is the same.
    for (mut session, planet, name) in
        [(open_4_5(), 3, "surveyed_4_5"), (open(), 1, "surveyed_4_4")]
    {
        let result = snapshot_step(&mut session, name, add(planet, ASTEROID));
        assert_eq!(
            result.entry.description,
            format!("Add anomaly {ASTEROID} to planet #{planet}, found by empire 0")
        );
        assert_eq!(anomaly(&session, planet), waiting(ASTEROID, &[PLAYER]));

        let removed = session.apply(result.inverse).expect("remove it");
        assert_eq!(
            removed.inverse,
            Op::AddAnomaly {
                planet,
                category: ASTEROID.to_owned(),
                found_by: Some(vec![PLAYER]),
            }
        );
        assert_eq!(current(&session), session.doc.original(), "{name}");
    }
}

#[test]
fn a_removal_takes_the_key_and_the_planet_from_every_finder() {
    let mut session = open_4_5();
    let found = anomaly(&session, 185).expect("planet 185's anomaly");
    assert_eq!(found.found_by, [16_777_221]);
    let result = snapshot_step(&mut session, "remove_4_5", remove(185));
    assert_eq!(
        result.entry.description,
        "Remove anomaly AIANOM_RESEARCHDEPO_CAT from planet #185"
    );
    assert_eq!(
        result.inverse,
        Op::AddAnomaly {
            planet: 185,
            category: "AIANOM_RESEARCHDEPO_CAT".to_owned(),
            found_by: Some(vec![16_777_221]),
        }
    );
    assert_eq!(anomaly(&session, 185), None);
    assert_eq!(
        anomaly(&session, 182).expect("182's").found_by,
        [16_777_221],
        "the other planet stays listed"
    );
    session.apply(result.inverse).expect("add it back");
    assert_eq!(anomaly(&session, 185), Some(found));
}

#[test]
fn the_inverse_of_a_removal_writes_the_file_back() {
    // 7807 is the only planet country 16777220 lists, so its list goes and comes back; 2090 is
    // last of two in country 51's; 2600 no country has found.
    for (session, planet) in [(open(), 7807), (open(), 2090), (open_4_5(), 2600)] {
        let mut session = session;
        let before = anomaly(&session, planet);
        let removed = session.apply(remove(planet)).expect("remove");
        assert_eq!(anomaly(&session, planet), None);
        session.apply(removed.inverse).expect("add it back");
        assert_eq!(anomaly(&session, planet), before);
        assert_eq!(current(&session), session.doc.original(), "planet {planet}");
    }
    let mut session = open();
    snapshot_step(&mut session, "remove_only_entry_4_4", remove(7807));
}

#[test]
fn an_anomaly_round_trips_from_the_file_as_opened() {
    round_trip(open_4_5(), add(585, ASTEROID));
    round_trip(open_4_5(), add(3, ASTEROID));
    round_trip(open_4_5(), remove(185));
    round_trip(open(), add(1, ASTEROID));
    round_trip(open(), remove(2090));
    round_trip(
        open(),
        Op::AddAnomaly {
            planet: 749,
            category: ASTEROID.to_owned(),
            found_by: Some(vec![PLAYER, 17]),
        },
    );
}

#[test]
fn an_anomaly_is_refused_for_a_star_a_held_one_none_or_a_bad_category() {
    let mut session = open_4_5();
    let refusals = [
        (add(99_999, ASTEROID), "planet 99999 does not exist"),
        (
            add(584, ASTEROID),
            "planet 584 is its system's star, which takes no anomaly",
        ),
        (
            remove(584),
            "planet 584 is its system's star, which takes no anomaly",
        ),
        (
            add(185, ASTEROID),
            "planet 185 already has anomaly AIANOM_RESEARCHDEPO_CAT",
        ),
        (remove(585), "planet 585 has no anomaly"),
        (add(585, ""), "an anomaly category may not be empty"),
        (
            add(585, "two words"),
            "\"two words\" cannot be written as an anomaly category",
        ),
    ];
    for (op, message) in refusals {
        let error = session.apply(op).expect_err(message);
        assert_eq!(error.to_string(), message);
    }
    assert!(!session.doc.is_dirty());
}

#[test]
fn a_save_before_stellaris_4_is_refused() {
    let mut session = open_3_4();
    for op in [add(1, ASTEROID), remove(1)] {
        let error = session.apply(op).expect_err("a 3.4 save");
        assert!(error.to_string().contains("3.4"), "{error}");
    }
    assert!(!session.doc.is_dirty());
}
