//! Adding a megastructure to the 4.5 sample, and taking an added one out again: the diff,
//! what the details read back, the ids the rows take and what is refused.

use sgf_core::entity::views::EntityKind;
use sgf_core::format::save::details::HeuristicResolver;
use sgf_core::ops::{MegastructurePlace, NewBypass, NewMegastructure, NewMegastructurePlace, Op};
use sgf_core::projections::galaxy::BypassLink;
use sgf_core::session::Session;
use sgf_core::views::details::MegastructureSummary;

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::edit::ALARI;
use common::examples::sol_nexus;
use common::{assert_refusals, current, entity_text, open_4_5};

pub(crate) fn add(system: u32, spec: NewMegastructure) -> Op {
    Op::AddMegastructure { system, spec }
}

/// A row of type `kind` on body `body`, which leaves nothing on it.
pub(crate) fn on(kind: &str, body: u32) -> NewMegastructure {
    NewMegastructure {
        kind: kind.to_owned(),
        at: MegastructurePlace::Body { body }.into(),
        ..NewMegastructure::default()
    }
}

/// A row of type `kind` on body `body`, which gives it the planet flags `flags`.
pub(crate) fn flagging(kind: &str, body: u32, flags: &[&str]) -> NewMegastructure {
    NewMegastructure {
        at: NewMegastructurePlace::Body {
            body,
            body_flags: flags.iter().map(|&flag| flag.to_owned()).collect(),
            star_only: false,
        },
        ..on(kind, body)
    }
}

/// A row of type `kind` at a point of its own, standing for an open or closed `bypass`.
pub(crate) fn at_point(kind: &str, bypass: &str, active: bool) -> NewMegastructure {
    NewMegastructure {
        kind: kind.to_owned(),
        at: MegastructurePlace::Free { x: 0.0, y: -260.0 }.into(),
        bypass: Some(NewBypass {
            kind: bypass.to_owned(),
            active,
        }),
        ..NewMegastructure::default()
    }
}

pub(crate) fn on_body(system: u32, kind: &str, body: u32) -> Op {
    add(system, on(kind, body))
}

fn ruin(system: u32, body: u32) -> Op {
    add(
        system,
        flagging("orbital_ring_ruined", body, &["ruined_orbital_ring_planet"]),
    )
}

fn free(system: u32, kind: &str, bypass: &str, active: bool) -> Op {
    add(system, at_point(kind, bypass, active))
}

pub(crate) fn remove(megastructure: u32) -> Op {
    Op::RemoveMegastructure {
        megastructure,
        construction: None,
        left_out: 0,
    }
}

fn megastructures(session: &Session, system: u32) -> Vec<MegastructureSummary> {
    session
        .details()
        .expect("details")
        .resolve(system, &HeuristicResolver, false)
        .expect("the system's details")
        .megastructures
}

/// The 4.5 sample's megastructure table holds slots up to 15, so the first add takes 16.
#[test]
fn a_science_nexus_added_on_a_gas_giant() {
    let mut session = open_4_5();
    let result = snapshot_step(&mut session, "megastructure_nexus_added", sol_nexus());
    assert_eq!(result.inverse, remove(16));
    assert_eq!(result.details_stale, [ALARI]);
    let added = megastructures(&session, ALARI);
    let nexus = added.iter().find(|m| m.id == 16).expect("row 16");
    assert_eq!(nexus.kind, "think_tank_3");
    assert_eq!((nexus.owner, nexus.planet), (Some(0), Some(6)));
    assert_eq!(nexus.culture.as_deref(), Some("mammalian_01"));
    assert!(entity_text(&session, EntityKind::Megastructure, 16).contains("think_tank_3"));

    let planet = common::planets(&session, ALARI)
        .into_iter()
        .find(|p| p.id == 6)
        .expect("planet 6");
    assert_eq!(nexus.at, planet.at, "the row stands at the planet's point");
    session
        .apply(Op::MoveBody {
            system: ALARI,
            body: 6,
            radius: 140.0,
            angle: 90.0,
        })
        .expect("move the gas giant");
    let moved = common::planets(&session, ALARI)
        .into_iter()
        .find(|p| p.id == 6)
        .expect("planet 6");
    let row = megastructures(&session, ALARI)
        .into_iter()
        .find(|m| m.id == 16)
        .expect("row 16");
    assert_eq!(row.at, moved.at, "the added row moves with its planet");
}

#[test]
fn a_ruined_orbital_ring_flags_its_planet() {
    let mut session = open_4_5();
    snapshot_step(
        &mut session,
        "megastructure_ruin_flags_created",
        ruin(ALARI, 4),
    );
    let mut session = open_4_5();
    snapshot_step(
        &mut session,
        "megastructure_ruin_flags_appended",
        ruin(ALARI, 2),
    );
}

/// The relays stand in Dristmak (0) and its neighbour 148, and their bypasses take 23 and
/// 24, past the sample's 22.
#[test]
fn two_relays_in_neighbouring_systems_connect_both_ways() {
    let mut session = open_4_5();
    session
        .apply(free(0, "hyper_relay", "relay_bypass", true))
        .expect("the first relay");
    let result = snapshot_step(
        &mut session,
        "megastructure_relays_added",
        free(148, "hyper_relay", "relay_bypass", true),
    );
    assert_eq!(result.inverse, remove(17));
    for system in [0, 148] {
        assert!(session.graph().bypasses.contains(&BypassLink::Other {
            system,
            kind: "relay_bypass".to_owned(),
        }));
    }
    session.apply(remove(17)).expect("take the second out");
    session.apply(remove(16)).expect("take the first out");
    assert_eq!(current(&session), session.doc().original());
}

/// The 4.5 sample's ruined gateways are bypasses 3 to 6.
#[test]
fn a_gateway_connects_to_every_other_gateway() {
    let mut session = open_4_5();
    snapshot_step(
        &mut session,
        "megastructure_gateway_added",
        free(1, "gateway_final", "gateway", true),
    );
    assert!(session.graph().bypasses.contains(&BypassLink::Gateway {
        system: 1,
        active: true,
    }));
}

#[test]
fn a_dyson_sphere_on_a_star_round_trips() {
    round_trip(open_4_5(), on_body(1, "dyson_sphere_5", 584));
    let mut session = open_4_5();
    session
        .apply(on_body(1, "dyson_sphere_5", 584))
        .expect("the sphere");
    let sphere = megastructures(&session, 1);
    assert_eq!(sphere.len(), 1);
    assert_eq!((sphere[0].id, sphere[0].planet), (16, Some(584)));
    assert_eq!((sphere[0].owner, sphere[0].at), (None, Some((0.0, 0.0))));
}

#[test]
fn an_added_row_gives_its_slot_back() {
    let mut session = open_4_5();
    session.apply(sol_nexus()).expect("16");
    session
        .apply(on_body(1, "dyson_sphere_5", 584))
        .expect("17");
    let removed = session.apply(remove(17)).expect("take 17 out");
    assert_eq!(removed.inverse, on_body(1, "dyson_sphere_5", 584));
    let again = session
        .apply(on_body(1, "dyson_sphere_5", 584))
        .expect("17 again");
    assert_eq!(again.inverse, remove(17), "the freed slot is taken again");

    let removed = session
        .apply(remove(16))
        .expect("take 16 out while 17 stands");
    assert_eq!(removed.inverse, sol_nexus());
    let text = String::from_utf8(current(&session)).expect("text");
    assert!(text.contains("\n\t16=none\n"), "16 is left as a tombstone");
    assert!(megastructures(&session, ALARI).iter().all(|m| m.id != 16));

    session.apply(remove(17)).expect("take 17 out");
    assert_eq!(
        current(&session),
        session.doc().original(),
        "the tombstone goes with the last row after it"
    );
}

#[test]
fn an_inverse_puts_back_the_ruin_flag_and_the_bypass() {
    for op in [ruin(ALARI, 2), free(1, "gateway_final", "gateway", true)] {
        let mut session = open_4_5();
        let added = session.apply(op.clone()).expect("the add");
        let removed = session.apply(added.inverse).expect("the removal");
        assert_eq!(current(&session), session.doc().original(), "{op:?}");
        assert_eq!(removed.inverse, op);
    }
}

/// Row 4 of the 4.5 sample is the ruined Orbital Ring on planet 936, in system 38.
#[test]
fn what_an_add_and_a_removal_refuse() {
    let mut session = open_4_5();
    session
        .apply(free(0, "hyper_relay", "relay_bypass", true))
        .expect("a relay in Dristmak");
    let owned = add(
        ALARI,
        NewMegastructure {
            owner: Some(999),
            ..on("think_tank_3", 6)
        },
    );
    let nan = add(
        1,
        NewMegastructure {
            at: NewMegastructurePlace::Free {
                x: f64::NAN,
                y: 0.0,
            },
            ..at_point("gateway_final", "gateway", true)
        },
    );
    let other_flag = add(ALARI, flagging("think_tank_3", 6, &["foo"]));
    let twice = add(
        ALARI,
        flagging(
            "think_tank_3",
            6,
            &["has_megastructure", "has_megastructure"],
        ),
    );
    assert_refusals(
        &mut session,
        [
            (
                on_body(38, "think_tank_3", 936),
                "a think_tank_3 cannot be added there: planet 936 already has megastructure 4",
            ),
            (
                free(0, "hyper_relay", "relay_bypass", true),
                "a hyper_relay cannot be added there: Dristmak #0 already has a relay_bypass",
            ),
            (
                free(1, "lgate_base", "lgate", false),
                "a lgate_base cannot be added there: its bypass is a lgate, which has not been tried in game",
            ),
            (owned, "country 999 does not exist"),
            (
                on_body(1, "think_tank_3", 6),
                "planet 6 is not a body of system 1",
            ),
            (
                other_flag,
                "a think_tank_3 cannot be added there: foo is not a planet flag a megastructure leaves",
            ),
            (
                twice,
                "\"has_megastructure\" cannot be written as a flag listed once",
            ),
            (nan, "value is not a finite number"),
            (
                on_body(ALARI, "", 6),
                "a megastructure type may not be empty",
            ),
            (
                remove(4),
                "megastructure 4 was in the save when it was opened: only a megastructure added since then can be removed or changed",
            ),
        ],
    );
}

#[test]
fn deleting_an_added_row_removes_it() {
    for op in [
        sol_nexus(),
        ruin(ALARI, 2),
        free(1, "gateway_final", "gateway", true),
    ] {
        let mut session = open_4_5();
        session.apply(op.clone()).expect("the add");
        let deleted = session
            .apply(Op::DeleteMegastructure {
                megastructure: 16,
                dismantle: None,
            })
            .expect("the delete");
        assert_eq!(current(&session), session.doc().original(), "{op:?}");
        assert_eq!(deleted.inverse, op);
    }
    let mut session = open_4_5();
    assert_refusals(
        &mut session,
        [(remove(99), "Megastructure 99 does not exist")],
    );
}

/// The second relay's bypass, 24, is left with no connections when the first goes.
#[test]
fn the_first_of_two_linked_relays_removed_while_the_second_stands() {
    let mut session = open_4_5();
    session
        .apply(free(0, "hyper_relay", "relay_bypass", true))
        .expect("the first relay");
    session
        .apply(free(148, "hyper_relay", "relay_bypass", true))
        .expect("the second relay");
    let removed = session.apply(remove(16)).expect("take the first out");
    assert_eq!(
        removed.inverse,
        free(0, "hyper_relay", "relay_bypass", true)
    );
    let text = String::from_utf8(current(&session)).expect("text");
    assert!(
        text.contains(
            "
	16=none
"
        ),
        "16 is left as a tombstone"
    );
    let bypasses = text
        .split(
            "
bypasses=
{",
        )
        .nth(1)
        .and_then(|rest| {
            rest.split(
                "
}
",
            )
            .next()
        })
        .expect("the bypasses table");
    let second = bypasses
        .split(
            "
	24=
",
        )
        .nth(1)
        .and_then(|rest| {
            rest.split(
                "
	}",
            )
            .next()
        })
        .expect("bypass 24");
    assert!(
        !second.contains("connections"),
        "24 keeps no list naming 23: {second}"
    );
    assert!(
        !bypasses.contains(
            "
	23=
"
        ),
        "bypass 23 is erased"
    );
    let relays: Vec<&BypassLink> = session
        .graph()
        .bypasses
        .iter()
        .filter(|link| matches!(link, BypassLink::Other { kind, .. } if kind == "relay_bypass"))
        .collect();
    assert_eq!(
        relays,
        [&BypassLink::Other {
            system: 148,
            kind: "relay_bypass".to_owned()
        }]
    );
    session.apply(remove(17)).expect("take the second out");
    assert_eq!(current(&session), session.doc().original());
}

/// Gas giant 6267 of system 596 has the `has_megastructure` flag with no row tied to it,
/// and planet 585 of Xu Nur (1) is not its star, 584.
#[test]
fn a_flagged_body_and_a_star_only_type_off_a_star_are_refused() {
    let mut session = open_4_5();
    let sphere = |body| {
        add(
            1,
            NewMegastructure {
                at: NewMegastructurePlace::Body {
                    body,
                    body_flags: Vec::new(),
                    star_only: true,
                },
                ..on("dyson_sphere_5", body)
            },
        )
    };
    assert_refusals(
        &mut session,
        [
            (
                on_body(596, "think_tank_3", 6267),
                "a think_tank_3 cannot be added there: the game counts a megastructure built at planet 6267 already",
            ),
            (
                sphere(585),
                "a dyson_sphere_5 cannot be added there: it is built only around a star, and planet 585 is not one",
            ),
        ],
    );
    session.apply(sphere(584)).expect("the sphere on the star");
}

/// A row whose add left an effect out says so again when a delete's inverse adds it back.
#[test]
fn a_deleted_row_comes_back_saying_what_its_add_left_out() {
    let mut session = open_4_5();
    let op = add(
        ALARI,
        NewMegastructure {
            left_out: 1,
            ..on("think_tank_3", 6)
        },
    );
    let added = session.apply(op.clone()).expect("the add");
    assert!(
        added
            .entry
            .description
            .ends_with(", leaving out 1 effect of its construction"),
        "{}",
        added.entry.description
    );
    let deleted = session
        .apply(Op::DeleteMegastructure {
            megastructure: 16,
            dismantle: None,
        })
        .expect("the delete");
    assert_eq!(deleted.inverse, op);
    let back = session.apply(deleted.inverse).expect("the add again");
    assert_eq!(back.entry.description, added.entry.description);
}

/// The 4.5 sample was saved on 2201.03.25, which a planet flag dates 62818656.
#[test]
fn a_flagged_add_is_read_back_by_its_removal() {
    let mut session = open_4_5();
    session.apply(sol_nexus()).expect("the Nexus");
    let planet = entity_text(&session, EntityKind::Planet, 6);
    assert!(planet.contains("has_megastructure=62818656"), "{planet}");
    let removed = session.apply(remove(16)).expect("the removal");
    assert_eq!(removed.inverse, sol_nexus());
    assert_eq!(current(&session), session.doc().original());
}
