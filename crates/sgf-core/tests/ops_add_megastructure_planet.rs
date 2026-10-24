//! A megastructure whose completion spawns a planet round the body it stands at, added to
//! the 4.5 sample: the row and the planet in one op, what is refused, what undo and the
//! inverse give back, and the planet removed on its own.

use sgf_core::entity::views::EntityKind;
use sgf_core::ops::{MegastructurePlace, NewMegastructure, NewPlanet, Op, TimedModifier};
use sgf_core::session::Session;

use crate::common;
use common::diff::snapshot_step;
use common::edit::{ALARI, planet_text, system_text};
use common::examples::{ADDED_MEGASTRUCTURE, sol_shipyard};
use common::line_diff::line_diff;
use common::{assert_refusals, current, entity_text, open_4_5, text};

/// The id the 4.5 sample's first added planet takes.
const ADDED_PLANET: u32 = 16777273;

/// [`sol_shipyard`]'s spec.
fn shipyard() -> NewMegastructure {
    let Op::AddMegastructure { spec, .. } = sol_shipyard() else {
        unreachable!("sol_shipyard adds a megastructure");
    };
    spec
}

/// [`sol_shipyard`] with its planet changed by `change`.
fn with_planet(change: impl FnOnce(&mut NewPlanet)) -> Op {
    let mut spec = shipyard();
    change(spec.planet.as_mut().expect("a planet"));
    Op::AddMegastructure {
        system: ALARI,
        spec,
    }
}

#[test]
fn what_an_add_with_a_planet_refuses() {
    let mut session = open_4_5();
    let free = Op::AddMegastructure {
        system: ALARI,
        spec: NewMegastructure {
            at: MegastructurePlace::Free { x: 10.0, y: 10.0 }.into(),
            ..shipyard()
        },
    };
    let round_a_moon = Op::AddMegastructure {
        system: ALARI,
        spec: NewMegastructure {
            at: MegastructurePlace::Body { body: 3 }.into(),
            ..shipyard()
        },
    };
    let timed = |days: &[Option<u32>]| {
        with_planet(|planet| {
            planet.modifiers = days
                .iter()
                .map(|&days| TimedModifier {
                    modifier: "ringyard_alloys".to_owned(),
                    days,
                })
                .collect();
        })
    };
    assert_refusals(
        &mut session,
        [
            (
                free,
                "a eq_shipyard_2 cannot be added there: it spawns a planet round the body it stands at, and it stands at none",
            ),
            (
                round_a_moon,
                "a eq_shipyard_2 cannot be added there: planet #3 orbits Alari planet #2, and Galaxy Forge can't put a planet round anything that orbits a planet",
            ),
            (
                with_planet(|planet| planet.size = 0),
                "a planet size may not be zero",
            ),
            (
                with_planet(|planet| planet.at.radius = 0.0),
                "radius 0 is invalid: a body's orbit must be greater than zero",
            ),
            (
                with_planet(|planet| planet.at.angle = f64::INFINITY),
                "value is not a finite number",
            ),
            (
                with_planet(|planet| planet.class = "two words".to_owned()),
                "\"two words\" cannot be written as a planet class",
            ),
            (
                with_planet(|planet| planet.name = "a \"quoted\" name".to_owned()),
                r#""a \"quoted\" name" cannot be written as a name key"#,
            ),
            (
                with_planet(|planet| planet.model = Some("two words".to_owned())),
                "\"two words\" cannot be written as a model",
            ),
            (
                with_planet(|planet| planet.flags = vec!["two words".to_owned()]),
                "\"two words\" cannot be written as a planet flag",
            ),
            (
                timed(&[Some(0)]),
                "a modifier cannot last 0 days, or longer than a save can hold: -1 keeps it for ever",
            ),
            (
                timed(&[None, Some(30)]),
                "\"ringyard_alloys\" is listed twice as a modifier",
            ),
        ],
    );
}

/// The row stands on planet 2 as one without a planet does, and the ring planet orbits
/// planet 2 a hundred-thousandth out at save angle 180, listed by Alari after its last
/// `planet=` line and by planet 2 after its moon 3, with its flags dated the save's date and
/// its modifier for ever. Undo puts the bytes back.
#[test]
fn a_shipyard_spawns_its_ring_round_its_planet() {
    let mut session = open_4_5();
    let result = snapshot_step(&mut session, "megastructure_with_a_planet", sol_shipyard());
    assert_eq!(result.created.planets, [ADDED_PLANET]);
    assert_eq!(result.created.megastructures, [ADDED_MEGASTRUCTURE]);
    let host = planet_text(&session, 2);
    assert!(
        host.contains(&format!("megastructure={ADDED_MEGASTRUCTURE}")),
        "{host}"
    );
    assert!(host.contains(&format!(" {ADDED_PLANET}")), "{host}");
    assert!(
        system_text(&session, ALARI).contains(&format!("planet={ADDED_PLANET}")),
        "the system lists the planet"
    );
    let planet = entity_text(&session, EntityKind::Planet, ADDED_PLANET);
    for line in [
        "moon_of=2",
        "planet_class=\"pc_equatorial_shipyard\"",
        "modifier=\"ringyard_alloys\"",
        "days=-1",
    ] {
        assert!(planet.contains(line), "{line}: {planet}");
    }
    session.undo().expect("undo").expect("the add to undo");
    assert_eq!(current(&session), session.doc().original());
}

/// The inverse takes the planet out before the row, and applied, leaves the save as it was
/// opened.
#[test]
fn the_inverse_takes_the_planet_then_the_row() {
    let mut session = open_4_5();
    let added = session.apply(sol_shipyard()).expect("the shipyard");
    let Op::Batch { ops, .. } = &added.inverse else {
        panic!("{:?}", added.inverse);
    };
    assert_eq!(
        ops[..],
        [
            Op::RemoveBody { body: ADDED_PLANET },
            Op::RemoveMegastructure {
                megastructure: ADDED_MEGASTRUCTURE,
                construction: None,
                left_out: 0,
            },
        ]
    );
    session
        .apply_inverse(added.inverse.clone())
        .expect("the inverse");
    assert_eq!(current(&session), session.doc().original());
}

/// The ring planet can be removed on its own: the row stays on planet 2, and undo puts the
/// planet back.
#[test]
fn the_planet_is_removed_on_its_own() {
    let mut session = open_4_5();
    session.apply(sol_shipyard()).expect("the shipyard");
    let after_add = current(&session);
    session
        .apply(Op::RemoveBody { body: ADDED_PLANET })
        .expect("the ring planet");
    let host = planet_text(&session, 2);
    assert!(
        host.contains(&format!("megastructure={ADDED_MEGASTRUCTURE}")),
        "{host}"
    );
    assert!(!host.contains(&ADDED_PLANET.to_string()), "{host}");
    assert!(!system_text(&session, ALARI).contains(&format!("planet={ADDED_PLANET}")));
    session.undo().expect("undo").expect("the removal to undo");
    assert_eq!(current(&session), after_add);
}

/// The inverse of removing the ring planet puts it back round planet 2 as the shipyard wrote
/// it, and the inverse of the batch that undoes the add writes the add again.
#[test]
fn the_inverses_put_the_planet_back_round_its_planet() {
    let mut session = open_4_5();
    let added = session.apply(sol_shipyard()).expect("the shipyard");
    let after_add = text(&session);
    let as_added = |session: &Session| {
        let now = text(session);
        assert!(
            now == after_add,
            "{}",
            line_diff(&after_add, &now, ("added", "now"))
        );
    };
    let removed = session
        .apply(Op::RemoveBody { body: ADDED_PLANET })
        .expect("the ring planet");
    assert_eq!(
        removed.inverse,
        Op::AddSpawnedPlanet {
            body: 2,
            planet: shipyard().planet.expect("a planet"),
        }
    );
    let back = session
        .apply_inverse(removed.inverse)
        .expect("the ring planet back");
    assert_eq!(
        back.entry.description,
        "Added planet Processing Ring #16777273 round Alari planet #2 in Alari system #169"
    );
    as_added(&session);

    let undone = session.apply_inverse(added.inverse).expect("the inverse");
    session
        .apply_inverse(undone.inverse)
        .expect("the shipyard again");
    as_added(&session);
}
