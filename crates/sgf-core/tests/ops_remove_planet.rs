//! Deleting a save planet and removing a colony, on the 4.5 and the 4.4 sample: each
//! edit's diff and the entities its inverse writes back, the planet page and the details
//! after a save and reopen, byte-exact undo, the inverse restoring every entity, and what is
//! refused.

use sgf_core::entity::{PlanetPageDigSite, get_planet_page};
use sgf_core::ops::{ClassChange, Op, OpError, PlanetClassRule, SavedEntity, SavedTable};
use sgf_core::session::{OpResult, Session};

use similar::{Algorithm, TextDiff};

use crate::common;
use common::diff::{round_trip, round_trip_step, unified_diff};
use common::examples::{ADDED_BODY, meissa_v};
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
    let (restore, also) = match &result.inverse {
        Op::Batch { ops, .. } => (&ops[0], &ops[1..]),
        restore => (restore, &[][..]),
    };
    let Op::RestoreSaveEntities {
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
        let sited = matches!(result.inverse, Op::Batch { .. });
        session.apply(result.inverse).expect(case.name);
        if !sited {
            assert_eq!(current(&session), before, "{}", case.name);
        }
    }
}

#[test]
fn a_dig_site_comes_back_on_its_planet_last_in_the_table() {
    let mut session = open_4_5();
    let before = get_planet_page(&session.doc, 703)
        .expect("the planet")
        .dig_site;
    let result = session.apply(delete(703)).expect("delete");
    assert_eq!(
        result.entry.description,
        "Deleted planet #703, and a dig site"
    );
    let lost = |text: &str| text.matches("type=\"site_lost_moments\"").count();
    assert_eq!(lost(&text(&session)) + 1, lost(&text(&open_4_5())));
    let Op::Batch { ops, .. } = &result.inverse else {
        panic!("a batch: {:?}", result.inverse);
    };
    assert_eq!(
        ops[1],
        Op::AddDigSite {
            planet: 703,
            site_type: "site_lost_moments".to_owned(),
            difficulty: 1,
        }
    );
    session.apply(result.inverse).expect("the inverse");
    let after = get_planet_page(&session.doc, 703)
        .expect("the planet")
        .dig_site;
    let kind = |site: &Option<_>| site.as_ref().map(|s: &PlanetPageDigSite| s.kind.clone());
    assert_eq!(kind(&after), kind(&before));
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
    let cases: [Refused; 5] = [
        (
            "star",
            open_4_5,
            delete(0),
            "planet 0 is a star: only a planet or moon can be deleted",
        ),
        (
            "ring world",
            open_4_5,
            delete(2445),
            "planet 2445 cannot be deleted: it is a ring world segment, which has not been tried in game",
        ),
        (
            "no colony",
            open_4_5,
            remove_colony(71),
            "planet 71 has no colony",
        ),
        (
            "megastructure",
            open_4_5,
            delete(936),
            "planet 936 cannot be deleted: a megastructure stands on or around it, which has not been tried in game",
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

#[test]
fn a_restore_takes_one_statement_per_text() {
    let mut session = open_4_5();
    let before = current(&session);
    let two = Op::RestoreSaveEntities {
        description: "Two".to_owned(),
        entities: vec![SavedEntity {
            table: SavedTable::Planet,
            id: 23,
            text: "23=none\n24=none".to_owned(),
        }],
    };
    let error = session.apply(two).expect_err("two statements");
    assert!(matches!(error, OpError::EntityMismatch { .. }), "{error}");
    assert_eq!(current(&session), before);
}

#[test]
fn the_inverse_of_the_inverse_deletes_again() {
    for case in cases() {
        let mut session = (case.session)();
        let result = session.apply(case.op.clone()).expect(case.name);
        let edited = current(&session);
        let restored = session.apply(result.inverse).expect(case.name);
        session.apply(restored.inverse).expect(case.name);
        assert_eq!(current(&session), edited, "{}", case.name);
    }
}

/// A body added since the file was opened goes as `RemoveAddedBody` takes it, its anomaly
/// with it: the file is as it was before the add, undo puts the body back, and so does the
/// inverse.
#[test]
fn an_added_body_is_deleted_as_its_removal_takes_it() {
    let found = Op::AddAnomaly {
        planet: ADDED_BODY,
        category: "asteroid_uninhabitable_category".to_owned(),
        found_by: Some(vec![0]),
    };
    for edits in [vec![meissa_v()], vec![meissa_v(), found]] {
        let mut session = open_4_5();
        let before = current(&session);
        for op in edits {
            session.apply(op).expect("an edit before the deletion");
        }
        let added = current(&session);
        let result = round_trip_step(&mut session, "delete", delete(ADDED_BODY));
        assert_eq!(
            result.entry.description,
            format!("Deleted planet #{ADDED_BODY}")
        );
        assert_eq!(current(&session), before);
        session.apply(result.inverse).expect("the inverse");
        assert_eq!(current(&session), added);
    }
}

/// Barren 585, with its moon, made an ocean world, and Meissa V, added this session, made one too: each is
/// deleted, and undo and the inverse each put back the planet with its new class.
#[test]
fn a_planet_whose_class_changed_is_deleted() {
    let rule = |class: &str, change| PlanetClassRule {
        class: class.to_owned(),
        change,
        models: 3,
    };
    let ocean = |planet| Op::SetPlanetClass {
        planet,
        from: rule("pc_barren", ClassChange::Uncolonised),
        to: rule("pc_ocean", ClassChange::Any),
        look: None,
    };
    let cases = [
        (vec![ocean(585)], 585, " and its moon"),
        (vec![meissa_v(), ocean(ADDED_BODY)], ADDED_BODY, ""),
    ];
    for (edits, planet, moons) in cases {
        let mut session = open_4_5();
        for op in edits {
            session.apply(op).expect("an edit before the deletion");
        }
        let changed = current(&session);
        let result = round_trip_step(&mut session, "delete", delete(planet));
        assert_eq!(
            result.entry.description,
            format!("Deleted planet #{planet}{moons}")
        );
        assert!(get_planet_page(&session.doc, planet).is_err(), "{planet}");
        session.apply(result.inverse).expect("the inverse");
        assert_eq!(current(&session), changed, "{planet}");
        let page = get_planet_page(&session.doc, planet).expect("the planet");
        assert_eq!(page.class, "pc_ocean");
    }
}
