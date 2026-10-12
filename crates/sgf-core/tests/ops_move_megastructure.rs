//! Moving a save megastructure within its system on the 4.5 sample: a free point's diff, a
//! tied row's move to another body with the keys that mark it, byte-exact undo, a row the
//! session added, and what is refused.

use sgf_core::entity::views::EntityKind;
use sgf_core::ops::{MegastructurePlace, Op};
use sgf_core::projections::galaxy::BypassLink;
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, round_trip_step, snapshot_step};
use common::examples::{ADDED_MEGASTRUCTURE, save_4_5_with_added_megastructure};
use common::{SAMPLE_4_5, assert_refusals, entity_text, open_3_4, open_4_5};

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

/// The 4.5 sample with `edit` applied to its gamestate.
fn edited_4_5(edit: impl FnOnce(&mut String)) -> Session {
    common::open_edited_sample(SAMPLE_4_5, |gamestate, _| edit(gamestate))
}

/// `text` with `insert` written after the first `after` that follows `from`.
fn insert_after(text: &mut String, from: &str, after: &str, insert: &str) {
    let start = text.find(from).unwrap_or_else(|| panic!("{from:?}"));
    let at = start
        + text[start..]
            .find(after)
            .unwrap_or_else(|| panic!("{after:?}"))
        + after.len();
    text.insert_str(at, insert);
}

/// A row of `megastructures`, `kind` in `system`, written after the last.
fn row(text: &mut String, id: u32, kind: &str, system: u32, tie: &str) {
    insert_after(
        text,
        "\nmegastructures=\n{\n",
        "\t16777231=none\n",
        &format!(
            "\t{id}=\n\t{{\n\t\ttype=\"{kind}\"\n\t\tcoordinate=\n\t\t{{\n\t\t\tx=10\n\t\t\ty=20\n\t\t\torigin={system}\n\t\t}}\n{tie}\t\torbitals=\n\t\t{{\n\t\t}}\n\t\tbuild_queue=4294967295\n\t\tdismantle_progress=0\n\t\tdismantle_finish_date=\"0.01.01\"\n\t}}\n"
        ),
    );
}

/// `planet`'s `megastructure` key, written after its `planet_orbitals`.
fn body_key(text: &mut String, planet: u32, id: u32) {
    insert_after(
        text,
        &format!("\n\t\t{planet}=\n\t\t{{\n"),
        "\t\t\tplanet_orbitals=\n\t\t\t{\n\t\t\t}\n",
        &format!("\t\t\tmegastructure={id}\n"),
    );
}

/// The 4.5 sample with Arc Furnace row 16 around planet 517 of Vinh (174), which keeps its
/// other flags; `edit` then changes it further.
fn furnace(edit: impl FnOnce(&mut String)) -> Session {
    edited_4_5(|text| {
        let planet = "\n\t\t517=\n\t\t{\n";
        body_key(text, 517, 16);
        insert_after(
            text,
            planet,
            "\t\t\tflags=\n\t\t\t{\n",
            "\t\t\t\thas_megastructure=62808000\n\t\t\t\thas_arc_furnace=62808000\n",
        );
        insert_after(
            text,
            planet,
            "\t\t\tentity=2\n",
            "\t\t\tentity_name=\"invisible_turret_entity\"\n",
        );
        row(text, 16, "orbital_arc_furnace_4", 174, "\t\tplanet=517\n");
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

/// Row 4, the ruined orbital ring of Sargas (38), stands around planet 936.
#[test]
fn a_ruined_orbital_ring_moves_to_another_planet_with_its_flag() {
    let mut session = open_4_5();
    let result = snapshot_step(&mut session, "orbital_ring_ruined", to_body(4, 933));
    assert_eq!(
        result.entry.description,
        "Moved megastructure #4 (orbital_ring_ruined) in Sargas #38 from planet #936 to planet #933"
    );
    assert!(
        matches!(result.inverse, Op::RestoreEntities { .. }),
        "{:?}",
        result.inverse
    );
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
        "
		516=
		{
",
        "			entity=2
",
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
    row(
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
        "
		516=
		{
",
        "			bombardment_damage=0
",
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

#[test]
fn what_is_refused() {
    assert_refusals(
        &mut open_4_5(),
        [
            (
                to_point(0, 30.0, 30.0),
                "megastructure 0 cannot be moved: its bypass is a lgate, which has not been tried in game",
            ),
            (to_point(14, 30.0, 30.0), "Megastructure 14 does not exist"),
            (
                to_point(999, 30.0, 30.0),
                "Megastructure 999 does not exist",
            ),
            (
                to_point(10, 30.0, 30.0),
                "megastructure 10 cannot be moved: it is part of a ring world, which stands where it is",
            ),
            (
                to_body(6, 1646),
                "megastructure 6 cannot be moved: it stands at a point of its own, not on a planet or star",
            ),
            (
                to_point(4, 30.0, 30.0),
                "megastructure 4 cannot be moved: it stands on or around planet 936, so it moves only to another planet or star",
            ),
            (to_body(4, 517), "planet 517 is not a body of system 38"),
            (
                to_body(4, 936),
                "megastructure 4 already stands at planet 936",
            ),
            (
                to_point(6, 301.69487, 84.54792),
                "megastructure 6 already stands there",
            ),
            (to_point(6, f64::NAN, 0.0), "value is not a finite number"),
        ],
    );
    assert_refusals(
        &mut open_3_4(),
        [(
            to_point(0, 30.0, 30.0),
            "this edit needs a save from Stellaris 4.0 or later, not Cepheus v3.4.5",
        )],
    );
}

#[test]
fn a_planet_that_has_a_megastructure_is_refused() {
    let mut session = furnace(|text| {
        body_key(text, 516, 17);
        row(text, 17, "think_tank_3", 174, "\t\tplanet=516\n");
    });
    assert_refusals(
        &mut session,
        [(
            to_body(16, 516),
            "megastructure 16 cannot be moved: planet 516 already has megastructure 17",
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
            kind: "think_tank_3".to_owned(),
            at: MegastructurePlace::Body { body: 6266 },
            owner: None,
            bypass: None,
            ruined_orbital_ring: false,
            megastructure_flag: false,
            star_only: false,
            construction: None,
            left_out: 0,
        })
        .expect("the add");
    round_trip_step(&mut session, "flagged", to_body(ADDED_MEGASTRUCTURE, 6267));
    let planet = entity_text(&session, EntityKind::Planet, 6267);
    assert!(planet.contains("megastructure=16"), "{planet}");
}

#[test]
fn a_structure_on_the_body_it_made_is_refused() {
    let mut session = edited_4_5(|text| {
        body_key(text, 517, 16);
        insert_after(
            text,
            "\n\t\t517=\n\t\t{\n",
            "\t\t\tflags=\n\t\t\t{\n",
            "\t\t\t\tmegastructure=62808000\n",
        );
        row(text, 16, "cosmogenesis_world_0", 174, "\t\tplanet=517\n");
    });
    assert_refusals(
        &mut session,
        [(
            to_body(16, 516),
            "megastructure 16 cannot be moved: it made planet 517, which stays where it is",
        )],
    );
}
