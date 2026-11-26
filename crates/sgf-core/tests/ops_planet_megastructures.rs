//! The rows a planet names, which Stellaris 4.6 lists in `megastructures` where 4.5.4 and
//! earlier write one `megastructure`, on the 4.6 sample: the list each op writes or takes an
//! id from, byte-exact undo, and the refusals that read it.

use sgf_core::ops::{
    ClassChange, HabitatOrbital, MegastructurePlace, NewHabitat, NewMegastructure,
    NewMegastructurePlace, Op, PlanetClassRule,
};
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip, round_trip_step, snapshot_step};
use common::edit::{insert_after, planet_text, replace_once};
use common::examples::sol_habitat;
use common::{SAMPLE_4_6, assert_refusals, open_4_6, open_edited_sample, reopened, text};

/// Trabano: stars 511, which names row 1, 512 and 513, and planets 514 to 526.
const TRABANO: u32 = 17;
/// The slot past the 4.6 sample's highest row.
const ADDED: u32 = 15;

/// A planet's list of `ids` as the game writes it.
fn block(ids: &str) -> String {
    format!("\t\t\tmegastructures=\n\t\t\t{{\n\t\t\t\t{ids} \n\t\t\t}}\n")
}

/// [`block`] with the key that follows.
fn list(ids: &str) -> String {
    format!("{}\t\t\tbombardment_damage=0\n", block(ids))
}

/// `keys` written after `planet`'s `planet_orbitals`.
fn naming(text: &mut String, planet: u32, keys: &str) {
    insert_after(
        text,
        &[
            &format!("\n\t\t{planet}=\n\t\t{{\n"),
            "\t\t\tplanet_orbitals=\n\t\t\t{\n\t\t\t}\n",
        ],
        keys,
    );
}

/// Row `id` at `planet` of Trabano, after the last row.
fn row(text: &mut String, id: u32, planet: u32) {
    replace_once(
        text,
        "\n}\nbypasses=\n",
        &format!(
            "\n\t{id}=\n\t{{\n\t\ttype=\"habitat_minor_orbital\"\n\t\tcoordinate=\n\t\t{{\n\t\t\tx=10\n\t\t\ty=20\n\t\t\torigin={TRABANO}\n\t\t\trandomized=no\n\t\t}}\n\t\tplanet={planet}\n\t\torbitals=\n\t\t{{\n\t\t}}\n\t\tbuild_queue=4294967295\n\t\tdismantle_progress=0\n\t\tdismantle_finish_date=\"0.01.01\"\n\t}}\n}}\nbypasses=\n"
        ),
    );
}

/// The 4.6 sample with row 15 at star 511 too, after row 1 in its list.
fn two_at_the_star() -> Session {
    open_edited_sample(SAMPLE_4_6, |text, _| {
        replace_once(
            text,
            "\t\t\tmegastructures=\n\t\t\t{\n\t\t\t\t1 \n",
            "\t\t\tmegastructures=\n\t\t\t{\n\t\t\t\t1 15 \n",
        );
        row(text, 15, 511);
    })
}

fn add(body: u32) -> Op {
    Op::AddMegastructure {
        system: TRABANO,
        spec: NewMegastructure {
            kind: "think_tank_3".to_owned(),
            at: NewMegastructurePlace::Body {
                body,
                body_flags: vec!["has_megastructure".to_owned()],
                star_only: false,
            },
            ..NewMegastructure::default()
        },
    }
}

fn delete(megastructure: u32) -> Op {
    Op::DeleteMegastructure {
        megastructure,
        dismantle: None,
    }
}

fn to_body(megastructure: u32, body: u32) -> Op {
    Op::MoveMegastructure {
        megastructure,
        at: MegastructurePlace::Body { body },
    }
}

#[test]
fn an_added_row_is_listed() {
    let mut session = open_4_6();
    snapshot_step(&mut session, "added", add(518));
    assert!(planet_text(&session, 518).contains(&list("15")));
    round_trip(open_4_6(), add(518));
    let mut session = reopened(&mut session);
    snapshot_step(&mut session, "added_then_deleted", delete(ADDED));
    let planet = planet_text(&session, 518);
    assert!(!planet.contains("megastructure"), "{planet}");
}

#[test]
fn a_planet_that_lists_a_row_takes_no_other() {
    assert_refusals(
        &mut open_4_6(),
        [(
            add(511),
            "a think_tank_3 cannot be added there: Trabano #511 already has megastructure 1",
        )],
    );
}

#[test]
fn a_deleted_row_leaves_its_list() {
    let mut session = open_4_6();
    snapshot_step(&mut session, "deleted", delete(1));
    let star = planet_text(&session, 511);
    assert!(!star.contains("megastructures="), "{star}");
    round_trip(open_4_6(), delete(1));
    session.apply(add(511)).expect("the star is free");
    assert!(planet_text(&session, 511).contains(&list("15")));
}

#[test]
fn a_deleted_row_leaves_the_others_listed() {
    let mut session = two_at_the_star();
    snapshot_step(&mut session, "deleted_first", delete(1));
    assert!(planet_text(&session, 511).contains(&list("15")));
    round_trip(two_at_the_star(), delete(1));

    let mut session = two_at_the_star();
    session.apply(delete(15)).expect("the last");
    assert!(planet_text(&session, 511).contains(&list("1")));
    round_trip(two_at_the_star(), delete(15));
}

#[test]
fn a_moved_row_leaves_one_list_for_another() {
    let mut session = open_4_6();
    snapshot_step(&mut session, "moved", to_body(1, 514));
    let star = planet_text(&session, 511);
    assert!(!star.contains("megastructures="), "{star}");
    assert!(planet_text(&session, 514).contains(&list("1")));
    round_trip(open_4_6(), to_body(1, 514));

    session.apply(delete(1)).expect("the moved row");
    let planet = planet_text(&session, 514);
    assert!(!planet.contains("megastructure"), "{planet}");
}

/// Row 999 is none of the table's, so star 512 takes another, after it in the list.
#[test]
fn a_moved_row_is_listed_after_what_the_planet_lists() {
    let stale = || {
        open_edited_sample(SAMPLE_4_6, |text, _| {
            naming(
                text,
                512,
                "\t\t\tmegastructures=\n\t\t\t{\n\t\t\t\t999 \n\t\t\t}\n",
            );
        })
    };
    let mut session = stale();
    session.apply(to_body(1, 512)).expect("the move");
    assert!(planet_text(&session, 512).contains(&list("999 1")));
    round_trip(stale(), to_body(1, 512));
}

/// 0.27.8 wrote `megastructure=<id>` in a 4.6 save, where the game writes a list.
#[test]
fn a_planet_naming_one_row_the_old_way_keeps_the_form() {
    let scalar = || {
        open_edited_sample(SAMPLE_4_6, |text, _| {
            naming(text, 514, "\t\t\tmegastructure=15\n");
            row(text, 15, 514);
        })
    };
    let mut session = scalar();
    session.apply(delete(15)).expect("the row");
    let planet = planet_text(&session, 514);
    assert!(!planet.contains("megastructure"), "{planet}");
    round_trip(scalar(), delete(15));

    let mut session = scalar();
    session.apply(to_body(15, 516)).expect("the move");
    assert!(planet_text(&session, 516).contains(&list("15")));
    session.apply(to_body(1, 514)).expect("the move");
    assert!(planet_text(&session, 514).contains(&list("1")));

    let stale = || {
        open_edited_sample(SAMPLE_4_6, |text, _| {
            naming(text, 514, "\t\t\tmegastructure=999\n");
        })
    };
    let mut session = stale();
    session.apply(to_body(1, 514)).expect("the move");
    let planet = planet_text(&session, 514);
    assert!(planet.contains("\t\t\tmegastructure=1\n"), "{planet}");
    assert!(!planet.contains("megastructures="), "{planet}");
    round_trip(stale(), to_body(1, 514));
}

/// A row's id is listed from 4.6, whatever the minor version's digits.
#[test]
fn the_saves_version_picks_the_form() {
    for (version, listed) in [
        ("v4.5.4", false),
        ("v4.6", true),
        ("4.6.0", true),
        ("Corona Borealis v4.10.1", true),
        ("v5.0.0", true),
    ] {
        let save = || {
            open_edited_sample(SAMPLE_4_6, |_, meta| {
                replace_once(meta, "Corona Borealis v4.6.0", version);
            })
        };
        let mut session = save();
        session.apply(add(518)).expect("the add");
        let planet = planet_text(&session, 518);
        assert_eq!(planet.contains(&list("15")), listed, "{version}: {planet}");
        let scalar = planet.contains("\t\t\tmegastructure=15\n");
        assert_eq!(scalar, !listed, "{version}: {planet}");
        round_trip(save(), add(518));
    }
}

#[test]
fn a_planet_naming_rows_both_ways_is_read_and_written_in_its_list() {
    let both = || {
        open_edited_sample(SAMPLE_4_6, |text, _| {
            naming(
                text,
                514,
                "\t\t\tmegastructure=15\n\t\t\tmegastructures=\n\t\t\t{\n\t\t\t\t15 999 \n\t\t\t}\n",
            );
            row(text, 15, 514);
        })
    };
    let mut session = both();
    session.apply(delete(15)).expect("the row");
    let planet = planet_text(&session, 514);
    assert!(!planet.contains("megastructure="), "{planet}");
    assert!(planet.contains(&list("999")), "{planet}");
    round_trip(both(), delete(15));

    let stale = || {
        open_edited_sample(SAMPLE_4_6, |text, _| {
            naming(
                text,
                514,
                "\t\t\tmegastructure=998\n\t\t\tmegastructures=\n\t\t\t{\n\t\t\t\t999 \n\t\t\t}\n",
            );
        })
    };
    let mut session = stale();
    session.apply(to_body(1, 514)).expect("the move");
    let planet = planet_text(&session, 514);
    assert!(planet.contains("\t\t\tmegastructure=998\n"), "{planet}");
    assert!(planet.contains(&list("999 1")), "{planet}");
    round_trip(stale(), to_body(1, 514));
}

#[test]
fn an_empty_list_holds_nothing_and_takes_a_row() {
    for empty in [
        "\t\t\tmegastructures=\n\t\t\t{\n\t\t\t}\n",
        "\t\t\tmegastructures={}\n",
    ] {
        let save = || open_edited_sample(SAMPLE_4_6, |text, _| naming(text, 518, empty));
        let mut session = save();
        session.apply(add(518)).expect("the add");
        let planet = planet_text(&session, 518);
        assert!(planet.contains(&list("15")), "{planet}");
        round_trip(save(), add(518));
    }
}

/// Planet 514's class change and its move to another system.
fn class_and_system() -> [Op; 2] {
    let rule = |class: &str| PlanetClassRule {
        class: class.to_owned(),
        change: ClassChange::Uncolonised,
        models: 3,
    };
    [
        Op::SetBodyClass {
            body: 514,
            from: rule("pc_barren_cold"),
            to: rule("pc_barren"),
            look: None,
        },
        Op::MoveBodyToSystem {
            body: 514,
            to: 24,
            at: None,
        },
    ]
}

const STAYS: [&str; 2] = [
    "planet 514 has a megastructure, so it keeps its class",
    "planet 514 has a megastructure, so it cannot be moved or copied",
];

/// The 4.6 sample with `keys` written where planet 514 names its rows.
fn naming_514(keys: &str) -> Session {
    open_edited_sample(SAMPLE_4_6, |text, _| naming(text, 514, keys))
}

/// Planet 514 lists row 15, which stands there, so it stays in its system and keeps its class.
#[test]
fn a_planet_that_lists_a_row_stays_as_it_is() {
    let mut session = open_edited_sample(SAMPLE_4_6, |text, _| {
        naming(text, 514, &block("999 15"));
        row(text, 15, 514);
    });
    assert_refusals(&mut session, class_and_system().into_iter().zip(STAYS));
}

/// What 0.27.8 left in a list when it deleted row 999 or moved row 1 away: neither stands on
/// the planet.
#[test]
fn a_list_naming_no_row_on_the_planet_holds_nothing() {
    for ids in ["999", "1", "999 1"] {
        let save = || naming_514(&block(ids));
        let session = save();
        for op in class_and_system() {
            assert_eq!(session.check_op(&op), None, "{ids}");
            round_trip(save(), op);
        }
        let mut session = save();
        session.apply(add(514)).expect("the add");
        let planet = planet_text(&session, 514);
        assert!(planet.contains(&list(&format!("{ids} 15"))), "{planet}");
        round_trip(save(), add(514));
    }
}

/// A row 0.27.8 wrote or left in the old form still holds its planet.
#[test]
fn a_planet_naming_a_row_the_old_way_stays_as_it_is() {
    let mut session = naming_514("\t\t\tmegastructure=999\n");
    assert_refusals(&mut session, class_and_system().into_iter().zip(STAYS));
}

#[test]
fn a_row_moved_back_to_a_list_that_kept_its_id_is_listed_once() {
    for ids in ["1", "999 1"] {
        let save = || naming_514(&block(ids));
        let mut session = save();
        session.apply(to_body(1, 514)).expect("the move");
        let planet = planet_text(&session, 514);
        assert!(planet.contains(&list(ids)), "{planet}");
        round_trip(save(), to_body(1, 514));
    }
}

#[test]
fn a_deleted_row_leaves_a_list_it_was_left_in_too() {
    let save = || naming_514(&block("999 1"));
    let mut session = save();
    session.apply(delete(1)).expect("the row");
    assert!(planet_text(&session, 514).contains(&list("999")));
    round_trip(save(), delete(1));
}

/// The orbital a habitat's add writes is listed by the host, and goes with the habitat.
#[test]
fn a_habitats_orbital_is_listed_by_its_host() {
    let Op::AddHabitat { habitat, .. } = sol_habitat() else {
        unreachable!("sol_habitat adds a habitat");
    };
    let restored = Op::AddHabitat {
        body: 518,
        habitat: NewHabitat {
            orbital: Some(HabitatOrbital {
                kind: "habitat_major_orbital".to_owned(),
                owner: None,
                culture: None,
                name: None,
                system_name: None,
            }),
            ..habitat
        },
    };
    let mut session = open_4_6();
    let result = round_trip_step(&mut session, "the habitat", restored.clone());
    let planet = planet_text(&session, 518);
    assert!(planet.contains(&list("15")), "{planet}");
    round_trip(open_4_6(), restored);
    let habitat = result.created.planets[0];
    round_trip_step(
        &mut session,
        "its deletion",
        Op::DeleteBody { body: habitat },
    );
    let planet = planet_text(&session, 518);
    assert!(!planet.contains("megastructures="), "{planet}");
    assert!(
        !text(&session).contains("habitat_major_orbital"),
        "the orbital went with its habitat"
    );
}
