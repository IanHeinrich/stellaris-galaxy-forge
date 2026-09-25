//! The planet size op on both sample saves: the diff each change produces is
//! snapshotted, the details read the new size, and undo puts the original bytes back.

use sgf_core::ops::Op;
use sgf_core::session::{OpResult, Session};

use crate::common;
use common::diff::{round_trip, snapshot_step};
use common::{current, open, open_4_5};

fn set(id: u32, size: u32) -> Op {
    Op::SetPlanetSize { id, size }
}

fn planet_size(session: &Session, system: u32, planet: u32) -> Option<u32> {
    let planets = common::planets(session, system);
    let body = planets.into_iter().find(|p| p.id == planet);
    body.expect("the planet").size
}

/// Round-trip and snapshot a size for `planet` of `system`, and check the details read it.
fn change(session: &mut Session, system: u32, planet: u32, size: u32, snapshot: &str) -> OpResult {
    let result = snapshot_step(session, snapshot, set(planet, size));
    assert_eq!(
        planet_size(session, system, planet),
        Some(size),
        "{snapshot}: details"
    );
    result
}

#[test]
fn the_4_5_samples_star_body_grows_and_back() {
    let mut session = open_4_5();
    assert_eq!(planet_size(&session, 1, 584), Some(29));
    let result = change(&mut session, 1, 584, 40, "star_body_4_5");
    assert_eq!(
        result.entry.description,
        "Set the size of planet #584 from 29 to 40"
    );
    assert_eq!(result.inverse, set(584, 29));
    session.apply(result.inverse).unwrap();
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(planet_size(&session, 1, 584), Some(29));
}

#[test]
fn the_4_5_samples_barren_planet_shrinks() {
    let mut session = open_4_5();
    assert_eq!(planet_size(&session, 1, 585), Some(27));
    change(&mut session, 1, 585, 12, "planet_4_5");
}

#[test]
fn the_4_4_samples_star_body_grows() {
    let mut session = open();
    assert_eq!(planet_size(&session, 1, 748), Some(25));
    change(&mut session, 1, 748, 30, "star_body_4_4");
    round_trip(open(), set(749, 5));
}

#[test]
fn a_planet_size_is_refused_for_an_unknown_planet_zero_or_no_change() {
    let mut session = open();
    let refusals = [
        (set(99_999, 10), "planet 99999 does not exist"),
        (set(748, 0), "a planet size may not be zero"),
        (set(748, 25), "planet 748 is already size 25"),
    ];
    for (op, message) in refusals {
        let error = session.apply(op).expect_err(message);
        assert_eq!(error.to_string(), message);
    }
    assert!(!session.doc.is_dirty());
    assert!(session.history().undo.is_empty());
}

#[test]
fn a_batch_of_a_star_class_and_its_bodys_size_is_one_step() {
    let mut session = open();
    let batch = Op::Batch {
        description: "Made system 1 a large pulsar".to_owned(),
        ops: vec![
            Op::SetStarClass {
                id: 1,
                class: "sc_pulsar".to_owned(),
                bodies: vec![sgf_core::ops::StarBody {
                    planet: 748,
                    class: "pc_pulsar".to_owned(),
                }],
            },
            set(748, 30),
        ],
    };
    let result = session.apply(batch).expect("apply the batch");
    assert_eq!(result.details_stale, [1]);
    assert_eq!(planet_size(&session, 1, 748), Some(30));
    assert_eq!(session.history().undo.len(), 1);

    session.undo().expect("undo").expect("something to undo");
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(planet_size(&session, 1, 748), Some(25));
}

#[test]
fn a_size_change_rereads_its_planet_and_keeps_the_details_built() {
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

    session.apply(set(748, 30)).expect("set the size");
    kept(&session, "the apply");
    assert_eq!(planet_size(&session, 1, 748), Some(30));

    let undone = session.undo().expect("undo").expect("something to undo");
    assert_eq!(undone.details_stale, [1], "the undo re-reads the system");
    kept(&session, "the undo");
    assert_eq!(planet_size(&session, 1, 748), Some(25));

    session.redo().expect("redo").expect("something to redo");
    kept(&session, "the redo");
    assert_eq!(planet_size(&session, 1, 748), Some(30));
}

#[test]
fn a_star_bodys_new_size_reaches_the_map() {
    let mut session = open_4_5();
    let size_of = |system: &sgf_core::projections::galaxy::SystemNode| {
        system.bodies.as_ref().expect("the system's bodies")[1].size
    };
    assert_eq!(size_of(&session.graph.systems[&5]), Some(20));
    let result = session.apply(set(619, 31)).expect("grow the second star");
    let edit = session.edit_result(result);
    let sent = edit
        .delta
        .systems
        .iter()
        .find(|s| s.id == 5)
        .expect("the system reaches the map");
    assert_eq!(size_of(sent), Some(31));
    assert_eq!(sent.bodies.as_ref().unwrap()[1].class, "pc_f_star");
}
