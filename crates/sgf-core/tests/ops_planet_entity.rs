//! The planet model op on the 4.5 sample: the diff each change produces is snapshotted, the
//! planet page and the system details read the model back, and undo puts the original bytes
//! back.

use sgf_core::entity::get_planet_page;
use sgf_core::format::save::details::HeuristicResolver;
use sgf_core::ops::Op;
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::{current, open_4_5, text};

const PARADISE: &str = "ocean_paradise_planet_01_entity";

fn set(planet: u32, entity: Option<&str>) -> Op {
    Op::SetBodyModel {
        body: planet,
        entity: entity.map(str::to_owned),
    }
}

/// Planet `id`'s model, as its page reads it from the session's bytes.
fn model(session: &Session, id: u32) -> Option<String> {
    let page = get_planet_page(&session.doc, id).unwrap_or_else(|e| panic!("planet {id}: {e}"));
    page.entity_name
}

/// Planet `id`'s model as its system's details read it, from the projection built before the
/// edit.
fn drawn_model(session: &Session, id: u32) -> Option<String> {
    let page = get_planet_page(&session.doc, id).unwrap_or_else(|e| panic!("planet {id}: {e}"));
    let system = page.system.expect("the planet's system");
    let details = session.built_details().expect("the details kept");
    let resolved = details.resolve(system, &HeuristicResolver, false);
    let planets = resolved.expect("the system's details").planets;
    let planet = planets
        .into_iter()
        .find(|p| p.id == id)
        .expect("the planet");
    planet.entity_name
}

/// Planet `id`'s `binary_flags`, as the session's bytes now hold it.
fn flags(session: &Session, id: u32) -> Option<String> {
    let text = text(session);
    let planets = text.find("\nplanets=\n").expect("the planets");
    let start = planets
        + text[planets..]
            .find(&format!("\n\t\t{id}=\n\t\t{{\n"))
            .unwrap_or_else(|| panic!("planet {id}"));
    let end = start + 1 + text[start + 1..].find("\n\t\t}\n").expect("its end");
    let entity = &text[start..end];
    let at = entity.find("\n\t\t\tbinary_flags=")? + "\n\t\t\tbinary_flags=".len();
    Some(entity[at..].lines().next().unwrap_or_default().to_owned())
}

/// Snapshot `entity` on `planet`, then check the page reads it, and that undo puts the
/// original bytes and model back and redo the new one.
fn change(planet: u32, entity: Option<&str>, snapshot: &str) -> Session {
    let mut session = open_4_5();
    let before = model(&session, planet);
    let result = snapshot_step(&mut session, snapshot, set(planet, entity));
    assert_eq!(result.inverse, set(planet, before.as_deref()));
    assert!(!result.reclassifies);
    assert_eq!(
        model(&session, planet).as_deref(),
        entity,
        "{snapshot}: after"
    );

    session.undo().expect("undo").expect("something to undo");
    assert_eq!(
        current(&session),
        session.doc.original(),
        "{snapshot}: undo"
    );
    assert_eq!(model(&session, planet), before, "{snapshot}: undone");
    session.redo().expect("redo").expect("something to redo");
    assert_eq!(
        model(&session, planet).as_deref(),
        entity,
        "{snapshot}: redone"
    );
    session
}

/// Barren 585 has no model and no `binary_flags`: the line goes after `entity=2`, and no
/// flag is written.
#[test]
fn a_planet_is_given_a_model_after_its_entity_line() {
    let session = change(585, Some(PARADISE), "model_set_4_5");
    assert_eq!(flags(&session, 585), None);
}

/// Planet 3318 holds Previously Terraformed from its initializer, with bit 2: the model is
/// rewritten in place and the bit stays.
#[test]
fn a_model_is_replaced_in_place() {
    let session = change(3318, Some(PARADISE), "model_replace_4_5");
    assert_eq!(flags(&session, 3318).as_deref(), Some("322"));
}

/// Deneb II (1415) holds an initializer gas giant model, `binary_flags=74`: taking the model
/// off clears bit 2 as well.
#[test]
fn a_model_is_taken_off_with_its_initializer_bit() {
    let session = change(1415, None, "model_clear_4_5");
    assert_eq!(flags(&session, 1415).as_deref(), Some("72"));
}

/// No sample planet holds a model with only bit 2 and 64 set, so planet 3318 (322: a ring,
/// the model's bit and 64) loses its ring first. Taking the model off then leaves only 64,
/// and the statement goes.
#[test]
fn a_model_is_taken_off_and_a_flags_statement_left_with_64_goes() {
    let mut session = open_4_5();
    session
        .apply(Op::SetBodyRing {
            body: 3318,
            ring: false,
        })
        .expect("take the ring off");
    assert_eq!(flags(&session, 3318).as_deref(), Some("66"));
    let ringless = current(&session);

    snapshot_step(&mut session, "model_clear_flags_go_4_5", set(3318, None));
    assert_eq!(flags(&session, 3318), None);
    assert_eq!(model(&session, 3318), None);
    session.undo().expect("undo").expect("something to undo");
    assert_eq!(current(&session), ringless);
    assert_eq!(flags(&session, 3318).as_deref(), Some("66"));
}

/// Habitat 6268's model came from `set_planet_entity`, so it has no bit 2 to clear.
#[test]
fn a_scripted_model_is_taken_off_and_the_flags_stay() {
    let mut session = open_4_5();
    let result = session.apply(set(6268, None)).expect("take the model off");
    assert_eq!(
        result.entry.description,
        "Took the model mammalian_01_habitat_phase_03_entity off planet #6268"
    );
    assert_eq!(model(&session, 6268), None);
    assert_eq!(flags(&session, 6268).as_deref(), Some("65"));
}

/// The system view draws from the details: they read a model given and one taken off in
/// place, through undo too, and the op names the planet's system as stale.
#[test]
fn the_system_details_read_the_model_in_place() {
    let mut session = open_4_5();
    session.warm_details().expect("build details");
    assert_eq!(drawn_model(&session, 585), None);
    let given = session
        .apply(set(585, Some(PARADISE)))
        .expect("give 585 a model");
    assert_eq!(given.details_stale, [1]);
    assert_eq!(drawn_model(&session, 585).as_deref(), Some(PARADISE));
    session.undo().expect("undo").expect("something to undo");
    assert_eq!(drawn_model(&session, 585), None);

    let held = drawn_model(&session, 1415);
    assert_eq!(held.as_deref(), Some("gas_giant_02_entity"));
    let taken = session
        .apply(set(1415, None))
        .expect("take 1415's model off");
    assert_eq!(taken.details_stale.len(), 1);
    assert_eq!(drawn_model(&session, 1415), None);
}

#[test]
fn a_model_round_trips_from_the_file_as_opened() {
    round_trip(open_4_5(), set(585, Some(PARADISE)));
    round_trip(open_4_5(), set(3318, Some(PARADISE)));
    round_trip(open_4_5(), set(1415, None));
}

#[test]
fn a_model_is_refused_for_a_star_an_unknown_planet_or_no_change() {
    let mut session = open_4_5();
    let refusals = [
        (set(99_999, Some(PARADISE)), "planet 99999 does not exist"),
        (
            set(584, Some(PARADISE)),
            "planet 584 is a star, which takes no planet model",
        ),
        (set(585, None), "planet 585 has no model of its own"),
        (
            set(3318, Some("previously_terraformed_planet_entity")),
            "planet 3318 already has the model previously_terraformed_planet_entity",
        ),
        (set(585, Some("")), "a planet model may not be empty"),
    ];
    for (op, message) in refusals {
        let error = session.apply(op).expect_err(message);
        assert_eq!(error.to_string(), message);
    }
    let error = session
        .apply(set(585, Some("two words")))
        .expect_err("not an identifier");
    assert!(error.to_string().contains("two words"), "{error}");
    assert!(!session.doc.is_dirty());
    assert!(session.history().undo.is_empty());
}
