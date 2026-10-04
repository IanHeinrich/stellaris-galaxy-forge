//! Adding a deposit to a save planet and removing one, on the 4.5 and the 4.4 sample, a
//! colony included: each edit's diff, the planet page and the details after a save and
//! reopen, the save's findings, byte-exact undo, a deposit added in the session giving its
//! slot back, a system added in the session taking the deposits added to it, a blocker
//! being cleared, and what is refused.

use sgf_core::entity::get_planet_page;
use sgf_core::ops::{Op, OpError, SystemSpec};
use sgf_core::session::Session;

use crate::common;
use common::diff::{plain_report, report, round_trip, round_trip_step};
use common::spec::{dorellion, mura};
use common::{current, findings, open, open_3_4, open_4_5, open_edited, text};

const GENERATION: u32 = 1 << 24;

fn add(planet: u32, kind: &str) -> Op {
    Op::AddDeposit {
        body: planet,
        kind: kind.to_owned(),
    }
}

fn remove(deposit: u32) -> Op {
    Op::RemoveDeposit { deposit }
}

/// The deposits planet `id`'s page lists, as (id, type).
fn page(session: &Session, id: u32) -> Vec<(u32, String)> {
    get_planet_page(&session.doc, id)
        .unwrap_or_else(|e| panic!("planet {id}: {e}"))
        .deposits
        .into_iter()
        .map(|d| (d.id, d.kind))
        .collect()
}

/// The deposit keys the details list for `planet` of `system`.
fn details(session: &Session, system: u32, planet: u32) -> Vec<(String, u32)> {
    let planets = common::planets(session, system);
    let body = planets.into_iter().find(|p| p.id == planet);
    body.expect("the planet").deposits
}

/// One edit on a sample: its snapshot's name, the session, the op, the system the planet
/// is in, and the planet.
struct Case {
    name: &'static str,
    session: fn() -> Session,
    op: Op,
    system: u32,
    planet: u32,
}

fn cases() -> Vec<Case> {
    vec![
        // A barren moon of the 4.5 homeworld, with no deposits: slot 0 at generation 1.
        Case {
            name: "add_to_a_moon_without_deposits_4_5",
            session: open_4_5,
            op: add(3, "d_minerals_3"),
            system: 169,
            planet: 3,
        },
        Case {
            name: "add_to_a_star_4_5",
            session: open_4_5,
            op: add(0, "d_energy_2"),
            system: 169,
            planet: 0,
        },
        // Meissa I, unowned with nine deposits: Prosperous Mesa from the middle.
        Case {
            name: "remove_from_the_middle_4_5",
            session: open_4_5,
            op: remove(257),
            system: 408,
            planet: 135,
        },
        // Grekil IV's only deposit: the list goes with it.
        Case {
            name: "remove_the_last_4_5",
            session: open_4_5,
            op: remove(16_777_696),
            system: 59,
            planet: 1129,
        },
        // The 4.5 player's capital, colony 0: the same entry and list as on any planet,
        // and nothing of the colony's own.
        Case {
            name: "add_to_a_capital_4_5",
            session: open_4_5,
            op: add(2, "d_minerals_3"),
            system: 169,
            planet: 2,
        },
        Case {
            name: "remove_from_a_capital_4_5",
            session: open_4_5,
            op: remove(440),
            system: 169,
            planet: 2,
        },
        Case {
            name: "add_to_a_planet_without_deposits_4_4",
            session: open,
            op: add(2, "d_minerals_3"),
            system: 217,
            planet: 2,
        },
        Case {
            name: "remove_the_last_4_4",
            session: open,
            op: remove(26),
            system: 217,
            planet: 5,
        },
        Case {
            name: "remove_from_the_middle_4_4",
            session: open,
            op: remove(367),
            system: 694,
            planet: 230,
        },
    ]
}

#[test]
fn each_edit_is_written_as_the_game_writes_it() {
    for case in cases() {
        let mut session = (case.session)();
        let result = session.apply(case.op.clone()).expect(case.name);
        assert_eq!(result.details_stale, [case.system], "{}", case.name);
        assert!(!result.reclassifies, "{}", case.name);
        common::snapshot(case.name, &report(&session, &result));
    }
}

#[test]
fn the_ids_the_edits_take_and_their_inverses() {
    let mut session = open_4_5();
    let added = session.apply(add(3, "d_minerals_3")).expect("add");
    assert_eq!(added.inverse, remove(GENERATION));
    assert_eq!(
        added.entry.description,
        "Added d_minerals_3 (#16777216) to planet #3"
    );
    assert_eq!(page(&session, 3), [(GENERATION, "d_minerals_3".to_owned())]);
    let removed = session.apply(remove(257)).expect("remove");
    assert_eq!(removed.inverse, add(135, "d_prosperous_mesa"));
    assert_eq!(
        removed.entry.description,
        "Removed d_prosperous_mesa (#257) from planet #135"
    );
    let text = text(&session);
    assert!(text.contains("\n\t257=none\n"));
    assert!(text.contains(&format!(
        "\n\t{GENERATION}=\n\t{{\n\t\ttype=\"d_minerals_3\""
    )));
}

#[test]
fn a_saved_edit_reopens_on_the_planet_page_and_in_the_details() {
    for case in cases() {
        let mut session = (case.session)();
        let before_findings = findings(&session);
        let before = page(&session, case.planet);
        session.apply(case.op.clone()).expect(case.name);
        let edited = page(&session, case.planet);
        let listed = details(&session, case.system, case.planet);
        assert_ne!(edited, before, "{}: the page", case.name);
        match &case.op {
            Op::AddDeposit { kind, .. } => {
                assert_eq!(edited.len(), before.len() + 1, "{}", case.name);
                assert_eq!(&edited.last().unwrap().1, kind, "{}", case.name);
                assert!(listed.iter().any(|(k, _)| k == kind), "{listed:?}");
            }
            Op::RemoveDeposit { deposit } => {
                assert_eq!(edited.len() + 1, before.len(), "{}", case.name);
                assert!(edited.iter().all(|(id, _)| id != deposit), "{}", case.name);
            }
            _ => unreachable!(),
        }

        let reopened = common::reopened(&mut session);
        assert_eq!(page(&reopened, case.planet), edited, "{}", case.name);
        assert_eq!(
            details(&reopened, case.system, case.planet),
            listed,
            "{}",
            case.name
        );
        assert_eq!(findings(&reopened), before_findings, "{}", case.name);
    }
}

#[test]
fn undo_puts_back_the_bytes_and_redo_writes_them_again() {
    for case in cases() {
        round_trip((case.session)(), case.op);
    }
    round_trip(
        open_4_5(),
        Op::Batch {
            description: "Moved a deposit".to_owned(),
            ops: vec![remove(21), add(12, "d_minerals_5")],
        },
    );
}

#[test]
fn a_batch_add_takes_the_slot_its_removal_freed_and_undoes_to_the_original() {
    let mut session = without_dead_deposits();
    let result = round_trip_step(
        &mut session,
        "the batch",
        Op::Batch {
            description: "Moved a deposit".to_owned(),
            ops: vec![remove(26), add(2, "d_minerals_3")],
        },
    );
    let reused = 26 + GENERATION;
    assert_eq!(page(&session, 2), [(reused, "d_minerals_3".to_owned())]);
    assert!(page(&session, 5).is_empty());
    assert_eq!(
        result.inverse,
        Op::Batch {
            description: "Moved a deposit".to_owned(),
            ops: vec![remove(reused), add(5, "d_minerals_3")],
        }
    );
    session.undo().expect("undo").expect("the batch");
    assert_eq!(current(&session), session.doc.original());
}

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
        assert_eq!(current(&session), session.doc.original());
    }
}

/// The 4.4 sample with every tombstone taken out of its deposit table, so that an add
/// appends past the last entry.
fn without_dead_deposits() -> Session {
    open_edited(|text| {
        let start = text.find("\ndeposit=\n{\n").expect("the deposit table") + 1;
        let end = start + text[start..].find("\n}\n").expect("its end");
        let table: String = text[start..end]
            .split_inclusive('\n')
            .filter(|line| !line.ends_with("=none\n"))
            .collect();
        text.replace_range(start..end, &table);
    })
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
    assert_eq!(current(&session), session.doc.original());
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
        assert_eq!(current(&session), session.doc.original(), "{id}");
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
    let station = get_planet_page(&session.doc, 13).unwrap().station;
    assert!(station.is_some());
    round_trip_step(&mut session, "under a station", remove(21));
    assert_eq!(get_planet_page(&session.doc, 13).unwrap().station, station);
    assert!(page(&session, 13).is_empty());
    round_trip_step(&mut session, "a blocker", remove(262));
    assert!(page(&session, 135).iter().all(|(id, _)| *id != 262));
}

/// A deposit type is one key whichever op writes it, and both refuse the same ones.
#[test]
fn a_deposit_type_is_checked_the_same_way_by_both_ops() {
    for kind in ["", "d minerals", "d_{x}", "d=x", "d_\"x", "d_é", "d_\u{7}"] {
        let on_planet = refused(&mut open_4_5(), add(3, kind));
        let mut spec = mura();
        spec.planets[0].deposits = vec![kind.to_owned()];
        let in_system = refused(&mut open_4_5(), Op::AddSystemFromSpec { spec });
        assert_eq!(on_planet.to_string(), in_system.to_string());
        assert!(
            matches!(
                on_planet,
                OpError::EmptyText {
                    what: "a deposit type"
                } | OpError::InvalidText {
                    what: "a deposit type",
                    ..
                }
            ),
            "{kind:?}: {on_planet}"
        );
    }
}

fn refused(session: &mut Session, op: Op) -> OpError {
    let error = session.apply(op).expect_err("refused");
    assert!(!session.doc.is_dirty(), "{error}");
    error
}

#[test]
fn what_the_ops_refuse() {
    let mut session = open_4_5();
    let cases: Vec<(Op, &str)> = vec![
        (add(99_999, "d_minerals_3"), "planet 99999 does not exist"),
        (remove(999_999), "deposit 999999 does not exist"),
        (remove(0), "deposit 0 does not exist"),
        (remove(96), "deposit 96 is not held by a planet"),
        (add(3, ""), "a deposit type may not be empty"),
        (
            add(3, "d minerals"),
            "\"d minerals\" cannot be written as a deposit type",
        ),
        (
            add(3, "d_\"x"),
            "\"d_\\\"x\" cannot be written as a deposit type",
        ),
    ];
    common::assert_refusals(&mut session, cases);

    session.apply(remove(257)).expect("remove");
    assert!(matches!(
        session.apply(remove(257)),
        Err(OpError::UnknownDeposit(257))
    ));

    let mut rift = open_edited(|text| {
        let held =
            "\n\t26=\n\t{\n\t\ttype=\"d_minerals_3\"\n\t\tdeposit_holder=\n\t\t{\n\t\t\ttype=0\n";
        assert!(text.contains(held));
        *text = text.replace(held, &held.replace("type=0", "type=1"));
    });
    assert!(matches!(
        refused(&mut rift, remove(26)),
        OpError::DepositNotOnPlanet(26)
    ));

    let mut old = open_3_4();
    assert!(matches!(
        refused(&mut old, add(3, "d_minerals_3")),
        OpError::VersionTooOld(_)
    ));
    assert!(matches!(
        refused(&mut old, remove(16)),
        OpError::VersionTooOld(_)
    ));
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
    let before = get_planet_page(&session.doc, 5172).expect("Olbers II");
    assert_eq!(before.clearing.len(), 1);
    assert_eq!(before.clearing[0].deposit, 3401);
    assert_eq!(
        before.clearing[0].cost,
        [("energy".to_owned(), 750.0), ("minerals".to_owned(), 250.0)]
    );
    assert!(
        get_planet_page(&open().doc, 5172)
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
    let after = get_planet_page(&session.doc, 5172).expect("Olbers II");
    assert!(after.clearing.is_empty());
}

#[test]
fn a_colonys_other_deposits_and_its_districts_are_left_as_they_were() {
    let mut session = open_4_5();
    let colony = |s: &Session| get_planet_page(&s.doc, 2).unwrap().colony.unwrap();
    let before = colony(&session);
    round_trip_step(&mut session, "remove", remove(441));
    round_trip_step(&mut session, "add", add(2, "d_rich_mountain"));
    assert_eq!(colony(&session), before);
    let kinds: Vec<String> = page(&session, 2).into_iter().map(|(_, k)| k).collect();
    assert_eq!(kinds.len(), 13);
    assert_eq!(kinds.last().map(String::as_str), Some("d_rich_mountain"));
}
