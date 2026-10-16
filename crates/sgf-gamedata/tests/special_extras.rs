//! A special system added to a save with what its own script makes, on the sample install:
//! Seddom with its anomaly and its planets' flags, and Tiyun Ort with its anomaly, its dig
//! site and its global event target, each one batch that undoes byte for byte, and the card
//! that says what each comes with and without.

use crate::common;

use std::fmt::Write as _;

use sgf_core::ops::{EventTargetOf, Op};
use sgf_core::overlay::Anchor;
use sgf_core::session::Session;
use sgf_gamedata::body_effects::LeftOut;
use sgf_gamedata::generate::special_op;
use sgf_gamedata::summary::{Planting, PlantingKind, layout_summary};

use common::{SPOT, open_4_5, open_4_5_edited, sample_install};

const SEDDOM: &str = "breachsealer_system";
const TIYUN_ORT: &str = "hostile_init_21";
/// The target Tiyun Ort's script saves, which the 4.5 sample's own Tiyun Ort holds.
const GRAVEYARD: &str = "tiyanki_graveyard_system";
/// The id a system added to the 4.5 sample takes.
const NEW: u32 = 601;

fn special(session: &Session, layout: &str, extras: bool) -> Op {
    special_op(sample_install(), session, 1, SPOT, layout, extras).expect("the op")
}

fn members(op: &Op) -> Vec<&Op> {
    match op {
        Op::Batch { ops, .. } => ops.iter().collect(),
        other => vec![other],
    }
}

fn names(op: &Op) -> Vec<&'static str> {
    members(op).iter().map(|op| op.name()).collect()
}

fn current(session: &Session) -> Vec<u8> {
    session.doc().pieces().collect::<Vec<_>>().concat()
}

/// Every slot the session wrote, in file order: the line it stands at, what it replaced and
/// what it now holds.
fn written(session: &Session) -> String {
    let doc = session.doc();
    let original = doc.original();
    let mut out = String::new();
    for (anchor, bytes) in doc.overlay().slots() {
        let line = original[..anchor.start()]
            .iter()
            .filter(|&&b| b == b'\n')
            .count()
            + 1;
        writeln!(out, "@@ line {line}").unwrap();
        if let Anchor::Original(span) = anchor {
            for old in String::from_utf8_lossy(span.slice(original)).lines() {
                writeln!(out, "-{old}").unwrap();
            }
        }
        for new in String::from_utf8_lossy(bytes).lines() {
            writeln!(out, "+{new}").unwrap();
        }
    }
    out
}

/// Apply `op`, snapshot what it wrote as `name`, and undo it back to the original bytes.
fn applied(session: &mut Session, name: &str, op: Op) -> String {
    let result = session.apply(op).expect("the add");
    let text = written(session);
    let report = format!("{}\n{text}", result.entry.description);
    insta::with_settings!({snapshot_path => "snapshots/special_extras", prepend_module_to_snapshot => false}, {
        insta::assert_snapshot!(name, report);
    });
    session.undo().expect("undo").expect("the add");
    assert_eq!(current(session), session.doc().original(), "{name}: undo");
    session.redo().expect("redo").expect("the add");
    text
}

#[test]
fn seddom_comes_with_its_anomaly_and_its_planets_flags() {
    let mut session = open_4_5();
    let op = special(&session, SEDDOM, true);
    assert_eq!(names(&op), ["AddSystemFromSpec", "AddAnomaly"]);
    let Op::AddAnomaly { category, .. } = members(&op)[1] else {
        unreachable!()
    };
    assert_eq!(category, "BREACHSEALER_CAT");
    let text = applied(&mut session, "seddom", op);
    assert!(text.contains("+\t\t\t\tplanet_Ariph=62808000"));
    assert!(text.contains("+\t\t\t\tstar_seddom=62808000"));
    assert!(text.contains("+\t\t\tanomaly=\"BREACHSEALER_CAT\""));
    assert!(
        text.contains("natural_spectacle_system"),
        "a converted layout keeps every star flag but those of an empire's start"
    );
}

#[test]
fn without_extras_seddom_keeps_its_flags_and_leaves_its_anomaly() {
    let session = open_4_5();
    let op = special(&session, SEDDOM, false);
    assert_eq!(names(&op), ["AddSystemFromSpec"]);
    let Op::AddSystemFromSpec { spec } = &op else {
        unreachable!()
    };
    let ariph = spec
        .planets
        .iter()
        .find(|p| p.name.as_deref() == Some("NAME_Ariph"));
    assert_eq!(
        ariph.expect("Ariph").flags,
        ["planet_Ariph", "suppress_archaeological_sites"]
    );
}

/// The 4.5 sample holds Tiyun Ort's target, so the add leaves it to the one there; on a
/// save without it, the new system takes it.
#[test]
fn tiyun_ort_comes_with_its_anomaly_its_dig_site_and_its_target() {
    let mut session = open_4_5();
    let op = special(&session, TIYUN_ORT, true);
    assert_eq!(
        names(&op),
        ["AddSystemFromSpec", "AddAnomaly", "AddDigSite"],
        "the sample's own Tiyun Ort keeps {GRAVEYARD}"
    );
    let Op::AddDigSite {
        site_type,
        difficulty,
        ..
    } = members(&op)[2]
    else {
        unreachable!()
    };
    assert_eq!(
        (site_type.as_str(), *difficulty),
        ("site_tiyanki_graveyard", 3)
    );
    let text = applied(&mut session, "tiyun_ort", op);
    assert!(text.contains("+\t\t\t\tgraveyard_site=62808000"));
    assert!(text.contains("+\t\t\ttype=\"site_tiyanki_graveyard\""));

    let renamed = format!("name=\"{GRAVEYARD}\"");
    let mut session = open_4_5_edited(|gamestate| {
        *gamestate = gamestate.replacen(&renamed, "name=\"sgf_other_graveyard\"", 1);
    });
    let op = special(&session, TIYUN_ORT, false);
    assert_eq!(names(&op), ["AddSystemFromSpec", "AddEventTarget"]);
    assert_eq!(
        members(&op)[1],
        &Op::AddEventTarget {
            name: GRAVEYARD.to_owned(),
            target: EventTargetOf::System { system: NEW },
        }
    );
    session.apply(op).expect("the add");
    assert!(
        session
            .save("reading event targets")
            .expect("a 4.x save")
            .holds_event_target(GRAVEYARD)
    );
}

#[test]
fn the_card_says_what_each_comes_with_and_without() {
    let gd = sample_install();
    let session = open_4_5();
    let planting = |kind: PlantingKind, key: &str| Planting {
        kind,
        key: key.to_owned(),
        name: gd.loc.name_or_readable(key),
    };

    let seddom = layout_summary(gd, SEDDOM, &session).expect("Seddom's card");
    assert_eq!(
        seddom.comes_with,
        [planting(PlantingKind::Anomaly, "BREACHSEALER_CAT")]
    );
    assert_eq!(
        seddom.comes_without,
        [LeftOut::SpawnedPlanets, LeftOut::AmbientObjects],
        "Huanghun is spawned by the system's script"
    );
    assert!(!seddom.story_kept_by_existing);

    let tiyun_ort = layout_summary(gd, TIYUN_ORT, &session).expect("Tiyun Ort's card");
    assert_eq!(
        tiyun_ort.comes_with,
        [
            planting(PlantingKind::DigSite, "site_tiyanki_graveyard"),
            planting(PlantingKind::Anomaly, "TIYANKI_ASTEROID_CAT"),
        ]
    );
    assert_eq!(
        tiyun_ort.comes_without,
        [LeftOut::Fleets, LeftOut::AmbientObjects]
    );
    assert!(
        tiyun_ort.story_kept_by_existing,
        "the sample's own Tiyun Ort holds {GRAVEYARD}"
    );
}
