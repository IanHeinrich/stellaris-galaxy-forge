//! Deleting a save ring world whole: Lachium's mixed ring on the 4.5 sample and the fallen
//! machine empires' home rings on the 4.4 sample, the flags the system and its star lose,
//! byte-exact undo and what is refused. Deleting a habitat takes its flags with it.

use sgf_core::entity::views::EntityKind;
use sgf_core::format::save::ring_world::{BASE_RING, RingWorldTypes};
use sgf_core::ops::{MegastructurePlace, NewRingWorld, Op, RingFlags, RingQuadrant};
use sgf_core::session::Session;

use crate::common;
use crate::ops_bodies::{move_body, set_parent};
use crate::ops_move_planet::move_planet;
use crate::ops_remove_planet::footprint;
use common::diff::{round_trip, snapshot_step};
use common::edit::{insert_after, megastructure_row, open_4_5_edited, system_text};
use common::examples::titanic_ring;
use common::{assert_refusals, current, entity_text, open, open_4_5, reopened};

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
        rings: None,
    }
}

fn delete_at(system: u32, radius: f64) -> Op {
    Op::DeleteRingWorld {
        system,
        radius: Some(radius),
        rings: None,
    }
}

/// The rings of `system` at `radius`, or all of them, deleted with `rings` as the rings the
/// install lays out.
fn delete_ringed(system: u32, radius: Option<f64>, rings: Vec<RingFlags>) -> Op {
    Op::DeleteRingWorld {
        system,
        radius,
        rings: Some(rings),
    }
}

fn ring_flags(radius: f64, flags: &[&str], sections: &[&str]) -> RingFlags {
    let owned = |list: &[&str]| list.iter().map(|s| (*s).to_owned()).collect();
    RingFlags {
        radius,
        flags: owned(flags),
        sections: owned(sections),
    }
}

/// The base game's ring as the install lays it out.
fn base_ring() -> RingFlags {
    ring_flags(BASE_RING.0, &BASE_RING.1, &[])
}

/// The rings an install with Gigastructural Engineering lays out: its base ring at 45, whose
/// habitable sections take `ring_01` to `ring_04`, and its titanic ring at 90, laid out
/// beside it, whose sections take `ring_05` to `ring_08`.
fn giga_rings() -> Vec<RingFlags> {
    vec![
        ring_flags(
            45.0,
            &[
                "giga_forbid_planet_dismantlement",
                "ring_01",
                "ring_02",
                "ring_03",
                "ring_world_built",
                "ring_04",
            ],
            &["ring_"],
        ),
        ring_flags(
            90.0,
            &[
                "giga_has_titanic_ring",
                "ring_05",
                "ring_06",
                "ring_07",
                "ring_world_built_one",
                "ring_08",
            ],
            &["ring_"],
        ),
    ]
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
    open_4_5_edited(|text| {
        insert_after(
            text,
            &["\n\t\t2444=\n\t\t{\n", "\t\t\tflags=\n\t\t\t{\n"],
            "\t\t\t\thas_megastructure=62808000\n",
        );
        if swarm {
            megastructure_row(text, 16, "dyson_swarm_1", LACHIUM, "\t\tplanet=2444\n");
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
    added_beside_lachiums(titanic_ring()).0
}

/// The titanic ring at 90 deleted, with the flags its build sets.
fn delete_titanic() -> Op {
    delete_ringed(LACHIUM, Some(90.0), giga_rings())
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
        delete_ringed(LACHIUM, Some(45.0), giga_rings()),
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

    session.apply(delete_titanic()).expect("the titanic ring");
    let system = system_text(&session, LACHIUM);
    for flag in ["ring_world_built_one=", "giga_has_titanic_ring="] {
        assert!(!system.contains(flag), "{flag}: {system}");
    }
    let star = entity_text(&session, EntityKind::Planet, 2444);
    assert!(!star.contains("has_megastructure"), "{star}");

    let mut titanic_first = two_rings();
    titanic_first
        .apply(delete_titanic())
        .expect("the titanic ring");
    let system = system_text(&titanic_first, LACHIUM);
    assert!(system.contains("ring_world_built="), "{system}");
    assert!(!system.contains("giga_has_titanic_ring="), "{system}");
    let star = entity_text(&titanic_first, EntityKind::Planet, 2444);
    assert!(star.contains("has_megastructure="), "{star}");
}

/// The flags of Lachium's own `flags` block, each as written.
fn lachium_flags(session: &Session) -> Vec<String> {
    system_flags(session, LACHIUM)
}

/// The flags of system `system`'s own `flags` block, each as written.
fn system_flags(session: &Session, system: u32) -> Vec<String> {
    let text = system_text(session, system);
    let open = "\n\t\tflags=\n\t\t{\n";
    let Some(at) = text.find(open) else {
        return Vec::new();
    };
    let block = &text[at + open.len()..];
    let end = block.find("\n\t\t}").expect("the flags block closes");
    block[..end]
        .lines()
        .map(|line| line.trim().to_owned())
        .collect()
}

/// `ring` added round Lachium's star beside its ring at 45, saved and opened again, and the
/// system's flags before the add.
fn added_beside_lachiums(ring: NewRingWorld) -> (Session, Vec<String>) {
    let mut session = open_4_5();
    let before = lachium_flags(&session);
    let op = session
        .save("adding a ring world")
        .expect("a save")
        .ring_world_op(LACHIUM, None, ring, false)
        .expect("the ring");
    session.apply(op).expect("the ring");
    (reopened(&mut session), before)
}

/// Deleting the titanic ring takes every flag its build set, its habitable sections'
/// `ring_05` to `ring_08` too, and leaves the system's flags as they were before the add.
#[test]
fn deleting_an_added_ring_takes_every_flag_its_build_set() {
    let (mut session, before) = added_beside_lachiums(titanic_ring());
    session.apply(delete_titanic()).expect("the titanic ring");
    assert_eq!(lachium_flags(&session), before);
}

/// A ring a mod's chain lays out at 65 takes its own flags, and leaves the base game's
/// `ring_world_built` to the ring at 45 that still stands. Where the install lays out no ring
/// at 65, its delete takes no flags.
#[test]
fn a_ring_at_another_radius_takes_its_own_flags() {
    let mut ring = titanic_ring();
    for quadrant in &mut ring.quadrants {
        if let RingQuadrant::Finished { segments } = quadrant {
            for segment in segments {
                segment.planet.at.radius = 65.0;
            }
        }
    }
    ring.system_flags = vec!["my_mod_ring_built".to_owned()];
    let modded = vec![base_ring(), ring_flags(65.0, &["my_mod_ring_built"], &[])];
    let (mut session, before) = added_beside_lachiums(ring.clone());
    session
        .apply(delete_ringed(LACHIUM, Some(65.0), modded))
        .expect("the ring at 65");
    assert_eq!(lachium_flags(&session), before);

    let (mut unlisted, _) = added_beside_lachiums(ring);
    unlisted
        .apply(delete_ringed(LACHIUM, Some(65.0), vec![base_ring()]))
        .expect("the ring at 65");
    let flags = lachium_flags(&unlisted);
    for flag in ["ring_world_built=", "my_mod_ring_built="] {
        assert!(
            flags.iter().any(|held| held.starts_with(flag)),
            "{flag}: {flags:?}"
        );
    }
}

/// Without game data a delete takes the base game's ring's flags for a ring at 45 only: the
/// titanic ring's leaves the base ring standing beside it its `ring_world_built`.
#[test]
fn without_game_data_only_a_ring_at_45_takes_the_base_rings_flags() {
    let (mut session, _) = added_beside_lachiums(titanic_ring());
    session
        .apply(delete_at(LACHIUM, 90.0))
        .expect("the titanic ring");
    let flags = lachium_flags(&session);
    assert!(
        flags
            .iter()
            .any(|flag| flag.starts_with("ring_world_built=")),
        "{flags:?}"
    );
}

/// Habraq, system 159: no ring world stands there.
const HABRAQ: u32 = 159;

/// The last ring of a system takes every flag named as a section, whichever ring the
/// install lists it for: a titanic ring built alone took `ring_01` to `ring_04`, which the
/// install lists for its base ring.
#[test]
fn the_last_ring_takes_every_section_flag() {
    let mut ring = titanic_ring();
    ring.system_flags = [
        "giga_has_titanic_ring",
        "ring_01",
        "ring_02",
        "ring_03",
        "ring_world_built_one",
        "ring_04",
    ]
    .map(str::to_owned)
    .to_vec();
    let mut session = open_4_5();
    let before = system_flags(&session, HABRAQ);
    let op = session
        .save("adding a ring world")
        .expect("a save")
        .ring_world_op(HABRAQ, None, ring, true)
        .expect("the ring");
    session.apply(op).expect("the ring");
    session
        .apply(delete_ringed(HABRAQ, None, giga_rings()))
        .expect("the ring");
    assert_eq!(system_flags(&session, HABRAQ), before);
}

/// Segment 2446 of Lachium names no megastructure row of its own.
const SEGMENT_2446_STAYS: &str =
    "planet 2446 is part of a ring world, so it cannot be moved or copied on its own";

#[test]
fn what_is_refused() {
    let mut ownerless = open_4_5_edited(|text| {
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
    let error = open_4_5()
        .save("copying planets")
        .expect("a save")
        .copy_bodies(&[2446])
        .expect_err("a segment");
    assert_eq!(error.to_string(), SEGMENT_2446_STAYS);
}

/// The 4.5 sample with Ithomes Gate's three habitats named by their hosts' flags, as a built
/// habitat's host is, and the system's `has_habitat`.
fn flagged_habitats() -> Session {
    open_4_5_edited(|text| {
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

/// The 4.5 sample with a row 16 of type `kind` in Lachium.
fn lachium_with_row(kind: &str) -> Session {
    open_4_5_edited(|text| {
        megastructure_row(text, 16, kind, LACHIUM, "");
        insert_after(
            text,
            &["\ngalactic_object=\n{\n", "\n\t203=\n\t{\n", "\t\t\t10 11 "],
            "16 ",
        );
    })
}

/// A row is part of a ring world as the install says for a type it defines, and by its key
/// for any other. A mod's frame section, named like no base game row, is refused on its own
/// and goes with the ring, and a type the install keeps out of rings goes alone.
#[test]
fn the_installs_ring_world_types_decide_which_rows_are_rings() {
    let types = RingWorldTypes::new([
        ("my_ring_frame".to_owned(), true),
        ("ring_world_monument".to_owned(), false),
    ]);
    let alone = Op::DeleteMegastructure {
        megastructure: 16,
        dismantle: None,
    };
    let mut framed = lachium_with_row("my_ring_frame");
    framed.set_ring_world_types(types.clone());
    assert_refusals(
        &mut framed,
        [
            (
                alone.clone(),
                "megastructure 16 cannot be deleted: it is part of a ring world: delete the ring world",
            ),
            (
                Op::MoveMegastructure {
                    megastructure: 16,
                    at: MegastructurePlace::Free { x: 5.0, y: 5.0 },
                },
                "megastructure 16 cannot be moved: it is part of a ring world, which stands where it is",
            ),
        ],
    );
    let result = framed.apply(delete(LACHIUM)).expect("the ring");
    assert!(
        result.entry.description.contains("and 3 sections"),
        "{}",
        result.entry.description
    );

    lachium_with_row("my_ring_frame")
        .apply(alone.clone())
        .expect("by its key, no ring row");
    let mut monument = lachium_with_row("ring_world_monument");
    monument.set_ring_world_types(types);
    monument
        .apply(alone)
        .expect("the install keeps it out of rings");
}
