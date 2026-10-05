//! Restoring what a planet deletion took, and the deletions that follow other edits: a dig
//! site comes back last in its table, a restore names its entities and writes one statement
//! per text, an added or reclassed planet is deleted, and what is refused.

use sgf_core::entity::{PlanetPageDigSite, get_planet_page};
use sgf_core::ops::{ClassChange, Op, OpError, PlanetClassRule, SavedEntity, SavedTable};
use sgf_core::session::Session;

use crate::common;
use crate::ops_remove_planet::{delete, remove_colony};
use common::diff::round_trip_step;
use common::examples::{ADDED_BODY, meissa_v};
use common::{current, open_3_4, open_4_5, text};

#[test]
fn a_dig_site_comes_back_on_its_planet_last_in_the_table() {
    let mut session = open_4_5();
    let before = get_planet_page(session.doc(), 703)
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
            body: 703,
            site_type: "site_lost_moments".to_owned(),
            difficulty: 1,
        }
    );
    session.apply_inverse(result.inverse).expect("the inverse");
    let after = get_planet_page(session.doc(), 703)
        .expect("the planet")
        .dig_site;
    let kind = |site: &Option<_>| site.as_ref().map(|s: &PlanetPageDigSite| s.kind.clone());
    assert_eq!(kind(&after), kind(&before));
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
    let Op::RestoreEntities {
        description,
        mut entities,
    } = result.inverse
    else {
        panic!("a restore");
    };
    entities[0].id += 1;
    let error = session
        .apply_inverse(Op::RestoreEntities {
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
    let two = Op::RestoreEntities {
        description: "Two".to_owned(),
        entities: vec![SavedEntity {
            table: SavedTable::Planet,
            id: 23,
            text: "23=none\n24=none".to_owned(),
        }],
    };
    let error = session.apply_inverse(two).expect_err("two statements");
    assert!(matches!(error, OpError::EntityMismatch { .. }), "{error}");
    assert_eq!(current(&session), before);
}

/// A body added since the file was opened goes as `RemoveBody` takes it, its anomaly
/// with it: the file is as it was before the add, undo puts the body back, and so does the
/// inverse.
#[test]
fn an_added_body_is_deleted_as_its_removal_takes_it() {
    let found = Op::AddAnomaly {
        body: ADDED_BODY,
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
    let ocean = |planet| Op::SetBodyClass {
        body: planet,
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
        assert!(get_planet_page(session.doc(), planet).is_err(), "{planet}");
        session.apply_inverse(result.inverse).expect("the inverse");
        assert_eq!(current(&session), changed, "{planet}");
        let page = get_planet_page(session.doc(), planet).expect("the planet");
        assert_eq!(page.class, "pc_ocean");
    }
}
