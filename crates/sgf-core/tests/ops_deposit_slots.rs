//! Where deposit edits land in the save's deposit table: an empty list written in place,
//! slots taken and given back as tombstones, deposits added in the session or to an added
//! system, and the blockers, stations and colonies whose other entries stay as they were.

use sgf_core::entity::get_planet_page;
use sgf_core::ops::{Op, SystemSpec};
use sgf_core::session::Session;

use crate::common;
use crate::ops_deposits::{GENERATION, add, page, remove, without_dead_deposits};
use common::diff::{plain_report, round_trip_step};
use common::spec::{dorellion, mura};
use common::{current, open, open_4_5, open_edited, text};

/// The 4.4 sample with an empty `deposits` list last in planet 2, which the game never
/// writes and drops on load.
fn with_empty_list() -> Session {
    open_edited(|text| {
        let end = "			atmosphere_width=1
		}
		3=
";
        assert_eq!(text.matches(end).count(), 1);
        let empty = "			atmosphere_width=1
			deposits=
			{
			}
		}
		3=
";
        *text = text.replace(end, empty);
    })
}

#[test]
fn an_add_to_an_empty_list_writes_the_list_in_its_place() {
    let mut session = with_empty_list();
    assert!(page(&session, 2).is_empty());
    let result = round_trip_step(&mut session, "add", add(2, "d_minerals_3"));
    assert_eq!(page(&session, 2), [(GENERATION, "d_minerals_3".to_owned())]);
    common::snapshot("add_to_an_empty_list_4_4", &plain_report(&session, &result));
}

#[test]
fn removing_a_deposit_added_in_the_session_gives_back_the_original_bytes() {
    for (mut session, planet) in [(open_4_5(), 3), (open(), 2)] {
        round_trip_step(&mut session, "first", add(planet, "d_minerals_3"));
        round_trip_step(&mut session, "second", add(planet, "d_energy_2"));
        let first = page(&session, planet)[0].0;
        let second = page(&session, planet)[1].0;
        assert_eq!((first, second), (GENERATION, GENERATION + 1));
        round_trip_step(&mut session, "remove the first", remove(first));
        round_trip_step(&mut session, "remove the second", remove(second));
        assert_eq!(current(&session), session.doc().original());
    }
}

#[test]
fn an_appended_deposit_leaves_the_table_when_it_goes_last() {
    let mut session = without_dead_deposits();
    round_trip_step(&mut session, "first", add(2, "d_minerals_3"));
    round_trip_step(&mut session, "second", add(2, "d_energy_2"));
    let (first, second) = (4994, 4995);
    assert_eq!(
        page(&session, 2),
        [
            (first, "d_minerals_3".to_owned()),
            (second, "d_energy_2".to_owned())
        ]
    );
    round_trip_step(&mut session, "remove the first", remove(first));
    assert!(text(&session).contains(&format!("\n\t{first}=none\n\t{second}=\n")));
    round_trip_step(&mut session, "remove the second", remove(second));
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn a_removed_deposits_slot_is_taken_next_and_given_back_as_its_tombstone() {
    let mut session = without_dead_deposits();
    round_trip_step(&mut session, "remove", remove(26));
    let reused = 26 + GENERATION;
    round_trip_step(&mut session, "add", add(2, "d_minerals_3"));
    assert_eq!(page(&session, 2), [(reused, "d_minerals_3".to_owned())]);
    round_trip_step(&mut session, "add again", add(2, "d_energy_2"));
    round_trip_step(&mut session, "remove the added", remove(reused));
    assert!(text(&session).contains("\n\t26=none\n"));

    // A system added over the removed deposit's slot gives it back as the tombstone too.
    let mut session = without_dead_deposits();
    session.apply(remove(26)).expect("remove");
    let removed = text(&session);
    session
        .apply(Op::AddSystemFromSpec { spec: dorellion() })
        .expect("add");
    assert!(text(&session).contains(&format!(
        "
	{reused}=
"
    )));
    session
        .apply(Op::RemoveSystem { system: 791 })
        .expect("remove");
    assert_eq!(text(&session), removed);
}

/// Both samples with the spike's system and the id it takes.
fn with_system() -> [(Session, SystemSpec, u32); 2] {
    [(open_4_5(), mura(), 601), (open(), dorellion(), 791)]
}

#[test]
fn removing_an_added_system_takes_the_deposits_added_to_it() {
    for (mut session, spec, id) in with_system() {
        session
            .apply(Op::AddSystemFromSpec { spec })
            .expect("add the system");
        let bodies: Vec<u32> = session
            .details()
            .expect("details")
            .raw(id)
            .expect("the system")
            .planets
            .iter()
            .map(|p| p.id)
            .collect();
        let (star, molten) = (bodies[0], bodies[1]);
        round_trip_step(&mut session, "on the star", add(star, "d_energy_2"));
        round_trip_step(&mut session, "on the planet", add(molten, "d_minerals_3"));
        let first_star_deposit = page(&session, star)[0].0;
        round_trip_step(
            &mut session,
            "one the add wrote",
            remove(first_star_deposit),
        );

        let removed = round_trip_step(&mut session, "the system", Op::RemoveSystem { system: id });
        assert_eq!(current(&session), session.doc().original(), "{id}");
        let Op::AddSystemFromSpec { spec } = removed.inverse else {
            panic!("{:?}", removed.inverse);
        };
        assert_eq!(spec.star.deposits, ["d_energy_2"]);
        assert_eq!(spec.planets[0].deposits, ["d_minerals_3"]);
    }
}

#[test]
fn a_station_deposit_a_blocker_and_a_moons_deposit_can_be_removed() {
    let mut session = open_4_5();
    let station = get_planet_page(session.doc(), 13).unwrap().station;
    assert!(station.is_some());
    round_trip_step(&mut session, "under a station", remove(21));
    assert_eq!(get_planet_page(session.doc(), 13).unwrap().station, station);
    assert!(page(&session, 13).is_empty());
    round_trip_step(&mut session, "a blocker", remove(262));
    assert!(page(&session, 135).iter().all(|(id, _)| *id != 262));
}

/// The 4.4 sample's one clearing item, which names a deposit the game had already removed,
/// pointed at Olbers II's Dangerous Wildlife (3401).
fn clearing_wildlife() -> Session {
    open_edited(|text| {
        let item = "deposit=753
					planet=13
";
        assert_eq!(text.matches(item).count(), 1);
        *text = text.replace(
            item,
            "deposit=3401
					planet=5172
",
        );
    })
}

#[test]
fn a_blocker_being_cleared_leaves_its_item_to_the_game() {
    let mut session = clearing_wildlife();
    let before = get_planet_page(session.doc(), 5172).expect("Olbers II");
    assert_eq!(before.clearing.len(), 1);
    assert_eq!(before.clearing[0].deposit, 3401);
    assert_eq!(
        before.clearing[0].cost,
        [("energy".to_owned(), 750.0), ("minerals".to_owned(), 250.0)]
    );
    assert!(
        get_planet_page(open().doc(), 5172)
            .unwrap()
            .clearing
            .is_empty()
    );

    let item = "deposit=3401
					planet=5172
";
    round_trip_step(&mut session, "the blocker", remove(3401));
    assert!(text(&session).contains(
        "
	3401=none
"
    ));
    assert!(text(&session).contains(item));
    let after = get_planet_page(session.doc(), 5172).expect("Olbers II");
    assert!(after.clearing.is_empty());
}

#[test]
fn a_colonys_other_deposits_and_its_districts_are_left_as_they_were() {
    let mut session = open_4_5();
    let colony = |s: &Session| get_planet_page(s.doc(), 2).unwrap().colony.unwrap();
    let before = colony(&session);
    round_trip_step(&mut session, "remove", remove(441));
    round_trip_step(&mut session, "add", add(2, "d_rich_mountain"));
    assert_eq!(colony(&session), before);
    let kinds: Vec<String> = page(&session, 2).into_iter().map(|(_, k)| k).collect();
    assert_eq!(kinds.len(), 13);
    assert_eq!(kinds.last().map(String::as_str), Some("d_rich_mountain"));
}
