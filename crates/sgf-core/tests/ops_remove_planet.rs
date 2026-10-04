//! Deleting a save planet and removing a colony, on the 4.5 and the 4.4 sample: each
//! edit's diff and the entities its inverse writes back, the planet page and the details
//! after a save and reopen, byte-exact undo, and the inverse restoring every entity.

use sgf_core::entity::get_planet_page;
use sgf_core::ops::{Op, SavedTable};
use sgf_core::session::{OpResult, Session};

use similar::{Algorithm, TextDiff};

use crate::common;
use common::diff::{round_trip, unified_diff};
use common::line_diff::{middle, renumbered};
use common::{current, open, open_4_5};

pub(crate) fn delete(planet: u32) -> Op {
    Op::DeleteBody { body: planet }
}

pub(crate) fn remove_colony(planet: u32) -> Op {
    Op::RemoveColony { body: planet }
}

/// The description, the entities the inverse writes back grouped by table, and the diff:
/// `whole`, or else without the hunks that only write tombstones.
fn footprint(session: &Session, result: &OpResult, whole: bool) -> String {
    let (restore, also) = match &result.inverse {
        Op::Batch { ops, .. } => (&ops[0], &ops[1..]),
        restore => (restore, &[][..]),
    };
    let Op::RestoreEntities {
        description,
        entities,
    } = restore
    else {
        panic!("the inverse restores entities: {:?}", result.inverse);
    };
    let mut out = format!(
        "{}\ndetails stale: {:?}\ninverse: {description}\n",
        result.entry.description, result.details_stale
    );
    let mut table: Option<SavedTable> = None;
    for entity in entities {
        if table != Some(entity.table) {
            out.push_str(&format!("\n  {:?}:", entity.table));
            table = Some(entity.table);
        }
        out.push_str(&format!(" {}", entity.id));
    }
    out.push('\n');
    for op in also {
        out.push_str(&format!("  then {op:?}\n"));
    }
    if whole {
        out.push_str(&unified_diff(session, None));
    } else {
        out.push_str(&rewrites(session));
    }
    out
}

/// The hunks of the session's diff that write more than tombstones: the lists and keys the
/// op rewrote, without the entries it only replaced with `<id>=none`.
fn rewrites(session: &Session) -> String {
    let original = String::from_utf8_lossy(session.doc().original()).into_owned();
    let edited = String::from_utf8_lossy(&current(session)).into_owned();
    let (original, edited, skipped) = middle(&original, &edited, 2);
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Patience)
        .diff_lines(original, edited);
    let mut out = String::new();
    for hunk in diff.unified_diff().context_radius(2).iter_hunks() {
        let text = renumbered(&hunk.to_string(), skipped);
        let mut added = text.lines().skip(1).filter(|line| line.starts_with('+'));
        let tombstones_only = added.clone().next().is_some()
            && added.all(|line| line.trim_start_matches('+').trim().ends_with("=none"));
        if !tombstones_only {
            out.push_str(&text);
        }
    }
    out
}

/// The 4.4 sample with planet 217, colony 39 of country 1, controlled by country 3, whose
/// `controlled_planets` lists it.
fn open_occupied() -> Session {
    common::open_edited(|text| {
        let planets = text
            .find(
                "
planets=",
            )
            .expect("planets");
        let entry = planets
            + text[planets..]
                .find(
                    "
		217=
		{",
                )
                .expect("planet 217");
        let owned = "			controller=1
";
        let at = entry + text[entry..].find(owned).expect("its controller");
        text.replace_range(
            at..at + owned.len(),
            "			controller=3
",
        );
        let countries = text
            .find(
                "
country=",
            )
            .expect("countries");
        let three = countries
            + text[countries..]
                .find(
                    "
	3=
	{",
                )
                .expect("country 3");
        let list = "		controlled_planets=
		{
			";
        let at = three + text[three..].find(list).expect("its planets") + list.len();
        text.insert_str(at, "217 ");
    })
}

/// One edit on a sample: its snapshot's name, the session, the op, the system the planet
/// is in, and whether its snapshot keeps the whole diff.
struct Case {
    name: &'static str,
    session: fn() -> Session,
    op: Op,
    system: u32,
    whole: bool,
}

fn cases() -> Vec<Case> {
    vec![
        // A gas giant with two moons, unowned: all three go.
        Case {
            name: "delete_a_planet_with_moons_4_5",
            session: open_4_5,
            op: delete(99),
            system: 140,
            whole: true,
        },
        // A moon alone: it leaves its planet's `moons`, which goes with it.
        Case {
            name: "delete_a_lone_moon_4_5",
            session: open_4_5,
            op: delete(23),
            system: 463,
            whole: true,
        },
        Case {
            name: "delete_a_planet_with_moons_4_4",
            session: open,
            op: delete(81),
            system: 192,
            whole: true,
        },
        Case {
            name: "delete_a_lone_moon_4_4",
            session: open,
            op: delete(12),
            system: 217,
            whole: true,
        },
        // A fallen empire's colony without a starbase at it.
        Case {
            name: "remove_a_colony_4_5",
            session: open_4_5,
            op: remove_colony(517),
            system: 174,
            whole: false,
        },
        // An empire's second colony, a year in.
        Case {
            name: "remove_a_colony_4_4",
            session: open,
            op: remove_colony(217),
            system: 137,
            whole: false,
        },
        // The capital of country 16777222 and its species' home planet.
        Case {
            name: "remove_a_capital_colony_4_5",
            session: open_4_5,
            op: remove_colony(77),
            system: 564,
            whole: false,
        },
        // A capital and home planet deleted with its colony.
        Case {
            name: "delete_a_capital_4_4",
            session: open,
            op: delete(96),
            system: 537,
            whole: false,
        },
        // A home planet with no colony on it.
        Case {
            name: "delete_a_home_planet_4_5",
            session: open_4_5,
            op: delete(726),
            system: 18,
            whole: true,
        },
        // An army building at the colony: the item stays in the queue, which loses its owner.
        Case {
            name: "remove_a_colony_under_construction_4_5",
            session: open_4_5,
            op: remove_colony(385),
            system: 513,
            whole: false,
        },
        // Colony 39 of country 1, occupied by country 3, which lists the planet too.
        Case {
            name: "remove_an_occupied_colony_4_4",
            session: open_occupied,
            op: remove_colony(217),
            system: 137,
            whole: false,
        },
        Case {
            name: "delete_a_habitat_4_5",
            session: open_4_5,
            op: delete(6268),
            system: 596,
            whole: true,
        },
        // A fallen empire's colony whose `orbital_defence` is the system's own citadel, which
        // stays: the planet only loses the key.
        Case {
            name: "remove_a_colony_at_the_system_starbase_4_5",
            session: open_4_5,
            op: remove_colony(318),
            system: 400,
            whole: false,
        },
        // A moon of the player's capital with a mining station, which goes with it.
        Case {
            name: "delete_a_moon_with_a_station_4_5",
            session: open_4_5,
            op: delete(8),
            system: 169,
            whole: true,
        },
        // A planet with an anomaly waiting on it: the key goes with the tombstone.
        Case {
            name: "delete_a_planet_with_an_anomaly_4_5",
            session: open_4_5,
            op: delete(1159),
            system: 62,
            whole: false,
        },
        // Moon 185's anomaly, which country 16777221 has found: the moon leaves its list,
        // and planet 182 stays in it.
        Case {
            name: "delete_a_moon_with_a_found_anomaly_4_5",
            session: open_4_5,
            op: delete(185),
            system: 496,
            whole: false,
        },
        // A planet a `saved_event_target` names, which is left for the game.
        Case {
            name: "delete_an_event_target_4_5",
            session: open_4_5,
            op: delete(4913),
            system: 448,
            whole: false,
        },
        // Site 0, Lost Moments, on an unowned planet: its entry goes too.
        Case {
            name: "delete_a_planet_with_a_dig_site_4_5",
            session: open_4_5,
            op: delete(703),
            system: 12,
            whole: true,
        },
        Case {
            name: "delete_a_colonised_planet_4_5",
            session: open_4_5,
            op: delete(528),
            system: 177,
            whole: false,
        },
        Case {
            name: "delete_a_colonised_planet_4_4",
            session: open,
            op: delete(247),
            system: 237,
            whole: false,
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
        common::snapshot(case.name, &footprint(&session, &result, case.whole));
    }
}

/// The cases whose edit is an `examples` op on the same sample, which the every-op sweeps in
/// `ops_history` undo and invert already.
const SWEPT: [&str; 2] = ["delete_a_lone_moon_4_4", "remove_a_colony_4_4"];

fn unswept() -> impl Iterator<Item = Case> {
    cases()
        .into_iter()
        .filter(|case| !SWEPT.contains(&case.name))
}

#[test]
fn undo_puts_back_every_byte() {
    for case in unswept() {
        round_trip((case.session)(), case.op);
    }
}

#[test]
fn the_inverse_writes_back_every_entity() {
    for case in unswept() {
        let mut session = (case.session)();
        let before = current(&session);
        let result = session.apply(case.op.clone()).expect(case.name);
        let sited = matches!(result.inverse, Op::Batch { .. });
        session.apply_inverse(result.inverse).expect(case.name);
        if !sited {
            assert_eq!(current(&session), before, "{}", case.name);
        }
    }
}

#[test]
fn a_saved_edit_reopens_on_the_planet_page_and_in_the_details() {
    for case in cases() {
        let mut session = (case.session)();
        let result = session.apply(case.op.clone()).expect(case.name);
        let reopened = common::reopened(&mut session);
        let listed: Vec<u32> = common::planets(&reopened, case.system)
            .iter()
            .map(|p| p.id)
            .collect();
        match case.op {
            Op::DeleteBody { body: planet } => {
                assert!(
                    get_planet_page(reopened.doc(), planet).is_err(),
                    "{}",
                    case.name
                );
                assert!(!listed.contains(&planet), "{}", case.name);
                assert!(!common::planet_ids(&reopened, case.system).contains(&planet));
            }
            Op::RemoveColony { body: planet } => {
                let page = get_planet_page(reopened.doc(), planet).expect(case.name);
                assert_eq!(page.colony, None, "{}", case.name);
                assert_eq!(page.owner, None, "{}", case.name);
                assert_eq!(page.controller, None, "{}", case.name);
                assert!(listed.contains(&planet), "{}", case.name);
            }
            _ => unreachable!(),
        }
        assert!(!result.entry.description.is_empty());
    }
}

#[test]
fn the_inverse_of_the_inverse_deletes_again() {
    for case in cases() {
        let mut session = (case.session)();
        let result = session.apply(case.op.clone()).expect(case.name);
        let edited = current(&session);
        let restored = session.apply_inverse(result.inverse).expect(case.name);
        session.apply_inverse(restored.inverse).expect(case.name);
        assert_eq!(current(&session), edited, "{}", case.name);
    }
}
