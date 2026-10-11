//! Adding a megastructure to the 4.5 sample, and taking an added one out again: the diff,
//! what the details read back, the ids the rows take and what is refused.

use sgf_core::entity::views::EntityKind;
use sgf_core::format::save::details::{HeuristicResolver, MegastructureSummary};
use sgf_core::ops::{
    ConstructionDeposit, ConstructionModifier, MegastructureConstruction, MegastructureDismantle,
    MegastructurePlace, ModifierHost, NewBypass, Op, VariableDrop, VariableRaise,
};
use sgf_core::projections::galaxy::BypassLink;
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::examples::sol_nexus;
use common::{assert_refusals, current, entity_text, open_3_4, open_4_5};

/// The 4.5 sample's capital system, Sol, holds gas giant 6, barren planet 4 and the capital
/// 2, the only one of the three with a `flags` block. Country 0 lists no megastructure.
const SOL: u32 = 169;

/// One row: the bypass as kind and whether it is open.
struct Row<'a> {
    system: u32,
    kind: &'a str,
    at: MegastructurePlace,
    owner: Option<u32>,
    bypass: Option<(&'a str, bool)>,
    ruin: bool,
    flag: bool,
    star_only: bool,
}

impl Row<'_> {
    fn op(&self) -> Op {
        Op::AddMegastructure {
            system: self.system,
            kind: self.kind.to_owned(),
            at: self.at,
            owner: self.owner,
            bypass: self.bypass.map(|(kind, active)| NewBypass {
                kind: kind.to_owned(),
                active,
            }),
            ruined_orbital_ring: self.ruin,
            megastructure_flag: self.flag,
            star_only: self.star_only,
            construction: None,
        }
    }
}

fn body_row(system: u32, kind: &str, body: u32) -> Row<'_> {
    Row {
        system,
        kind,
        at: MegastructurePlace::Body { body },
        owner: None,
        bypass: None,
        ruin: false,
        flag: false,
        star_only: false,
    }
}

fn free_row<'a>(system: u32, kind: &'a str, bypass: &'a str, active: bool) -> Row<'a> {
    Row {
        system,
        kind,
        at: MegastructurePlace::Free { x: 0.0, y: -260.0 },
        owner: None,
        bypass: Some((bypass, active)),
        ruin: false,
        flag: false,
        star_only: false,
    }
}

fn on_body(system: u32, kind: &str, body: u32) -> Op {
    body_row(system, kind, body).op()
}

fn ruin(system: u32, body: u32) -> Op {
    Row {
        ruin: true,
        ..body_row(system, "orbital_ring_ruined", body)
    }
    .op()
}

fn nexus() -> Op {
    sol_nexus()
}

fn free(system: u32, kind: &str, bypass: &str, active: bool) -> Op {
    free_row(system, kind, bypass, active).op()
}

fn remove(megastructure: u32) -> Op {
    Op::RemoveMegastructure {
        megastructure,
        construction: None,
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
    let result = snapshot_step(&mut session, "megastructure_nexus_added", nexus());
    assert_eq!(result.inverse, remove(16));
    assert_eq!(result.details_stale, [SOL]);
    let added = megastructures(&session, SOL);
    let nexus = added.iter().find(|m| m.id == 16).expect("row 16");
    assert_eq!(nexus.kind, "think_tank_3");
    assert_eq!((nexus.owner, nexus.planet), (Some(0), Some(6)));
    assert_eq!(nexus.culture.as_deref(), Some("mammalian_01"));
    assert!(entity_text(&session, EntityKind::Megastructure, 16).contains("think_tank_3"));

    let planet = common::planets(&session, SOL)
        .into_iter()
        .find(|p| p.id == 6)
        .expect("planet 6");
    assert_eq!(nexus.at, planet.at, "the row stands at the planet's point");
    session
        .apply(Op::MoveBody {
            system: SOL,
            body: 6,
            radius: 140.0,
            angle: 90.0,
        })
        .expect("move the gas giant");
    let moved = common::planets(&session, SOL)
        .into_iter()
        .find(|p| p.id == 6)
        .expect("planet 6");
    let row = megastructures(&session, SOL)
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
        ruin(SOL, 4),
    );
    let mut session = open_4_5();
    snapshot_step(
        &mut session,
        "megastructure_ruin_flags_appended",
        ruin(SOL, 2),
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
    session.apply(nexus()).expect("16");
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
    assert_eq!(removed.inverse, nexus());
    let text = String::from_utf8(current(&session)).expect("text");
    assert!(text.contains("\n\t16=none\n"), "16 is left as a tombstone");
    assert!(megastructures(&session, SOL).iter().all(|m| m.id != 16));

    session.apply(remove(17)).expect("take 17 out");
    assert_eq!(
        current(&session),
        session.doc().original(),
        "the tombstone goes with the last row after it"
    );
}

#[test]
fn an_inverse_puts_back_the_ruin_flag_and_the_bypass() {
    for op in [ruin(SOL, 2), free(1, "gateway_final", "gateway", true)] {
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
    let free_ruin = Row {
        ruin: true,
        ..free_row(0, "hyper_relay", "relay_bypass", true)
    }
    .op();
    let owned = Row {
        owner: Some(999),
        ..body_row(SOL, "think_tank_3", 6)
    }
    .op();
    let nan = Row {
        at: MegastructurePlace::Free {
            x: f64::NAN,
            y: 0.0,
        },
        ..free_row(1, "gateway_final", "gateway", true)
    }
    .op();
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
                free_ruin,
                "a hyper_relay cannot be added there: it stands on or around a planet or star, and a free point has none",
            ),
            (nan, "value is not a finite number"),
            (on_body(SOL, "", 6), "a megastructure type may not be empty"),
            (
                remove(4),
                "megastructure 4 was in the save when it was opened: only one added since then can be taken out again",
            ),
        ],
    );
    let mut old = open_3_4();
    let error = old.apply(nexus()).expect_err("a 3.4 save");
    assert!(error.to_string().contains("3.4"), "{error}");
}

#[test]
fn deleting_an_added_row_removes_it() {
    for op in [
        nexus(),
        ruin(SOL, 2),
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
        Row {
            star_only: true,
            ..body_row(1, "dyson_sphere_5", body)
        }
        .op()
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

/// The 4.5 sample was saved on 2201.03.25, which a planet flag dates 62818752.
#[test]
fn a_flagged_add_is_read_back_by_its_removal() {
    let mut session = open_4_5();
    session.apply(nexus()).expect("the Nexus");
    let planet = entity_text(&session, EntityKind::Planet, 6);
    assert!(planet.contains("has_megastructure=62818752"), "{planet}");
    let removed = session.apply(remove(16)).expect("the removal");
    assert_eq!(removed.inverse, nexus());
    assert_eq!(current(&session), session.doc().original());
}

/// Sol's bodies but its star, 0, and its colonised continental world, 2.
const SOL_FURNACE_PLANETS: [u32; 13] = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

fn modifier(on: ModifierHost, modifier: &str) -> ConstructionModifier {
    ConstructionModifier {
        on,
        modifier: modifier.to_owned(),
        days: -1,
    }
}

fn raise(variable: &str, by: u32) -> VariableRaise {
    VariableRaise {
        variable: variable.to_owned(),
        by,
    }
}

fn furnace_construction() -> MegastructureConstruction {
    MegastructureConstruction {
        modifiers: SOL_FURNACE_PLANETS
            .iter()
            .map(|&body| modifier(ModifierHost::Body { body }, "orbital_arc_furnace_4_mod"))
            .collect(),
        deposits: SOL_FURNACE_PLANETS
            .iter()
            .map(|&body| ConstructionDeposit {
                body,
                kind: "d_arc_furnace_4".to_owned(),
            })
            .collect(),
        variables: vec![raise("arc_furnace_counter", 1)],
    }
}

/// A finished Arc Furnace round Sol's molten planet 1, owned by country 0.
fn furnace() -> Op {
    with_construction(
        Row {
            owner: Some(0),
            flag: true,
            ..body_row(SOL, "orbital_arc_furnace_4", 1)
        },
        furnace_construction(),
    )
}

/// A finished Dyson Swarm round Sol's star, owned by country 16, which has no `variables`.
fn swarm() -> Op {
    with_construction(
        Row {
            owner: Some(16),
            flag: true,
            ..body_row(SOL, "dyson_swarm_3", 0)
        },
        MegastructureConstruction {
            modifiers: vec![modifier(
                ModifierHost::Body { body: 0 },
                "dyson_swarm_3_mod",
            )],
            deposits: Vec::new(),
            variables: vec![raise("dyson_swarm_counter", 1)],
        },
    )
}

fn with_construction(row: Row<'_>, construction: MegastructureConstruction) -> Op {
    match row.op() {
        Op::AddMegastructure {
            system,
            kind,
            at,
            owner,
            bypass,
            ruined_orbital_ring,
            megastructure_flag,
            star_only,
            ..
        } => Op::AddMegastructure {
            system,
            kind,
            at,
            owner,
            bypass,
            ruined_orbital_ring,
            megastructure_flag,
            star_only,
            construction: Some(construction),
        },
        other => other,
    }
}

/// Country 0's `variables` starts with `astral_threads_scripted_rewards_mult`, so the
/// counter goes first. Of the 13 planets, 1, 5, 8, 10, 11, 13 and 14 list deposits already.
#[test]
fn an_arc_furnace_writes_its_mining_bonus_deposits_and_counter() {
    let mut session = open_4_5();
    let result = snapshot_step(&mut session, "megastructure_furnace_constructed", furnace());
    assert_eq!(
        result.inverse,
        Op::RemoveMegastructure {
            megastructure: 16,
            construction: Some(furnace_construction()),
        }
    );
    let country = entity_text(&session, EntityKind::Country, 0);
    assert!(
        country.contains("arc_furnace_counter=1\n\t\t\tastral_threads_scripted_rewards_mult=1"),
        "{country}"
    );
    for body in SOL_FURNACE_PLANETS {
        let planet = entity_text(&session, EntityKind::Planet, body);
        assert!(
            planet.contains("orbital_arc_furnace_4_mod"),
            "{body}: {planet}"
        );
    }

    let removed = session.apply(remove(16)).expect("the removal");
    assert_eq!(removed.inverse, furnace(), "read back from the add");
    assert_eq!(current(&session), session.doc().original());
}

/// The add's inverse carries what it wrote; its inverse adds it all again, twice over.
#[test]
fn an_arc_furnace_and_its_inverse_undo_each_other_twice() {
    let mut session = open_4_5();
    let added = session.apply(furnace()).expect("the furnace").inverse;
    let after_add = current(&session);
    let removed = session.apply_inverse(added).expect("its inverse").inverse;
    assert_eq!(current(&session), session.doc().original());
    assert_eq!(removed, furnace());
    let again = session.apply_inverse(removed).expect("added again").inverse;
    assert_eq!(current(&session), after_add);
    session.apply_inverse(again).expect("removed again");
    assert_eq!(current(&session), session.doc().original());
}

/// Country 16 lists no variables, so it gains the block after its `flags`. Deleted, the
/// added row goes as its removal does, whatever the dismantle says.
#[test]
fn a_dyson_swarm_writes_its_star_modifier_and_counter() {
    let mut session = open_4_5();
    snapshot_step(&mut session, "megastructure_swarm_constructed", swarm());
    let deleted = session
        .apply(Op::DeleteMegastructure {
            megastructure: 16,
            dismantle: Some(MegastructureDismantle {
                modifiers: vec!["dyson_swarm_3_mod".to_owned()],
                deposits: Vec::new(),
                variables: vec![VariableDrop {
                    variable: "dyson_swarm_counter".to_owned(),
                    by: 1,
                }],
            }),
        })
        .expect("the delete");
    assert_eq!(deleted.inverse, swarm());
    assert_eq!(current(&session), session.doc().original());
}

/// A modifier on the system itself, and a counter the owner holds already at 0, which goes
/// back to 0 rather than out.
#[test]
fn a_system_modifier_and_a_held_counter_are_taken_back_exactly() {
    let seal = with_construction(
        Row {
            owner: Some(0),
            bypass: None,
            ..free_row(SOL, "shroud_seal", "", false)
        },
        MegastructureConstruction {
            modifiers: vec![modifier(ModifierHost::System, "shroud_seal_modifier")],
            deposits: Vec::new(),
            variables: vec![raise("conquest_subjects", 2)],
        },
    );
    round_trip(open_4_5(), seal.clone());
    let mut session = open_4_5();
    session.apply(seal.clone()).expect("the seal");
    let system = entity_text(&session, EntityKind::System, SOL);
    assert!(
        system.contains("modifier=\"shroud_seal_modifier\""),
        "{system}"
    );
    assert!(entity_text(&session, EntityKind::Country, 0).contains("conquest_subjects=2"));
    let removed = session.apply(remove(16)).expect("the removal");
    assert_eq!(removed.inverse, seal);
    assert_eq!(current(&session), session.doc().original());
}

/// Planet 2 has `prosp_uni_mod` already, and Xu Nur's star 584 stands in another system.
#[test]
fn a_construction_the_add_cannot_write_is_refused() {
    let built = |construction: MegastructureConstruction| {
        with_construction(
            Row {
                owner: Some(0),
                ..body_row(SOL, "orbital_arc_furnace_4", 1)
            },
            construction,
        )
    };
    let modifiers = |on, name: &str, days| MegastructureConstruction {
        modifiers: vec![ConstructionModifier {
            on,
            modifier: name.to_owned(),
            days,
        }],
        ..MegastructureConstruction::default()
    };
    let unowned = with_construction(
        body_row(SOL, "dyson_swarm_3", 0),
        MegastructureConstruction {
            variables: vec![raise("dyson_swarm_counter", 1)],
            ..MegastructureConstruction::default()
        },
    );
    let mut session = open_4_5();
    assert_refusals(
        &mut session,
        [
            (
                built(modifiers(
                    ModifierHost::Body { body: 2 },
                    "prosp_uni_mod",
                    -1,
                )),
                "a orbital_arc_furnace_4 cannot be added there: planet 2 already has modifier prosp_uni_mod",
            ),
            (
                built(modifiers(ModifierHost::System, "shroud_seal_modifier", 0)),
                "a orbital_arc_furnace_4 cannot be added there: modifier shroud_seal_modifier would last 0 days",
            ),
            (
                built(modifiers(
                    ModifierHost::Body { body: 584 },
                    "dyson_swarm_3_mod",
                    -1,
                )),
                "planet 584 is not a body of system 169",
            ),
            (
                unowned,
                "a dyson_swarm_3 cannot be added there: variable dyson_swarm_counter needs an owner to count it",
            ),
        ],
    );
}
