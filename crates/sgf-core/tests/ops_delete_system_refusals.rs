//! What refuses the deletion of a system a 4.6 save held: what it holds, what names it from
//! elsewhere, and the save's version.

use std::collections::BTreeMap;

use sgf_core::ops::{EventTargetOf, Op};
use sgf_core::views::Capabilities;

use crate::common;
use crate::ops_delete_system::{
    BESIDE, CROSSROADS, IN_NEBULA, NEXT, OCCIDAN, delete, open_4_6_edited,
};
use common::diff::round_trip;
use common::edit::{insert_after, replace_once};
use common::{SAMPLE_4_6, assert_refusals, open_4_5, open_4_6, open_edited_sample};

/// What the refusal of system `system` for holding `holds` says.
fn kept(system: u32, holds: &str) -> String {
    format!("system {system} cannot be deleted: {holds}, and that hasn't been tested in game")
}

/// The sample with `insert` written after the last of `anchors` refuses [`OCCIDAN`]'s deletion
/// for `holds`, and goes on taking [`CROSSROADS`]'s.
#[track_caller]
fn refused_with(anchors: &[&str], insert: &str, holds: &str) {
    let mut session = open_4_6_edited(|text| insert_after(text, anchors, insert));
    let message = kept(OCCIDAN, holds);
    assert_refusals(&mut session, [(delete(OCCIDAN), message.as_str())]);
    assert_eq!(session.check_op(&delete(CROSSROADS)), None, "{insert}");
}

/// The sample with the `from` that follows the last of `anchors` made `to` refuses
/// [`OCCIDAN`]'s deletion for `holds`, and goes on taking [`CROSSROADS`]'s.
#[track_caller]
fn refused_where(anchors: &[&str], from: &str, to: &str, holds: &str) {
    let mut session = open_4_6_edited(|text| {
        let mut at = 0;
        for anchor in anchors {
            at += text[at..]
                .find(anchor)
                .unwrap_or_else(|| panic!("{anchor:?}"));
        }
        at += text[at..].find(from).unwrap_or_else(|| panic!("{from:?}"));
        text.replace_range(at..at + from.len(), to);
    });
    let message = kept(OCCIDAN, holds);
    assert_refusals(&mut session, [(delete(OCCIDAN), message.as_str())]);
    assert_eq!(session.check_op(&delete(CROSSROADS)), None, "{to}");
}

/// Each thing in a system that refuses its deletion, as the sample holds it, one the sample
/// lacks made by hand, and one added in the session.
#[test]
fn what_is_refused() {
    let owner = kept(28, "it has an owner");
    let sector = kept(459, "it has an owner");
    let colony = kept(86, "it has a colony");
    let fleet = kept(16, "it has a fleet in it");
    let bypass = kept(6, "it has a wormhole, gateway or other bypass");
    let megastructure = kept(17, "it has a megastructure");
    assert_refusals(
        &mut open_4_6(),
        [
            (delete(28), owner.as_str()),
            (delete(459), &sector),
            (delete(86), &colony),
            (delete(16), &fleet),
            (delete(6), &bypass),
            (delete(17), &megastructure),
            (delete(NEXT), "system 600 does not exist"),
        ],
    );

    let mut starbase = open_4_6_edited(|text| {
        insert_after(
            text,
            &[
                "\ngalactic_object=\n",
                "\n\t516=\n",
                "\t\tstarbases=\n\t\t{\n\t\t\t",
            ],
            "9999 ",
        );
    });
    let message = kept(OCCIDAN, "it has a starbase");
    assert_refusals(&mut starbase, [(delete(OCCIDAN), message.as_str())]);

    let mut paired = open_4_6();
    paired
        .apply(Op::AddWormholePair {
            a: OCCIDAN,
            b: CROSSROADS,
            at: None,
        })
        .expect("add a pair");
    let bypass = kept(OCCIDAN, "it has a wormhole, gateway or other bypass");
    assert_refusals(&mut paired, [(delete(OCCIDAN), bypass.as_str())]);
}

/// A cosmic storm over a system, in its own `storm` key or among a storm's systems, and one
/// with the system on its path.
#[test]
fn a_cosmic_storm_refuses_the_deletion() {
    let holds = "a cosmic storm is on it or has it on its path";
    let occidan = ["\ngalactic_object=\n", "\n\t516=\n"];
    refused_where(&occidan, "\t\tstorm=4294967295\n", "\t\tstorm=0\n", holds);
    let storms = ["\nstorms=\n{\n\tstorms=\n\t{\n"];
    for body in [
        "\t\t\tcluster=\n\t\t\t{\n\t\t\t\tobjects=\n\t\t\t\t{\n\t\t\t\t\t77 516 \n\t\t\t\t}\n\t\t\t}\n",
        "\t\t\tpath=\n\t\t\t{\n\t\t\t\t77 516 \n\t\t\t}\n",
    ] {
        let storm =
            format!("\t\t0=\n\t\t{{\n\t\t\ttype=\"gravity_storm\"\n{body}\t\t}}\n\t\t1=none\n");
        refused_with(&storms, &storm, holds);
    }
}

/// A fleet standing elsewhere that names the system or a planet in it: where it is going, the
/// way there, its orders, and where it last jumped, fought or went missing.
#[test]
fn a_fleet_outside_that_names_the_system_refuses_the_deletion() {
    let holds = "a fleet outside it has it in its course, its orders or its past";
    let fleet = ["\nfleet=\n", "\n\t0=\n"];
    let (null, here) = ("origin=4294967295", "origin=516");
    for block in [
        &["\t\tmia_from=\n"] as &[&str],
        &["\t\tcombat=\n", "\t\t\tcoordinate=\n"],
        &["\t\tcombat=\n", "\t\t\tstart_coordinate=\n"],
        &["\t\tmovement_manager=\n", "\t\t\ttarget=\n"],
        &["\t\tmovement_manager=\n", "\t\t\ttarget_coordinate=\n"],
        &["\t\tmovement_manager=\n", "\t\t\tlast_ftl_jump=\n"],
    ] {
        refused_where(&[&fleet, block].concat(), null, here, holds);
    }
    let last_jump = [&fleet[..], &["\t\t\t\tjump_method=jump_count\n"]].concat();
    refused_with(&last_jump, "\t\t\t\tto=516\n", holds);
    let path = [&fleet[..], &["\t\t\tpath=\n\t\t\t{\n"]].concat();
    let node = "\t\t\t\tnode=\n\t\t\t\t{\n\t\t\t\t\tcoordinate=\n\t\t\t\t\t{\n\t\t\t\t\t\tx=0\n\t\t\t\t\t\ty=0\n\t\t\t\t\t\torigin=516\n\t\t\t\t\t}\n\t\t\t\t}\n";
    refused_with(&path, node, holds);
    let orders = [&fleet[..], &["\t\tcommanding_armada=none\n"]].concat();
    for (key, body) in [
        ("current_order", "colonize_planet_order={ planet=5440 }"),
        (
            "current_order",
            "survey_planet_order={ deposit_holder={ type=0 id=5440 } }",
        ),
        (
            "order",
            "aggressive_stance_fleet_order={ return_coordinate={ target={ type=2 id=5440 } } }",
        ),
        (
            "order",
            "merge_fleet_order={ sub_order={ move_to_system_point_order={ coordinate={ x=0 y=0 origin=516 } } } }",
        ),
        (
            "auto_movement",
            "type=auto_move_planet auto_move_target=5440",
        ),
        (
            "actions",
            "repeat={ current={ find_planet={ planet=5440 } } }",
        ),
    ] {
        refused_with(&orders, &format!("\t\t{key}={{ {body} }}\n"), holds);
    }
    for other in [
        "current_order={ survey_planet_order={ deposit_holder={ type=1 id=5440 } } }",
        "order={ aggressive_stance_fleet_order={ return_coordinate={ target={ type=3 id=5440 } } } }",
        "order={ follow_order={ fleet=516 } }",
    ] {
        let session =
            open_4_6_edited(|text| insert_after(text, &orders, &format!("\t\t{other}\n")));
        assert_eq!(session.check_op(&delete(OCCIDAN)), None, "{other}");
    }
}

/// An astral rift or a psionic aura in the system, by its row or the system's own key.
#[test]
fn a_rift_or_an_aura_refuses_the_deletion() {
    let occidan = [
        "\ngalactic_object=\n",
        "\n\t516=\n",
        "\t\touter_radius=350\n",
    ];
    let rift = "it has an astral rift";
    refused_with(
        &occidan,
        "\t\tastral_rifts=\n\t\t{\n\t\t\t0 \n\t\t}\n",
        rift,
    );
    refused_with(
        &["\nastral_rifts=\n{\n\trifts=\n\t{\n"],
        "\t\t0=\n\t\t{\n\t\t\tcoordinate=\n\t\t\t{\n\t\t\t\torigin=516\n\t\t\t}\n\t\t}\n\t\t1=none\n",
        rift,
    );
    let aura = "it has a psionic aura";
    refused_with(&occidan, "\t\tpsionic_aura=0\n", aura);
    refused_with(
        &["\npsionic_auras=\n{\n\tpsionic_auras=\n\t{\n"],
        "\t\t0=\n\t\t{\n\t\t\tcountry=0\n\t\t\tsystem=516\n\t\t}\n\t\t1=none\n",
        aura,
    );
}

#[test]
fn an_empires_starting_system_is_refused() {
    let from = "\t\tstarting_system=349\n";
    let to = "\t\tstarting_system=516\n";
    refused_where(
        &["\ncountry=\n"],
        from,
        to,
        "it is an empire's starting system",
    );
}

/// What names the system or a planet in it from outside: a dig site, a saved event target and
/// a country's list of the anomalies it found, whether the save held it or an op added it.
#[test]
fn what_names_the_system_refuses_the_deletion() {
    let site = "it has a dig site";
    refused_where(
        &["\narchaeological_sites=\n", "\t\t0=\n"],
        "\t\t\t\tid=566\n",
        "\t\t\t\tid=5440\n",
        site,
    );
    let target = "a saved event target names it or something in it";
    for (kind, id) in [("galactic_object", 516), ("planet", 5440)] {
        refused_with(
            &[
                "\nsaved_event_target=\n{\n\ttype=fleet\n\tid=156\n\topener_id=4294967295\n\tname=\"CaravaneerCustomCapital\"\n}\n",
            ],
            &format!(
                "saved_event_target=\n{{\n\ttype={kind}\n\tid={id}\n\topener_id=4294967295\n\tname=\"sgf_test\"\n}}\n"
            ),
            target,
        );
    }
    // An ambient object standing in the system is the target.
    let platform = kept(101, target);
    assert_refusals(&mut open_4_6(), [(delete(101), platform.as_str())]);
    let anomaly = "a country has found an anomaly in it";
    let added = [
        (
            Op::AddDigSite {
                body: 5448,
                site_type: "site_lost_moments".to_owned(),
                difficulty: 1,
            },
            site,
        ),
        (
            Op::AddEventTarget {
                name: "sgf_test".to_owned(),
                target: EventTargetOf::System { system: OCCIDAN },
            },
            target,
        ),
        (
            Op::AddAnomaly {
                body: 5448,
                category: "frozen_uninhabitable_category".to_owned(),
                found_by: Some(vec![0]),
            },
            anomaly,
        ),
    ];
    for (op, holds) in added {
        let mut session = open_4_6();
        session.apply(op).expect("add");
        let message = kept(OCCIDAN, holds);
        assert_refusals(&mut session, [(delete(OCCIDAN), message.as_str())]);
        session.undo().expect("undo").expect("the add");
        round_trip(session, delete(OCCIDAN));
    }
}

/// How many of the sample's 600 systems can be deleted, and why each of the others can't. The
/// counts are the 4.6 sample's own. Of the 470 whose own entry and bodies hold nothing that
/// refuses, a saved event target keeps four and a dig site one.
#[test]
fn what_the_sample_accepts() {
    let session = open_4_6();
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for &id in &session.graph().order {
        let why = session.check_op(&delete(id)).map(|message| {
            message
                .strip_prefix(&format!("system {id} cannot be deleted: "))
                .and_then(|why| why.strip_suffix(", and that hasn't been tested in game"))
                .map(str::to_owned)
                .unwrap_or_else(|| panic!("{message}"))
        });
        *counts.entry(why.unwrap_or_default()).or_default() += 1;
    }
    let expected = [
        ("", 465),
        ("a saved event target names it or something in it", 4),
        ("it has a colony", 8),
        ("it has a dig site", 1),
        ("it has a fleet in it", 80),
        ("it has a megastructure", 3),
        ("it has a wormhole, gateway or other bypass", 12),
        ("it has an owner", 27),
    ];
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
