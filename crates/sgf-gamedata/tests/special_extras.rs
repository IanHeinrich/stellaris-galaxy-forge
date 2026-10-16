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
use sgf_gamedata::generate::{SystemAsk, special_op, systems_op};
use sgf_gamedata::summary::{Planting, PlantingKind, layout_summary};

use common::generate::FILES;
use common::prepare::current;
use common::{SPOT, hand_written, open_4_5, open_4_5_edited, sample_install};

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

const SCOPES: &str = "common/solar_system_initializers/01_scopes.txt";

/// Two special layouts on the hand-written install: one plants from a scope its own
/// `init_effect` opens, the other from a body, which follows an `if`-free effect but not a
/// scope inside it.
const SCOPED: &str = "fx_scoped_system = {
	class = rl_single
	usage = misc_system_init
	usage_odds = 5
	max_instances = 1
	planet = { count = 1 class = star orbit_distance = 0 }
	change_orbit = 40
	planet = { count = 1 orbit_distance = 40 }
	init_effect = {
		random_system_planet = {
			add_anomaly = { category = FX_SCOPED_CAT }
			create_archaeological_site = site_fx_scoped
		}
	}
}
fx_scoped_body = {
	class = rl_single
	usage = misc_system_init
	usage_odds = 5
	max_instances = 1
	planet = { count = 1 class = star orbit_distance = 0 }
	change_orbit = 40
	planet = {
		count = 1
		orbit_distance = 40
		init_effect = {
			set_planet_flag = fx_kept
			set_planet_flag = fx_dynamic_@event_target:fx_caller
			add_anomaly = { category = FX_KEPT_CAT }
			random_system_planet = {
				add_anomaly = { category = FX_SCOPED_CAT }
			}
		}
	}
}
";

fn scoped_install() -> (tempfile::TempDir, sgf_gamedata::GameData) {
    let mut files = FILES.to_vec();
    files.push((SCOPES, SCOPED));
    hand_written(&files)
}

#[test]
fn an_anomaly_or_dig_site_in_a_scope_the_generator_does_not_follow_is_on_the_card() {
    let (_dir, gd) = scoped_install();
    let session = open_4_5();

    let system = layout_summary(&gd, "fx_scoped_system", &session).expect("the card");
    assert_eq!(
        system.comes_without,
        [LeftOut::Anomaly, LeftOut::DigSite],
        "the system's own script is dropped"
    );
    assert!(system.comes_with.is_empty());

    let body = layout_summary(&gd, "fx_scoped_body", &session).expect("the card");
    assert_eq!(body.comes_without, [LeftOut::Anomaly], "the scoped one");
    let kept: Vec<&str> = body.comes_with.iter().map(|p| p.key.as_str()).collect();
    assert_eq!(kept, ["FX_KEPT_CAT"], "the one the body's own effect adds");
}

#[test]
fn a_planet_flag_written_from_a_scope_at_run_time_is_not_written() {
    let (_dir, gd) = scoped_install();
    let session = open_4_5();
    let op = special_op(&gd, &session, 1, SPOT, "fx_scoped_body", true).expect("the op");
    assert_eq!(names(&op), ["AddSystemFromSpec", "AddAnomaly"]);
    let Op::AddSystemFromSpec { spec } = members(&op)[0] else {
        unreachable!()
    };
    let flags: Vec<&String> = spec.planets.iter().flat_map(|p| &p.flags).collect();
    assert_eq!(flags, ["fx_kept"]);
}

/// Random and Shape adds draw from the plain layouts, so they write a body's planet flags and
/// nothing a layout's script plants: no anomaly, dig site or event target.
#[test]
fn random_and_shape_adds_plant_nothing() {
    let (_dir, gd) = common::generate::hand_written();
    let session = open_4_5();
    let star_class = "sc_sun".to_owned();
    let asks = [SystemAsk {
        star_class,
        x: SPOT.0,
        y: SPOT.1,
    }];
    let op = systems_op(&gd, &session, 7, &asks, &[], "Shape".to_owned()).expect("the op");
    assert!(
        names(&op).iter().all(|name| *name == "AddSystemFromSpec"),
        "{:?}",
        names(&op)
    );
    assert_eq!(names(&op).len(), 1);
}

/// A ruined Dyson sphere's system goes in with its row at the centre, tied to no body, as the
/// game writes a `spawn_megastructure` that names no place.
#[test]
fn a_ruined_dyson_sphere_comes_with_its_row() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mut session = open_4_5();
    let op = special_op(gd, &session, 1, SPOT, "dyson_sphere_init_01", true).expect("the op");
    assert_eq!(names(&op), ["AddSystemFromSpec", "AddMegastructure"]);
    let text = applied(&mut session, "dyson_sphere", op);
    assert!(text.contains("type=\"dyson_sphere_ruined\""), "{text}");
}
