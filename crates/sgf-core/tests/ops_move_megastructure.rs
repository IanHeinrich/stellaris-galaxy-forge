//! Moving a save megastructure within its system on the 4.5 sample: a free point's diff, a
//! tied row's move to another body with the keys that mark it, byte-exact undo, a row the
//! session added, and what is refused.

use sgf_core::entity::views::EntityKind;
use sgf_core::format::save::details::HeuristicResolver;
use sgf_core::ops::{MegastructurePlace, NewMegastructure, Op};
use sgf_core::projections::galaxy::BypassLink;
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, round_trip_step, snapshot_step};
use common::edit::{insert_after, megastructure_row, open_4_5_edited};
use common::examples::{ADDED_MEGASTRUCTURE, save_4_5_with_added_megastructure};
use common::{assert_refusals, entity_text, open_4_5};

fn to_point(megastructure: u32, x: f64, y: f64) -> Op {
    Op::MoveMegastructure {
        megastructure,
        at: MegastructurePlace::Free { x, y },
    }
}

fn to_body(megastructure: u32, body: u32) -> Op {
    Op::MoveMegastructure {
        megastructure,
        at: MegastructurePlace::Body { body },
    }
}

fn beside(megastructure: u32, body: u32, x: f64, y: f64) -> Op {
    Op::MoveMegastructure {
        megastructure,
        at: MegastructurePlace::Beside { body, x, y },
    }
}
/// `planet`'s `megastructure` key, written after its `planet_orbitals`.
fn body_key(text: &mut String, planet: u32, id: u32) {
    insert_after(
        text,
        &[
            &format!("\n\t\t{planet}=\n\t\t{{\n"),
            "\t\t\tplanet_orbitals=\n\t\t\t{\n\t\t\t}\n",
        ],
        &format!("\t\t\tmegastructure={id}\n"),
    );
}

/// The 4.5 sample with Arc Furnace row 16 around planet 517 of Vinh (174), which keeps its
/// other flags; `edit` then changes it further.
fn furnace(edit: impl FnOnce(&mut String)) -> Session {
    open_4_5_edited(|text| {
        let planet = "\n\t\t517=\n\t\t{\n";
        body_key(text, 517, 16);
        insert_after(
            text,
            &[planet, "\t\t\tflags=\n\t\t\t{\n"],
            "\t\t\t\thas_megastructure=62808000\n\t\t\t\thas_arc_furnace=62808000\n",
        );
        insert_after(
            text,
            &[planet, "\t\t\tentity=2\n"],
            "\t\t\tentity_name=\"invisible_turret_entity\"\n",
        );
        megastructure_row(text, 16, "orbital_arc_furnace_4", 174, "\t\tplanet=517\n");
        edit(text);
    })
}

/// Row 6, a ruined gateway in Melitane (116), stands at a point of its own.
#[test]
fn a_gateway_moves_to_another_point_and_keeps_its_links() {
    let mut session = open_4_5();
    let result = snapshot_step(&mut session, "gateway_ruined", to_point(6, 250.0, -100.0));
    assert_eq!(
        result.entry.description,
        "Moved megastructure #6 (gateway_ruined) in Melitane #116 from 313.32 at 15.66° to 269.26 at 338.2°"
    );
    assert!(
        matches!(result.inverse, Op::RestoreEntities { .. }),
        "{:?}",
        result.inverse
    );
    assert_eq!(result.details_stale, [116]);
    assert!(
        session
            .graph()
            .bypasses
            .iter()
            .any(|link| matches!(link, BypassLink::Gateway { system: 116, .. })),
        "the gateway stays in the network"
    );
    round_trip(open_4_5(), to_point(6, 250.0, -100.0));
}

/// Row 0, the L-Gate of Gaping Maw (4), stands at a point of its own and keeps its bypass.
#[test]
fn an_lgate_moves_to_another_point() {
    let mut session = open_4_5();
    let result = snapshot_step(&mut session, "lgate", to_point(0, 30.0, 30.0));
    assert!(
        matches!(result.inverse, Op::RestoreEntities { .. }),
        "{:?}",
        result.inverse
    );
    assert_eq!(result.details_stale, [4]);
    round_trip(open_4_5(), to_point(0, 30.0, 30.0));
}

/// Row 4, the ruined orbital ring of Sargas (38), stands around planet 936.
#[test]
fn a_ruined_orbital_ring_moves_to_another_planet_with_its_flag() {
    let mut session = open_4_5();
    let result = snapshot_step(&mut session, "orbital_ring_ruined", to_body(4, 933));
    assert_eq!(
        result.entry.description,
        "Moved megastructure #4 (orbital_ring_ruined) in Sargas #38 from Sargas II #936 to Sargas I #933"
    );
    assert!(
        matches!(result.inverse, Op::RestoreEntities { .. }),
        "{:?}",
        result.inverse
    );
    assert_eq!(result.details_stale, [38]);
    assert_eq!(session.check_op(&Op::DeleteBody { body: 936 }), None);
    let planet = entity_text(&session, EntityKind::Planet, 933);
    assert!(
        planet.contains("ruined_orbital_ring_planet=62808000"),
        "{planet}"
    );
    round_trip(open_4_5(), to_body(4, 933));
}

#[test]
fn an_arc_furnace_takes_its_flags_and_model_to_the_new_planet() {
    let mut session = furnace(|_| {});
    snapshot_step(&mut session, "orbital_arc_furnace", to_body(16, 516));
    let old = entity_text(&session, EntityKind::Planet, 517);
    assert!(old.contains("fallen_empire_world=62808000"), "{old}");
    assert!(!old.contains("invisible_turret_entity"), "{old}");
    let new = entity_text(&session, EntityKind::Planet, 516);
    for moved in [
        "megastructure=16",
        "has_megastructure=62808000",
        "has_arc_furnace=62808000",
        "entity_name=\"invisible_turret_entity\"",
    ] {
        assert!(new.contains(moved), "{moved}: {new}");
    }
    round_trip(furnace(|_| {}), to_body(16, 516));
}

/// Planet 516 with a model of its own.
fn own_model(text: &mut String) {
    insert_after(
        text,
        &[
            "
		516=
		{
",
            "			entity=2
",
        ],
        "			entity_name=\"barren_cold_planet_02_entity\"
",
    );
}

#[test]
fn a_planet_model_the_furnace_takes_the_place_of_comes_back_on_undo() {
    let mut session = furnace(own_model);
    session.apply(to_body(16, 516)).expect("the move");
    let planet = entity_text(&session, EntityKind::Planet, 516);
    assert!(
        planet.contains("entity_name=\"invisible_turret_entity\""),
        "{planet}"
    );
    assert!(!planet.contains("barren_cold_planet_02_entity"), "{planet}");
    round_trip(furnace(own_model), to_body(16, 516));
}

/// The furnace's planet 517 also named by row 17.
fn shared(text: &mut String) {
    megastructure_row(
        text,
        17,
        "orbital_ring_tier_1",
        174,
        "		planet=517
",
    );
}

#[test]
fn a_planet_another_row_names_keeps_its_flags() {
    let mut session = furnace(shared);
    session.apply(to_body(16, 516)).expect("the move");
    let old = entity_text(&session, EntityKind::Planet, 517);
    assert!(!old.contains("megastructure=16"), "{old}");
    assert!(old.contains("has_arc_furnace=62808000"), "{old}");
    let new = entity_text(&session, EntityKind::Planet, 516);
    assert!(new.contains("has_arc_furnace=62808000"), "{new}");
    round_trip(furnace(shared), to_body(16, 516));
}

/// Planet 516 with a `has_arc_furnace` flag of its own, dated other than the furnace's.
fn own_flag(text: &mut String) {
    insert_after(
        text,
        &[
            "
		516=
		{
",
            "			bombardment_damage=0
",
        ],
        "			flags=
			{
				has_arc_furnace=62000000
			}
",
    );
}

#[test]
fn a_flag_the_new_planet_has_already_stays_as_it_is() {
    let mut session = furnace(own_flag);
    session.apply(to_body(16, 516)).expect("the move");
    let new = entity_text(&session, EntityKind::Planet, 516);
    assert!(new.contains("has_arc_furnace=62000000"), "{new}");
    assert!(!new.contains("has_arc_furnace=62808000"), "{new}");
    assert!(new.contains("has_megastructure=62808000"), "{new}");
    round_trip(furnace(own_flag), to_body(16, 516));
}

/// Planet 516 with a `megastructure` key naming row 999, which the table does not hold.
fn stale_key(text: &mut String) {
    body_key(text, 516, 999);
}

#[test]
fn a_key_naming_no_row_takes_the_moved_row() {
    let mut session = furnace(stale_key);
    session.apply(to_body(16, 516)).expect("the move");
    let new = entity_text(&session, EntityKind::Planet, 516);
    assert!(new.contains("megastructure=16"), "{new}");
    assert!(!new.contains("megastructure=999"), "{new}");
    round_trip(furnace(stale_key), to_body(16, 516));
}

#[test]
fn a_row_the_session_added_moves_too() {
    let mut session = save_4_5_with_added_megastructure();
    let result = round_trip_step(&mut session, "added", to_body(ADDED_MEGASTRUCTURE, 7));
    assert_eq!(
        result.entry.description,
        "Moved megastructure #16 (think_tank_3) in Alari system #169 from planet #6 to planet #7"
    );
    let row = entity_text(&session, EntityKind::Megastructure, ADDED_MEGASTRUCTURE);
    assert!(row.contains("planet=7"), "{row}");
    let planet = entity_text(&session, EntityKind::Planet, 7);
    assert!(planet.contains("megastructure=16"), "{planet}");
    assert!(planet.contains("has_megastructure="), "{planet}");
    let old = entity_text(&session, EntityKind::Planet, 6);
    assert!(!old.contains("has_megastructure="), "{old}");
}

/// The Science Nexus added to gas giant 6 of Alari (169) stands at a point of its own and
/// keeps its planet, then goes back to the planet's point.
#[test]
fn a_row_tied_to_a_planet_stands_at_a_point_of_its_own_and_back() {
    let mut session = save_4_5_with_added_megastructure();
    let opened = entity_text(&session, EntityKind::Planet, 6);
    let result = round_trip_step(
        &mut session,
        "beside",
        beside(ADDED_MEGASTRUCTURE, 6, 40.0, -30.0),
    );
    assert_eq!(
        result.entry.description,
        format!(
            "Moved megastructure #16 (think_tank_3) in Alari system #169 from {} to 50 at 323.13°, tied to planet #6",
            described_point(&session_before_move())
        )
    );
    let row = entity_text(&session, EntityKind::Megastructure, ADDED_MEGASTRUCTURE);
    assert!(row.contains("planet=6"), "{row}");
    assert!(
        row.contains(
            "x=40
"
        ) && row.contains(
            "y=-30
"
        ),
        "{row}"
    );
    assert_eq!(
        entity_text(&session, EntityKind::Planet, 6),
        opened,
        "the planet stays as it was"
    );

    let back = round_trip_step(&mut session, "back", to_body(ADDED_MEGASTRUCTURE, 6));
    assert_eq!(
        back.entry.description,
        "Moved megastructure #16 (think_tank_3) in Alari system #169 back to planet #6"
    );
    assert_refusals(
        &mut session,
        [(
            to_body(ADDED_MEGASTRUCTURE, 6),
            "megastructure 16 already stands at planet #6",
        )],
    );
}

/// The added Science Nexus as it stands before any move.
fn session_before_move() -> Session {
    save_4_5_with_added_megastructure()
}

/// "r at a°" for the added Science Nexus's point, as a description names it.
fn described_point(session: &Session) -> String {
    let row = entity_text(session, EntityKind::Megastructure, ADDED_MEGASTRUCTURE);
    let axis = |key: &str| -> f64 {
        let start = row.find(&format!("	{key}=")).expect(key) + key.len() + 2;
        row[start..].lines().next().unwrap().parse().unwrap()
    };
    let (x, y) = (axis("x"), axis("y"));
    let radius = x.hypot(y);
    let angle = (y.atan2(x).to_degrees() + 360.0) % 360.0;
    format!("{} at {}°", trimmed(radius), trimmed(angle))
}

fn trimmed(v: f64) -> String {
    let text = format!("{v:.2}");
    text.trim_end_matches('0').trim_end_matches('.').to_owned()
}

#[test]
fn a_row_dropped_on_another_planet_at_its_own_point_takes_it_as_its_planet() {
    let mut session = save_4_5_with_added_megastructure();
    round_trip_step(
        &mut session,
        "rehomed",
        beside(ADDED_MEGASTRUCTURE, 7, 40.0, -30.0),
    );
    let row = entity_text(&session, EntityKind::Megastructure, ADDED_MEGASTRUCTURE);
    assert!(
        row.contains("planet=7")
            && row.contains(
                "x=40
"
            ),
        "{row}"
    );
    assert!(entity_text(&session, EntityKind::Planet, 7).contains("megastructure=16"));
}

/// A row added beside its planet is taken out with an inverse that adds it back there.
#[test]
fn a_row_added_beside_its_planet_comes_back_there() {
    let mut session = open_4_5();
    let mut nexus = common::examples::sol_nexus();
    if let Op::AddMegastructure { spec, .. } = &mut nexus {
        spec.at = MegastructurePlace::Beside {
            body: 6,
            x: 40.0,
            y: -30.0,
        }
        .into();
    }
    session.apply(nexus).expect("the add");
    let removed = session
        .apply(Op::RemoveMegastructure {
            megastructure: ADDED_MEGASTRUCTURE,
            construction: None,
            left_out: 0,
        })
        .expect("the removal");
    let Op::AddMegastructure { spec, .. } = removed.inverse else {
        panic!("an add, not {:?}", removed.inverse);
    };
    assert_eq!(
        spec.at.place(),
        MegastructurePlace::Beside {
            body: 6,
            x: 40.0,
            y: -30.0
        }
    );
}

#[test]
fn what_is_refused() {
    assert_refusals(
        &mut open_4_5(),
        [
            (to_point(14, 30.0, 30.0), "Megastructure 14 does not exist"),
            (
                to_point(999, 30.0, 30.0),
                "Megastructure 999 does not exist",
            ),
            (
                to_point(10, 30.0, 30.0),
                "megastructure 10 cannot be moved: it is part of a ring world, which stays where it is",
            ),
            (
                to_body(6, 1646),
                "megastructure 6 cannot be moved: it sits in empty space and can't go on a planet or star",
            ),
            (
                to_point(4, 30.0, 30.0),
                "megastructure 4 cannot be moved: it is built at Sargas II #936, so it has to stay at a planet or star",
            ),
            (to_body(4, 517), "planet 517 is not a body of system 38"),
            (
                to_body(4, 936),
                "megastructure 4 already stands at Sargas II #936",
            ),
            (
                to_point(6, 301.69487, 84.54792),
                "megastructure 6 already stands there",
            ),
            (to_point(6, f64::NAN, 0.0), "value is not a finite number"),
            (
                beside(6, 1646, 10.0, 10.0),
                "megastructure 6 cannot be moved: it sits in empty space and can't go on a planet or star",
            ),
            (
                beside(4, 933, f64::NAN, 0.0),
                "value is not a finite number",
            ),
        ],
    );
}

#[test]
fn a_planet_that_has_a_megastructure_is_refused() {
    let mut session = furnace(|text| {
        body_key(text, 516, 17);
        megastructure_row(text, 17, "think_tank_3", 174, "\t\tplanet=516\n");
    });
    assert_refusals(
        &mut session,
        [(
            to_body(16, 516),
            "megastructure 16 cannot be moved: Vinh II #516 already has megastructure 17",
        )],
    );
}

/// Gas giant 6267 of Ithome's Gate (596) has the flag `has_megastructure` with no row tied
/// to it, which a move leaves to the game.
#[test]
fn a_planet_the_game_counts_a_megastructure_at_takes_one() {
    let mut session = open_4_5();
    session
        .apply(Op::AddMegastructure {
            system: 596,
            spec: NewMegastructure {
                kind: "think_tank_3".to_owned(),
                at: MegastructurePlace::Body { body: 6266 }.into(),
                ..NewMegastructure::default()
            },
        })
        .expect("the add");
    round_trip_step(&mut session, "flagged", to_body(ADDED_MEGASTRUCTURE, 6267));
    let planet = entity_text(&session, EntityKind::Planet, 6267);
    assert!(planet.contains("megastructure=16"), "{planet}");
}

/// Star 511 is Vinh's. The furnace takes its key and flags to the star, which keeps its own
/// model, and planet 517 shows again. Sent on to planet 516, the furnace hides it as before.
#[test]
fn an_arc_furnace_moves_onto_a_star_and_back_to_a_planet() {
    let mut session = furnace(|_| {});
    snapshot_step(
        &mut session,
        "orbital_arc_furnace_onto_star",
        to_body(16, 511),
    );
    let star = entity_text(&session, EntityKind::Planet, 511);
    for moved in [
        "megastructure=16",
        "has_megastructure=62808000",
        "has_arc_furnace=62808000",
    ] {
        assert!(star.contains(moved), "{moved}: {star}");
    }
    assert!(!star.contains("invisible_turret_entity"), "{star}");
    let old = entity_text(&session, EntityKind::Planet, 517);
    for gone in [
        "megastructure=16",
        "has_megastructure=",
        "invisible_turret_entity",
    ] {
        assert!(!old.contains(gone), "{gone}: {old}");
    }
    round_trip(furnace(|_| {}), to_body(16, 511));

    round_trip_step(&mut session, "back to a planet", to_body(16, 516));
    let planet = entity_text(&session, EntityKind::Planet, 516);
    for moved in [
        "megastructure=16",
        "has_arc_furnace=62808000",
        "entity_name=\"invisible_turret_entity\"",
    ] {
        assert!(planet.contains(moved), "{moved}: {planet}");
    }
    let star = entity_text(&session, EntityKind::Planet, 511);
    assert!(!star.contains("has_arc_furnace"), "{star}");
}

/// Planet 517 hidden under the furnace's model without the furnace's flag, as Giga's
/// Macroengineering Test Site leaves its planet: the row is no Arc Furnace and stays off the
/// star, and still takes the model to another planet.
#[test]
fn a_hidden_planet_without_the_furnace_flag_keeps_its_row_off_a_star() {
    let unflagged = |text: &mut String| {
        *text = text.replacen(
            "				has_arc_furnace=62808000
",
            "",
            1,
        );
    };
    assert_refusals(
        &mut furnace(unflagged),
        [(
            to_body(16, 511),
            "megastructure 16 cannot be moved: it hides Vinh III #517 without the Arc Furnace's flag, and only an Arc Furnace goes on a star such as Vinh #511",
        )],
    );
    let mut session = furnace(unflagged);
    session.apply(to_body(16, 516)).expect("on to planet 516");
    let planet = entity_text(&session, EntityKind::Planet, 516);
    assert!(
        planet.contains("entity_name=\"invisible_turret_entity\""),
        "{planet}"
    );
}

#[test]
fn a_structure_on_the_body_it_made_is_refused() {
    let mut session = open_4_5_edited(|text| {
        body_key(text, 517, 16);
        insert_after(
            text,
            &["\n\t\t517=\n\t\t{\n", "\t\t\tflags=\n\t\t\t{\n"],
            "\t\t\t\tmegastructure=62808000\n",
        );
        megastructure_row(text, 16, "cosmogenesis_world_0", 174, "\t\tplanet=517\n");
    });
    let details = session.details().expect("details");
    let made = details
        .resolve(174, &HeuristicResolver, false)
        .expect("Vinh's details")
        .megastructures
        .into_iter()
        .find(|row| row.id == 16)
        .expect("row 16");
    assert!(made.made_body, "the details say it made its planet");
    assert_refusals(
        &mut session,
        [
            (
                to_body(16, 516),
                "megastructure 16 cannot be moved: building it created Vinh III #517, so it stays with that planet",
            ),
            (
                beside(16, 517, 10.0, 10.0),
                "megastructure 16 cannot be moved: building it created Vinh III #517, so it stays with that planet",
            ),
        ],
    );
}
