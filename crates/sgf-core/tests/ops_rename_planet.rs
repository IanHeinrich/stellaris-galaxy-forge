//! Renaming a save planet on the 4.5 and the 4.4 sample: the name it is written with, the
//! copy of it each moon holds, undo and the inverse putting back the bytes as opened, and
//! what the op refuses.

use sgf_core::entity::get_planet_page;
use sgf_core::ops::NewName;
use sgf_core::ops::{Op, OpError, StarEdit};
use sgf_core::projections::name::NameTemplate;
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip_step, snapshot_step};
use common::fixture::GRAMMAR;
use common::{current, open, open_4_5};

fn rename(planet: u32, name: &str) -> Op {
    Op::RenameBody {
        body: planet,
        name: NewName::Literal(name.to_owned()),
    }
}

fn literal(name: &str) -> NameTemplate {
    NameTemplate {
        key: name.to_owned(),
        literal: true,
        variables: Vec::new(),
    }
}

fn name(session: &Session, planet: u32) -> NameTemplate {
    get_planet_page(&session.doc, planet)
        .expect("the planet's page")
        .name
}

/// The value of the `PARENT` variable a moon's name holds its planet's name in.
fn parent_copy(session: &Session, moon: u32) -> NameTemplate {
    let name = name(session, moon);
    name.variables
        .iter()
        .find(|v| v.name == "PARENT")
        .unwrap_or_else(|| panic!("moon {moon} names no PARENT: {name:?}"))
        .value
        .clone()
}

#[test]
fn the_diff_a_rename_writes() {
    let mut session = open_4_5();
    let result = snapshot_step(&mut session, "shuckon_i_140", rename(140, "Nova Terra"));
    assert_eq!(
        result.entry.description,
        "Renamed planet #140 to Nova Terra"
    );
}

/// A sample to open, a body on it and that body's moons.
type Case = (fn() -> Session, u32, &'static [u32]);

/// Shuckon I (140) and its moon (141) on 4.5; the planet of the binary's second star (809)
/// and its moon (810), which names the star two levels down; Olbers II (5172) and its moon
/// on 4.4; a colonised capital with no moons (18).
#[test]
fn a_planet_and_its_moons_take_the_new_name_and_the_inverse_puts_back_the_bytes() {
    let cases: [Case; 4] = [
        (open_4_5, 140, &[141]),
        (open_4_5, 809, &[810]),
        (open, 5172, &[5173]),
        (open_4_5, 18, &[]),
    ];
    for (opened, planet, moons) in cases {
        let mut session = opened();
        let label = format!("planet {planet}");
        let old = name(&session, planet);
        for &moon in moons {
            assert_eq!(parent_copy(&session, moon), old, "{label}: moon {moon}");
        }

        let result = round_trip_step(&mut session, &label, rename(planet, "Nova Terra"));
        assert_eq!(name(&session, planet), literal("Nova Terra"), "{label}");
        for &moon in moons {
            assert_eq!(
                parent_copy(&session, moon),
                literal("Nova Terra"),
                "{label}: moon {moon}"
            );
        }

        session.apply(result.inverse).expect("apply the inverse");
        assert_eq!(current(&session), session.doc.original(), "{label}");
        assert_eq!(name(&session, planet), old, "{label}");
    }
}

/// Planet 810 of the 4.5 sample is a moon whose name holds its planet's name, which holds
/// the name of the star that planet orbits.
#[test]
fn a_moon_of_a_moon_names_the_renamed_body_where_it_is_nested() {
    let mut session = open_4_5();
    let star = name(&session, 809).variables[0].value.clone();
    assert_eq!(star.key, "STAR_NAME_2_OF_2");
    session.apply(rename(809, "Cinder")).expect("rename 809");
    let copy = parent_copy(&session, 810);
    assert_eq!(copy, literal("Cinder"));
}

/// Moon 141 of the 4.5 sample, edited to name its planet Shuckoff I where planet 140 is
/// Shuckon I.
#[test]
fn a_moon_whose_copy_differs_keeps_it() {
    let mut session = common::open_edited_sample(common::SAMPLE_4_5, |gamestate, _| {
        let moon = gamestate
            .find(
                "
		141=
",
            )
            .expect("moon 141");
        let at = moon + gamestate[moon..].find("key=\"Shuckon\"").expect("its copy");
        gamestate.replace_range(at..at + "key=\"Shuckon\"".len(), "key=\"Shuckoff\"");
    });
    let copy = parent_copy(&session, 141);
    assert_eq!(copy.variables[0].value.key, "Shuckoff");
    session
        .apply(rename(140, "Nova Terra"))
        .expect("rename 140");
    assert_eq!(parent_copy(&session, 141), copy);
    assert_eq!(name(&session, 140), literal("Nova Terra"));
}

#[test]
fn the_details_read_the_new_name() {
    let mut session = open_4_5();
    session.warm_details().expect("build details");
    session.apply(rename(140, "Nova Terra")).expect("rename");
    let system = get_planet_page(&session.doc, 140).unwrap().system.unwrap();
    let planets = common::planets(&session, system);
    let renamed = planets.iter().find(|p| p.id == 140).expect("planet 140");
    assert_eq!(renamed.name, literal("Nova Terra"));
    let moon = planets.iter().find(|p| p.id == 141).expect("moon 141");
    assert_eq!(moon.name.variables[0].value, literal("Nova Terra"));
}

#[test]
fn what_a_rename_refuses() {
    let mut session = open_4_5();
    let refusals = [
        (rename(99_999, "Nova Terra"), "planet 99999 does not exist"),
        (rename(140, ""), "a name may not be empty"),
        (rename(140, "Nova \"Terra\""), "cannot be written as a name"),
    ];
    for (op, message) in refusals {
        let error = session.apply(op).expect_err(message);
        assert!(error.to_string().contains(message), "{error}");
    }
    let bad_block = Op::RenameBody {
        body: 140,
        name: NewName::Block {
            value: "key=\"Nova Terra\"".to_owned(),
            name: "Nova Terra".to_owned(),
        },
    };
    let error = session.apply(bad_block).expect_err("not a block");
    assert!(matches!(error, OpError::InvalidText { .. }), "{error}");
    let trailing = Op::RenameBody {
        body: 140,
        name: NewName::Block {
            value: "{ key=\"Nova Terra\" } # }".to_owned(),
            name: "Nova Terra".to_owned(),
        },
    };
    let error = session.apply(trailing).expect_err("text after the block");
    assert!(matches!(error, OpError::InvalidText { .. }), "{error}");
    for star in [584, 619] {
        let error = session
            .apply(rename(star, "Nova Terra"))
            .expect_err("a star");
        assert!(
            matches!(error, OpError::StarRefused { body, edit: StarEdit::Rename } if body == star),
            "{error}"
        );
    }
    assert!(!session.doc.is_dirty());

    session.apply(rename(140, "Nova Terra")).expect("rename");
    let error = session
        .apply(rename(140, "Nova Terra"))
        .expect_err("unchanged");
    assert_eq!(error.to_string(), "planet 140 is already named Nova Terra");

    let mut scenario = GRAMMAR.open();
    let error = scenario
        .apply(rename(0, "Nova Terra"))
        .expect_err("a scenario");
    assert!(matches!(error, OpError::Unsupported { .. }), "{error}");
}
