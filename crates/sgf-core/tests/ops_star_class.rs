//! The star class op on both sample saves: the diff each change produces is snapshotted,
//! the projection and a reload of the edited bytes read the new class, the details read
//! the new body classes, and undo puts the original bytes back.

use sgf_core::ops::{Op, OpError, StarBody};
use sgf_core::projections::galaxy::SystemNode;
use sgf_core::session::Session;
use sgf_core::views::DocumentKind;

mod common;
use common::diff::{plain_report, round_trip};
use common::examples;
use common::{SAMPLE_4_5, current, open, reprojected};

fn set(id: u32, class: &str, bodies: &[(u32, &str)]) -> Op {
    Op::SetStarClass {
        id,
        class: class.to_owned(),
        bodies: bodies
            .iter()
            .map(|&(planet, class)| StarBody {
                planet,
                class: class.to_owned(),
            })
            .collect(),
    }
}

fn star_class(session: &Session, id: u32) -> String {
    session.graph.systems[&id].star_class.clone()
}

fn body_class(session: &Session, id: u32, planet: u32) -> String {
    let details = session.details().expect("details");
    let raw = details.raw(id).expect("the system's details");
    raw.planets
        .iter()
        .find(|p| p.id == planet)
        .expect("the body")
        .class
        .clone()
}

/// Apply `op` to system `id`, check the projection, a reload of the bytes, the map delta
/// and the details all read it, snapshot the diff, then undo and check the original bytes,
/// class and body classes are back.
fn change_and_undo(session: &mut Session, op: Op, snapshot: &str) {
    let Op::SetStarClass { id, class, bodies } = op.clone() else {
        unreachable!("a star class op")
    };
    let before_class = star_class(session, id);
    let before_bodies: Vec<String> = bodies
        .iter()
        .map(|b| body_class(session, id, b.planet))
        .collect();

    let result = session.apply(op).expect("set the star class");
    assert_eq!(star_class(session, id), class, "{snapshot}");
    assert_eq!(
        reprojected(session).systems[&id].star_class,
        class,
        "{snapshot}: a reload"
    );
    assert_eq!(result.details_stale, [id], "{snapshot}");
    assert!(!result.reclassifies, "{snapshot}");
    let edit = session.edit_result(result.clone());
    let delta = edit
        .delta
        .systems
        .iter()
        .find(|s| s.id == id)
        .expect("the system reaches the map");
    assert_eq!(delta.star_class, class, "{snapshot}: reaches the app");
    for body in &bodies {
        assert_eq!(
            body_class(session, id, body.planet),
            body.class,
            "{snapshot}: details"
        );
    }
    common::snapshot(snapshot, &plain_report(session, &result));

    let undone = session.undo().expect("undo").expect("something to undo");
    assert_eq!(undone.details_stale, [id], "{snapshot}: undo");
    assert_eq!(current(session), session.doc.original(), "{snapshot}: undo");
    assert_eq!(star_class(session, id), before_class, "{snapshot}: undo");
    for (body, class) in bodies.iter().zip(&before_bodies) {
        assert_eq!(
            &body_class(session, id, body.planet),
            class,
            "{snapshot}: undo"
        );
    }
}

#[test]
fn the_4_5_samples_g_star_becomes_a_pulsar_and_back() {
    let mut session = Session::open(SAMPLE_4_5).expect("open the 4.5 sample");
    assert_eq!(star_class(&session, 1), "sc_g");
    change_and_undo(
        &mut session,
        set(1, "sc_pulsar", &[(584, "pc_pulsar")]),
        "g_to_pulsar_4_5",
    );

    let result = session
        .apply(set(1, "sc_pulsar", &[(584, "pc_pulsar")]))
        .unwrap();
    assert_eq!(
        result.entry.description,
        format!(
            "Set the star class of {} (#1) from sc_g to sc_pulsar",
            session.graph.systems[&1].display_name()
        )
    );
    assert_eq!(result.inverse, set(1, "sc_g", &[(584, "pc_g_star")]));
    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(star_class(&session, 1), "sc_g");
}

#[test]
fn the_4_4_samples_g_star_becomes_a_pulsar() {
    let mut session = open();
    assert_eq!(star_class(&session, 1), "sc_g");
    change_and_undo(
        &mut session,
        set(1, "sc_pulsar", &[(748, "pc_pulsar")]),
        "g_to_pulsar_4_4",
    );
    session.redo().expect("redo").expect("something to redo");
    assert_eq!(star_class(&session, 1), "sc_pulsar");
    assert_eq!(body_class(&session, 1, 748), "pc_pulsar");
}

#[test]
fn a_binary_system_rewrites_both_of_its_stars() {
    let op = set(
        35,
        "sc_binary_7",
        &[(1063, "pc_k_star"), (1064, "pc_f_star")],
    );
    let mut session = open();
    assert_eq!(star_class(&session, 35), "sc_binary_2");
    change_and_undo(&mut session, op.clone(), "binary_2_to_binary_7");
    round_trip(open(), op);
}

#[test]
fn a_star_class_is_refused_where_it_names_no_body_of_the_system_or_changes_nothing() {
    let mut session = open();
    let refusals = [
        (
            set(99_999, "sc_pulsar", &[(748, "pc_pulsar")]),
            "system 99999 does not exist",
        ),
        (
            set(1, "", &[(748, "pc_pulsar")]),
            "a star class may not be empty",
        ),
        (
            set(1, "sc_\"pulsar", &[(748, "pc_pulsar")]),
            "class \"sc_\\\"pulsar\" may not hold a quote, a backslash or a line break",
        ),
        (set(1, "sc_pulsar", &[]), "no star bodies given"),
        (
            set(1, "sc_pulsar", &[(1063, "pc_pulsar")]),
            "planet 1063 is not a body of system 1",
        ),
        (
            set(1, "sc_binary_1", &[(748, "pc_a_star"), (748, "pc_pulsar")]),
            "planet 748 is listed more than once",
        ),
        (
            set(1, "sc_pulsar", &[(748, "")]),
            "planet 748's class may not be empty",
        ),
        (
            set(1, "sc_g", &[(748, "pc_g_star")]),
            "system 1 is already sc_g with those star bodies",
        ),
    ];
    for (op, message) in refusals {
        let error = session.apply(op).expect_err(message);
        assert_eq!(error.to_string(), message);
    }
    assert!(!session.doc.is_dirty());
    assert!(session.history().undo.is_empty());

    let mut scenario = examples::scenario();
    assert!(matches!(
        scenario.apply(set(10, "sc_pulsar", &[(1, "pc_pulsar")])),
        Err(OpError::Unsupported {
            kind: DocumentKind::Scenario,
            ..
        })
    ));
    assert!(!scenario.doc.is_dirty());
}

#[test]
fn a_body_alone_changes_when_the_star_class_already_stands() {
    let mut session = open();
    let result = session
        .apply(set(1, "sc_g", &[(748, "pc_pulsar")]))
        .expect("rewrite the body alone");
    assert_eq!(result.details_stale, [1]);
    assert_eq!(star_class(&session, 1), "sc_g");
    assert_eq!(body_class(&session, 1, 748), "pc_pulsar");
    assert_eq!(result.inverse, set(1, "sc_g", &[(748, "pc_g_star")]));
    session.undo().expect("undo").expect("something to undo");
    assert_eq!(current(&session), session.doc.original());
}

#[test]
fn a_star_class_change_rereads_its_bodies_and_keeps_the_other_systems_details() {
    let mut session = open();
    session.warm_details().expect("build details");
    let other = session
        .details()
        .unwrap()
        .raw(35)
        .cloned()
        .expect("system 35's details");
    let kept = |session: &Session, step: &str| {
        let details = session
            .built_details()
            .unwrap_or_else(|| panic!("{step} dropped the details"));
        assert_eq!(details.raw(35), Some(&other), "{step}");
    };

    session
        .apply(set(1, "sc_pulsar", &[(748, "pc_pulsar")]))
        .expect("set the star class");
    kept(&session, "the apply");
    assert_eq!(body_class(&session, 1, 748), "pc_pulsar");

    session.undo().expect("undo").expect("something to undo");
    kept(&session, "the undo");
    assert_eq!(body_class(&session, 1, 748), "pc_g_star");

    session.redo().expect("redo").expect("something to redo");
    kept(&session, "the redo");
    assert_eq!(body_class(&session, 1, 748), "pc_pulsar");
}

#[test]
fn a_batch_of_star_classes_is_one_step_that_undoes_to_the_original_bytes() {
    let mut session = open();
    let batch = Op::Batch {
        description: "Set two star classes".to_owned(),
        ops: vec![
            set(1, "sc_pulsar", &[(748, "pc_pulsar")]),
            set(
                35,
                "sc_binary_7",
                &[(1063, "pc_k_star"), (1064, "pc_f_star")],
            ),
        ],
    };
    let result = session.apply(batch).expect("apply the batch");
    assert_eq!(result.details_stale, [1, 35]);
    assert_eq!(star_class(&session, 1), "sc_pulsar");
    assert_eq!(star_class(&session, 35), "sc_binary_7");
    assert_eq!(body_class(&session, 1, 748), "pc_pulsar");
    assert_eq!(body_class(&session, 35, 1063), "pc_k_star");
    assert_eq!(body_class(&session, 35, 1064), "pc_f_star");
    assert_eq!(session.history().undo.len(), 1);

    session.undo().expect("undo").expect("something to undo");
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(star_class(&session, 1), "sc_g");
    assert_eq!(star_class(&session, 35), "sc_binary_2");
    assert_eq!(body_class(&session, 1, 748), "pc_g_star");
}

#[test]
fn a_refused_member_leaves_the_whole_batch_unapplied() {
    let mut session = open();
    let batch = Op::Batch {
        description: "Set two star classes".to_owned(),
        ops: vec![
            set(1, "sc_pulsar", &[(748, "pc_pulsar")]),
            set(35, "sc_binary_7", &[(748, "pc_k_star")]),
        ],
    };
    let error = session.apply(batch).expect_err("748 is not a body of 35");
    assert!(
        matches!(
            error,
            OpError::NotABody {
                planet: 748,
                system: 35
            }
        ),
        "{error}"
    );
    assert!(!session.doc.is_dirty());
    assert!(session.history().undo.is_empty());
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(star_class(&session, 1), "sc_g");
    assert_eq!(body_class(&session, 1, 748), "pc_g_star");
}

fn bodies(system: &SystemNode) -> Vec<(String, Option<u32>)> {
    system
        .bodies
        .as_ref()
        .expect("a save system lists its bodies")
        .iter()
        .map(|b| (b.class.clone(), b.size))
        .collect()
}

#[test]
fn a_binarys_bodies_are_read_at_load_and_follow_a_change_of_one_star() {
    let mut session = Session::open(SAMPLE_4_5).expect("open the 4.5 sample");
    let system = &session.graph.systems[&5];
    assert_eq!(system.star_class, "sc_binary_7");
    let loaded = bodies(system);
    assert_eq!(loaded.len(), 9);
    assert_eq!(
        loaded[..3],
        [
            ("pc_k_star".to_owned(), Some(33)),
            ("pc_f_star".to_owned(), Some(20)),
            ("pc_gas_giant".to_owned(), Some(22)),
        ]
    );

    let result = session
        .apply(set(5, "sc_binary_7", &[(619, "pc_t_star")]))
        .expect("rewrite the second star alone");
    let edit = session.edit_result(result);
    let sent = edit
        .delta
        .systems
        .iter()
        .find(|s| s.id == 5)
        .expect("the system reaches the map");
    let mut expected = loaded.clone();
    expected[1] = ("pc_t_star".to_owned(), Some(20));
    assert_eq!(bodies(sent), expected, "the delta");
    assert_eq!(
        bodies(&session.graph.systems[&5]),
        expected,
        "the projection"
    );
    assert_eq!(
        bodies(&reprojected(&session).systems[&5]),
        expected,
        "a reload"
    );

    let undone = session.undo().expect("undo").expect("something to undo");
    let edit = session.edit_result(undone);
    let sent = edit
        .delta
        .systems
        .iter()
        .find(|s| s.id == 5)
        .expect("undo reaches the map");
    assert_eq!(bodies(sent), loaded, "undo");
}

#[test]
fn a_scenario_system_carries_no_bodies() {
    let scenario = examples::scenario();
    assert!(scenario.graph.systems.values().all(|s| s.bodies.is_none()));
}
