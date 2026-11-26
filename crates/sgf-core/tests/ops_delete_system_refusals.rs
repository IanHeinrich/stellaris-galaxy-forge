//! What refuses the deletion of a system a 4.6 save held: an empire's capital or starting
//! system, a row added since the file was opened, and the save's version. What names the
//! system from elsewhere refuses nothing.

use std::collections::BTreeMap;

use sgf_core::ops::{EventTargetOf, Op};
use sgf_core::views::Capabilities;

use crate::common;
use crate::ops_add_megastructure::on_body;
use crate::ops_delete_system::{
    BESIDE, CROSSROADS, IN_NEBULA, NEXT, OCCIDAN, delete, open_4_6_edited,
};
use common::diff::round_trip;
use common::edit::{insert_after, replace_once};
use common::{SAMPLE_4_6, assert_refusals, open_4_5, open_4_6, open_edited_sample};

/// The sample with `insert` written after the last of `anchors` takes [`OCCIDAN`]'s deletion
/// and its undo.
#[track_caller]
fn taken_with(anchors: &[&str], insert: &str) {
    let session = open_4_6_edited(|text| insert_after(text, anchors, insert));
    round_trip(session, delete(OCCIDAN));
}

/// The sample with the `from` that follows the last of `anchors` made `to` takes
/// [`OCCIDAN`]'s deletion and its undo.
#[track_caller]
fn taken_where(anchors: &[&str], from: &str, to: &str) {
    round_trip(edited_where(anchors, from, to), delete(OCCIDAN));
}

fn edited_where(anchors: &[&str], from: &str, to: &str) -> sgf_core::session::Session {
    open_4_6_edited(|text| {
        let mut at = 0;
        for anchor in anchors {
            at += text[at..]
                .find(anchor)
                .unwrap_or_else(|| panic!("{anchor:?}"));
        }
        at += text[at..].find(from).unwrap_or_else(|| panic!("{from:?}"));
        text.replace_range(at..at + from.len(), to);
    })
}

/// What the sample holds that refuses a deletion, and what an added wormhole pair or
/// megastructure refuses.
#[test]
fn what_is_refused() {
    let capital = "system 459 cannot be deleted: it holds an empire's capital";
    let fallen = "system 196 cannot be deleted: it holds an empire's capital";
    assert_refusals(
        &mut open_4_6(),
        [
            (delete(459), capital),
            (delete(196), fallen),
            (delete(NEXT), "system 600 does not exist"),
        ],
    );

    let mut paired = open_4_6();
    paired
        .apply(Op::AddWormholePair {
            a: OCCIDAN,
            b: CROSSROADS,
            at: None,
        })
        .expect("add a pair");
    let added = "system 516 cannot be deleted: it has a wormhole added since the file was opened, so remove the wormhole first";
    assert_refusals(&mut paired, [(delete(OCCIDAN), added)]);

    let mut built = open_4_6();
    built
        .apply(on_body(OCCIDAN, "think_tank_3", 5440))
        .expect("add a megastructure");
    let added = "system 516 cannot be deleted: it has a megastructure added since the file was opened, so remove it first";
    assert_refusals(&mut built, [(delete(OCCIDAN), added)]);
}

/// A nomad empire's capital arkship refuses its system as a capital does, whether the system
/// lists its starbase or only its station's fleet stands there.
#[test]
fn a_capital_arkship_is_refused() {
    let message = "system 478 cannot be deleted: it holds an empire's capital";
    let mut listed = open_4_6_edited(|text| {
        insert_after(
            text,
            &["\nstarbase_mgr=\n", "\n\t\t13=\n\t\t{\n"],
            "\t\t\ttype=\"sarkship_capital\"\n",
        );
    });
    assert_refusals(&mut listed, [(delete(478), message)]);
    let mut unlisted = open_4_6_edited(|text| {
        insert_after(
            text,
            &["\nstarbase_mgr=\n", "\n\t\t13=\n\t\t{\n"],
            "\t\t\ttype=\"sarkship_capital\"\n",
        );
        let at = text.find("\ngalactic_object=\n").expect("the systems");
        let at = at + text[at..].find("\n\t478=\n").expect("Zowod");
        let at = at
            + text[at..]
                .find("\t\tstarbases=\n\t\t{\n\t\t\t13 \n")
                .expect("its list");
        let list = "\t\tstarbases=\n\t\t{\n\t\t\t13 \n";
        text.replace_range(
            at..at + list.len(),
            "\t\tstarbases=\n\t\t{\n\t\t\t4294967295 \n",
        );
    });
    assert_refusals(&mut unlisted, [(delete(478), message)]);
}

#[test]
fn an_empires_starting_system_is_refused() {
    let mut session = edited_where(
        &["\ncountry=\n"],
        "\t\tstarting_system=349\n",
        "\t\tstarting_system=516\n",
    );
    let message = "system 516 cannot be deleted: it is an empire's starting system, and that hasn't been tested in game";
    assert_refusals(&mut session, [(delete(OCCIDAN), message)]);
}

/// A cosmic storm over a system, in its own `storm` key or among a storm's systems, and one
/// with the system on its path.
#[test]
fn a_cosmic_storm_takes_the_deletion() {
    let occidan = ["\ngalactic_object=\n", "\n\t516=\n"];
    taken_where(&occidan, "\t\tstorm=4294967295\n", "\t\tstorm=0\n");
    let storms = ["\nstorms=\n{\n\tstorms=\n\t{\n"];
    for body in [
        "\t\t\tcluster=\n\t\t\t{\n\t\t\t\tobjects=\n\t\t\t\t{\n\t\t\t\t\t77 516 \n\t\t\t\t}\n\t\t\t}\n",
        "\t\t\tpath=\n\t\t\t{\n\t\t\t\t77 516 \n\t\t\t}\n",
    ] {
        let storm =
            format!("\t\t0=\n\t\t{{\n\t\t\ttype=\"gravity_storm\"\n{body}\t\t}}\n\t\t1=none\n");
        taken_with(&storms, &storm);
    }
}

/// A fleet standing elsewhere that names the system or a planet in it, as where it is going,
/// the way there, its orders, or where it last jumped, fought or went missing, is left as the
/// game leaves it.
#[test]
fn a_fleet_outside_that_names_the_system_takes_the_deletion() {
    let fleet = ["\nfleet=\n", "\n\t0=\n"];
    let (null, here) = ("origin=4294967295", "origin=516");
    for block in [
        &["\t\tmia_from=\n"] as &[&str],
        &["\t\tmovement_manager=\n", "\t\t\ttarget=\n"],
        &["\t\tmovement_manager=\n", "\t\t\tlast_ftl_jump=\n"],
    ] {
        taken_where(&[&fleet, block].concat(), null, here);
    }
    let path = [&fleet[..], &["\t\t\tpath=\n\t\t\t{\n"]].concat();
    let node = "\t\t\t\tnode=\n\t\t\t\t{\n\t\t\t\t\tcoordinate=\n\t\t\t\t\t{\n\t\t\t\t\t\tx=0\n\t\t\t\t\t\ty=0\n\t\t\t\t\t\torigin=516\n\t\t\t\t\t}\n\t\t\t\t}\n";
    taken_with(&path, node);
    let orders = [&fleet[..], &["\t\tcommanding_armada=none\n"]].concat();
    taken_with(
        &orders,
        "\t\tcurrent_order={ colonize_planet_order={ planet=5440 } }\n",
    );
}

/// An astral rift or a psionic aura in the system, by its row or the system's own key.
#[test]
fn a_rift_or_an_aura_takes_the_deletion() {
    let occidan = [
        "\ngalactic_object=\n",
        "\n\t516=\n",
        "\t\touter_radius=350\n",
    ];
    taken_with(&occidan, "\t\tastral_rifts=\n\t\t{\n\t\t\t0 \n\t\t}\n");
    taken_with(
        &["\nastral_rifts=\n{\n\trifts=\n\t{\n"],
        "\t\t0=\n\t\t{\n\t\t\tcoordinate=\n\t\t\t{\n\t\t\t\torigin=516\n\t\t\t}\n\t\t}\n\t\t1=none\n",
    );
    taken_with(&occidan, "\t\tpsionic_aura=0\n");
    taken_with(
        &["\npsionic_auras=\n{\n\tpsionic_auras=\n\t{\n"],
        "\t\t0=\n\t\t{\n\t\t\tcountry=0\n\t\t\tsystem=516\n\t\t}\n\t\t1=none\n",
    );
}

/// What names the system or a planet in it from outside, a dig site, a saved event target or
/// a country's list of the anomalies it found, whether the save held it or an op added it.
#[test]
fn what_names_the_system_takes_the_deletion() {
    taken_where(
        &["\narchaeological_sites=\n", "\t\t0=\n"],
        "\t\t\t\tid=566\n",
        "\t\t\t\tid=5440\n",
    );
    for (kind, id) in [("galactic_object", 516), ("planet", 5440)] {
        taken_with(
            &[
                "\nsaved_event_target=\n{\n\ttype=fleet\n\tid=156\n\topener_id=4294967295\n\tname=\"CaravaneerCustomCapital\"\n}\n",
            ],
            &format!(
                "saved_event_target=\n{{\n\ttype={kind}\n\tid={id}\n\topener_id=4294967295\n\tname=\"sgf_test\"\n}}\n"
            ),
        );
    }
    round_trip(open_4_6(), delete(101));
    for op in [
        Op::AddDigSite {
            body: 5448,
            site_type: "site_lost_moments".to_owned(),
            difficulty: 1,
        },
        Op::AddEventTarget {
            name: "sgf_test".to_owned(),
            target: EventTargetOf::System { system: OCCIDAN },
        },
        Op::AddAnomaly {
            body: 5448,
            category: "frozen_uninhabitable_category".to_owned(),
            found_by: Some(vec![0]),
        },
    ] {
        let mut session = open_4_6();
        session.apply(op).expect("add");
        common::diff::round_trip_step(&mut session, "delete", delete(OCCIDAN));
    }
}

/// How many of the sample's 600 systems can be deleted, and why each of the others can't. The
/// counts are the 4.6 sample's own: the player's starting system holds its capital arkship.
#[test]
fn what_the_sample_accepts() {
    let session = open_4_6();
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for &id in &session.graph().order {
        let why = session.check_op(&delete(id)).map(|message| {
            let why = message
                .strip_prefix(&format!("system {id} cannot be deleted: "))
                .unwrap_or_else(|| panic!("{message}"));
            why.strip_suffix(", and that hasn't been tested in game")
                .unwrap_or(why)
                .to_owned()
        });
        *counts.entry(why.unwrap_or_default()).or_default() += 1;
    }
    let expected = [("", 596), ("it holds an empire's capital", 4)];
    let counts: Vec<(&str, usize)> = counts.iter().map(|(why, &n)| (why.as_str(), n)).collect();
    assert_eq!(counts, expected);
    for system in [OCCIDAN, BESIDE, CROSSROADS, IN_NEBULA] {
        assert_eq!(session.check_op(&delete(system)), None, "{system}");
    }
}

/// Only a game from 4.6 on removes a system, so an older save refuses the deletion and does
/// not offer it.
#[test]
fn a_save_before_4_6_refuses_the_deletion() {
    let mut session = open_4_5();
    assert!(!Capabilities::of(session.doc()).delete_systems);
    let message = "this edit needs a save from Stellaris 4.6 or later, not Cygnus v4.5.0";
    assert_refusals(&mut session, [(delete(0), message)]);
    let message = "this edit needs a save from Stellaris 4.6 or later, not Cepheus v3.4.5";
    assert_refusals(&mut common::open_3_4(), [(delete(0), message)]);
    let with_version = |version: &str| {
        open_edited_sample(SAMPLE_4_6, |_, meta| {
            replace_once(meta, "Corona Borealis v4.6.0", version);
        })
    };
    for (version, offered) in [("4.10.1", true), ("v5.0", true), ("v4", false)] {
        let session = with_version(version);
        let capabilities = Capabilities::of(session.doc());
        assert_eq!(capabilities.delete_systems, offered, "{version}");
        let refused = session.check_op(&delete(OCCIDAN));
        assert_eq!(refused.is_none(), offered, "{version}");
    }
}
