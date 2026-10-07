//! Save planets copied as specs and pasted as new bodies, on the 4.x samples: the paste's
//! diff, what the pasted bodies read back as, byte-exact undo and inverse, a copy taken from
//! the 4.4 sample into the 4.5 one, and what is refused.

use sgf_core::entity::EntityKind;
use sgf_core::ops::{BodyName, NewBody, NewModifier, Op};
use sgf_core::session::{OpResult, Session};
use sgf_core::views::OrbitPlacement;

use crate::common;
use common::diff::snapshot_step;
use common::{current, open, open_3_4, open_4_5};

/// Gas giant 10 of Alaria (169) has moons 11, 12 and 13, a deposit and the extensive moon
/// system feature with no timed item. Kazam (216) has 14 bodies and nobody's colony.
const GIANT: u32 = 10;
const KAZAM: u32 = 216;

/// The planet a paste wrote, as its inverse names it last.
fn pasted(result: &OpResult) -> u32 {
    let ops = match &result.inverse {
        Op::Batch { ops, .. } => ops.as_slice(),
        inverse => std::slice::from_ref(inverse),
    };
    ops.iter()
        .rev()
        .find_map(|op| match op {
            Op::RemoveBody { body } => Some(*body),
            _ => None,
        })
        .expect("the inverse removes the pasted planet")
}

fn copy(session: &Session, bodies: &[u32]) -> Vec<NewBody> {
    session.copy_bodies(bodies).expect("a copy")
}

/// `copy` with each moon's placement rounded, which reading back from the written point
/// can move in the last decimal.
fn rounded(mut copy: NewBody) -> NewBody {
    for moon in &mut copy.moons {
        moon.at = OrbitPlacement {
            radius: (moon.at.radius * 100.0).round() / 100.0,
            angle: (moon.at.angle * 100.0).round() / 100.0,
        };
    }
    copy
}

/// Assert that body `id` of `session` copies back as `expected`.
#[track_caller]
fn reads_back(session: &Session, id: u32, expected: &NewBody) {
    let read = copy(session, &[id]).remove(0);
    assert_eq!(rounded(read), rounded(expected.clone()));
}

#[test]
fn a_planet_with_its_moons_model_modifier_and_feature_is_pasted_whole() {
    let mut source = open_4_5();
    source
        .apply(Op::SetBodyModel {
            body: GIANT,
            entity: Some("gas_giant_05_entity".to_owned()),
        })
        .expect("a model");
    source
        .apply(Op::AddBodyModifier {
            body: GIANT,
            modifier: "harvested_resources_mining".to_owned(),
            days: vec![360],
            feature: None,
        })
        .expect("a modifier");
    let copies = copy(&source, &[GIANT]);
    let [giant] = copies.as_slice() else {
        panic!("one copy, not {copies:?}");
    };
    assert_eq!(giant.class, "pc_gas_giant");
    assert_eq!(giant.moon_of, None);
    assert_eq!(
        giant.name,
        Some(BodyName::Fixed("HUM1_PLANET_UltraksPoint".to_owned()))
    );
    assert_eq!(giant.entity_name.as_deref(), Some("gas_giant_05_entity"));
    assert_eq!(giant.deposits.len(), 1);
    assert_eq!(giant.moons.len(), 3);
    assert!(!giant.fixed_name);
    assert_eq!(
        giant.modifiers,
        [
            NewModifier {
                modifier: "harvested_resources_mining".to_owned(),
                days: vec![360],
                feature: None,
            },
            NewModifier {
                modifier: "extensive_moon_system".to_owned(),
                days: Vec::new(),
                feature: Some("pm_extensive_moon_system".to_owned()),
            },
        ]
    );

    let mut session = open_4_5();
    let op = session
        .paste_bodies_op(KAZAM, &copies, None)
        .expect("a paste");
    let result = snapshot_step(&mut session, "paste_giant_into_216", op);
    assert!(
        result.entry.description.contains("with 3 moons and "),
        "{}",
        result.entry.description
    );
    let id = pasted(&result);
    reads_back(&session, id, giant);
    assert_eq!(
        flags(&session, id) & 1,
        0,
        "the giant's fixed key has no fixed-name bit"
    );

    let inverse = session.apply(result.inverse).expect("the inverse");
    assert_eq!(
        current(&session),
        session.doc().original(),
        "{}",
        inverse.entry.description
    );
    session.undo().expect("undo").expect("the inverse to undo");
    session.undo().expect("undo").expect("the paste to undo");
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn a_colonised_planet_is_copied_without_its_colony() {
    let mut session = open_4_5();
    let copies = copy(&session, &[402]);
    assert_eq!(copies[0].name, None, "Linkirk I is numbered again");
    let op = session
        .paste_bodies_op(KAZAM, &copies, None)
        .expect("a paste");
    let result = session.apply(op).expect("the paste");
    let entry = common::entity_text(&session, EntityKind::Planet, pasted(&result));
    for key in ["colony=", "owner=", "controller=", "fallen_empire_world"] {
        assert!(!entry.contains(key), "{key} in {entry}");
    }
    assert!(entry.contains("planet_class=\"pc_arid\""), "{entry}");
    reads_back(&session, pasted(&result), &copies[0]);
}

/// Gas giant 99 of Tharbarite (140), with moons 100 and 101, pasted beside itself.
#[test]
fn a_copy_goes_to_a_point_in_its_own_system() {
    let mut session = open_4_5();
    let copies = copy(&session, &[99]);
    let at = OrbitPlacement {
        radius: 200.0,
        angle: 45.0,
    };
    let op = session
        .paste_bodies_op(140, &copies, Some(at))
        .expect("a paste");
    assert!(matches!(&op, Op::AddBody { at: placed, .. } if *placed == at));
    let result = snapshot_step(&mut session, "paste_99_into_140_at", op);
    reads_back(&session, pasted(&result), &copies[0]);
}

#[test]
fn a_moon_goes_with_its_planet_and_alone_becomes_a_planet() {
    let mut session = open_4_5();
    let group = copy(&session, &[100, 99, 402]);
    assert_eq!(group.len(), 2, "moon 100 goes with planet 99");
    assert_eq!(group[0].moons.len(), 2);
    let op = session
        .paste_bodies_op(KAZAM, &group, None)
        .expect("a paste");
    let Op::Batch { ops, .. } = &op else {
        panic!("a batch, not {op:?}");
    };
    assert_eq!(ops.len(), 2);
    session.apply(op).expect("the group");

    let moon = copy(&session, &[100]).remove(0);
    assert_eq!(moon.moon_of, None);
    assert!(!moon.ring && moon.moons.is_empty());
    session
        .apply(session.paste_bodies_op(KAZAM, &[moon], None).expect("op"))
        .expect("the moon as a planet");
}

/// Earth (3) and the Moon (4) of the 4.4 sample, pasted into the 4.5 sample.
#[test]
fn a_copy_from_one_save_is_pasted_into_another() {
    let copies = copy(&open(), &[3]);
    assert_eq!(
        copies[0].name,
        Some(BodyName::Fixed("NAME_Earth".to_owned()))
    );
    assert_eq!(copies[0].moons.len(), 1);
    assert!(copies[0].fixed_name, "Earth holds the fixed-name bit");
    let mut session = open_4_5();
    let op = session
        .paste_bodies_op(KAZAM, &copies, None)
        .expect("a paste");
    let result = session.apply(op).expect("the paste");
    let earth = pasted(&result);
    reads_back(&session, earth, &copies[0]);
    assert_eq!(flags(&session, earth) & 1, 1, "a fixed name keeps its bit");
    session.undo().expect("undo").expect("the paste");
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn stars_megastructures_and_empty_pastes_are_refused() {
    let session = open_4_5();
    let refusals = [
        (
            86,
            "planet 86 is a star: only a planet or moon can be copied",
        ),
        (
            936,
            "planet 936 has a megastructure, so it cannot be moved or copied",
        ),
        (
            6268,
            "planet 6268 has a megastructure, so it cannot be moved or copied",
        ),
        (
            6267,
            "planet 6268 has a megastructure, so it cannot be moved or copied",
        ),
        (
            2445,
            "planet 2445 has a megastructure, so it cannot be moved or copied",
        ),
    ];
    for (body, message) in refusals {
        let error = session.copy_bodies(&[body]).expect_err(message);
        assert_eq!(error.to_string(), message);
    }
    let copies = copy(&session, &[402]);
    let error = session.paste_bodies_op(KAZAM, &[], None).expect_err("none");
    assert_eq!(error.to_string(), "no entries given");
    let error = session
        .paste_bodies_op(99_999, &copies, None)
        .expect_err("no system");
    assert_eq!(error.to_string(), "system 99999 does not exist");
    let error = common::examples::scenario()
        .copy_bodies(&[1])
        .expect_err("a scenario has no bodies");
    assert_eq!(
        error.to_string(),
        "copying planets is not supported for a scenario document"
    );
}

#[test]
fn a_moon_spec_with_moons_of_its_own_is_refused() {
    let mut session = open_4_5();
    let mut copies = copy(&session, &[99]);
    let inner = copies[0].moons[0].clone();
    copies[0].moons[1].spec.moons.push(inner);
    let op = session
        .paste_bodies_op(KAZAM, &copies, None)
        .expect("an op");
    let error = session.apply(op).expect_err("a moon with moons");
    assert_eq!(error.to_string(), "a moon cannot have moons");
}

/// Planet `id`'s `binary_flags`, 0 when it writes none.
fn flags(session: &Session, id: u32) -> u32 {
    const KEY: &str = "\n\t\t\tbinary_flags=";
    let entity = common::entity_text(session, EntityKind::Planet, id);
    entity.find(KEY).map_or(0, |at| {
        let rest = &entity[at + KEY.len()..];
        rest.lines()
            .next()
            .unwrap_or_default()
            .parse()
            .expect("a number")
    })
}

/// Asteroid 1271 of Nihal (76) takes a name from the save's pool of asteroid names in
/// Kazam, and the inverse puts it back.
#[test]
fn an_asteroid_is_named_from_the_pool() {
    let copies = copy(&open_4_5(), &[1271]);
    assert!(copies[0].asteroid, "{copies:?}");
    let mut session = open_4_5();
    let op = session
        .paste_bodies_op(KAZAM, &copies, None)
        .expect("a paste");
    let result = session.apply(op).expect("the paste");
    let asteroid = pasted(&result);
    let entry = common::entity_text(&session, EntityKind::Planet, asteroid);
    assert!(entry.contains("key=\"ASTEROID_NAME_FORMAT\""), "{entry}");
    assert!(!entry.contains("PLANET_NAME_FORMAT"), "{entry}");
    reads_back(&session, asteroid, &copies[0]);
    session.apply(result.inverse).expect("the inverse");
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn a_save_before_stellaris_4_is_refused() {
    let older = open_3_4();
    let error = older.copy_bodies(&[3]).expect_err("a 3.4 copy");
    assert!(
        error.to_string().contains("Stellaris 4.0 or later"),
        "{error}"
    );
    let copies = copy(&open_4_5(), &[402]);
    let error = older
        .paste_bodies_op(0, &copies, None)
        .expect_err("a 3.4 paste");
    assert!(
        error.to_string().contains("Stellaris 4.0 or later"),
        "{error}"
    );
}

/// The ids of every body a paste wrote, as its inverse removes them.
fn all_pasted(result: &OpResult) -> Vec<u32> {
    let mut ids = Vec::new();
    let mut pending = vec![&result.inverse];
    while let Some(op) = pending.pop() {
        match op {
            Op::Batch { ops, .. } => pending.extend(ops),
            Op::RemoveBody { body } => ids.push(*body),
            _ => {}
        }
    }
    ids.sort_unstable();
    ids
}

/// Three planets pasted as one batch into Kazam, which has 14 bodies, on a session whose
/// details were built first, as the app's are: the details list all 20 without a reload.
#[test]
fn a_pasted_group_shows_in_the_live_details() {
    let mut session = open_4_5();
    session.warm_details().expect("build details");
    let copies = copy(&session, &[10, 402, 1271]);
    let op = session
        .paste_bodies_op(KAZAM, &copies, None)
        .expect("a paste");
    let result = session.apply(op).expect("the paste");
    assert!(
        result.details_stale.contains(&KAZAM),
        "{:?}",
        result.details_stale
    );
    let new = all_pasted(&result);
    assert_eq!(new.len(), 6, "three planets and three moons: {new:?}");

    let details = session.details().expect("the details");
    let listed: Vec<u32> = details
        .raw(KAZAM)
        .expect("Kazam's details")
        .planets
        .iter()
        .map(|p| p.id)
        .collect();
    assert_eq!(listed.len(), 20, "{listed:?}");
    for id in new {
        assert!(listed.contains(&id), "{id} missing from {listed:?}");
    }
}

/// Each `AddBody` of a pasted group's batch, as (radius, angle).
fn placements(op: &Op) -> Vec<(f64, f64)> {
    let Op::Batch { ops, .. } = op else {
        panic!("a batch, not {op:?}");
    };
    ops.iter()
        .map(|op| match op {
            Op::AddBody { at, .. } => (at.radius, at.angle),
            other => panic!("an add, not {other:?}"),
        })
        .collect()
}

/// A group lines up at one angle on increasing radii: from the point it was pasted at,
/// outward, or on the next free orbits past Kazam's reach at 0° without one.
#[test]
fn a_pasted_group_lines_up_at_one_angle() {
    let mut session = open_4_5();
    let copies = copy(&session, &[10, 402, 1271]);
    let at = OrbitPlacement {
        radius: 50.0,
        angle: 135.0,
    };
    for (given, angle) in [(None, 0.0), (Some(at), 135.0)] {
        let op = session
            .paste_bodies_op(KAZAM, &copies, given)
            .expect("a paste");
        let placed = placements(&op);
        assert_eq!(placed.len(), 3);
        assert!(placed.iter().all(|&(_, a)| a == angle), "{placed:?}");
        assert!(
            placed.windows(2).all(|pair| pair[0].0 < pair[1].0),
            "{placed:?}"
        );
        if given.is_some() {
            assert_eq!(placed[0].0, 50.0, "the first copy goes where it was pasted");
        }
    }
    let op = session
        .paste_bodies_op(KAZAM, &copies, Some(at))
        .expect("a paste");
    snapshot_step(&mut session, "paste_group_into_216_at_135", op);
}
