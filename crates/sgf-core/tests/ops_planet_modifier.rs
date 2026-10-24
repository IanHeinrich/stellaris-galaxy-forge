//! The planet modifier ops on the 4.5 sample: the diff each change produces is snapshotted,
//! the planet page reads the modifier back, and undo puts the original bytes back.

use sgf_core::entity::get_planet_page;
use sgf_core::ops::{Op, PlanetFlag};
use sgf_core::session::{OpResult, Session};

use crate::common;
use common::diff::{round_trip, round_trip_step, snapshot_step};
use common::{SAMPLE_4_5, current, open, open_4_5, open_edited_sample};

const CANDIDATE: &str = "terraforming_candidate";
const FROZEN: &str = "frozen_terraforming_candidate";
const HARVESTED: &str = "harvested_resources_mining";
/// A gas giant with the extensive moon system feature and no timed item for it.
const GAS_GIANT: u32 = 10;
const MOONS: &str = "extensive_moon_system";
const PM_MOONS: &str = "pm_extensive_moon_system";

/// Planet flags a modifier is written with, as a mod's marker modifier sets them.
const MARKER: &str = "candidate_marker";
const KIND: &str = "candidate_kind";
/// A flag planets 1 and 40 hold, dated `DAY_ONE`.
const STARTING: &str = "starting_deposit";
/// The 4.5 sample's day one as a planet flag's date.
const DAY_ONE: u32 = 62_808_000;
/// The 4.5 sample's own date, 2201.03.25, as a planet flag's date.
const TODAY: u32 = 62_818_656;

/// `op` with the planet flags `listed`, each with its date.
fn with_flags(mut op: Op, listed: &[(&str, Option<u32>)]) -> Op {
    let listed = listed
        .iter()
        .map(|&(flag, date)| PlanetFlag {
            flag: flag.to_owned(),
            date,
        })
        .collect();
    match &mut op {
        Op::AddBodyModifier { flags, .. } | Op::RemoveBodyModifier { flags, .. } => {
            *flags = listed;
        }
        _ => panic!("{op:?} takes no planet flags"),
    }
    op
}

fn add(planet: u32, modifier: &str, days: &[i32]) -> Op {
    Op::AddBodyModifier {
        body: planet,
        modifier: modifier.to_owned(),
        days: days.to_vec(),
        feature: None,
        flags: Vec::new(),
    }
}

fn add_feature(planet: u32, modifier: &str, days: &[i32], feature: &str) -> Op {
    Op::AddBodyModifier {
        body: planet,
        modifier: modifier.to_owned(),
        days: days.to_vec(),
        feature: Some(feature.to_owned()),
        flags: Vec::new(),
    }
}

fn remove(planet: u32, modifier: &str, feature: Option<&str>) -> Op {
    Op::RemoveBodyModifier {
        body: planet,
        modifier: modifier.to_owned(),
        feature: feature.map(str::to_owned),
        flags: Vec::new(),
    }
}

/// The timed modifiers planet `id`'s page lists, as (modifier, days).
fn page(session: &Session, id: u32) -> Vec<(String, i32)> {
    get_planet_page(session.doc(), id)
        .unwrap_or_else(|e| panic!("planet {id}: {e}"))
        .timed_modifiers
        .into_iter()
        .map(|m| (m.modifier, m.days))
        .collect()
}

/// The planet features planet `id`'s page lists.
fn features(session: &Session, id: u32) -> Vec<String> {
    get_planet_page(session.doc(), id)
        .unwrap_or_else(|e| panic!("planet {id}: {e}"))
        .planet_modifiers
}

/// Round-trip and snapshot `op`, which adds `modifier` for `days`, and check the page lists
/// it last.
fn mark(session: &mut Session, planet: u32, op: Op, snapshot: &str) -> OpResult {
    let Op::AddBodyModifier { modifier, days, .. } = &op else {
        panic!("{op:?} adds nothing");
    };
    let mut expected = page(session, planet);
    expected.extend(days.iter().map(|&d| (modifier.clone(), d)));
    let result = snapshot_step(session, snapshot, op);
    assert_eq!(page(session, planet), expected, "{snapshot}: the page");
    result
}

#[test]
fn a_barren_planet_without_timed_modifiers_becomes_a_candidate_and_back() {
    let mut session = open_4_5();
    assert!(page(&session, 585).is_empty());
    let result = mark(&mut session, 585, add(585, CANDIDATE, &[-1]), "barren_4_5");
    assert_eq!(
        result.entry.description,
        "Added modifier terraforming_candidate to Xu Nur I #585"
    );
    assert_eq!(result.inverse, remove(585, CANDIDATE, None));
    let system = get_planet_page(session.doc(), 585)
        .expect("planet 585")
        .system
        .expect("planet 585 orbits a system");
    assert_eq!(result.details_stale, vec![system]);
    assert!(!result.reclassifies);

    let removed = session.apply(result.inverse).expect("remove the candidate");
    assert_eq!(
        removed.entry.description,
        "Removed modifier terraforming_candidate from Xu Nur I #585"
    );
    assert_eq!(removed.inverse, add(585, CANDIDATE, &[-1]));
    assert_eq!(
        current(&session),
        session.doc().original(),
        "the block goes"
    );
    assert!(page(&session, 585).is_empty());

    session.undo().expect("undo").expect("something to undo");
    session.undo().expect("undo").expect("something to undo");
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn a_frozen_moon_with_a_timed_modifier_takes_the_candidate_last() {
    let mut session = open_4_5();
    let harvested = (HARVESTED.to_owned(), 3426);
    assert_eq!(page(&session, 40), std::slice::from_ref(&harvested));
    mark(&mut session, 40, add(40, FROZEN, &[-1]), "frozen_moon_4_5");

    round_trip_step(
        &mut session,
        "remove the candidate",
        remove(40, FROZEN, None),
    );
    assert_eq!(page(&session, 40), [harvested]);
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn a_modifier_for_some_days_is_written_with_them() {
    let mut session = open_4_5();
    let result = mark(&mut session, 585, add(585, CANDIDATE, &[360]), "timed_4_5");
    assert_eq!(
        result.entry.description,
        "Added modifier terraforming_candidate to Xu Nur I #585 for 360 days"
    );
}

#[test]
fn a_modifier_that_runs_out_is_removed_and_its_inverse_writes_its_days_back() {
    let mut session = open_4_5();
    let result = snapshot_step(
        &mut session,
        "remove_timed_4_5",
        remove(40, HARVESTED, None),
    );
    assert_eq!(result.inverse, add(40, HARVESTED, &[3426]));
    assert!(page(&session, 40).is_empty());

    session.apply(result.inverse).expect("write it back");
    assert_eq!(page(&session, 40), [(HARVESTED.to_owned(), 3426)]);
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn a_planet_feature_writes_its_line_beside_the_timed_item_and_takes_both_away() {
    let mut session = open_4_5();
    assert!(features(&session, 585).is_empty());
    let op = add_feature(585, "mineral_poor", &[-1], "pm_mineral_poor");
    let result = mark(&mut session, 585, op, "feature_4_5");
    assert_eq!(
        result.entry.description,
        "Added planet feature pm_mineral_poor (mineral_poor) to Xu Nur I #585"
    );
    assert_eq!(features(&session, 585), ["pm_mineral_poor"]);
    assert_eq!(
        result.inverse,
        remove(585, "mineral_poor", Some("pm_mineral_poor"))
    );

    let removed = session.apply(result.inverse).expect("remove the feature");
    assert_eq!(
        removed.entry.description,
        "Removed planet feature pm_mineral_poor (mineral_poor) from Xu Nur I #585"
    );
    assert!(features(&session, 585).is_empty());
    assert!(page(&session, 585).is_empty());
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn a_feature_without_its_timed_item_is_removed_by_its_line() {
    let mut session = open_4_5();
    assert_eq!(features(&session, GAS_GIANT), [PM_MOONS]);
    assert!(page(&session, GAS_GIANT).is_empty());
    let result = session
        .apply(remove(GAS_GIANT, MOONS, Some(PM_MOONS)))
        .expect("remove the feature");
    assert_eq!(result.inverse, add_feature(GAS_GIANT, MOONS, &[], PM_MOONS));
    assert!(features(&session, GAS_GIANT).is_empty());

    session.apply(result.inverse).expect("write the line back");
    assert_eq!(features(&session, GAS_GIANT), [PM_MOONS]);
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn a_modifier_round_trips_from_the_file_as_opened() {
    round_trip(open_4_5(), add(40, FROZEN, &[720]));
    round_trip(open_4_5(), remove(GAS_GIANT, MOONS, Some(PM_MOONS)));
    round_trip(open_4_5(), add_feature(GAS_GIANT, MOONS, &[-1], PM_MOONS));
    round_trip(
        open_4_5(),
        with_flags(remove(40, HARVESTED, None), &[(STARTING, None)]),
    );
}

#[test]
fn a_modifier_is_refused_for_a_star_an_unknown_planet_or_no_change() {
    let mut session = open_4_5();
    let refusals = [
        (add(99_999, CANDIDATE, &[-1]), "planet 99999 does not exist"),
        (
            add(584, CANDIDATE, &[-1]),
            "Xu Nur #584 is its system's star, which takes no planet modifiers",
        ),
        (
            remove(584, CANDIDATE, None),
            "Xu Nur #584 is its system's star, which takes no planet modifiers",
        ),
        (
            remove(585, CANDIDATE, None),
            "planet 585 does not have terraforming_candidate",
        ),
        (
            remove(585, "mineral_poor", Some("pm_mineral_poor")),
            "planet 585 does not have pm_mineral_poor",
        ),
        (
            add(40, HARVESTED, &[-1]),
            "planet 40 already has harvested_resources_mining",
        ),
        (
            add_feature(GAS_GIANT, MOONS, &[], PM_MOONS),
            "planet 10 already has pm_extensive_moon_system",
        ),
        (add(585, "", &[-1]), "a modifier may not be empty"),
        (
            add(585, "two words", &[-1]),
            "\"two words\" cannot be written as a modifier",
        ),
        (
            add(585, CANDIDATE, &[0]),
            "a modifier cannot last 0 days, or longer than a save can hold: -1 keeps it for ever",
        ),
        (
            add(585, CANDIDATE, &[]),
            "0 copies of a modifier: an op adds or restores 1 to 16",
        ),
        (
            add(585, CANDIDATE, &[-1; 17]),
            "17 copies of a modifier: an op adds or restores 1 to 16",
        ),
    ];
    common::assert_refusals(&mut session, refusals);
}

#[test]
fn removing_two_permanent_copies_has_an_inverse_that_puts_both_back() {
    let mut session = open_edited_sample(SAMPLE_4_5, |gamestate, _| {
        let planet = gamestate
            .find(
                "
		585=
		{",
            )
            .expect("planet 585");
        let anchor = "			bombardment_damage=0
";
        let at = planet
            + gamestate[planet..]
                .find(anchor)
                .expect("its bombardment_damage");
        let item = "					{
						modifier=\"terraforming_candidate\"
						days=-1
					}
 
";
        let block = format!(
            "			timed_modifier=
			{{
				items=
				{{
					
{item}{item}				}}
			}}
"
        );
        gamestate.insert_str(at + anchor.len(), &block);
    });
    let two = vec![(CANDIDATE.to_owned(), -1), (CANDIDATE.to_owned(), -1)];
    assert_eq!(page(&session, 585), two);

    let removed = session
        .apply(remove(585, CANDIDATE, None))
        .expect("remove both copies");
    assert!(page(&session, 585).is_empty());
    assert_eq!(removed.inverse, add(585, CANDIDATE, &[-1, -1]));
    session
        .apply(removed.inverse)
        .expect("apply the removal's inverse");
    assert_eq!(page(&session, 585), two);
    assert!(
        current(&session) == session.doc().original(),
        "the inverse writes the two copies back as the file held them"
    );
}

#[test]
fn a_negative_count_of_days_the_save_holds_is_written_back_as_it_was() {
    let mut session = open();
    let living_sea = ("living_sea".to_owned(), -360);
    assert!(page(&session, 1567).contains(&living_sea));
    let removed = session
        .apply(remove(1567, "living_sea", None))
        .expect("remove the living sea");
    assert_eq!(removed.inverse, add(1567, "living_sea", &[-360]));
    assert!(!page(&session, 1567).contains(&living_sea));

    session.apply(removed.inverse).expect("write it back");
    assert!(page(&session, 1567).contains(&living_sea));
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn an_item_whose_days_are_not_a_number_is_not_removed() {
    let mut session = open_edited_sample(SAMPLE_4_5, |gamestate, _| {
        *gamestate = gamestate.replacen("days=3426", "days=soon", 1);
    });
    let error = session
        .apply(remove(40, HARVESTED, None))
        .expect_err("unreadable days");
    assert!(
        error
            .to_string()
            .contains("harvested_resources_mining lasts \"soon\" days, which is not a number"),
        "{error}"
    );
    assert!(!session.doc().is_dirty());
}

#[test]
fn flags_are_written_with_the_modifier_and_its_removal_takes_them_off() {
    let mut session = open_4_5();
    let both = [(MARKER, None), (KIND, None)];
    let op = with_flags(add(585, CANDIDATE, &[-1]), &both);
    let result = mark(&mut session, 585, op, "flags_4_5");
    assert_eq!(
        result.entry.description,
        "Added modifier terraforming_candidate to Xu Nur I #585"
    );
    assert_eq!(
        result.inverse,
        with_flags(remove(585, CANDIDATE, None), &both)
    );

    let removed = session.apply(result.inverse).expect("remove the candidate");
    assert_eq!(
        removed.entry.description,
        "Removed modifier terraforming_candidate from Xu Nur I #585"
    );
    let dated = [(MARKER, Some(TODAY)), (KIND, Some(TODAY))];
    assert_eq!(
        removed.inverse,
        with_flags(add(585, CANDIDATE, &[-1]), &dated)
    );
    assert_eq!(
        current(&session),
        session.doc().original(),
        "the flags block goes"
    );
}

#[test]
fn a_flag_the_planet_holds_is_left_as_it_is() {
    let mut session = open_4_5();
    let op = with_flags(
        add(1, CANDIDATE, &[-1]),
        &[(STARTING, None), (MARKER, None)],
    );
    let result = mark(&mut session, 1, op, "held_flag_4_5");
    assert_eq!(
        result.inverse,
        with_flags(remove(1, CANDIDATE, None), &[(MARKER, None)])
    );

    session.apply(result.inverse).expect("remove the candidate");
    assert_eq!(
        current(&session),
        session.doc().original(),
        "starting_deposit stays"
    );
}

#[test]
fn removing_a_flag_the_file_holds_has_an_inverse_that_writes_its_date_back() {
    let mut session = open_4_5();
    let op = with_flags(
        remove(40, HARVESTED, None),
        &[(STARTING, None), (MARKER, None)],
    );
    let result = snapshot_step(&mut session, "remove_flags_4_5", op);
    assert_eq!(
        result.inverse,
        with_flags(add(40, HARVESTED, &[3426]), &[(STARTING, Some(DAY_ONE))])
    );
    assert!(page(&session, 40).is_empty());

    session.apply(result.inverse).expect("write both back");
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn a_flag_is_refused_when_it_cannot_be_written() {
    let mut session = open_4_5();
    let refusals = [
        (
            with_flags(add(585, CANDIDATE, &[-1]), &[("two words", None)]),
            "\"two words\" cannot be written as a planet flag",
        ),
        (
            with_flags(
                add(585, CANDIDATE, &[-1]),
                &[(MARKER, None), (MARKER, None)],
            ),
            "\"candidate_marker\" is listed twice as a flag",
        ),
        (
            with_flags(remove(40, HARVESTED, None), &[("", None)]),
            "a planet flag may not be empty",
        ),
    ];
    common::assert_refusals(&mut session, refusals);
}

#[test]
fn a_timed_flag_stays_while_the_modifier_and_the_dated_flags_go() {
    let mut session = open_4_5();
    const TIMED: &str = "3_year_owner_change_flag";
    session
        .apply(with_flags(add(2, CANDIDATE, &[-1]), &[(MARKER, None)]))
        .expect("add the candidate");
    let removed = session
        .apply(with_flags(
            remove(2, CANDIDATE, None),
            &[(TIMED, None), (MARKER, None)],
        ))
        .expect("remove the candidate");
    assert_eq!(
        removed.inverse,
        with_flags(add(2, CANDIDATE, &[-1]), &[(MARKER, Some(TODAY))])
    );
    assert_eq!(
        current(&session),
        session.doc().original(),
        "the timed flag stays"
    );
}

#[test]
fn a_flag_held_twice_goes_and_comes_back_once_with_its_first_date() {
    let mut session = open_edited_sample(SAMPLE_4_5, |gamestate, _| {
        let planets = gamestate
            .find(
                "
planets=",
            )
            .expect("the planets");
        let planet = planets
            + gamestate[planets..]
                .find(
                    "
		40=
		{",
                )
                .expect("planet 40");
        let flag = "starting_deposit=62808000\n";
        let at = planet + gamestate[planet..].find(flag).expect("its flag") + flag.len();
        gamestate.insert_str(at, "\t\t\t\tstarting_deposit=62818000\n");
    });
    let original = current(&session);
    let removed = session
        .apply(with_flags(remove(40, HARVESTED, None), &[(STARTING, None)]))
        .expect("remove the modifier");
    assert_eq!(
        removed.inverse,
        with_flags(add(40, HARVESTED, &[3426]), &[(STARTING, Some(DAY_ONE))])
    );
    let later = b"starting_deposit=62818000";
    assert!(
        !current(&session).windows(later.len()).any(|w| w == later),
        "both copies go"
    );
    session
        .apply(removed.inverse)
        .expect("the inverse is accepted");
    session.undo().expect("undo").expect("an op to undo");
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), original);
}
