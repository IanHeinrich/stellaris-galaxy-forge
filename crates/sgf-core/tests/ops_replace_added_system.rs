//! Rolling a system added since the save was opened again in place, on the 4.5 and the
//! 4.4 sample: its id, position, lanes and name stay while its star and bodies change,
//! undo is byte-exact, a removal after it gives back the file as opened, the systems
//! added after it keep their ids, and a system the file held is refused. Also the flag
//! that tells the app which systems were added.

use std::collections::BTreeSet;

use sgf_core::ops::{Op, OpError, SystemSpec};
use sgf_core::session::Session;
use sgf_core::views::{GalaxyView, SystemDetail};

use crate::common;
use common::diff::{round_trip_step, step_report};
use common::spec::{SAMPLE_4_5, SAMPLES, belted, mura, rerolled, small};
use common::{current, examples, findings, planet_ids, pooled};

fn add(spec: SystemSpec) -> Op {
    Op::AddSaveSystem { spec }
}

fn reroll(system: u32, spec: SystemSpec) -> Op {
    Op::ReplaceSaveSystem { system, spec }
}

/// A belted system, given a lane from a system the file held and moved, rolled again:
/// what the reroll keeps and replaces, the same spec rolled back writes the same text,
/// asteroid names included, and a removal after it gives back the file as opened.
#[test]
fn a_reroll_keeps_the_id_position_name_and_lanes_and_replaces_the_rest() {
    for sample in &SAMPLES {
        let (mut session, first, joiner) = ((sample.open)(), sample.id, sample.joiner);
        let spike = belted((sample.spike)());
        let session = &mut session;
        session.apply(add(spike.clone())).expect("add");
        round_trip_step(
            session,
            "a lane from a system the file held",
            Op::AddLane {
                a: joiner,
                b: first,
                bridge: true,
            },
        );
        round_trip_step(
            session,
            "move",
            Op::MoveSystem {
                id: first,
                x: spike.x + 2.0,
                y: spike.y,
            },
        );
        let before = session.system(first).expect("the spike").clone();
        let joiner_lanes = session.system(joiner).expect("the joiner").lanes.clone();
        let moved = current(session);

        let mut again = rerolled(spike.clone());
        (again.x, again.y, again.lanes) = (f64::NAN, f64::INFINITY, vec![99_999]);
        let result = round_trip_step(session, "reroll", reroll(first, again));
        assert!(result.renumbered.is_empty());
        let after = session.system(first).expect("the spike, rolled again");
        assert_eq!(
            (after.x, after.y, &after.name, &after.lanes),
            (before.x, before.y, &before.name, &before.lanes)
        );
        assert_eq!(
            (after.star_class.as_str(), after.initializer.as_str()),
            ("sc_m", "basic_init_03")
        );
        assert_eq!(after.planet_count, 4);
        assert!(after.added);
        assert_eq!(
            session.system(joiner).expect("the joiner").lanes,
            joiner_lanes,
            "{first}: the lane from the file's system, bridge and all"
        );
        assert_eq!(planet_ids(session, first).len(), 4);

        round_trip_step(session, "reroll back", reroll(first, spike.clone()));
        assert_eq!(
            current(session),
            moved,
            "{first}: the same spec gives the same text, asteroid names included"
        );
        session
            .apply(reroll(first, rerolled(spike)))
            .expect("reroll again");
        round_trip_step(session, "remove", Op::RemoveSystem { id: first });
        assert_eq!(current(session), session.doc.original(), "{first}");
    }
}

#[test]
fn rerolling_a_middle_system_keeps_the_ids_after_it_and_reopens() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for sample in &SAMPLES {
        let mut session = (sample.open)();
        let opened = findings(&session);
        let first = sample.id;
        let (middle, last) = (first + 1, first + 2);
        let second = small("Tau_Ceti", sample.spots[0], vec![first, sample.near[0]]);
        let third = small("Altair", sample.spots[1], vec![middle]);
        let session = &mut session;
        for spec in [(sample.spike)(), second.clone(), third.clone()] {
            session.apply(add(spec)).expect("add");
        }
        let third_planets = planet_ids(session, last);
        let lanes = session.system(middle).expect("the middle").lanes.clone();

        let mut again = rerolled((sample.spike)());
        again.name = second.name.clone();
        let result = round_trip_step(session, "reroll the middle", reroll(middle, again));
        assert!(result.renumbered.is_empty());
        let rolled = session.system(middle).expect("the middle, rolled again");
        assert_eq!(rolled.star_class, "sc_m");
        assert_eq!(rolled.lanes, lanes);
        let kept = session.system(last).expect("the third keeps its id");
        assert_eq!((kept.name.key.as_str(), kept.x), ("Altair", third.x));
        assert_eq!(planet_ids(session, last), third_planets);

        let path = dir.path().join(format!("{first}.sav"));
        session.save_as(&path).expect("save");
        let reopened = Session::open(&path).expect("reopen");
        let ids: BTreeSet<u32> = reopened.graph.systems.keys().copied().collect();
        assert_eq!(ids, (0..=last).collect(), "{first}: dense ids");
        let system = reopened.system(middle).expect("the middle, reopened");
        assert_eq!(system.star_class, "sc_m");
        assert_eq!(system.planet_count, 4);
        assert!(!system.added, "a reopened file added nothing");
        assert_eq!(system.lanes, session.system(middle).unwrap().lanes);
        assert_eq!(planet_ids(&reopened, middle), planet_ids(session, middle));
        assert_eq!(
            findings(&reopened),
            opened,
            "{first}: the save's own findings"
        );
    }
}

#[test]
fn the_diff_a_reroll_writes() {
    let mut session = (SAMPLE_4_5.open)();
    session.apply(add(mura())).expect("add");
    let report = step_report(&mut session, reroll(SAMPLE_4_5.id, rerolled(mura())));
    common::snapshot("reroll_mura", &report);
}

/// The spike's system with its gas giant and moons at angles whose coordinates, read
/// back, measure an angle that misses them in the last decimal.
fn awkward(mut spec: SystemSpec) -> SystemSpec {
    let giant = &mut spec.planets[3];
    giant.angle = 2.66;
    giant.moons[0].angle = 2.05;
    giant.moons[1].angle = 8.68;
    spec
}

#[test]
fn the_inverse_writes_back_the_text_the_reroll_replaced() {
    for variant in ["plain", "belted", "awkward"] {
        for sample in &SAMPLES {
            let (mut session, spike) = ((sample.open)(), (sample.spike)());
            let first = sample.id;
            let spike = match variant {
                "belted" => belted(spike.clone()),
                "awkward" => awkward(spike.clone()),
                _ => spike.clone(),
            };
            let session = &mut session;
            session.apply(add(spike.clone())).expect("add");
            let star = planet_ids(session, first)[0];
            session
                .apply(Op::SetPlanetSize { id: star, size: 30 })
                .expect("an edit to the old star");
            session
                .apply(Op::MoveSystem {
                    id: first,
                    x: spike.x + 2.0,
                    y: spike.y,
                })
                .expect("a move");
            let before = current(session);
            let result = session
                .apply(reroll(first, rerolled(spike.clone())))
                .expect("reroll");
            let Op::ReplaceSaveSystem { system, spec } = &result.inverse else {
                panic!("{:?}", result.inverse);
            };
            assert_eq!(*system, first);
            assert_eq!(spec.star.size, 30);
            assert_eq!((spec.x, spec.y), (spike.x + 2.0, spike.y));
            assert_eq!(spec.lanes, spike.lanes);
            session.apply(result.inverse).expect("apply the inverse");
            assert!(
                current(session) == before,
                "{first}, {variant}: the inverse wrote different text"
            );
        }
    }
}

#[test]
fn deposits_added_to_its_planets_later_leave_with_them() {
    for sample in &SAMPLES {
        let (mut session, spike) = ((sample.open)(), (sample.spike)());
        let first = sample.id;
        let session = &mut session;
        session.apply(add(spike.clone())).expect("add");
        let planet = planet_ids(session, first)[1];
        round_trip_step(
            session,
            "a deposit on the added planet",
            Op::AddSaveDeposit {
                planet,
                kind: "d_minerals_3".to_owned(),
            },
        );
        let with_deposit = current(session);
        round_trip_step(session, "reroll", reroll(first, rerolled(spike.clone())));
        round_trip_step(session, "remove", Op::RemoveSystem { id: first });
        assert_eq!(current(session), session.doc.original(), "{first}");
        session.undo().expect("undo").expect("the removal");
        session.undo().expect("undo").expect("the reroll");
        assert_eq!(current(session), with_deposit);
        round_trip_step(session, "remove", Op::RemoveSystem { id: first });
        assert_eq!(current(session), session.doc.original(), "{first}");
    }
}

#[test]
fn a_reroll_under_another_name_swaps_it_in_the_pool() {
    let sample = SAMPLE_4_5;
    let (mut session, spike) = ((sample.open)(), (sample.spike)());
    let first = sample.id;
    let session = &mut session;
    let other = sgf_core::ops::free_star_names(&session.doc)
        .into_iter()
        .find(|name| *name != spike.name)
        .expect("a free name");
    session.apply(add(spike.clone())).expect("add");
    assert_eq!(pooled(session, "star_names", &spike.name), 0);
    let mut again = rerolled(spike.clone());
    again.name = other.clone();
    let result = round_trip_step(session, "reroll renamed", reroll(first, again));
    assert_eq!(
        result.entry.description,
        format!("Rolled Mura (#601) again as {other}, sc_m, with 4 bodies")
    );
    assert_eq!(session.system(first).unwrap().name.key, other);
    assert_eq!(pooled(session, "star_names", &spike.name), 1);
    assert_eq!(pooled(session, "star_names", &other), 0);
    session
        .apply(Op::RemoveSystem { id: first })
        .expect("remove");
    assert_eq!(current(session), session.doc.original());
}

#[test]
fn what_a_reroll_refuses() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for sample in &SAMPLES {
        let (mut session, spike) = ((sample.open)(), (sample.spike)());
        let first = sample.id;
        let session = &mut session;
        let error = session
            .apply(reroll(sample.joiner, rerolled(spike.clone())))
            .expect_err("a system the file held");
        assert!(
            matches!(error, OpError::SystemNotAdded(id) if id == sample.joiner),
            "{error}"
        );
        let error = session
            .apply(reroll(99_999, rerolled(spike.clone())))
            .expect_err("no such system");
        assert!(matches!(error, OpError::UnknownSystem(99_999)), "{error}");

        session.apply(add(spike.clone())).expect("add");
        let written = current(session);
        let mut bad = rerolled(spike.clone());
        bad.star_class.clear();
        let error = session
            .apply(reroll(first, bad))
            .expect_err("no star class");
        assert!(
            matches!(
                error,
                OpError::EmptyText {
                    what: "a star class"
                }
            ),
            "{error}"
        );
        assert_eq!(current(session), written, "a refusal writes nothing");

        let path = dir.path().join(format!("{first}.sav"));
        session.save_as(&path).expect("save");
        let mut reopened = Session::open(&path).expect("reopen");
        let error = reopened
            .apply(reroll(first, rerolled(spike.clone())))
            .expect_err("added before the file was reopened");
        assert!(
            matches!(error, OpError::SystemNotAdded(id) if id == first),
            "{error}"
        );
        assert!(!reopened.is_dirty());
    }
}

fn added_ids(view: &GalaxyView) -> Vec<u32> {
    view.systems
        .iter()
        .filter(|system| system.added)
        .map(|system| system.id)
        .collect()
}

#[test]
fn the_added_flag_follows_adds_undo_redo_and_renumbering() {
    let sample = SAMPLE_4_5;
    let (mut session, spike) = ((sample.open)(), (sample.spike)());
    let (first, home) = (sample.id, sample.near[0]);
    let session = &mut session;
    assert!(added_ids(&GalaxyView::from(&session.graph)).is_empty());

    let result = session.apply(add(spike.clone())).expect("add");
    let delta = session.edit_result(result).delta;
    let sent: Vec<(u32, bool)> = delta.systems.iter().map(|s| (s.id, s.added)).collect();
    assert!(sent.contains(&(first, true)), "{sent:?}");
    assert!(sent.iter().all(|&(id, added)| added == (id == first)));
    let detail = SystemDetail::of(&session.graph, first).expect("the detail");
    assert!(detail.system.added);
    assert!(!SystemDetail::of(&session.graph, home).unwrap().system.added);

    session
        .apply(add(small("Tau_Ceti", sample.spots[0], vec![home])))
        .expect("add a second");
    assert_eq!(
        added_ids(&GalaxyView::from(&session.graph)),
        [first, first + 1]
    );
    let removed = session
        .apply(Op::RemoveSystem { id: first })
        .expect("remove the first");
    assert_eq!(
        removed.renumbered,
        [(first, None), (first + 1, Some(first))]
    );
    let moved = session.system(first).expect("the second, renumbered");
    assert_eq!((moved.name.key.as_str(), moved.added), ("Tau_Ceti", true));
    assert_eq!(added_ids(&GalaxyView::from(&session.graph)), [first]);

    session.undo().expect("undo").expect("the removal");
    assert_eq!(
        added_ids(&GalaxyView::from(&session.graph)),
        [first, first + 1]
    );
    session.undo().expect("undo").expect("the second add");
    session.undo().expect("undo").expect("the first add");
    assert!(added_ids(&GalaxyView::from(&session.graph)).is_empty());
    session.redo().expect("redo").expect("the first add");
    assert_eq!(added_ids(&GalaxyView::from(&session.graph)), [first]);

    let mut scenario = examples::scenario();
    scenario
        .apply(Op::AddSystem {
            id: Some(77),
            x: 10.0,
            y: 10.0,
            name: None,
            initializer: None,
            spawn_weight: None,
            spawn_script: None,
        })
        .expect("a scenario system");
    assert!(added_ids(&GalaxyView::from(&scenario.graph)).is_empty());
}
