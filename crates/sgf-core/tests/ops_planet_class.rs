//! The planet class op on the 4.5 sample: the diff each change produces is snapshotted, undo
//! and the inverse each put the original bytes back, and the refusals name what they refuse.
//! The install's rules for each class are written out here, as the app sends them.

use sgf_core::entity::get_planet_page;
use sgf_core::ops::{ClassChange, Op, PlanetClassRule};
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::{current, open_3_4, open_4_5};

/// What the install says of `class`, as far as these tests need it.
fn rule(class: &str) -> PlanetClassRule {
    let (change, models) = match class {
        "pc_continental" => (ClassChange::Any, 4),
        "pc_ocean" | "pc_arid" => (ClassChange::Any, 3),
        "pc_nuked" => (ClassChange::Any, 1),
        "pc_barren" => (ClassChange::Uncolonised, 3),
        "pc_gas_giant" => (ClassChange::Uncolonised, 5),
        "pc_city" => (ClassChange::Uncolonised, 1),
        _ => (ClassChange::Never, 1),
    };
    PlanetClassRule {
        class: class.to_owned(),
        change,
        models,
    }
}

fn set(planet: u32, from: &str, to: &str) -> Op {
    Op::SetPlanetClass {
        planet,
        from: rule(from),
        to: rule(to),
        look: None,
    }
}

/// Planet `id`'s class, model index and model, as its page reads them from the bytes.
fn look(session: &Session, id: u32) -> (String, Option<String>) {
    let page = get_planet_page(&session.doc, id).unwrap_or_else(|e| panic!("planet {id}: {e}"));
    (page.class, page.entity_name)
}

/// Snapshot `planet` made `to`, check the page reads it, that undo and then the inverse
/// applied as an op each put the original bytes back, and that the details refresh in place.
fn change(planet: u32, from: &str, to: &str, snapshot: &str) {
    let mut session = open_4_5();
    session.warm_details().expect("build details");
    let result = snapshot_step(&mut session, snapshot, set(planet, from, to));
    assert_eq!(result.details_stale.len(), 1, "{snapshot}: stale");
    assert!(!result.reclassifies);
    assert!(session.built_details().is_some(), "{snapshot}: kept");
    assert_eq!(look(&session, planet), (to.to_owned(), None));

    session.undo().expect("undo").expect("something to undo");
    assert_eq!(
        current(&session),
        session.doc.original(),
        "{snapshot}: undo"
    );

    let mut session = open_4_5();
    let applied = session.apply(set(planet, from, to)).expect("apply");
    session.apply(applied.inverse).expect("apply the inverse");
    assert_eq!(
        current(&session),
        session.doc.original(),
        "{snapshot}: inverse"
    );
}

/// Barren 585, uncolonised, becomes an ocean world: `entity=2` fits its three models.
#[test]
fn an_uncolonised_planet_changes_class() {
    change(585, "pc_barren", "pc_ocean", "class_uncolonised_4_5");
}

/// Planet 3318 has Previously Terraformed as its model: it goes, and bit 2 stays.
#[test]
fn a_model_of_its_own_goes_with_the_old_class() {
    change(3318, "pc_continental", "pc_arid", "class_model_4_5");
}

/// Gas giant 39 has `entity=3`, past barren's three models, so it goes back to 0.
#[test]
fn a_model_index_the_new_class_lacks_goes_back_to_0() {
    change(39, "pc_gas_giant", "pc_barren", "class_entity_reset_4_5");
}

/// Planet 2 is the player's capital, continental: an ocean world keeps its colony as it is.
#[test]
fn a_colony_changes_to_another_standard_class() {
    change(2, "pc_continental", "pc_ocean", "class_colony_4_5");
}

/// Deneb II (1415), a gas giant with `entity=3` and a model of its own, loses both, and its
/// inverse puts both back where they stood.
#[test]
fn the_inverse_puts_back_a_model_and_its_index() {
    round_trip(open_4_5(), set(1415, "pc_gas_giant", "pc_barren"));
    change(
        1415,
        "pc_gas_giant",
        "pc_barren",
        "class_model_and_index_4_5",
    );
}

#[test]
fn a_class_change_is_refused_for_stars_fixed_classes_and_colonies() {
    let mut session = open_4_5();
    let refusals = [
        (
            set(99_999, "pc_barren", "pc_ocean"),
            "planet 99999 does not exist",
        ),
        (
            set(584, "pc_g_star", "pc_barren"),
            "planet 584 is a star; its star type is changed on the star's page",
        ),
        (
            set(585, "pc_barren", "pc_g_star"),
            "pc_g_star is a class no planet is changed to or from",
        ),
        (
            set(585, "pc_barren", "pc_habitat"),
            "pc_habitat is a class no planet is changed to or from",
        ),
        (
            set(6268, "pc_habitat", "pc_barren"),
            "pc_habitat is a class no planet is changed to or from",
        ),
        (
            set(2, "pc_continental", "pc_barren"),
            "planet 2 is a colony, and a colony cannot be changed to or from pc_barren",
        ),
        (
            set(2, "pc_continental", "pc_city"),
            "planet 2 is a colony, and a colony cannot be changed to or from pc_city",
        ),
        (
            set(585, "pc_desert", "pc_ocean"),
            "planet 585 is pc_barren, not pc_desert",
        ),
        (
            set(585, "pc_barren", "pc_barren"),
            "planet 585 is already pc_barren",
        ),
        (set(585, "pc_barren", ""), "a planet class may not be empty"),
    ];
    for (op, message) in refusals {
        let error = session.apply(op).expect_err(message);
        assert_eq!(error.to_string(), message);
    }
    assert!(!session.doc.is_dirty());
    assert!(session.history().undo.is_empty());
}

/// A colony may still go to a class open to colonies whose one model it lacks the index of.
#[test]
fn a_colony_made_nuked_takes_its_one_model() {
    let mut session = open_4_5();
    session
        .apply(set(2, "pc_continental", "pc_nuked"))
        .expect("a colony made a tomb world");
    let text = String::from_utf8_lossy(&current(&session)).into_owned();
    let planets = text.find("\nplanets=\n").expect("the planets");
    let start = planets + text[planets..].find("\n\t\t2=\n").expect("planet 2");
    let entity = &text[start..start + text[start..].find("\n\t\t}\n").expect("its end")];
    assert!(entity.contains("\n\t\t\tplanet_class=\"pc_nuked\"\n"));
    assert!(entity.contains("\n\t\t\tentity=0\n"), "{entity}");
}

#[test]
fn a_save_before_stellaris_4_is_refused() {
    let mut session = open_3_4();
    let error = session
        .apply(set(1, "pc_barren", "pc_ocean"))
        .expect_err("a 3.4 save");
    assert!(error.to_string().contains("3.4"), "{error}");
    assert!(!session.doc.is_dirty());
}
