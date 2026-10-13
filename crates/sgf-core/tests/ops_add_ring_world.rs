//! Adding a ring world round a star of the 4.5 sample, with the system cleared first or with
//! its planets left in place, taking it out again, and what is refused.

use sgf_core::entity::views::EntityKind;
use sgf_core::ops::{
    NewMegastructure, NewMegastructurePlace, NewRingWorld, Op, RingQuadrant, RingVariable,
    TimedModifier,
};
use sgf_core::session::Session;
use sgf_core::views::ClearedMegastructure;

use crate::common;
use common::diff::snapshot_step;
use common::edit::{ALARI, open_4_5_edited, planet_text, system_text};
use common::examples::{
    CHORS_COMPASS, HABRAQ, chors_ring, finished_quadrant, finished_ring, mixed_ring, sol_nexus,
    titanic_ring,
};
use common::{assert_refusals, current, entity_text, open_4_5};

/// Lachium, whose ruined ring the sample holds.
const LACHIUM: u32 = 203;
/// Tuzhik, a binary system: stars 618 and 619.
const TUZHIK: u32 = 5;
/// A one-star system with no megastructure, whose star is 584.
const STAR_SYSTEM: u32 = 1;
const STAR: u32 = 584;
/// Vinh, whose tropical planet 517 is a colony.
const VINH: u32 = 174;
/// Plessis, whose starbase orbits the uncolonised shielded world 484.
const PLESSIS: u32 = 298;

fn owner(session: &Session, system: u32) -> Option<u32> {
    session.graph().systems.get(&system).and_then(|s| s.owner)
}

/// Cleared as the game's frame clears it, Habraq loses its four planets, the moon of 782 and
/// its belt, and gains twelve segments round its star, which gets `has_megastructure`; the
/// system gets `ring_world_built`. Undo puts back the bytes.
#[test]
fn a_finished_ring_in_a_cleared_system() {
    let mut session = open_4_5();
    let owner = owner(&session, HABRAQ);
    assert!(owner.is_some(), "Habraq is owned");
    let op = session
        .save("adding a ring world")
        .expect("a save")
        .ring_world_op(HABRAQ, owner, finished_ring(), true)
        .expect("the batch");
    let Op::Batch { ops, description } = &op else {
        panic!("{op:?}");
    };
    assert_eq!(
        description,
        "Added a ring world round Habraq #159, removing 4 planets, 1 moon and 1 belt"
    );
    assert_eq!(ops[0], Op::DeleteBody { body: 783 }, "the moon first");
    let result = snapshot_step(&mut session, "finished_ring_cleared", op);
    assert_eq!(result.details_stale, [HABRAQ]);
    let ids = common::planet_ids(&session, HABRAQ);
    assert_eq!(ids.len(), 13, "the star and twelve segments: {ids:?}");
    assert!(ids.contains(&778), "{ids:?}");
    let system = system_text(&session, HABRAQ);
    assert!(system.contains("ring_world_built="), "{system}");
    assert!(!system.contains("asteroid_belts"), "{system}");
    assert!(planet_text(&session, 778).contains("has_megastructure="));
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), session.doc().original());
}

/// Chors Compass keeps its four planets and two belts. Its frame quadrant is a named row in
/// its culture, its ruined quadrant a row with no name or culture, and the system gets the
/// section counter the one finished quadrant leaves. The base game's chain flags no star, so
/// the star stays as it is.
#[test]
fn a_mixed_ring_with_the_planets_left_in_place() {
    let mut session = open_4_5();
    let owner = owner(&session, CHORS_COMPASS);
    let before = common::planet_ids(&session, CHORS_COMPASS);
    let op = session
        .save("adding a ring world")
        .expect("a save")
        .ring_world_op(CHORS_COMPASS, owner, mixed_ring(), false)
        .expect("the op");
    assert_eq!(op, chors_ring(owner), "no batch without clearing");
    let result = snapshot_step(&mut session, "mixed_ring_in_place", op);
    assert_eq!(
        result.entry.description,
        "Added a ring world round Chors Compass #23 with 1 finished section, 1 frame section, 1 ruined section and 1 damaged section"
    );
    let after = common::planet_ids(&session, CHORS_COMPASS);
    assert!(before.iter().all(|id| after.contains(id)), "{after:?}");
    assert_eq!(after.len(), before.len() + 6);
    let system = system_text(&session, CHORS_COMPASS);
    assert!(system.contains("asteroid_belts"), "{system}");
    assert!(system.contains("ring_section_1="), "{system}");
    let star = planet_text(&session, 794);
    assert!(
        !star.contains("has_megastructure"),
        "a chain that flags no star leaves it as it is: {star}"
    );
}

/// Taking out a ring world added this session leaves the save as it was opened, and its
/// inverse adds the same ring again.
#[test]
fn removing_an_added_ring_world_leaves_the_save_as_it_was() {
    let mut session = open_4_5();
    let add = chors_ring(Some(0));
    let added = session.apply(add.clone()).expect("the add");
    let removal = added.inverse.clone();
    assert!(matches!(removal, Op::RemoveRingWorld { .. }), "{removal:?}");
    let removed = session.apply_inverse(removal).expect("the removal");
    assert_eq!(
        removed.entry.description,
        "Removed the ring world from Chors Compass #23"
    );
    assert_eq!(current(&session), session.doc().original());
    assert_eq!(removed.inverse, add);
}

/// The clearing names the colonies it takes, so the app can name them before the add; the
/// batch then goes as one edit.
#[test]
fn the_clearing_names_the_colonies_it_takes() {
    let mut session = open_4_5();
    let clearing = session
        .save("clearing a system for a ring world")
        .expect("a save")
        .ring_world_clearing(VINH)
        .expect("the clearing");
    assert_eq!(clearing.colonies, [517]);
    assert_eq!(clearing.bodies.len(), 12);
    assert_eq!(clearing.moons, 2);
    let op = session
        .save("adding a ring world")
        .expect("a save")
        .ring_world_op(VINH, None, finished_ring(), true)
        .expect("the batch");
    let result = session.apply(op).expect("the add");
    assert!(
        result
            .entry
            .description
            .ends_with(", with the colony on planet #517"),
        "{}",
        result.entry.description
    );
    assert_eq!(common::planet_ids(&session, VINH).len(), 13);
}

#[test]
fn what_an_add_refuses() {
    let mut session = open_4_5();
    let add = |system: u32, ring: NewRingWorld| Op::AddRingWorld {
        system,
        owner: None,
        ring,
    };
    let empty = NewRingWorld {
        quadrants: Vec::new(),
        system_flags: Vec::new(),
        system_variables: Vec::new(),
        star_flags: Vec::new(),
    };
    let mut sizeless = finished_ring();
    if let RingQuadrant::Finished { segments } = &mut sizeless.quadrants[0] {
        segments[0].planet.size = 0;
    }
    let no_planets = NewRingWorld {
        quadrants: vec![RingQuadrant::Finished {
            segments: Vec::new(),
        }],
        system_flags: Vec::new(),
        system_variables: Vec::new(),
        star_flags: Vec::new(),
    };
    let twice = NewRingWorld {
        quadrants: vec![finished_quadrant(180.0, "NAME_Habitable_Section_A")],
        system_flags: ["ring_world_built", "ring_world_built"]
            .map(str::to_owned)
            .to_vec(),
        system_variables: Vec::new(),
        star_flags: Vec::new(),
    };
    assert_refusals(
        &mut session,
        [
            (
                add(LACHIUM, finished_ring()),
                "a ring world cannot be added there: planet 2445 of Lachium #203 is a segment of the ring world at orbit 45.01",
            ),
            (
                add(TUZHIK, finished_ring()),
                "a ring world cannot be added there: Tuzhik #5 has 2 stars, and a ring world stands round one",
            ),
            (
                Op::AddRingWorld {
                    system: HABRAQ,
                    owner: Some(99_999),
                    ring: finished_ring(),
                },
                "country 99999 does not exist",
            ),
            (
                add(HABRAQ, empty),
                "a ring world cannot be added there: it has no quadrants",
            ),
            (
                add(HABRAQ, no_planets),
                "a ring world cannot be added there: a quadrant with no planets",
            ),
            (add(HABRAQ, sizeless), "a planet size may not be zero"),
            (
                add(HABRAQ, twice),
                "\"ring_world_built\" cannot be written as a flag listed once",
            ),
            (
                add(999_999, finished_ring()),
                "system 999999 does not exist",
            ),
        ],
    );
    session
        .apply(chors_ring(None))
        .expect("a ring round Chors Compass");
    assert_refusals(
        &mut session,
        [(
            chors_ring(None),
            "a ring world cannot be added there: planet 16777273 of Chors Compass #23 is a segment of the ring world at orbit 45.21",
        )],
    );
}

/// No save shows what the game does with a starbase whose planet the frame removes, so the
/// clearing names the planet and refuses before any op is built. Left in place, the planet
/// keeps its starbase and the ring goes in.
#[test]
fn clearing_a_planet_a_starbase_orbits_is_refused() {
    let mut session = open_4_5();
    let clearing = session
        .save("clearing a system for a ring world")
        .expect("a save")
        .ring_world_clearing(PLESSIS)
        .expect("the clearing");
    assert_eq!(clearing.starbase_bodies, [484]);
    let refused = session
        .save("adding a ring world")
        .expect("a save")
        .ring_world_op(PLESSIS, None, finished_ring(), true)
        .expect_err("a starbase's planet");
    assert_eq!(
        refused.to_string(),
        "a ring world cannot be added there: a starbase orbits planet 484, which clearing Plessis #298 would delete; add the ring with the planets left in place"
    );
    let op = session
        .save("adding a ring world")
        .expect("a save")
        .ring_world_op(PLESSIS, None, finished_ring(), false)
        .expect("left in place");
    session.apply(op).expect("the ring");
}

/// A ring world goes round a star that a Dyson Sphere wraps, as it does in a system holding
/// any other megastructure: the game runs such a save. The star keeps its `megastructure` key
/// and the sphere's row stands as it was. Undo puts back the bytes.
#[test]
fn a_ring_round_a_star_a_dyson_sphere_wraps() {
    let mut session = open_4_5();
    let sphere = Op::AddMegastructure {
        system: STAR_SYSTEM,
        spec: NewMegastructure {
            kind: "dyson_sphere_5".to_owned(),
            at: NewMegastructurePlace::Body {
                body: STAR,
                body_flags: vec!["has_megastructure".to_owned()],
                star_only: true,
            },
            ..NewMegastructure::default()
        },
    };
    session.apply(sphere).expect("the sphere");
    let with_sphere = current(&session);
    let row = entity_text(&session, EntityKind::Megastructure, 16);
    assert!(planet_text(&session, STAR).contains("megastructure=16"));
    let op = session
        .save("adding a ring world")
        .expect("a save")
        .ring_world_op(STAR_SYSTEM, None, finished_ring(), false)
        .expect("the op");
    session.apply(op).expect("the ring beside the sphere");
    assert_eq!(entity_text(&session, EntityKind::Megastructure, 16), row);
    assert!(planet_text(&session, STAR).contains("megastructure=16"));
    assert!(system_text(&session, STAR_SYSTEM).contains("ring_world_built="));
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), with_sphere);
    session.undo().expect("undo").expect("the sphere");
    assert_eq!(current(&session), session.doc().original());
}

/// Clearing a system deletes the megastructure rows that name a body it deletes, before the
/// body, since `DeleteBody` refuses a body a row names. Undo puts back the bytes.
#[test]
fn clearing_a_planet_a_megastructure_stands_on() {
    let mut session = open_4_5();
    session.apply(sol_nexus()).expect("the nexus");
    let with_nexus = current(&session);
    let clearing = session
        .save("clearing a system for a ring world")
        .expect("a save")
        .ring_world_clearing(ALARI)
        .expect("the clearing");
    assert_eq!(
        clearing.megastructures,
        [ClearedMegastructure { id: 16, body: 6 }]
    );
    let op = session
        .save("adding a ring world")
        .expect("a save")
        .ring_world_op(ALARI, Some(0), finished_ring(), true)
        .expect("the batch");
    let Op::Batch { ops, description } = &op else {
        panic!("{op:?}");
    };
    assert!(
        description.ends_with(" and megastructure #16"),
        "{description}"
    );
    assert_eq!(
        ops[0],
        Op::DeleteMegastructure {
            megastructure: 16,
            dismantle: None
        }
    );
    session.apply(op).expect("the cleared ring");
    assert!(!common::planet_ids(&session, ALARI).contains(&6));
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), with_nexus);
}

fn counted(value: f64) -> NewRingWorld {
    NewRingWorld {
        system_variables: vec![RingVariable {
            name: "ring_segments".to_owned(),
            value,
        }],
        ..mixed_ring()
    }
}

/// The section count a ring leaves goes in the system's `variables`: a block of its own
/// before `initializer` when the system has none, else in name order among what it holds, or
/// over the value it held. Taking the ring out puts the block back as it stood.
#[test]
fn the_rings_variables_are_written_and_taken_back() {
    let mut session = open_4_5();
    let added = session
        .apply(Op::AddRingWorld {
            system: CHORS_COMPASS,
            owner: None,
            ring: counted(1.0),
        })
        .expect("the ring");
    let system = system_text(&session, CHORS_COMPASS);
    let block = system.find(
        "		variables=
		{
			ring_segments=1
		}",
    );
    assert!(block.is_some(), "{system}");
    assert!(block < system.find("initializer="), "{system}");
    session.apply_inverse(added.inverse).expect("the removal");
    assert_eq!(current(&session), session.doc().original());

    for (held, written) in [
        (
            "			giga_system_bm=178
",
            "giga_system_bm=178
			ring_segments=1",
        ),
        (
            "			ring_segments=3
",
            "			ring_segments=1
		}",
        ),
    ] {
        let mut session = open_4_5_edited(|gamestate| {
            let objects = gamestate
                .find(
                    "
galactic_object=
",
                )
                .expect("systems");
            let system = objects
                + gamestate[objects..]
                    .find(
                        "
	23=
",
                    )
                    .expect("Chors");
            let at = system
                + gamestate[system..]
                    .find("		initializer=")
                    .expect("its initializer");
            gamestate.insert_str(
                at,
                &format!(
                    "		variables=
		{{
{held}		}}
"
                ),
            );
        });
        let before = current(&session);
        let added = session
            .apply(Op::AddRingWorld {
                system: CHORS_COMPASS,
                owner: None,
                ring: counted(1.0),
            })
            .expect("the ring");
        let system = system_text(&session, CHORS_COMPASS);
        assert!(system.contains(written), "{system}");
        assert_eq!(system.matches("ring_segments").count(), 1, "{system}");
        session.apply_inverse(added.inverse).expect("the removal");
        assert_eq!(current(&session), before, "{held}");
    }
}

/// A titanic ring goes round Lachium's star beside the base game's ring the file holds at 45:
/// its segments stand at 90.4, its habitable sections have the housing modifier with no end,
/// and the system and the star get the flags its chain leaves. A second ring at 45 is
/// refused. Undo puts back the bytes.
#[test]
fn a_titanic_ring_beside_a_ring_the_file_holds() {
    let mut session = open_4_5();
    let op = session
        .save("adding a ring world")
        .expect("a save")
        .ring_world_op(LACHIUM, None, titanic_ring(), false)
        .expect("the op");
    let result = snapshot_step(&mut session, "titanic_ring_beside_lachiums", op);
    assert_eq!(
        result.entry.description,
        "Added a ring world round Lachium #203"
    );
    let system = system_text(&session, LACHIUM);
    for flag in [
        "giga_has_titanic_ring=",
        "ring_world_built_one=",
        "ring_08=",
    ] {
        assert!(system.contains(flag), "{flag}: {system}");
    }
    assert!(planet_text(&session, 2444).contains("has_megastructure="));
    assert_refusals(
        &mut session,
        [(
            Op::AddRingWorld {
                system: LACHIUM,
                owner: None,
                ring: titanic_ring(),
            },
            "a ring world cannot be added there: planet 16777273 of Lachium #203 is a segment of the ring world at orbit 90.43",
        )],
    );
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), session.doc().original());
}

/// Clearing a system that holds a ring world leaves its segments and rows standing: only the
/// other bodies and the belts go before the new ring is added. Undo puts back the bytes.
#[test]
fn clearing_for_a_second_ring_keeps_the_first() {
    let mut session = open_4_5();
    session
        .apply(chors_ring(None))
        .expect("the base game's ring");
    let with_ring = current(&session);
    let segments: Vec<u32> = common::planet_ids(&session, CHORS_COMPASS)
        .into_iter()
        .filter(|&id| planet_text(&session, id).contains("pc_ringworld"))
        .collect();
    assert_eq!(segments.len(), 6, "{segments:?}");
    let clearing = session
        .save("clearing a system for a ring world")
        .expect("a save")
        .ring_world_clearing(CHORS_COMPASS)
        .expect("the clearing");
    assert_eq!(clearing.bodies.len(), 4, "{:?}", clearing.bodies);
    assert!(
        clearing.bodies.iter().all(|id| !segments.contains(id)),
        "{clearing:?}"
    );
    let op = session
        .save("adding a ring world")
        .expect("a save")
        .ring_world_op(CHORS_COMPASS, None, titanic_ring(), true)
        .expect("the batch");
    let result = session.apply(op).expect("the cleared titanic ring");
    assert_eq!(
        result.entry.description,
        "Added a ring world round Chors Compass #23, removing 4 planets and 2 belts"
    );
    let ids = common::planet_ids(&session, CHORS_COMPASS);
    assert!(segments.iter().all(|id| ids.contains(id)), "{ids:?}");
    assert_eq!(ids.len(), 1 + 6 + 12, "{ids:?}");
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), with_ring);
}

/// A segment's timed modifier is checked as an added modifier is: a day count of 0, one past
/// what a save holds and a modifier listed twice are refused.
#[test]
fn what_a_segments_modifiers_refuse() {
    let mut session = open_4_5();
    let with = |days: &[Option<u32>]| {
        let mut ring = titanic_ring();
        if let RingQuadrant::Finished { segments } = &mut ring.quadrants[0] {
            segments[2].modifiers = days
                .iter()
                .map(|&days| TimedModifier {
                    modifier: "giga_titanic_housing".to_owned(),
                    days,
                })
                .collect();
        }
        Op::AddRingWorld {
            system: HABRAQ,
            owner: None,
            ring,
        }
    };
    assert_refusals(
        &mut session,
        [
            (
                with(&[Some(0)]),
                "a modifier cannot last 0 days, or longer than a save can hold: -1 keeps it for ever",
            ),
            (
                with(&[Some(u32::MAX)]),
                "a modifier cannot last 0 days, or longer than a save can hold: -1 keeps it for ever",
            ),
            (
                with(&[None, Some(360)]),
                "\"giga_titanic_housing\" cannot be written as a modifier listed once",
            ),
        ],
    );
}
