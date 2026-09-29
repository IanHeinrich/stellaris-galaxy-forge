//! Deleting a save planet and removing a colony, on the 4.5 and the 4.4 sample: each
//! edit's diff and the entities its inverse writes back, the planet page and the details
//! after a save and reopen, byte-exact undo, the inverse restoring every entity, and what is
//! refused.

use sgf_core::entity::get_planet_page;
use sgf_core::ops::{Op, OpError, SavedTable};
use sgf_core::session::{OpResult, Session};

use similar::{Algorithm, TextDiff};

use crate::common;
use common::diff::{round_trip, unified_diff};
use common::{current, open, open_3_4, open_4_5, text};

fn delete(planet: u32) -> Op {
    Op::DeleteSavePlanet { planet }
}

fn remove_colony(planet: u32) -> Op {
    Op::RemoveColony { planet }
}

/// The description, the entities the inverse writes back grouped by table, and the diff:
/// `whole`, or else without the hunks that only write tombstones.
fn footprint(session: &Session, result: &OpResult, whole: bool) -> String {
    let Op::RestoreSaveEntities {
        description,
        entities,
    } = &result.inverse
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
    let original = String::from_utf8_lossy(session.doc.original()).into_owned();
    let edited = String::from_utf8_lossy(&current(session)).into_owned();
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Patience)
        .diff_lines(&original, &edited);
    let mut out = String::new();
    for hunk in diff.unified_diff().context_radius(2).iter_hunks() {
        let text = hunk.to_string();
        let mut added = text.lines().skip(1).filter(|line| line.starts_with('+'));
        let tombstones_only = added.clone().next().is_some()
            && added.all(|line| line.trim_start_matches('+').trim().ends_with("=none"));
        if !tombstones_only {
            out.push_str(&text);
        }
    }
    out
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

#[test]
fn undo_puts_back_every_byte() {
    for case in cases() {
        round_trip((case.session)(), case.op);
    }
}

#[test]
fn the_inverse_writes_back_every_entity() {
    for case in cases() {
        let mut session = (case.session)();
        let before = current(&session);
        let result = session.apply(case.op.clone()).expect(case.name);
        session.apply(result.inverse).expect(case.name);
        assert_eq!(current(&session), before, "{}", case.name);
    }
}

#[test]
fn a_saved_edit_reopens_on_the_planet_page_and_in_the_details() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for case in cases() {
        let mut session = (case.session)();
        let result = session.apply(case.op.clone()).expect(case.name);
        let path = dir.path().join(format!("{}.sav", case.name));
        session.save_as(&path).expect("save");
        let reopened = Session::open(&path).expect("reopen");
        let listed: Vec<u32> = common::planets(&reopened, case.system)
            .iter()
            .map(|p| p.id)
            .collect();
        match case.op {
            Op::DeleteSavePlanet { planet } => {
                assert!(
                    get_planet_page(&reopened.doc, planet).is_err(),
                    "{}",
                    case.name
                );
                assert!(!listed.contains(&planet), "{}", case.name);
                assert!(!common::planet_ids(&reopened, case.system).contains(&planet));
            }
            Op::RemoveColony { planet } => {
                let page = get_planet_page(&reopened.doc, planet).expect(case.name);
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
fn the_descriptions_name_what_goes() {
    let mut session = open_4_5();
    let moons = session.apply(delete(99)).expect("delete");
    assert_eq!(
        moons.entry.description,
        "Deleted planet #99 and its 2 moons"
    );
    let moon = session.apply(delete(23)).expect("delete");
    assert_eq!(moon.entry.description, "Deleted moon #23");
    let colonised = session.apply(delete(528)).expect("delete");
    assert_eq!(
        colonised.entry.description,
        "Deleted planet #528 and its moon, with a colony"
    );
    let text = text(&session);
    for id in [99, 100, 101, 23, 528] {
        assert!(text.contains(&format!("\n\t\t{id}=none\n")), "{id}");
    }
}

/// The refusal `op` gets on `session`, as the app shows it.
fn refusal(mut session: Session, op: Op) -> String {
    let before = current(&session);
    let error = session.apply(op).expect_err("a refusal");
    assert_eq!(current(&session), before);
    error.to_string()
}

/// A refusal's name, the sample, the op and the message.
type Refused = (&'static str, fn() -> Session, Op, &'static str);

#[test]
fn what_is_refused() {
    let cases: [Refused; 14] = [
        (
            "star",
            open_4_5,
            delete(0),
            "planet 0 is a star: only a planet or moon can be deleted",
        ),
        (
            "capital",
            open_4_5,
            remove_colony(2),
            "the colony on planet 2 cannot be removed: it is the capital of country 0",
        ),
        (
            "capital deleted",
            open_4_5,
            delete(2),
            "the colony on planet 2 cannot be removed: it is the capital of country 0",
        ),
        (
            "citadel",
            open_4_5,
            remove_colony(318),
            "the colony on planet 318 cannot be removed: its starbase is starbase_level_deep_space_citadel_3, not an orbital ring, which has not been tried in game",
        ),
        (
            "construction",
            open_4_5,
            remove_colony(385),
            "the colony on planet 385 cannot be removed: construction is under way there: cancel it in game first",
        ),
        (
            "no colony",
            open_4_5,
            remove_colony(71),
            "planet 71 has no colony",
        ),
        (
            "station",
            open_4_5,
            delete(8),
            "planet 8 cannot be deleted: it has a mining or research station",
        ),
        (
            "station on a moon",
            open_4_5,
            delete(71),
            "planet 72 cannot be deleted: it has a mining or research station",
        ),
        (
            "anomaly",
            open_4_5,
            delete(1159),
            "planet 1159 cannot be deleted: it has an anomaly",
        ),
        (
            "habitat",
            open_4_5,
            delete(6268),
            "planet 6268 cannot be deleted: it is a habitat or ring world segment, which has not been tried in game",
        ),
        (
            "megastructure",
            open_4_5,
            delete(936),
            "planet 936 cannot be deleted: a megastructure stands on or around it, which has not been tried in game",
        ),
        (
            "site",
            open_4_5,
            delete(703),
            "planet 703 cannot be deleted: it has an archaeological site",
        ),
        (
            "event target",
            open_4_5,
            delete(4913),
            "planet 4913 cannot be deleted: an event target names it",
        ),
        (
            "3.x",
            open_3_4,
            delete(1),
            "this edit needs a save from Stellaris 4.0 or later, not Cepheus v3.4.5",
        ),
    ];
    for (name, session, op, expected) in cases {
        assert_eq!(refusal(session(), op), expected, "{name}");
    }
}

#[test]
fn a_restore_names_its_entities_by_id() {
    let mut session = open_4_5();
    let result = session.apply(delete(23)).expect("delete");
    let Op::RestoreSaveEntities {
        description,
        mut entities,
    } = result.inverse
    else {
        panic!("a restore");
    };
    entities[0].id += 1;
    let error = session
        .apply(Op::RestoreSaveEntities {
            description,
            entities,
        })
        .expect_err("a mismatch");
    assert!(matches!(error, OpError::EntityMismatch { .. }), "{error}");
}
