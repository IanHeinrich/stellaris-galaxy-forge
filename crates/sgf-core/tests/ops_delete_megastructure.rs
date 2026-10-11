//! Deleting a save megastructure: each row's diff on the 4.5 sample, the bypass it takes
//! along, the dead table a `save_on_death` row is logged in, the colony on a body the
//! structure made, byte-exact undo and what is refused.

use sgf_core::entity::views::EntityKind;
use sgf_core::ops::Op;
use sgf_core::projections::galaxy::BypassLink;
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::{
    SAMPLE, SAMPLE_4_5, assert_refusals, entity_text, open_3_4, open_4_5, open_edited_sample, text,
};

fn delete(megastructure: u32) -> Op {
    Op::DeleteMegastructure { megastructure }
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
    let mut upgrading = edited_4_5(|text| {
        insert_after(
            text,
            "\nfleet=\n{\n",
            "\t0=\n\t{\n",
            "\t\tcurrent_order=\n\t\t{\n\t\t\tbuild_megastructure_fleet_order=\n\t\t\t{\n\t\t\t\tupgrade=6\n\t\t\t}\n\t\t}\n",
        );
    });
    assert_refusals(
        &mut upgrading,
        [(
            delete(6),
            "megastructure 6 cannot be deleted: a construction ship is upgrading it",
        )],
    );
    assert_refusals(
        &mut open_3_4(),
        [(
            delete(0),
            "this edit needs a save from Stellaris 4.0 or later, not Cepheus v3.4.5",
        )],
    );
}
