//! What a new system's layout script makes beside its bodies, added with it as one batch on
//! the 4.5 sample: the anomalies, dig sites and global event targets name the ids the new
//! bodies take, planet flags are written on their bodies, a target name the save holds is
//! left to the one there, and anomalies and dig sites only go in when asked for.

use sgf_core::entity::get_planet_page;
use sgf_core::ops::{
    BodySpec, EventTargetOf, Op, OpError, SpecAnomaly, SpecBody, SpecDigSite, SpecEventTarget,
    SpecTarget, SystemAdd, SystemExtras, SystemSpec,
};
use sgf_core::session::Session;

use crate::common;
use common::diff::{report, round_trip_step};
use common::spec::{SAMPLE_4_5, body, small};
use common::{current, open_4_5, planet_ids, text};

/// A target the 4.5 sample holds.
const HELD: &str = "ratling_capital";

/// A K star, a gas giant with two moons, a barren planet flagged `sgf_flag` and a third
/// planet: anomalies on the second moon, a site on the third planet, and targets on the
/// barren planet, the system and one the save holds.
fn with_extras() -> SystemAdd {
    let mut spec = small("Extras", SAMPLE_4_5.spots[0], Vec::new());
    spec.planets = vec![
        BodySpec {
            moons: vec![
                body("pc_barren", 4, 8.0, 0.0, 0),
                body("pc_frozen", 5, 12.0, 90.0, 0),
            ],
            ..body("pc_gas_giant", 22, 50.0, 0.0, 0)
        },
        BodySpec {
            flags: vec!["sgf_flag".to_owned()],
            ..body("pc_barren", 10, 80.0, 120.0, 1)
        },
        body("pc_toxic", 15, 110.0, 240.0, 0),
    ];
    let target = |target: SpecTarget, name: &str| SpecEventTarget {
        target,
        name: name.to_owned(),
    };
    SystemAdd {
        spec,
        extras: SystemExtras {
            anomalies: vec![SpecAnomaly {
                body: SpecBody::Moon { of: 0, index: 1 },
                category: "SGF_MOON_CAT".to_owned(),
            }],
            dig_sites: vec![SpecDigSite {
                body: SpecBody::Planet { index: 2 },
                site_type: "site_lost_moments".to_owned(),
                difficulty: 1,
            }],
            event_targets: vec![
                target(
                    SpecTarget::Body(SpecBody::Planet { index: 1 }),
                    "sgf_planet",
                ),
                target(SpecTarget::System, "sgf_system"),
                target(SpecTarget::System, HELD),
            ],
        },
    }
}

/// A small system beside it with an anomaly on its star.
fn second() -> SystemAdd {
    SystemAdd {
        spec: small("Second", SAMPLE_4_5.spots[1], Vec::new()),
        extras: SystemExtras {
            anomalies: vec![SpecAnomaly {
                body: SpecBody::Star,
                category: "SGF_STAR_CAT".to_owned(),
            }],
            ..SystemExtras::default()
        },
    }
}

fn built(session: &Session, systems: Vec<SystemAdd>, extras: bool) -> Op {
    session
        .save("adding systems")
        .expect("a 4.5 save")
        .add_systems_op(systems, &[], extras, None)
        .expect("the op")
}

fn members(op: &Op) -> &[Op] {
    match op {
        Op::Batch { ops, .. } => ops,
        other => panic!("a batch, not {}", other.name()),
    }
}

fn anomaly(session: &Session, body: u32) -> Option<String> {
    let page = get_planet_page(session.doc(), body).expect("the planet");
    page.anomaly.map(|anomaly| anomaly.category)
}

fn site(session: &Session, body: u32) -> Option<String> {
    let page = get_planet_page(session.doc(), body).expect("the planet");
    page.dig_site.map(|site| site.kind)
}

/// Every id the batch names for a new body is the one the add wrote at that place: the
/// first new body takes the 4.5 sample's dead slot, the rest the slots past the end, and
/// the second system's bodies follow the first's.
#[test]
fn the_extras_name_the_ids_the_new_bodies_take() {
    let mut session = open_4_5();
    let first = SAMPLE_4_5.id;
    let op = built(&session, vec![with_extras(), second()], true);
    let ops = members(&op).to_vec();
    let result = round_trip_step(&mut session, "extras", op);
    assert_eq!(
        result.entry.description,
        "Added 2 systems with their 2 anomalies and dig site"
    );

    let bodies = planet_ids(&session, first);
    let seconds = planet_ids(&session, first + 1);
    assert_eq!(bodies.len(), 6, "{bodies:?}");
    let expected = [
        Op::AddAnomaly {
            body: bodies[3],
            category: "SGF_MOON_CAT".to_owned(),
            found_by: None,
        },
        Op::AddDigSite {
            body: bodies[5],
            site_type: "site_lost_moments".to_owned(),
            difficulty: 1,
        },
        Op::AddAnomaly {
            body: seconds[0],
            category: "SGF_STAR_CAT".to_owned(),
            found_by: None,
        },
        Op::AddEventTarget {
            name: "sgf_planet".to_owned(),
            target: EventTargetOf::Body { body: bodies[4] },
        },
        Op::AddEventTarget {
            name: "sgf_system".to_owned(),
            target: EventTargetOf::System { system: first },
        },
    ];
    assert_eq!(&ops[2..], expected.as_slice());
    assert_eq!(
        anomaly(&session, bodies[3]).as_deref(),
        Some("SGF_MOON_CAT")
    );
    assert_eq!(
        anomaly(&session, seconds[0]).as_deref(),
        Some("SGF_STAR_CAT")
    );
    assert_eq!(
        site(&session, bodies[5]).as_deref(),
        Some("site_lost_moments")
    );
    let written = text(&session);
    assert!(written.contains("\t\t\tflags=\n\t\t\t{\n\t\t\t\tsgf_flag=62808000\n\t\t\t}\n"));
    common::snapshot("extras", &report(&session, &result));
}

/// Without extras the anomalies and sites stay out, and the planet flags and targets go in.
#[test]
fn without_extras_only_the_flags_and_targets_are_written() {
    let session = open_4_5();
    let op = built(&session, vec![with_extras()], false);
    let names: Vec<&str> = members(&op).iter().map(Op::name).collect();
    assert_eq!(
        names,
        ["AddSystemFromSpec", "AddEventTarget", "AddEventTarget"]
    );
    let Op::Batch { description, .. } = &op else {
        unreachable!()
    };
    assert_eq!(
        description,
        "Added Extras #601 at (-270, -130) with 6 bodies and 0 lanes"
    );
    let Op::AddSystemFromSpec { spec } = &members(&op)[0] else {
        unreachable!()
    };
    assert_eq!(spec.planets[1].flags, ["sgf_flag"]);
}

/// A name the save holds is not saved again, and the rest of the add goes ahead.
#[test]
fn a_target_the_save_holds_stays_with_the_one_there() {
    let mut session = open_4_5();
    let op = built(&session, vec![with_extras()], true);
    assert!(
        !members(&op)
            .iter()
            .any(|op| matches!(op, Op::AddEventTarget { name, .. } if name == HELD))
    );
    let result = session.apply(op).expect("the add");
    assert_eq!(
        result.entry.description,
        "Added Extras #601 with its anomaly and dig site"
    );
    let written = text(&session);
    assert_eq!(written.matches(&format!("name=\"{HELD}\"")).count(), 1);
}

/// A system with nothing beside it is its add alone, described as that add describes it;
/// one target saved by two of the systems is saved once, for the last.
#[test]
fn a_bare_system_is_its_add_alone_and_a_name_saved_twice_takes_the_last() {
    let session = open_4_5();
    let spec: SystemSpec = small("Bare", SAMPLE_4_5.spots[0], Vec::new());
    let op = built(&session, vec![SystemAdd::from(spec)], true);
    assert!(matches!(op, Op::AddSystemFromSpec { .. }), "{}", op.name());

    let twice = |system: SystemAdd| SystemAdd {
        extras: SystemExtras {
            event_targets: vec![SpecEventTarget {
                target: SpecTarget::System,
                name: "sgf_twice".to_owned(),
            }],
            ..SystemExtras::default()
        },
        ..system
    };
    let op = built(&session, vec![twice(with_extras()), twice(second())], true);
    let saved: Vec<&Op> = members(&op)
        .iter()
        .filter(|op| matches!(op, Op::AddEventTarget { name, .. } if name == "sgf_twice"))
        .collect();
    assert_eq!(
        saved,
        [&Op::AddEventTarget {
            name: "sgf_twice".to_owned(),
            target: EventTargetOf::System {
                system: SAMPLE_4_5.id + 1
            },
        }]
    );
}

/// An extra on a body the spec lacks is refused before any op is built, naming the system
/// and the body.
#[test]
fn an_extra_on_a_missing_body_is_refused() {
    let session = open_4_5();
    let mut add = with_extras();
    add.extras.anomalies[0].body = SpecBody::Moon { of: 0, index: 5 };
    let error = session
        .save("adding systems")
        .expect("a 4.5 save")
        .add_systems_op(vec![add], &[], true, None)
        .expect_err("refused");
    assert_eq!(
        error.to_string(),
        "Extras #601 has no moon 6 of planet 1 for what its layout plants there"
    );
    assert!(!session.doc().is_dirty());
}

/// A target name that cannot be written is refused by the builder; an anomaly category
/// that cannot is refused by its op, and the batch leaves the document as it was.
#[test]
fn a_refused_member_leaves_the_document_as_it_was() {
    let mut session = open_4_5();
    let mut bad_name = with_extras();
    bad_name.extras.event_targets[0].name = "two words".to_owned();
    let error = session
        .save("adding systems")
        .expect("a 4.5 save")
        .add_systems_op(vec![bad_name], &[], true, None)
        .expect_err("refused");
    assert!(matches!(error, OpError::InvalidText { .. }), "{error}");

    let mut bad_category = with_extras();
    bad_category.extras.anomalies[0].category = "two words".to_owned();
    let op = built(&session, vec![bad_category], true);
    session.apply(op).expect_err("the anomaly is refused");
    assert!(!session.doc().is_dirty());
    assert!(session.history().undo.is_empty());
    assert_eq!(current(&session), session.doc().original());
}

/// A system that saves only event targets is described as its add alone describes it.
#[test]
fn a_system_with_only_targets_is_described_as_its_add() {
    let mut session = open_4_5();
    let op = built(&session, vec![with_extras()], false);
    let result = session.apply(op).expect("the add");
    assert!(
        result
            .entry
            .description
            .starts_with("Added Extras #601 at (-270, -130) with 6 bodies and 0 lanes"),
        "{}",
        result.entry.description
    );
}

/// Removing the system an add wrote with its extras undoes byte for byte, and the removal's
/// inverse carries the planet flags the add wrote.
#[test]
fn a_system_added_with_extras_is_removed_and_put_back() {
    let mut session = open_4_5();
    let op = built(&session, vec![with_extras()], true);
    session.apply(op).expect("the add");
    let id = SAMPLE_4_5.id;
    let result = round_trip_step(&mut session, "remove", Op::RemoveSystem { system: id });
    let Op::AddSystemFromSpec { spec } = &result.inverse else {
        panic!("a spec, not {}", result.inverse.name());
    };
    assert_eq!(spec.planets[1].flags, ["sgf_flag"]);
}
