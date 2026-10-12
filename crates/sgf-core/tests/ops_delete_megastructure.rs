//! Deleting a save megastructure: each row's diff on the 4.5 sample, the bypass it takes
//! along, the dead table a `save_on_death` row is logged in, the colony on a body the
//! structure made, byte-exact undo and what is refused.

use sgf_core::entity::views::EntityKind;
use sgf_core::ops::{MegastructureDismantle, Op, VariableDrop};
use sgf_core::projections::galaxy::BypassLink;
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::{
    SAMPLE, SAMPLE_4_5, assert_refusals, current, entity_text, open_3_4, open_4_5,
    open_edited_sample, text,
};

fn delete(megastructure: u32) -> Op {
    Op::DeleteMegastructure {
        megastructure,
        dismantle: None,
    }
}

/// The 4.5 sample with `edit` applied to its gamestate.
fn edited_4_5(edit: impl FnOnce(&mut String)) -> Session {
    open_edited_sample(SAMPLE_4_5, |gamestate, _| edit(gamestate))
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

/// Row `id` of the top-level `megastructures` given `save_on_death=1`.
fn save_on_death(text: &mut String, id: u32) {
    insert_after(
        text,
        "\nmegastructures=\n{\n",
        &format!("\n\t{id}=\n\t{{\n"),
        "\t\tsave_on_death=1\n",
    );
}

#[test]
fn a_ruined_orbital_ring_leaves_its_planet_free() {
    let mut session = open_4_5();
    let refused = session.check_op(&Op::DeleteBody { body: 936 });
    assert_eq!(
        refused.as_deref(),
        Some(
            "planet 936 cannot be deleted: a megastructure stands on or around it: delete the megastructure first"
        )
    );
    snapshot_step(&mut session, "orbital_ring_ruined", delete(4));
    assert_eq!(session.check_op(&Op::DeleteBody { body: 936 }), None);
}

#[test]
fn a_ruined_gateway_takes_its_bypass_out_of_the_network() {
    let mut session = open_4_5();
    let gateway = |session: &Session| {
        session
            .graph()
            .bypasses
            .iter()
            .any(|link| matches!(link, BypassLink::Gateway { system: 116, .. }))
    };
    assert!(gateway(&session));
    snapshot_step(&mut session, "gateway_ruined", delete(6));
    assert!(!gateway(&session));
}

#[test]
fn a_ruin_on_a_star_and_an_owned_seal_leave_their_lists() {
    let mut session = open_4_5();
    snapshot_step(
        &mut session,
        "strategic_coordination_center_ruined",
        delete(1),
    );
    let mut session = open_4_5();
    snapshot_step(&mut session, "shroud_seal", delete(2));
}

#[test]
fn a_row_saved_on_death_is_logged_in_the_dead_table() {
    let mut session = edited_4_5(|text| save_on_death(text, 2));
    snapshot_step(&mut session, "logged", delete(2));
    let text = text(&session);
    assert!(
        text.contains("\tmap=\n\t{\n\t\t2=1\n\t\t16777231=0\n\t}\n"),
        "the map line goes before the higher id"
    );
}

#[test]
fn an_empty_dead_table_gets_both_blocks() {
    let mut session = open_edited_sample(SAMPLE, |gamestate, _| save_on_death(gamestate, 11));
    snapshot_step(&mut session, "logged_in_an_empty_table", delete(11));
}

/// The 4.5 sample with a cosmogenesis world row 16 tied to planet 517, which holds colony
/// 18; with `made`, the planet has the flag a body the structure made has.
fn on_colony(made: bool) -> Session {
    edited_4_5(|text| {
        insert_after(
            text,
            "\n\t\t517=\n\t\t{\n",
            "\t\t\tplanet_orbitals=\n\t\t\t{\n\t\t\t}\n",
            "\t\t\tmegastructure=16\n",
        );
        if made {
            insert_after(
                text,
                "\n\t\t517=\n\t\t{\n",
                "\t\t\tflags=\n\t\t\t{\n",
                "\t\t\t\tmegastructure=62808000\n",
            );
        }
        insert_after(
            text,
            "\nmegastructures=\n{\n",
            "\t16777231=none\n",
            "\t16=\n\t{\n\t\ttype=\"cosmogenesis_world_0\"\n\t\tcoordinate=\n\t\t{\n\t\t\tx=36.6864\n\t\t\ty=114.372\n\t\t\torigin=174\n\t\t}\n\t\towner=11\n\t\tplanet=517\n\t\torbitals=\n\t\t{\n\t\t}\n\t\tbuild_queue=4294967295\n\t\tdismantle_progress=0\n\t\tdismantle_finish_date=\"0.01.01\"\n\t}\n",
        );
    })
}

#[test]
fn the_colony_on_a_body_the_structure_made_goes_with_it() {
    let mut session = on_colony(true);
    let result = session.apply(delete(16)).expect("delete");
    assert_eq!(
        result.entry.description,
        "Deleted megastructure #16 (cosmogenesis_world_0) in Vinh #174, with the colony on planet #517"
    );
    assert!(!entity_text(&session, EntityKind::Planet, 517).contains("colony=18"));
    round_trip(on_colony(true), delete(16));
}

#[test]
fn a_colony_on_an_ordinary_planet_stays() {
    let mut session = on_colony(false);
    let result = session.apply(delete(16)).expect("delete");
    assert_eq!(
        result.entry.description,
        "Deleted megastructure #16 (cosmogenesis_world_0) in Vinh #174"
    );
    assert!(entity_text(&session, EntityKind::Planet, 517).contains("colony=18"));
}

#[test]
fn what_is_refused() {
    assert_refusals(
        &mut open_4_5(),
        [
            (
                delete(0),
                "megastructure 0 cannot be deleted: its bypass is a lgate, which has not been tried in game",
            ),
            (delete(14), "Megastructure 14 does not exist"),
            (delete(999), "Megastructure 999 does not exist"),
        ],
    );
    assert_refusals(
        &mut open_3_4(),
        [(
            delete(0),
            "this edit needs a save from Stellaris 4.0 or later, not Cepheus v3.4.5",
        )],
    );
}

#[test]
fn a_ring_world_quadrant_is_refused() {
    let mut session = edited_4_5(|text| {
        let ruined = "
	4=
	{
		type=\"orbital_ring_ruined\"";
        assert!(text.contains(ruined));
        *text = text.replacen(
            ruined,
            &ruined.replace("orbital_ring_ruined", "ring_world_ruined"),
            1,
        );
    });
    assert_refusals(
        &mut session,
        [(
            delete(4),
            "megastructure 4 cannot be deleted: it is part of a ring world: delete the ring world",
        )],
    );
}

#[test]
fn the_inverse_of_the_inverse_deletes_again() {
    let mut session = open_4_5();
    let result = session.apply(delete(6)).expect("delete");
    let edited = current(&session);
    let restored = session.apply_inverse(result.inverse).expect("restore");
    session
        .apply_inverse(restored.inverse)
        .expect("delete again");
    assert_eq!(current(&session), edited);
}

/// A row of `megastructures` tied to nothing, `kind` in `system`, written after the last.
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

/// The 4.5 sample with Arc Furnace row 16 around planet 517, which keeps its other flags;
/// with `another`, row 17 names the planet too.
fn furnace(another: bool) -> Session {
    edited_4_5(|text| {
        let planet = "\n\t\t517=\n\t\t{\n";
        insert_after(
            text,
            planet,
            "\t\t\tplanet_orbitals=\n\t\t\t{\n\t\t\t}\n",
            "\t\t\tmegastructure=16\n",
        );
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
        if another {
            row(text, 17, "orbital_ring_tier_1", 174, "\t\tplanet=517\n");
        }
    })
}

#[test]
fn an_arc_furnace_gives_its_planet_back() {
    let mut session = furnace(false);
    snapshot_step(&mut session, "orbital_arc_furnace", delete(16));
    let planet = entity_text(&session, EntityKind::Planet, 517);
    assert!(planet.contains("fallen_empire_world=62808000"), "{planet}");
}

#[test]
fn a_planet_another_row_names_keeps_its_flags_and_model() {
    let mut session = furnace(true);
    session.apply(delete(16)).expect("delete");
    let planet = entity_text(&session, EntityKind::Planet, 517);
    assert!(!planet.contains("megastructure=16"), "{planet}");
    for kept in [
        "has_megastructure=62808000",
        "has_arc_furnace=62808000",
        "entity_name=\"invisible_turret_entity\"",
    ] {
        assert!(planet.contains(kept), "{kept}: {planet}");
    }
}

/// The 4.5 sample with Hyper Relays 16, 17 and 18 in systems 0, 148 and 358, their relay
/// bypasses 23, 24 and 25 linked in a chain through 24.
fn relays() -> Session {
    edited_4_5(|text| {
        let relays = [
            (16, 0, 23, "24 "),
            (17, 148, 24, "23 25 "),
            (18, 358, 25, "24 "),
        ];
        for (id, system, bypass, linked) in relays {
            row(
                text,
                id,
                "hyper_relay",
                system,
                &format!("\t\tbypass={bypass}\n"),
            );
            insert_after(
                text,
                "\ngalactic_object=\n{\n",
                &format!("\n\t{system}=\n\t{{\n"),
                &format!(
                    "\t\tmegastructures=\n\t\t{{\n\t\t\t{id} \n\t\t}}\n\t\tbypasses=\n\t\t{{\n\t\t\t{bypass} \n\t\t}}\n"
                ),
            );
            let end = text
                .find("\nnatural_wormholes=\n")
                .expect("the bypasses' end");
            text.insert_str(
                end - 1,
                &format!(
                    "\t{bypass}=\n\t{{\n\t\ttype=\"relay_bypass\"\n\t\tactive=yes\n\t\tconnections=\n\t\t{{\n\t\t\t{linked}\n\t\t}}\n\t\tactive_connections=\n\t\t{{\n\t\t\t{linked}\n\t\t}}\n\t\towner=\n\t\t{{\n\t\t\ttype=6\n\t\t\tid={id}\n\t\t}}\n\t}}\n"
                ),
            );
        }
    })
}

#[test]
fn a_hyper_relay_leaves_the_relay_network() {
    let mut session = relays();
    snapshot_step(&mut session, "hyper_relay", delete(16));
}

#[test]
fn a_megastructure_key_naming_no_row_refuses_nothing() {
    let session = edited_4_5(|text| {
        for (planet, row) in [(99, 14), (517, 999)] {
            insert_after(
                text,
                &format!("\n\t\t{planet}=\n\t\t{{\n"),
                "\t\t\tplanet_orbitals=\n\t\t\t{\n\t\t\t}\n",
                &format!("\t\t\tmegastructure={row}\n"),
            );
        }
    });
    assert_eq!(session.check_op(&Op::DeleteBody { body: 99 }), None);
    assert_eq!(session.check_op(&Op::RemoveColony { body: 517 }), None);
}

#[test]
fn a_row_mid_upgrade_goes_with_its_upgrade() {
    let mut session = edited_4_5(|text| {
        insert_after(
            text,
            "\nmegastructures=\n{\n",
            "\n\t2=\n\t{\n",
            "\t\tupgrade=\n\t\t{\n\t\t\tupgrade_to=\"shroud_seal_2\"\n\t\t\tprogress=461\n\t\t\thalted=0\n\t\t\tindefinitely_halted=no\n\t\t}\n",
        );
    });
    session.apply(delete(2)).expect("delete");
    assert!(!text(&session).contains("upgrade_to=\"shroud_seal_2\""));
}

/// What the install says an Arc Furnace's dismantle takes back.
fn furnace_dismantle() -> MegastructureDismantle {
    MegastructureDismantle {
        modifiers: (1..=4)
            .map(|n| format!("orbital_arc_furnace_{n}_mod"))
            .collect(),
        deposits: (1..=4).map(|n| format!("d_arc_furnace_{n}")).collect(),
        variables: vec![VariableDrop {
            variable: "arc_furnace_counter".to_owned(),
            by: 1,
        }],
    }
}

/// A `timed_modifier` block of `modifiers`, each for ever, as a planet holds one.
fn modifiers_block(modifiers: &[&str]) -> String {
    let items: String = modifiers
        .iter()
        .map(|m| {
            format!(
                "\t\t\t\t\t{{\n\t\t\t\t\t\tmodifier=\"{m}\"\n\t\t\t\t\t\tdays=-1\n\t\t\t\t\t}}\n \n"
            )
        })
        .collect();
    format!(
        "\t\t\ttimed_modifier=\n\t\t\t{{\n\t\t\t\titems=\n\t\t\t\t{{\n\t\t\t\t\t\n{items}\t\t\t\t}}\n\t\t\t}}\n"
    )
}

/// Planet `planet` of the 4.5 sample given `block` after its `bombardment_damage`.
fn after_bombardment(text: &mut String, planet: u32, block: &str) {
    insert_after(
        text,
        &format!("\n\t\t{planet}=\n\t\t{{\n"),
        "\t\t\tbombardment_damage=0\n",
        block,
    );
}

/// Country 11's `variables` given `line` first.
fn owner_variable(text: &mut String, line: &str) {
    let country = text
        .find(
            "
country=
{
",
        )
        .expect("country");
    let start = country
        + text[country..]
            .find(
                "
	11=
	{
",
            )
            .expect("country 11");
    let at = start
        + text[start..]
            .find(
                "		variables=
		{
",
            )
            .expect("its variables")
        + "		variables=
		{
"
        .len();
    text.insert_str(at, line);
}

/// The 4.5 sample with Arc Furnace row 16 of country 11 around planet 517 of Vinh: the
/// furnace's modifier on 514, 515 and 517, which keeps a modifier of its own, deposit 790
/// of 517's eleven and 802, 520's only one, made furnace deposits, and the owner's counter.
fn furnace_system() -> Session {
    edited_4_5(|text| {
        let planet = "\n\t\t517=\n\t\t{\n";
        insert_after(
            text,
            planet,
            "\t\t\tplanet_orbitals=\n\t\t\t{\n\t\t\t}\n",
            "\t\t\tmegastructure=16\n",
        );
        insert_after(
            text,
            planet,
            "\t\t\tflags=\n\t\t\t{\n",
            "\t\t\t\thas_megastructure=62808000\n\t\t\t\thas_arc_furnace=62808000\n",
        );
        row(
            text,
            16,
            "orbital_arc_furnace_4",
            174,
            "\t\towner=11\n\t\tplanet=517\n",
        );
        let furnace = ["orbital_arc_furnace_4_mod"];
        after_bombardment(text, 514, &modifiers_block(&furnace));
        after_bombardment(text, 515, &modifiers_block(&furnace));
        after_bombardment(
            text,
            517,
            &modifiers_block(&["orbital_arc_furnace_4_mod", "hazardous_weather"]),
        );
        for (deposit, kind) in [(790, "d_hot_springs"), (802, "d_exotic_gases_1")] {
            let was = format!("\n\t{deposit}=\n\t{{\n\t\ttype=\"{kind}\"\n");
            let now = format!("\n\t{deposit}=\n\t{{\n\t\ttype=\"d_arc_furnace_4\"\n");
            assert!(text.contains(&was), "deposit {deposit}");
            *text = text.replacen(&was, &now, 1);
        }
        owner_variable(text, "\t\t\tarc_furnace_counter=1\n");
    })
}

fn delete_furnace() -> Op {
    Op::DeleteMegastructure {
        megastructure: 16,
        dismantle: Some(furnace_dismantle()),
    }
}

#[test]
fn an_arc_furnace_takes_back_its_modifiers_deposits_and_counter() {
    let mut session = furnace_system();
    let result = snapshot_step(&mut session, "arc_furnace_dismantled", delete_furnace());
    assert_eq!(
        result.entry.description,
        "Deleted megastructure #16 (orbital_arc_furnace_4) in Vinh #174, and took back 3 modifiers, 2 deposits and 1 counter"
    );
    round_trip(furnace_system(), delete_furnace());
}

#[test]
fn the_inverse_of_a_dismantles_inverse_deletes_again() {
    let mut session = furnace_system();
    let result = session.apply(delete_furnace()).expect("delete");
    let edited = current(&session);
    let restored = session.apply_inverse(result.inverse).expect("restore");
    session
        .apply_inverse(restored.inverse)
        .expect("delete again");
    assert_eq!(current(&session), edited);
}

#[test]
fn a_dyson_swarm_takes_back_its_stars_modifier() {
    let swarm = || {
        edited_4_5(|text| {
            row(
                text,
                16,
                "dyson_swarm_3",
                174,
                "\t\towner=11\n\t\tplanet=511\n",
            );
            after_bombardment(text, 511, &modifiers_block(&["dyson_swarm_3_mod"]));
            owner_variable(text, "\t\t\tdyson_swarm_counter=2\n");
        })
    };
    let op = Op::DeleteMegastructure {
        megastructure: 16,
        dismantle: Some(MegastructureDismantle {
            modifiers: vec!["dyson_swarm_3_mod".to_owned()],
            deposits: Vec::new(),
            variables: vec![VariableDrop {
                variable: "dyson_swarm_counter".to_owned(),
                by: 1,
            }],
        }),
    };
    let mut session = swarm();
    snapshot_step(&mut session, "dyson_swarm_dismantled", op.clone());
    round_trip(swarm(), op);
}

#[test]
fn a_dismantle_names_identifiers() {
    assert_refusals(
        &mut open_4_5(),
        [(
            Op::DeleteMegastructure {
                megastructure: 6,
                dismantle: Some(MegastructureDismantle {
                    modifiers: vec!["two words".to_owned()],
                    ..MegastructureDismantle::default()
                }),
            },
            "\"two words\" cannot be written as a modifier",
        )],
    );
}
