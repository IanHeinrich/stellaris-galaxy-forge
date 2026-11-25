//! Deleting a save megastructure: each row's diff on the 4.5 sample, the bypass it takes
//! along, the dead table a `save_on_death` row is logged in, the colony and the flags its planet
//! keeps, byte-exact undo and what is refused.

use sgf_core::entity::views::EntityKind;
use sgf_core::ops::{
    MegastructureDismantle, MegastructurePlace, NewMegastructure, NewMegastructurePlace, Op,
    VariableStep,
};
use sgf_core::projections::galaxy::BypassLink;
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, round_trip_step, snapshot_step};
use common::edit::{
    HALL_FLAGS, galactic_hall, insert_after, megastructure_row, open_4_5_edited,
    structure_at_colony,
};
use common::{
    SAMPLE, assert_refusals, current, entity_text, holds, open_4_5, open_edited_sample, reopened,
    text,
};

fn delete(megastructure: u32) -> Op {
    Op::DeleteMegastructure {
        megastructure,
        dismantle: None,
    }
}

/// Row `id` of the top-level `megastructures` given `save_on_death=1`.
fn save_on_death(text: &mut String, id: u32) {
    insert_after(
        text,
        &["\nmegastructures=\n{\n", &format!("\n\t{id}=\n\t{{\n")],
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
            "planet 936 cannot be deleted: it has a megastructure, so delete the megastructure first"
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
    let mut session = open_4_5_edited(|text| save_on_death(text, 2));
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

/// The 4.5 sample with row 16 of type `kind` at planet 517, a colony made `class` with the
/// planet flags `flags`.
fn at_colony(kind: &str, class: &str, flags: &[&str]) -> Session {
    open_4_5_edited(|text| structure_at_colony(text, kind, class, flags))
}

/// Whether planet 517 has `flag`.
fn flagged(session: &Session, flag: &str) -> bool {
    entity_text(session, EntityKind::Planet, 517).contains(&format!("\t{flag}=62808000\n"))
}

#[test]
fn a_colony_stays_whatever_its_planet_is() {
    let habitat = ["megastructure", "habitat"];
    let made = ["megastructure"];
    for (kind, class, flags) in [
        ("orbital_ring_tier_1", "pc_tropical", &[][..]),
        ("spy_orb_4", "pc_habitat", &habitat),
        ("mega_art_installation_4", "pc_habitat", &habitat),
        ("interstellar_assembly_4", "pc_habitat", &habitat),
        ("strategic_coordination_center_3", "pc_habitat", &habitat),
        ("katzen_forge_1", "pc_habitat", &habitat),
        ("spy_orb_4", "pc_ringworld_habitable", &made),
        ("cosmogenesis_world_0", "pc_cosmogenesis_world", &made),
        (
            "planetary_drive_yard_1_fortress",
            "pc_giga_maginot_world",
            &made,
        ),
        ("galactic_halls_0_militarist", "pc_tropical", &HALL_FLAGS),
        ("galactic_halls_0_militarist", "pc_habitat", &HALL_FLAGS),
    ] {
        let opened = at_colony(kind, class, flags);
        let mut session = at_colony(kind, class, flags);
        let result = round_trip_step(&mut session, kind, delete(16));
        assert_eq!(
            result.entry.description,
            format!("Deleted megastructure #16 ({kind}) in Vinh #174")
        );
        let planet = entity_text(&session, EntityKind::Planet, 517);
        assert!(planet.contains("colony=18"), "{kind}: {planet}");
        assert_eq!(
            entity_text(&session, EntityKind::Colony, 18),
            entity_text(&opened, EntityKind::Colony, 18),
            "{kind}"
        );
        round_trip(at_colony(kind, class, flags), delete(16));
    }
}

/// A Spy Orb added to a habitat and saved is a row the file holds.
#[test]
fn a_colony_stays_when_an_added_row_is_deleted_after_a_save() {
    let mut session = open_4_5_edited(|text| {
        insert_after(
            text,
            &["\n\t\t517=\n\t\t{\n", "\t\t\tflags=\n\t\t\t{\n"],
            "\t\t\t\tmegastructure=62808000\n\t\t\t\thabitat=62808000\n",
        );
    });
    session
        .apply(Op::AddMegastructure {
            system: 174,
            spec: NewMegastructure {
                kind: "spy_orb_4".to_owned(),
                at: MegastructurePlace::Body { body: 517 }.into(),
                ..NewMegastructure::default()
            },
        })
        .expect("the orb");
    let mut session = reopened(&mut session);
    session.apply(delete(16)).expect("the orb");
    let planet = entity_text(&session, EntityKind::Planet, 517);
    assert!(planet.contains("colony=18"), "{planet}");
    assert!(flagged(&session, "megastructure"), "{planet}");
}

/// The flag a habitat has of its own is not a Science Nexus's to take.
#[test]
fn a_habitat_keeps_its_own_flag() {
    let nexus = || {
        at_colony(
            "think_tank_3",
            "pc_habitat",
            &["megastructure", "habitat", "has_megastructure"],
        )
    };
    round_trip(nexus(), delete(16));
    let mut session = nexus();
    session.apply(delete(16)).expect("the Nexus");
    let session = reopened(&mut session);
    assert!(flagged(&session, "megastructure"));
    assert!(flagged(&session, "habitat"));
    assert!(!flagged(&session, "has_megastructure"));
}

#[test]
fn a_grand_archives_planet_keeps_its_flag() {
    let archive = || {
        at_colony(
            "grand_archive_0",
            "pc_tropical",
            &["megastructure", "has_megastructure"],
        )
    };
    let mut session = archive();
    session.apply(delete(16)).expect("the Archive");
    assert!(flagged(&session, "megastructure"));
    assert!(!flagged(&session, "has_megastructure"));
    round_trip(archive(), delete(16));
}

#[test]
fn a_hall_takes_its_flags() {
    let hall = || open_4_5_edited(galactic_hall);
    let mut session = hall();
    session.apply(delete(16)).expect("the Hall");
    let planet = entity_text(&session, EntityKind::Planet, 517);
    assert!(planet.contains("fallen_empire_world=62808000"), "{planet}");
    assert!(!planet.contains("megastructure"), "{planet}");
    round_trip(hall(), delete(16));
}

#[test]
fn a_hall_whose_planet_another_row_names_leaves_its_flags_for_that_row() {
    let mut session = open_4_5_edited(|text| {
        galactic_hall(text);
        megastructure_row(text, 17, "habitat_minor_orbital", 174, "\t\tplanet=517\n");
    });
    session.apply(delete(16)).expect("the Hall");
    for flag in HALL_FLAGS {
        assert!(flagged(&session, flag), "{flag}");
    }
    session.apply(delete(17)).expect("the orbital");
    let planet = entity_text(&session, EntityKind::Planet, 517);
    assert!(planet.contains("colony=18"), "{planet}");
    assert!(!planet.contains("megastructure"), "{planet}");
}

/// What 0.27.8 left of a Hall it deleted: an add there writes neither flag, so its inverse
/// takes neither, and once saved its row takes both.
#[test]
fn an_added_row_leaves_a_halls_flags() {
    let left = || {
        open_4_5_edited(|text| {
            insert_after(
                text,
                &["\n\t\t517=\n\t\t{\n", "\t\t\tflags=\n\t\t\t{\n"],
                "\t\t\t\thas_galactic_hall_megastructure=62808000\n\t\t\t\tmegastructure=62808000\n",
            );
        })
    };
    let add = Op::AddMegastructure {
        system: 174,
        spec: NewMegastructure {
            kind: "think_tank_3".to_owned(),
            at: NewMegastructurePlace::Body {
                body: 517,
                body_flags: vec!["has_megastructure".to_owned()],
                star_only: false,
            },
            ..NewMegastructure::default()
        },
    };
    round_trip(left(), add.clone());
    let mut session = left();
    let opened = current(&session);
    let added = session.apply(add.clone()).expect("the Nexus");
    session.apply_inverse(added.inverse).expect("its inverse");
    assert!(
        holds(&session, &opened),
        "the inverse took the Hall's flags"
    );
    session.apply(add).expect("the Nexus");
    let mut session = reopened(&mut session);
    session.apply(delete(16)).expect("the Nexus");
    let planet = entity_text(&session, EntityKind::Planet, 517);
    assert!(!planet.contains("megastructure"), "{planet}");
}

#[test]
fn what_is_refused() {
    assert_refusals(
        &mut open_4_5(),
        [
            (
                delete(0),
                "megastructure 0 cannot be deleted: deleting it hasn't been tested in game",
            ),
            (delete(14), "Megastructure 14 does not exist"),
            (delete(999), "Megastructure 999 does not exist"),
        ],
    );
}

#[test]
fn a_ring_world_quadrant_is_refused() {
    let mut session = open_4_5_edited(|text| {
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
            "megastructure 4 cannot be deleted: it is part of a ring world, so delete the whole ring world instead",
        )],
    );
}

/// The 4.5 sample with Arc Furnace row 16 around planet 517, which keeps its other flags;
/// with `another`, row 17 names the planet too.
fn furnace(another: bool) -> Session {
    open_4_5_edited(|text| {
        let planet = "\n\t\t517=\n\t\t{\n";
        insert_after(
            text,
            &[planet, "\t\t\tplanet_orbitals=\n\t\t\t{\n\t\t\t}\n"],
            "\t\t\tmegastructure=16\n",
        );
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
        if another {
            megastructure_row(text, 17, "orbital_ring_tier_1", 174, "\t\tplanet=517\n");
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
    open_4_5_edited(|text| {
        let relays = [
            (16, 0, 23, "24 "),
            (17, 148, 24, "23 25 "),
            (18, 358, 25, "24 "),
        ];
        for (id, system, bypass, linked) in relays {
            megastructure_row(
                text,
                id,
                "hyper_relay",
                system,
                &format!("\t\tbypass={bypass}\n"),
            );
            insert_after(
                text,
                &["\ngalactic_object=\n{\n", &format!("\n\t{system}=\n\t{{\n")],
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
    let session = open_4_5_edited(|text| {
        for (planet, row) in [(99, 14), (517, 999)] {
            insert_after(
                text,
                &[
                    &format!("\n\t\t{planet}=\n\t\t{{\n"),
                    "\t\t\tplanet_orbitals=\n\t\t\t{\n\t\t\t}\n",
                ],
                &format!("\t\t\tmegastructure={row}\n"),
            );
        }
    });
    assert_eq!(session.check_op(&Op::DeleteBody { body: 99 }), None);
    assert_eq!(session.check_op(&Op::RemoveColony { body: 517 }), None);
}

#[test]
fn a_row_mid_upgrade_goes_with_its_upgrade() {
    let mut session = open_4_5_edited(|text| {
        insert_after(
            text,
            &["\nmegastructures=\n{\n", "\n\t2=\n\t{\n"],
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
        variables: vec![VariableStep {
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
        &[
            &format!("\n\t\t{planet}=\n\t\t{{\n"),
            "\t\t\tbombardment_damage=0\n",
        ],
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
    open_4_5_edited(|text| {
        let planet = "\n\t\t517=\n\t\t{\n";
        insert_after(
            text,
            &[planet, "\t\t\tplanet_orbitals=\n\t\t\t{\n\t\t\t}\n"],
            "\t\t\tmegastructure=16\n",
        );
        insert_after(
            text,
            &[planet, "\t\t\tflags=\n\t\t\t{\n"],
            "\t\t\t\thas_megastructure=62808000\n\t\t\t\thas_arc_furnace=62808000\n",
        );
        megastructure_row(
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
    let edited = current(&session);
    let restored = session.apply_inverse(result.inverse).expect("restore");
    session
        .apply_inverse(restored.inverse)
        .expect("delete again");
    assert!(
        holds(&session, &edited),
        "the inverse's inverse deletes again"
    );
    round_trip(furnace_system(), delete_furnace());
}

#[test]
fn a_dyson_swarm_takes_back_its_stars_modifier() {
    let swarm = || {
        open_4_5_edited(|text| {
            megastructure_row(
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
            variables: vec![VariableStep {
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

/// A habitat orbital the file held, made here from row 1 at star 631 with `has_orbital` on
/// the star: deleting it takes the flag, its block with it, and undo, which applies the
/// inverse, puts it back.
#[test]
fn a_habitat_orbital_takes_its_bodys_flag() {
    let mut session = open_4_5_edited(|gamestate| {
        insert_after(
            gamestate,
            &[
                "
megastructures=
{
",
                "
	1=
	{
",
            ],
            "		name=
		{
			key=\"TARGET_ORBITAL_NAME\"
		}
",
        );
        *gamestate = gamestate.replacen(
            "type=\"strategic_coordination_center_ruined\"",
            "type=\"habitat_major_orbital\"",
            1,
        );
        insert_after(
            gamestate,
            &[
                "
		631=
		{
",
                "			megastructure=1
			bombardment_damage=0
",
            ],
            "			flags=
			{
				has_orbital=62808000
			}
",
        );
    });
    let star = entity_text(&session, EntityKind::Planet, 631);
    assert!(star.contains("has_orbital="), "{star}");
    session.apply(delete(1)).expect("the orbital");
    let star = entity_text(&session, EntityKind::Planet, 631);
    assert!(!star.contains("	flags="), "{star}");
    session.undo().expect("undo").expect("the delete to undo");
    assert_eq!(current(&session), session.doc().original());
}
