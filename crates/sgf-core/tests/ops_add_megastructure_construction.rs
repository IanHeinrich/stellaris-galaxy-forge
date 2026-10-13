//! A megastructure added to the 4.5 sample as finished, with what its construction writes
//! beyond the row: modifiers, deposits and the owner's counters, and how its removal, a
//! delete, undo and redo take them back.

use sgf_core::entity::views::EntityKind;
use sgf_core::ops::{
    ConstructionDeposit, ConstructionModifier, MegastructureConstruction, MegastructureDismantle,
    ModifierHost, NewMegastructure, Op, TimedModifier, VariableStep,
};

use crate::common;
use crate::ops_add_megastructure::{add, at_point, flagging, on, remove};
use common::diff::{round_trip, snapshot_step};
use common::edit::{ALARI, open_4_5_edited};
use common::{assert_refusals, current, entity_text, open_4_5};

/// Alari's bodies but its star, 0, and its colonised continental world, 2.
const FURNACE_PLANETS: [u32; 13] = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

fn modifier(on: ModifierHost, modifier: &str) -> ConstructionModifier {
    ConstructionModifier {
        on,
        timed: TimedModifier {
            modifier: modifier.to_owned(),
            days: None,
        },
    }
}

fn raise(variable: &str, by: u32) -> VariableStep {
    VariableStep {
        variable: variable.to_owned(),
        by,
    }
}

fn furnace_construction() -> MegastructureConstruction {
    MegastructureConstruction {
        modifiers: FURNACE_PLANETS
            .iter()
            .map(|&body| modifier(ModifierHost::Body { body }, "orbital_arc_furnace_4_mod"))
            .collect(),
        deposits: FURNACE_PLANETS
            .iter()
            .map(|&body| ConstructionDeposit {
                body,
                kind: "d_arc_furnace_4".to_owned(),
            })
            .collect(),
        variables: vec![raise("arc_furnace_counter", 1)],
    }
}

/// A finished Arc Furnace round Alari's molten planet 1, owned by country 0.
fn furnace() -> Op {
    add(
        ALARI,
        NewMegastructure {
            owner: Some(0),
            construction: Some(furnace_construction()),
            ..flagging("orbital_arc_furnace_4", 1, &["has_megastructure"])
        },
    )
}

/// A finished Dyson Swarm round Alari's star, owned by country 16, which has no `variables`.
fn swarm() -> Op {
    add(
        ALARI,
        NewMegastructure {
            owner: Some(16),
            construction: Some(MegastructureConstruction {
                modifiers: vec![modifier(
                    ModifierHost::Body { body: 0 },
                    "dyson_swarm_3_mod",
                )],
                deposits: Vec::new(),
                variables: vec![raise("dyson_swarm_counter", 1)],
            }),
            ..flagging("dyson_swarm_3", 0, &["has_megastructure"])
        },
    )
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
            left_out: 0,
        }
    );
    let country = entity_text(&session, EntityKind::Country, 0);
    assert!(
        country.contains("arc_furnace_counter=1\n\t\t\tastral_threads_scripted_rewards_mult=1"),
        "{country}"
    );
    for body in FURNACE_PLANETS {
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
                variables: vec![VariableStep {
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
    let seal = add(
        ALARI,
        NewMegastructure {
            owner: Some(0),
            bypass: None,
            construction: Some(MegastructureConstruction {
                modifiers: vec![modifier(ModifierHost::System, "shroud_seal_modifier")],
                deposits: Vec::new(),
                variables: vec![raise("conquest_subjects", 2)],
            }),
            ..at_point("shroud_seal", "", false)
        },
    );
    round_trip(open_4_5(), seal.clone());
    let mut session = open_4_5();
    session.apply(seal.clone()).expect("the seal");
    let system = entity_text(&session, EntityKind::System, ALARI);
    assert!(
        system.contains("modifier=\"shroud_seal_modifier\""),
        "{system}"
    );
    assert!(entity_text(&session, EntityKind::Country, 0).contains("conquest_subjects=2"));
    let removed = session.apply(remove(16)).expect("the removal");
    assert_eq!(removed.inverse, seal);
    assert_eq!(current(&session), session.doc().original());
}

/// Planet 2 has `prosp_uni_mod` already, Xu Nur's star 584 stands in another system, and a
/// modifier on one host is listed once.
#[test]
fn a_construction_the_add_cannot_write_is_refused() {
    let built = |construction: MegastructureConstruction| {
        add(
            ALARI,
            NewMegastructure {
                owner: Some(0),
                construction: Some(construction),
                ..on("orbital_arc_furnace_4", 1)
            },
        )
    };
    let modifiers = |on, name: &str, days| MegastructureConstruction {
        modifiers: vec![ConstructionModifier {
            on,
            timed: TimedModifier {
                modifier: name.to_owned(),
                days,
            },
        }],
        ..MegastructureConstruction::default()
    };
    let unowned = add(
        ALARI,
        NewMegastructure {
            construction: Some(MegastructureConstruction {
                variables: vec![raise("dyson_swarm_counter", 1)],
                ..MegastructureConstruction::default()
            }),
            ..on("dyson_swarm_3", 0)
        },
    );
    let mut twice = modifiers(ModifierHost::System, "shroud_seal_modifier", Some(30));
    twice.modifiers.push(twice.modifiers[0].clone());
    let mut session = open_4_5();
    assert_refusals(
        &mut session,
        [
            (
                built(modifiers(
                    ModifierHost::Body { body: 2 },
                    "prosp_uni_mod",
                    None,
                )),
                "a orbital_arc_furnace_4 cannot be added there: planet 2 already has modifier prosp_uni_mod",
            ),
            (
                built(modifiers(
                    ModifierHost::System,
                    "shroud_seal_modifier",
                    Some(0),
                )),
                "a modifier cannot last 0 days, or longer than a save can hold: -1 keeps it for ever",
            ),
            (
                built(modifiers(
                    ModifierHost::Body { body: 584 },
                    "dyson_swarm_3_mod",
                    None,
                )),
                "planet 584 is not a body of system 169",
            ),
            (
                unowned,
                "a dyson_swarm_3 cannot be added there: variable dyson_swarm_counter needs an owner to count it",
            ),
            (
                built(twice),
                "\"shroud_seal_modifier\" cannot be written as a modifier listed once",
            ),
        ],
    );
}

/// Planet 12 deleted after the furnace is added leaves its added deposit behind, as the
/// game leaves a deleted body's deposits; the furnace's removal finds it by its holder and
/// takes it back with the other twelve, and the modifier went with the planet.
#[test]
fn a_furnace_removed_after_a_body_takes_back_the_deleted_bodys_deposit() {
    let mut session = open_4_5();
    session.apply(furnace()).expect("the furnace");
    let after_add = current(&session);
    session
        .apply(Op::DeleteBody { body: 12 })
        .expect("planet 12");
    let removed = session.apply(remove(16)).expect("the removal");
    let Op::AddMegastructure {
        spec: NewMegastructure {
            construction: Some(taken),
            ..
        },
        ..
    } = &removed.inverse
    else {
        panic!("{:?}", removed.inverse);
    };
    assert_eq!(taken.deposits.len(), 13, "{:?}", taken.deposits);
    assert_eq!(taken.modifiers.len(), 12, "{:?}", taken.modifiers);
    assert!(
        removed
            .entry
            .description
            .ends_with(", with 12 modifiers, 13 deposits and 1 counter"),
        "{}",
        removed.entry.description
    );
    session.undo().expect("undo the removal");
    let after_delete = current(&session);
    session.undo().expect("undo the delete");
    assert_eq!(current(&session), after_add);
    session.redo().expect("redo the delete");
    session.redo().expect("redo the removal");
    session
        .apply_inverse(removed.inverse.clone())
        .expect("the removal's inverse adds the deleted body's deposit back");
    let back = entity_text(&session, EntityKind::Planet, 12);
    assert_eq!(
        back.trim(),
        "12=none",
        "the deleted body is not listed again"
    );
    session.undo().expect("undo the inverse");
    session.undo().expect("undo the removal");
    assert_eq!(current(&session), after_delete);
    session.undo().expect("undo the delete");
    session.undo().expect("undo the add");
    assert_eq!(current(&session), session.doc().original());
}

/// Planet 12's `coordinate` has no `origin`, so the removal cannot tell where it stands.
/// It stops there instead of leaving the planet's modifier behind.
#[test]
fn a_removal_stops_on_a_planet_it_cannot_read() {
    let mut session = open_4_5_edited(|gamestate| {
        let from = "x=-165.3322\n\t\t\t\ty=-59.0354\n\t\t\t\torigin=169\n";
        assert!(gamestate.contains(from));
        *gamestate = gamestate.replacen(from, "x=-165.3322\n\t\t\t\ty=-59.0354\n", 1);
    });
    session
        .apply(add(ALARI, on("think_tank_3", 6)))
        .expect("the nexus");
    let refused = session
        .apply_inverse(Op::RemoveMegastructure {
            megastructure: 16,
            construction: Some(MegastructureConstruction {
                modifiers: vec![modifier(
                    ModifierHost::Body { body: 12 },
                    "orbital_arc_furnace_4_mod",
                )],
                ..MegastructureConstruction::default()
            }),
            left_out: 0,
        })
        .expect_err("planet 12 cannot be read");
    assert!(refused.to_string().contains("origin"), "{refused}");
}

/// A furnace added and deleted in one batch: the delete finds what the add earlier in the
/// batch wrote, and takes it all back.
#[test]
fn a_furnace_added_and_deleted_in_one_batch_leaves_nothing() {
    let mut session = open_4_5();
    session
        .apply(Op::Batch {
            description: "Added and deleted a furnace".to_owned(),
            ops: vec![
                furnace(),
                Op::DeleteMegastructure {
                    megastructure: 16,
                    dismantle: None,
                },
            ],
        })
        .expect("the batch");
    let after = current(&session);
    assert_eq!(after, session.doc().original());
    session.undo().expect("undo the batch");
    assert_eq!(current(&session), session.doc().original());
    session.redo().expect("redo the batch");
    assert_eq!(current(&session), after);
}

/// The furnace's add undone and redone through the history still knows what it wrote, so
/// deleting the row afterwards takes it all back.
#[test]
fn an_added_furnace_redone_is_deleted_with_its_construction() {
    let mut session = open_4_5();
    session.apply(furnace()).expect("the furnace");
    session.undo().expect("undo");
    session.redo().expect("redo");
    let deleted = session
        .apply(Op::DeleteMegastructure {
            megastructure: 16,
            dismantle: None,
        })
        .expect("the delete");
    assert_eq!(deleted.inverse, furnace());
    assert_eq!(current(&session), session.doc().original());
}

/// A deposit added after the furnace takes the id past the furnace's thirteen, so taking
/// the furnace out frees ids below a live one. Undo and redo put back each state byte for
/// byte.
#[test]
fn a_deposit_added_after_a_furnace_survives_its_removal_and_undo() {
    let mut session = open_4_5();
    session.apply(furnace()).expect("the furnace");
    session
        .apply(Op::AddDeposit {
            body: 2,
            kind: "d_minerals_1".to_owned(),
        })
        .expect("the deposit");
    let with_deposit = current(&session);
    session.apply(remove(16)).expect("the removal");
    let removed = current(&session);
    assert!(
        entity_text(&session, EntityKind::Planet, 2).contains("deposits"),
        "the added deposit stays listed"
    );
    session.undo().expect("undo the removal");
    assert_eq!(current(&session), with_deposit);
    session.redo().expect("redo the removal");
    assert_eq!(current(&session), removed);
    session.undo().expect("undo the removal");
    session.undo().expect("undo the deposit");
    session.undo().expect("undo the furnace");
    assert_eq!(current(&session), session.doc().original());
}
