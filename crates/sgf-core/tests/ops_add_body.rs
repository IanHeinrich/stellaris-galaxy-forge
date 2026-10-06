//! A planet or moon added to a save system, on the 4.x samples: each add's diff, the name it
//! is numbered with, byte-exact undo, the inverse that takes it out again, and what is
//! refused.

use sgf_core::entity::EntityKind;
use sgf_core::ops::{NewBody, Op, OpError};
use sgf_core::session::OpResult;
use sgf_core::views::OrbitPlacement;

use crate::common;
use common::diff::snapshot_step;
use common::examples::{ADDED_BODY, meissa_v};
use common::{current, open, open_4_5, open_edited_sample, text};

fn body(class: &str, size: u32) -> NewBody {
    NewBody {
        class: class.to_owned(),
        size,
        moon_of: None,
        name: None,
        deposits: Vec::new(),
        ring: false,
    }
}

fn moon(class: &str, size: u32, of: u32) -> NewBody {
    NewBody {
        moon_of: Some(of),
        ..body(class, size)
    }
}

fn add(system: u32, spec: NewBody, radius: f64, angle: f64) -> Op {
    Op::AddBody {
        system,
        spec,
        at: OrbitPlacement { radius, angle },
    }
}

/// The planet an add wrote, as its inverse names it.
fn added(result: &OpResult) -> u32 {
    let removal = match &result.inverse {
        Op::Batch { ops, .. } => &ops[0],
        inverse => inverse,
    };
    match removal {
        Op::RemoveBody { body: planet } => *planet,
        other => panic!("a removal, not {other:?}"),
    }
}

/// The literal keys of a name's `NUMERAL` variables, outermost last.
fn numerals(entry: &str) -> Vec<&str> {
    entry
        .split("key=\"NUMERAL\"")
        .skip(1)
        .filter_map(|rest| rest.split("key=\"").nth(1)?.split('"').next())
        .collect()
}

/// Alaria (169) is the player's home system. Its planets all have fixed names, so the first
/// numbered one is I, named after the system. The planet lies past the inner radius of 215,
/// which grows to 270.
#[test]
fn a_planet_added_to_an_owned_system() {
    let mut session = open_4_5();
    let spec = NewBody {
        deposits: vec!["d_mineral_fields".to_owned(), "d_rich_mountain".to_owned()],
        ..body("pc_desert", 12)
    };
    let result = snapshot_step(
        &mut session,
        "planet_added_to_owned_169",
        add(169, spec, 240.0, 200.0),
    );
    let id = added(&result);
    assert_eq!(id, ADDED_BODY, "the lowest dead slot, one generation on");
    assert_eq!(
        result.entry.description,
        format!(
            "Added planet #{id} to Alari system #169 (pc_desert, size 12) at orbit 240 at 200°, \
             with 2 deposits; set the inner radius of Alari system #169 from 215 to 270"
        )
    );
    assert_eq!(result.details_stale, [169]);
    let entry = common::entity_text(&session, EntityKind::Planet, id);
    assert!(entry.contains("key=\"SPEC_Alari_system\""), "{entry}");
    assert_eq!(numerals(&entry), ["I"]);
    assert!(!entry.contains("	binary_flags"), "{entry}");
}

/// Meissa (408), which nobody owns, numbers its planets I to IV, so the new one is Meissa V.
/// It lies inside Meissa I, so the radius stays.
#[test]
fn a_planet_added_to_an_unowned_system_takes_the_next_numeral() {
    let mut session = open_4_5();
    let result = snapshot_step(&mut session, "planet_added_to_unowned_408", meissa_v());
    let id = added(&result);
    assert_eq!(
        result.entry.description,
        format!(
            "Added planet #{id} to Meissa #408 (pc_barren, size 10) at orbit 45 at 300°, \
             with 1 deposit"
        )
    );
    assert_eq!(result.inverse, Op::RemoveBody { body: id });
    let entry = common::entity_text(&session, EntityKind::Planet, id);
    assert!(entry.contains("key=\"Meissa\""), "{entry}");
    assert_eq!(numerals(&entry), ["V"]);
}

/// Meissa IV (138) has no moons. Its first is Meissa IV a, with the moon bit and `moon_of`,
/// and Meissa IV gains a `moons` list; the second is Meissa IV b. The first reaches 160, past
/// Meissa IV but inside the inner radius of 175, so the radii stay. The second takes a slot past
/// the table's end, so it comes first in the ascending list.
#[test]
fn moons_added_to_a_planet_are_lettered_in_turn() {
    let mut session = open_4_5();
    let first = snapshot_step(
        &mut session,
        "moon_added_to_138",
        add(408, moon("pc_barren", 6, 138), 15.0, 90.0),
    );
    let a = added(&first);
    assert_eq!(
        first.entry.description,
        format!(
            "Added moon #{a} of planet #138 in Meissa #408 (pc_barren, size 6) at orbit 15 at 90°"
        )
    );
    assert_eq!(first.inverse, Op::RemoveBody { body: a });
    assert!(
        text(&session).contains("\t\tinner_radius=175\n\t\touter_radius=275\n"),
        "the radii stay"
    );
    let entry = common::entity_text(&session, EntityKind::Planet, a);
    assert!(entry.contains("binary_flags=576"), "{entry}");
    assert!(entry.contains("moon_of=138"), "{entry}");
    assert_eq!(numerals(&entry), ["IV", "a"]);

    let second = session
        .apply(add(408, moon("pc_frozen", 5, 138), 20.0, 180.0))
        .expect("a second moon");
    let b = added(&second);
    assert_eq!(
        numerals(&common::entity_text(&session, EntityKind::Planet, b)),
        ["IV", "b"]
    );
    let parent = common::entity_text(&session, EntityKind::Planet, 138);
    assert!(
        parent.contains(&format!("moons=\n\t\t\t{{\n\t\t\t\t{b} {a} \n")),
        "{parent}"
    );
}

/// System 8 of the 4.4 sample is owned and numbers its planets to VIII; its gas giant VI
/// (151) has moons a to c. A planet and a moon take IX and d.
#[test]
fn a_planet_and_a_moon_added_on_the_4_4_sample() {
    let mut session = open();
    let planet = snapshot_step(
        &mut session,
        "planet_added_to_4_4_system_8",
        add(8, body("pc_toxic", 15), 210.0, 45.0),
    );
    assert_eq!(
        numerals(&common::entity_text(
            &session,
            EntityKind::Planet,
            added(&planet)
        )),
        ["IX"]
    );
    let moon = snapshot_step(
        &mut session,
        "moon_added_to_4_4_planet_151",
        add(8, moon("pc_barren", 7, 151), 30.0, 10.0),
    );
    assert_eq!(
        numerals(&common::entity_text(
            &session,
            EntityKind::Planet,
            added(&moon)
        )),
        ["VI", "d"]
    );
}

#[test]
fn a_typed_name_and_a_ring_are_written_as_given() {
    let mut session = open_4_5();
    let spec = NewBody {
        name: Some("New Hope".to_owned()),
        ring: true,
        ..body("pc_gas_giant", 20)
    };
    let result = session
        .apply(add(408, spec, 250.0, 10.0))
        .expect("a named ringed giant");
    let entry = common::entity_text(&session, EntityKind::Planet, added(&result));
    assert!(
        entry.contains("key=\"New Hope\"\n\t\t\t\tliteral=yes"),
        "{entry}"
    );
    assert!(entry.contains("binary_flags=320"), "{entry}");
}

/// The inverse takes the body out again, and puts back the inner radius the add grew.
#[test]
fn the_inverse_puts_the_bytes_back() {
    let cases = [
        (open_4_5(), meissa_v()),
        (open_4_5(), add(169, body("pc_desert", 12), 240.0, 200.0)),
        (open_4_5(), add(408, moon("pc_barren", 6, 138), 15.0, 90.0)),
    ];
    for (mut session, op) in cases {
        let before = current(&session);
        let result = session.apply(op).expect("add");
        let with_body = current(&session);
        let removed = session.apply(result.inverse).expect("the inverse");
        assert_eq!(current(&session), before, "{}", removed.entry.description);
        session
            .apply(removed.inverse)
            .expect("the inverse's inverse");
        assert_eq!(current(&session), with_body, "{}", result.entry.description);
    }
}

#[test]
fn adds_and_removals_are_refused() {
    let mut session = open_4_5();
    let refusals = [
        (
            add(99_999, body("pc_desert", 12), 50.0, 0.0),
            "system 99999 does not exist",
        ),
        (
            add(408, moon("pc_barren", 5, 134), 20.0, 0.0),
            "planet 134 is a star: a moon needs a planet to orbit",
        ),
        (
            add(169, moon("pc_barren", 5, 3), 10.0, 0.0),
            "planet 3 is a moon, and a moon cannot have moons",
        ),
        (
            add(408, moon("pc_barren", 5, 2), 10.0, 0.0),
            "planet 2 is not a body of system 408",
        ),
        (
            add(216, moon("pc_barren", 5, 29), 10.0, 0.0),
            "an asteroid cannot have moons",
        ),
        (
            add(408, body("pc_desert", 0), 50.0, 0.0),
            "a planet size may not be zero",
        ),
        (
            add(408, body("", 10), 50.0, 0.0),
            "a planet class may not be empty",
        ),
        (
            add(
                408,
                NewBody {
                    ring: true,
                    ..moon("pc_barren", 5, 138)
                },
                15.0,
                0.0,
            ),
            "a moon cannot have a ring",
        ),
        (
            add(408, body("pc_desert", 10), 0.0, 0.0),
            "radius 0 is invalid: a body's orbit must be greater than zero",
        ),
        (
            Op::RemoveBody { body: 138 },
            "planet 138 was in the save when it was opened: only a body added since then can be taken out again",
        ),
    ];
    common::assert_refusals(&mut session, refusals);

    let planet = session.apply(meissa_v()).expect("a planet");
    let id = added(&planet);
    session
        .apply(add(408, moon("pc_barren", 5, id), 15.0, 0.0))
        .expect("a moon of it");
    let error = session
        .apply(Op::RemoveBody { body: id })
        .expect_err("it has a moon");
    assert!(
        matches!(error, OpError::BodyHasMoons(p) if p == id),
        "{error}"
    );
}

#[test]
fn an_ironman_save_takes_a_planet() {
    let mut session =
        open_edited_sample(common::SAMPLE_4_5, |_, meta| meta.push_str("ironman=yes\n"));
    session
        .apply(meissa_v())
        .expect("an Ironman save takes a planet");
}

/// Moon 23 of system 463 is deleted, so the planet added after it takes its slot one
/// generation on. The details list the new planet once and the deleted moon not at all, the
/// moon cannot be deleted again, and taking the new planet out leaves the system as the
/// delete left it.
#[test]
fn a_planet_added_in_a_deleted_moons_slot_is_listed_once() {
    let mut session = open_4_5();
    session
        .apply(Op::DeleteBody { body: 23 })
        .expect("delete the moon");
    let after_delete = common::planet_ids(&session, 463);
    let result = session
        .apply(add(463, body("pc_barren", 10), 60.0, 0.0))
        .expect("a planet");
    let id = added(&result);
    assert_eq!(
        id,
        23 | 1 << 24,
        "the deleted moon's slot, one generation on"
    );
    let ids = common::planet_ids(&session, 463);
    assert_eq!(ids.iter().filter(|&&p| p == id).count(), 1, "{ids:?}");
    assert!(!ids.contains(&23), "{ids:?}");
    assert_eq!(ids.len(), after_delete.len() + 1, "{ids:?}");
    let error = session
        .apply(Op::DeleteBody { body: 23 })
        .expect_err("the moon is gone");
    assert!(matches!(error, OpError::UnknownPlanet(23)), "{error}");

    session.apply(result.inverse).expect("take it out again");
    assert_eq!(common::planet_ids(&session, 463), after_delete);
}
