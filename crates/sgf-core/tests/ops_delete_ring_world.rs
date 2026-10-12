//! Deleting a save ring world whole: Lachium's mixed ring on the 4.5 sample and the fallen
//! machine empires' home rings on the 4.4 sample, the flags the system and its star lose,
//! byte-exact undo and what is refused. Deleting a habitat takes its flags with it.

use sgf_core::entity::views::EntityKind;
use sgf_core::ops::Op;
use sgf_core::session::Session;

use crate::common;
use crate::ops_bodies::{move_body, set_parent};
use crate::ops_move_planet::move_planet;
use crate::ops_remove_planet::footprint;
use common::diff::{round_trip, snapshot_step};
use common::examples::titanic_ring;
use common::{
    SAMPLE_4_5, assert_refusals, current, entity_text, open, open_3_4, open_4_5,
    open_edited_sample, reopened,
};

/// Lachium, 4.5: two ruined sections, six segments with colony 25 of pre-FTL country 42 on
/// planet 2447, and the Interloper at orbit 40, which is no segment.
const LACHIUM: u32 = 203;
/// Alpha Refuge, 4.4: nine segments, three of them fallen empire colonies and two more
/// controlled by the empire, one ruined section, and deep-space citadels (fleets 71, 79
/// and 80) orbiting uncolonised segments 624, 627 and 630. The system's own citadel, fleet
/// 81, orbits the star 622.
const ALPHA_REFUGE: u32 = 246;
/// Gamma Refuge, 4.4: four ruined sections of country 15 and no segment.
const GAMMA_REFUGE: u32 = 0;
/// Ter Meku, 4.5: two damaged segments at orbit 100 round a black hole.
const TER_MEKU: u32 = 100;

fn delete(system: u32) -> Op {
    Op::DeleteRingWorld {
        system,
        radius: None,
    }
}

fn delete_at(system: u32, radius: f64) -> Op {
    Op::DeleteRingWorld {
        system,
        radius: Some(radius),
    }
}

/// `text` with `insert` written after the last of `anchors`, each found after the one
/// before.
fn insert_after(text: &mut String, anchors: &[&str], insert: &str) {
    let mut at = 0;
    for anchor in anchors {
        at += text[at..]
            .find(anchor)
            .unwrap_or_else(|| panic!("{anchor:?}"))
            + anchor.len();
    }
    text.insert_str(at, insert);
}

fn edited_4_5(edit: impl FnOnce(&mut String)) -> Session {
    open_edited_sample(SAMPLE_4_5, |gamestate, _| edit(gamestate))
}

fn system_text(session: &Session, system: u32) -> String {
    entity_text(session, EntityKind::System, system)
}

#[test]
fn lachiums_mixed_ring_goes_with_its_colony_and_leaves_the_interloper() {
    let mut session = open_4_5();
    let result = session.apply(delete(LACHIUM)).expect("delete");
    assert_eq!(
        result.entry.description,
        "Deleted the ring world in Lachium #203, its 6 planets and 2 sections, with the colony on Lachium I #2447"
    );
    common::snapshot("lachium", &footprint(&session, &result, false));
    assert_eq!(common::planet_ids(&session, LACHIUM), [2444, 2450]);
    let system = system_text(&session, LACHIUM);
    assert!(!system.contains("ring_world_built"), "{system}");
    assert!(!system.contains("megastructures="), "{system}");
    assert!(
        system.contains("shattered_ring_system=62808000"),
        "{system}"
    );
    round_trip(open_4_5(), delete(LACHIUM));
}

#[test]
fn a_fallen_empires_home_ring_goes_with_its_colonies() {
    let mut session = open();
    let result = session.apply(delete(ALPHA_REFUGE)).expect("delete");
    assert_eq!(
        result.entry.description,
        "Deleted the ring world in Alpha Refuge #246, its 9 planets and 1 section, with 3 colonies, and left 3 fleets orbiting its star"
    );
    common::snapshot("alpha_refuge", &footprint(&session, &result, false));
    let system = system_text(&session, ALPHA_REFUGE);
    assert!(!system.contains("colonies="), "{system}");
    assert!(!system.contains("ring_world_built"), "{system}");
    assert!(
        system.contains("ancient_wonders_system=62808000"),
        "{system}"
    );
    for fleet in [71, 79, 80, 81] {
        let text = entity_text(&session, EntityKind::Fleet, fleet);
        assert!(
            text.contains(
                "					planet=622
"
            ),
            "fleet {fleet}: {text}"
        );
    }
    round_trip(open(), delete(ALPHA_REFUGE));
}

#[test]
fn a_ring_of_ruined_sections_leaves_its_owners_list() {
    let mut session = open();
    let result = session.apply(delete(GAMMA_REFUGE)).expect("delete");
    common::snapshot("gamma_refuge", &footprint(&session, &result, false));
    let owner = entity_text(&session, EntityKind::Country, 15);
    assert!(
        owner.contains("owned_megastructures="),
        "the owner keeps its other rows"
    );
    round_trip(open(), delete(GAMMA_REFUGE));
}

#[test]
fn a_radius_picks_one_ring() {
    assert_refusals(
        &mut open_4_5(),
        [(
            delete_at(TER_MEKU, 45.0),
            "system 100 has no ring world at orbit 45",
        )],
    );
    let mut session = open_4_5();
    let result = session.apply(delete_at(TER_MEKU, 100.0)).expect("delete");
    assert_eq!(
        result.entry.description,
        "Deleted the ring world at orbit 100 in Ter Meku Black Hole #100 and its 2 planets"
    );
    let mut whole = open_4_5();
    whole.apply(delete(LACHIUM)).expect("every ring");
    let mut picked = open_4_5();
    picked
        .apply(delete_at(LACHIUM, 45.0))
        .expect("the ring at 45");
    assert_eq!(current(&picked), current(&whole));
}

/// The 4.5 sample with Lachium's star 2444 given `has_megastructure`; with `swarm`, a Dyson
/// Swarm row 16 of the system names the star.
fn flagged_star(swarm: bool) -> Session {
    edited_4_5(|text| {
        insert_after(
            text,
            &["\n\t\t2444=\n\t\t{\n", "\t\t\tflags=\n\t\t\t{\n"],
            "\t\t\t\thas_megastructure=62808000\n",
        );
        if swarm {
            insert_after(
                text,
                &["\nmegastructures=\n{\n", "\t16777231=none\n"],
                "\t16=\n\t{\n\t\ttype=\"dyson_swarm_1\"\n\t\tcoordinate=\n\t\t{\n\t\t\tx=0\n\t\t\ty=0\n\t\t\torigin=203\n\t\t}\n\t\tplanet=2444\n\t\torbitals=\n\t\t{\n\t\t}\n\t\tbuild_queue=4294967295\n\t\tdismantle_progress=0\n\t\tdismantle_finish_date=\"0.01.01\"\n\t}\n",
            );
            insert_after(
                text,
                &["\ngalactic_object=\n{\n", "\n\t203=\n\t{\n", "\t\t\t10 11 "],
                "16 ",
            );
        }
    })
}

#[test]
fn the_star_loses_its_megastructure_flag_unless_another_row_names_it() {
    let mut session = flagged_star(false);
    session.apply(delete(LACHIUM)).expect("delete");
    let star = entity_text(&session, EntityKind::Planet, 2444);
    assert!(!star.contains("has_megastructure"), "{star}");
    assert!(star.contains("starting_mining_target=62808000"), "{star}");
    round_trip(flagged_star(false), delete(LACHIUM));

    let mut session = flagged_star(true);
    session.apply(delete(LACHIUM)).expect("delete");
    let star = entity_text(&session, EntityKind::Planet, 2444);
    assert!(star.contains("has_megastructure=62808000"), "{star}");
    assert!(system_text(&session, LACHIUM).contains("\t\t\t16 \n"));
}

/// The 4.5 sample with Gigastructural Engineering's titanic ring added round Lachium's star
/// beside its ring at 45, whose system has `ring_world_built`, saved and opened again.
fn two_rings() -> Session {
    let mut session = open_4_5();
    let op = session
        .ring_world_op(LACHIUM, None, titanic_ring(), false)
        .expect("the titanic ring");
    session.apply(op).expect("the titanic ring");
    reopened(&mut session)
}

/// Deleting one of two rings takes the flags of its own size only: the base game's ring at
/// 45 takes `ring_world_built`, and the titanic ring at 90 takes `ring_world_built_one` and
/// `giga_has_titanic_ring`. The star keeps `has_megastructure` while a ring stands.
#[test]
fn deleting_one_of_two_rings_keeps_the_others_flags() {
    let mut session = two_rings();
    let result = snapshot_step(
        &mut session,
        "the_ring_beside_a_titanic_ring",
        delete_at(LACHIUM, 45.0),
    );
    assert!(
        result
            .entry
            .description
            .starts_with("Deleted the ring world at orbit 45 in Lachium #203"),
        "{}",
        result.entry.description
    );
    let system = system_text(&session, LACHIUM);
    assert!(!system.contains("ring_world_built="), "{system}");
    for flag in ["ring_world_built_one=", "giga_has_titanic_ring="] {
        assert!(system.contains(flag), "{flag}: {system}");
    }
    let star = entity_text(&session, EntityKind::Planet, 2444);
    assert!(star.contains("has_megastructure="), "{star}");

    session
        .apply(delete_at(LACHIUM, 90.0))
        .expect("the titanic ring");
    let system = system_text(&session, LACHIUM);
    for flag in ["ring_world_built_one=", "giga_has_titanic_ring="] {
        assert!(!system.contains(flag), "{flag}: {system}");
    }
    let star = entity_text(&session, EntityKind::Planet, 2444);
    assert!(!star.contains("has_megastructure"), "{star}");

    let mut titanic_first = two_rings();
    titanic_first
        .apply(delete_at(LACHIUM, 90.0))
        .expect("the titanic ring");
    let system = system_text(&titanic_first, LACHIUM);
    assert!(system.contains("ring_world_built="), "{system}");
    assert!(!system.contains("giga_has_titanic_ring="), "{system}");
    let star = entity_text(&titanic_first, EntityKind::Planet, 2444);
    assert!(star.contains("has_megastructure="), "{star}");
}

#[test]
fn the_inverse_of_the_inverse_deletes_again() {
    let mut session = open_4_5();
    let result = session.apply(delete(LACHIUM)).expect("delete");
    let edited = current(&session);
    let restored = session.apply_inverse(result.inverse).expect("restore");
    session
        .apply_inverse(restored.inverse)
        .expect("delete again");
    assert_eq!(current(&session), edited);
}

/// Segment 2446 of Lachium names no megastructure row of its own.
const SEGMENT_2446_STAYS: &str =
    "planet 2446 is part of a ring world, so it cannot be moved or copied on its own";

#[test]
fn what_is_refused() {
    let mut ownerless = edited_4_5(|text| {
        let owned = "\t\t\towner=42\n\t\t\toriginal_owner=42\n";
        let at = text.find("\n\t\t2447=\n\t\t{\n").expect("planet 2447");
        let at = at + text[at..].find(owned).expect("its owner");
        text.replace_range(at..at + owned.len(), "\t\t\toriginal_owner=42\n");
    });
    assert_refusals(
        &mut ownerless,
        [(
            delete(LACHIUM),
            "the colony on planet 2447 cannot be removed: the planet has no owner",
        )],
    );
    assert_refusals(
        &mut open_4_5(),
        [
            (delete(38), "system 38 has no ring world"),
            (delete(99999), "system 99999 does not exist"),
            (
                delete_at(LACHIUM, 0.0),
                "radius 0 is invalid: a ring's radius is a number above 0",
            ),
            (
                delete_at(LACHIUM, f64::NAN),
                "radius NaN is invalid: a ring's radius is a number above 0",
            ),
            (
                Op::DeleteBody { body: 2445 },
                "planet 2445 cannot be deleted: it is a ring world segment: delete the ring world",
            ),
            (
                Op::DeleteMegastructure {
                    megastructure: 10,
                    dismantle: None,
                },
                "megastructure 10 cannot be deleted: it is part of a ring world: delete the ring world",
            ),
            (
                Op::RemoveColony { body: 2447 },
                "the colony on planet 2447 cannot be removed: it is a ring world segment, which has not been tried in game",
            ),
            (move_body(LACHIUM, 2446, 45.0, 10.0), SEGMENT_2446_STAYS),
            (
                set_parent(LACHIUM, 2446, Some(2450), 5.0, 0.0),
                SEGMENT_2446_STAYS,
            ),
            (move_planet(2446, 216), SEGMENT_2446_STAYS),
        ],
    );
    let error = open_4_5().copy_bodies(&[2446]).expect_err("a segment");
    assert_eq!(error.to_string(), SEGMENT_2446_STAYS);
    assert_refusals(
        &mut open_3_4(),
        [(
            delete(0),
            "this edit needs a save from Stellaris 4.0 or later, not Cepheus v3.4.5",
        )],
    );
}

/// The 4.5 sample with Ithomes Gate's three habitats named by their hosts' flags, as a built
/// habitat's host is, and the system's `has_habitat`.
fn flagged_habitats() -> Session {
    edited_4_5(|text| {
        for (host, habitat) in [(6267, 6268), (6269, 6270), (6271, 6272)] {
            insert_after(
                text,
                &[
                    &format!("\n\t\t{host}=\n\t\t{{\n"),
                    "\t\t\tflags=\n\t\t\t{\n",
                ],
                &format!("\t\t\t\thabitat{habitat}=62808000\n"),
            );
        }
        insert_after(
            text,
            &[
                "\ngalactic_object=\n{\n",
                "\n\t596=\n\t{\n",
                "\t\tflags=\n\t\t{\n",
            ],
            "\t\t\thas_habitat=62808000\n",
        );
    })
}

#[test]
fn a_habitat_takes_its_hosts_flag_and_the_last_takes_the_systems() {
    let mut session = flagged_habitats();
    snapshot_step(
        &mut session,
        "habitat_host_flag",
        Op::DeleteBody { body: 6268 },
    );
    assert!(system_text(&session, 596).contains("has_habitat=62808000"));
    session
        .apply(Op::DeleteBody { body: 6270 })
        .expect("second");
    assert!(system_text(&session, 596).contains("has_habitat=62808000"));
    session.apply(Op::DeleteBody { body: 6272 }).expect("last");
    let system = system_text(&session, 596);
    assert!(!system.contains("has_habitat"), "{system}");
    assert!(system.contains("ithomes_gate=62808000"), "{system}");
    for host in [6267, 6269, 6271] {
        let planet = entity_text(&session, EntityKind::Planet, host);
        assert!(!planet.contains("habitat6"), "{planet}");
    }
}

#[test]
fn the_last_habitat_deleted_round_trips() {
    let last = || {
        let mut session = flagged_habitats();
        for habitat in [6268, 6270] {
            session
                .apply(Op::DeleteBody { body: habitat })
                .expect("delete");
        }
        session
    };
    let mut session = last();
    let before = current(&session);
    let result = session.apply(Op::DeleteBody { body: 6272 }).expect("last");
    session.apply_inverse(result.inverse).expect("restore");
    assert_eq!(current(&session), before);
}
