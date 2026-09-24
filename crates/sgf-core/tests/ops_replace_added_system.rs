//! Rolling a system added since the save was opened again in place, on the 4.5 and the
//! 4.4 sample: its id, position, lanes and name stay while its star and bodies change,
//! undo is byte-exact, a removal after it gives back the file as opened, the systems
//! added after it keep their ids, and a system the file held is refused. Also the flag
//! that tells the app which systems were added.

use std::collections::BTreeSet;
use std::fmt::Write as _;

use sgf_core::ops::{BodySpec, Op, OpError, SystemSpec};
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;
use sgf_core::views::{GalaxyView, SystemDetail};
use similar::{Algorithm, TextDiff};

mod common;
use common::diff::round_trip_step;
use common::spec::{belted, body, dorellion, mura, rerolled};
use common::{SAMPLE_4_5, current, examples, open, text};

/// One sample, the spike's system and the id it takes, where a second system fits, and
/// a system the file holds that a lane to the spike can come from.
struct Sample {
    session: Session,
    spike: SystemSpec,
    first: u32,
    second: (f64, f64),
    third: (f64, f64),
    home: u32,
    joiner: u32,
}

fn samples() -> [Sample; 2] {
    [
        Sample {
            session: Session::open(SAMPLE_4_5).expect("open the 4.5 sample"),
            spike: mura(),
            first: 601,
            second: (-270.0, -130.0),
            third: (-300.0, -120.0),
            home: 420,
            joiner: 149,
        },
        Sample {
            session: open(),
            spike: dorellion(),
            first: 791,
            second: (415.0, -190.0),
            third: (420.0, -222.0),
            home: 217,
            joiner: 614,
        },
    ]
}

fn add(spec: SystemSpec) -> Op {
    Op::AddSaveSystem { spec }
}

fn reroll(system: u32, spec: SystemSpec) -> Op {
    Op::ReplaceSaveSystem { system, spec }
}

/// A K star with one planet holding a deposit.
fn small(name: &str, (x, y): (f64, f64), lanes: Vec<u32>) -> SystemSpec {
    let planet = BodySpec {
        deposits: vec!["d_minerals_3".to_owned()],
        ..body("pc_barren", 10, 60.0, 45.0, 1)
    };
    SystemSpec {
        name: name.to_owned(),
        x,
        y,
        star_class: "sc_k".to_owned(),
        initializer: "basic_init_01".to_owned(),
        star: body("pc_k_star", 20, 0.0, 0.0, 0),
        planets: vec![planet],
        lanes,
        ..SystemSpec::default()
    }
}

fn findings(session: &Session) -> BTreeSet<(IssueCode, Vec<u32>, String)> {
    session
        .validate()
        .into_iter()
        .map(|issue| (issue.code, issue.systems, issue.message))
        .collect()
}

fn planets_of(session: &Session, id: u32) -> Vec<u32> {
    let details = session.details().expect("details");
    let raw = details.raw(id).expect("the system's details");
    raw.planets.iter().map(|p| p.id).collect()
}

fn pooled(session: &Session, name: &str) -> usize {
    let text = text(session);
    let start = text.find("\nrandom_name_database=").expect("the pool");
    let end = start + text[start..].find("\n}\n").expect("the pool's end");
    text[start..end]
        .matches(&format!("\t\t\"{name}\"\n"))
        .count()
}

#[test]
fn a_reroll_keeps_the_id_position_name_and_lanes_and_replaces_the_rest() {
    for mut sample in samples() {
        let (first, joiner) = (sample.first, sample.joiner);
        let spike = sample.spike.clone();
        let session = &mut sample.session;
        round_trip_step(session, "add", add(spike.clone()));
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
        assert_eq!(planets_of(session, first).len(), 4);
    }
}

#[test]
fn add_reroll_and_remove_gives_back_the_file_as_opened() {
    for mut sample in samples() {
        let first = sample.first;
        let spike = sample.spike.clone();
        let session = &mut sample.session;
        round_trip_step(session, "add", add(belted(spike.clone())));
        let added = current(session);
        round_trip_step(session, "reroll", reroll(first, rerolled(spike.clone())));
        round_trip_step(session, "reroll back", reroll(first, belted(spike.clone())));
        assert_eq!(
            current(session),
            added,
            "{first}: the same spec gives the same text, asteroid names included"
        );
        round_trip_step(session, "reroll again", reroll(first, rerolled(spike)));
        round_trip_step(session, "remove", Op::RemoveSystem { id: first });
        assert_eq!(current(session), session.doc.original(), "{first}");
    }
}

#[test]
fn rerolling_a_middle_system_keeps_the_ids_after_it_and_reopens() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for mut sample in samples() {
        let opened = findings(&sample.session);
        let first = sample.first;
        let (middle, last) = (first + 1, first + 2);
        let second = small("Tau_Ceti", sample.second, vec![first, sample.home]);
        let third = small("Altair", sample.third, vec![middle]);
        let session = &mut sample.session;
        round_trip_step(session, "spike", add(sample.spike.clone()));
        round_trip_step(session, "second", add(second.clone()));
        round_trip_step(session, "third", add(third.clone()));
        let third_planets = planets_of(session, last);
        let lanes = session.system(middle).expect("the middle").lanes.clone();

        let mut again = rerolled(sample.spike.clone());
        again.name = second.name.clone();
        let result = round_trip_step(session, "reroll the middle", reroll(middle, again));
        assert!(result.renumbered.is_empty());
        let rolled = session.system(middle).expect("the middle, rolled again");
        assert_eq!(rolled.star_class, "sc_m");
        assert_eq!(rolled.lanes, lanes);
        let kept = session.system(last).expect("the third keeps its id");
        assert_eq!((kept.name.key.as_str(), kept.x), ("Altair", third.x));
        assert_eq!(planets_of(session, last), third_planets);

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
        assert_eq!(planets_of(&reopened, middle), planets_of(session, middle));
        assert_eq!(
            findings(&reopened),
            opened,
            "{first}: the save's own findings"
        );
    }
}

#[test]
fn the_diff_a_reroll_writes() {
    let mut sample = samples().into_iter().next().expect("the 4.5 sample");
    let session = &mut sample.session;
    session.apply(add(mura())).expect("add");
    let before = text(session);
    let result = session
        .apply(reroll(sample.first, rerolled(mura())))
        .expect("reroll");
    let after = text(session);
    let mut report = String::new();
    writeln!(report, "{}", result.entry.description).unwrap();
    writeln!(report, "touched: {:?}", result.touched).unwrap();
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(&before, &after);
    write!(
        report,
        "{}",
        diff.unified_diff()
            .context_radius(3)
            .header("before", "after")
    )
    .unwrap();
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
        for mut sample in samples() {
            let first = sample.first;
            let spike = match variant {
                "belted" => belted(sample.spike.clone()),
                "awkward" => awkward(sample.spike.clone()),
                _ => sample.spike.clone(),
            };
            let session = &mut sample.session;
            session.apply(add(spike.clone())).expect("add");
            let star = planets_of(session, first)[0];
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
    for mut sample in samples() {
        let first = sample.first;
        let session = &mut sample.session;
        round_trip_step(session, "add", add(sample.spike.clone()));
        let planet = planets_of(session, first)[1];
        round_trip_step(
            session,
            "a deposit on the added planet",
            Op::AddSaveDeposit {
                planet,
                kind: "d_minerals_3".to_owned(),
            },
        );
        let with_deposit = current(session);
        round_trip_step(
            session,
            "reroll",
            reroll(first, rerolled(sample.spike.clone())),
        );
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
    let mut sample = samples().into_iter().next().expect("the 4.5 sample");
    let first = sample.first;
    let session = &mut sample.session;
    let other = sgf_core::ops::free_star_names(&session.doc)
        .into_iter()
        .find(|name| *name != sample.spike.name)
        .expect("a free name");
    session.apply(add(sample.spike.clone())).expect("add");
    assert_eq!(pooled(session, &sample.spike.name), 0);
    let mut again = rerolled(sample.spike.clone());
    again.name = other.clone();
    let result = round_trip_step(session, "reroll renamed", reroll(first, again));
    assert_eq!(
        result.entry.description,
        format!("Rolled Mura (#601) again as {other}, sc_m, with 4 bodies")
    );
    assert_eq!(session.system(first).unwrap().name.key, other);
    assert_eq!(pooled(session, &sample.spike.name), 1);
    assert_eq!(pooled(session, &other), 0);
    session
        .apply(Op::RemoveSystem { id: first })
        .expect("remove");
    assert_eq!(current(session), session.doc.original());
}

#[test]
fn what_a_reroll_refuses() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for mut sample in samples() {
        let first = sample.first;
        let session = &mut sample.session;
        let error = session
            .apply(reroll(sample.joiner, rerolled(sample.spike.clone())))
            .expect_err("a system the file held");
        assert!(
            matches!(error, OpError::SystemNotAdded(id) if id == sample.joiner),
            "{error}"
        );
        let error = session
            .apply(reroll(99_999, rerolled(sample.spike.clone())))
            .expect_err("no such system");
        assert!(matches!(error, OpError::UnknownSystem(99_999)), "{error}");

        session.apply(add(sample.spike.clone())).expect("add");
        let written = current(session);
        let mut bad = rerolled(sample.spike.clone());
        bad.star_class.clear();
        let error = session
            .apply(reroll(first, bad))
            .expect_err("no star class");
        assert!(matches!(error, OpError::EmptyStarClass), "{error}");
        assert_eq!(current(session), written, "a refusal writes nothing");

        let path = dir.path().join(format!("{first}.sav"));
        session.save_as(&path).expect("save");
        let mut reopened = Session::open(&path).expect("reopen");
        let error = reopened
            .apply(reroll(first, rerolled(sample.spike.clone())))
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
    let mut sample = samples().into_iter().next().expect("the 4.5 sample");
    let (first, home) = (sample.first, sample.home);
    let session = &mut sample.session;
    assert!(added_ids(&GalaxyView::from(&session.graph)).is_empty());

    let result = session.apply(add(sample.spike.clone())).expect("add");
    let delta = session.edit_result(result).delta;
    let sent: Vec<(u32, bool)> = delta.systems.iter().map(|s| (s.id, s.added)).collect();
    assert!(sent.contains(&(first, true)), "{sent:?}");
    assert!(sent.iter().all(|&(id, added)| added == (id == first)));
    let detail = SystemDetail::of(&session.graph, first).expect("the detail");
    assert!(detail.system.added);
    assert!(!SystemDetail::of(&session.graph, home).unwrap().system.added);

    session
        .apply(add(small("Tau_Ceti", sample.second, vec![home])))
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
