//! The inverse of removing a system added to a save puts back what the removal took: its
//! lanes and bridges, its nebula and cloud, its name in the pool, its belts and the edits
//! made to it; and a system the file held is refused.

use std::collections::BTreeSet;

use sgf_core::ops::{Op, OpError, SystemSpec};
use sgf_core::session::Session;

use crate::common;
use crate::ops_remove_added_system::{add, remove, second, system_entity};
use common::diff::{assert_fresh, round_trip_step, step_report};
use common::spec::{SAMPLE_4_5, SAMPLES, belted, mura};
use common::{current, planet_ids, pooled, text};

/// Inside Nythran Expanse's radius on the 4.5 sample and clear of its systems.
const IN_NYTHRAN_EXPANSE: (f64, f64) = (-330.0, -75.0);
/// A member of Nythran Expanse on the 4.5 sample.
const PHARGIS: u32 = 171;

/// The cloud system `id` lists last, as its ambient object's id and type.
fn cloud(session: &Session, id: u32) -> Option<(u32, String)> {
    let text = text(session);
    let systems = text.find("\ngalactic_object=\n{\n")?;
    let entry = systems + text[systems..].find(&format!("\n\t{id}=\n\t{{\n"))?;
    let end = entry + text[entry..].find("\n\t}\n")?;
    let list = entry + text[entry..end].find("\t\tambient_object=\n\t\t{\n\t\t\t")?;
    let ids = text[list..].lines().nth(2)?;
    let last: u32 = ids.split_whitespace().last()?.parse().ok()?;
    let table = text.find("\nambient_object=\n{\n")?;
    let at = table + text[table..].find(&format!("\n\t{last}=\n\t{{\n"))?;
    let data = at + text[at..].find("\t\tdata=\"")? + "\t\tdata=\"".len();
    let kind = &text[data..data + text[data..].find('"')?];
    Some((last, kind.to_owned()))
}

#[test]
fn a_system_the_file_held_is_refused() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for sample in &SAMPLES {
        let (mut session, first, home) = ((sample.open)(), sample.id, sample.home());
        let error = session.apply(remove(home)).expect_err("refused");
        assert!(
            matches!(error, OpError::SystemNotAdded(id) if id == home),
            "{error}"
        );
        let error = session.apply(remove(99_999)).expect_err("refused");
        assert!(matches!(error, OpError::UnknownSystem(99_999)), "{error}");

        session.apply(add((sample.spike)())).expect("add");
        let path = dir.path().join(format!("{first}.sav"));
        session.save_as(&path).expect("save");
        let error = session
            .apply(Op::RemoveSystems {
                systems: vec![first, home],
            })
            .expect_err("one of them was in the file");
        assert!(
            matches!(error, OpError::SystemNotAdded(id) if id == home),
            "{error}"
        );
        assert!(!session.is_dirty(), "a refusal writes nothing");
        session
            .apply(remove(first))
            .expect("still removable after a save, in the session that added it");

        let mut reopened = Session::open(&path).expect("reopen");
        let error = reopened.apply(remove(first)).expect_err("refused");
        assert!(
            matches!(error, OpError::SystemNotAdded(id) if id == first),
            "{error}"
        );
        assert!(!reopened.is_dirty());
    }
}

/// The add's inverse removes the system; a removal of one of two namesakes leaves the
/// name taken, of both gives it back; and an add after that takes it again, writing the
/// pool line as the first add did.
#[test]
fn the_name_returns_to_the_pool_and_is_taken_again() {
    for sample in &SAMPLES {
        let (mut session, spike, first) = ((sample.open)(), (sample.spike)(), sample.id);
        let session = &mut session;
        let names = |session: &Session| pooled(session, "star_names", &spike.name);
        assert_eq!(names(session), 1);
        let result = session.apply(add(spike.clone())).expect("add");
        assert_eq!(result.inverse, remove(first));
        let added = current(session);
        session.apply(result.inverse).expect("apply the inverse");
        assert_eq!(current(session), session.doc().original());
        assert_fresh(session, "the inverse applied");

        session.apply(add(spike.clone())).expect("add");
        let mut twin = spike.clone();
        (twin.x, twin.y) = sample.spots[0];
        session.apply(add(twin)).expect("add one of the same name");
        assert_eq!(names(session), 0);
        session.apply(remove(first)).expect("remove the first");
        assert_eq!(names(session), 0, "the other still holds the name");
        session.apply(remove(first)).expect("remove the other");
        assert_eq!(names(session), 1);
        assert_eq!(current(session), session.doc().original());

        round_trip_step(session, "add it again", add(spike.clone()));
        assert_eq!(names(session), 0);
        assert_eq!(
            current(session),
            added,
            "the pool line goes as the first add took it"
        );
    }
}

/// What a removal's inverse puts back besides the spec: the nebula the system stood in,
/// with its cloud and cloaking, a bridge lane and a lane length set by hand.
#[test]
fn a_removals_inverse_puts_back_its_nebula_its_bridge_and_a_set_length() {
    let mut session = (SAMPLE_4_5.open)();
    let mut spike = mura();
    (spike.x, spike.y) = IN_NYTHRAN_EXPANSE;
    let (mura, home) = (SAMPLE_4_5.id, spike.lanes[0]);
    session
        .apply(add(spike))
        .expect("add inside Nythran Expanse");
    session
        .apply(Op::SetLaneLength {
            a: mura,
            b: home,
            length: 123.5,
        })
        .expect("set a length by hand");
    session
        .apply(Op::AddLane {
            a: mura,
            b: PHARGIS,
            bridge: true,
        })
        .expect("add a bridge");
    let before = current(&session);

    let result = session.apply(remove(mura)).expect("remove");
    let report = step_report(&mut session, result.inverse);
    assert!(current(&session) == before, "{report}");
}

/// System `id`'s lanes as (other end, bridge, length), each end in `ids` renamed.
fn lanes_as(session: &Session, id: u32, ids: &[(u32, u32)]) -> BTreeSet<(u32, bool, String)> {
    let system = session.system(id).expect("the system");
    let rename = |to: u32| {
        ids.iter()
            .find(|&&(old, _)| old == to)
            .map_or(to, |&(_, new)| new)
    };
    let lanes = system.lanes.iter();
    lanes
        .map(|lane| (rename(lane.to), lane.bridge, lane.length.to_string()))
        .collect()
}

/// The same, where the removed system was not the last one added: its first lane is a
/// bridge, it has two, and the system added after it takes its id and back again.
#[test]
fn a_removals_inverse_puts_back_bridges_first_and_a_cloud_when_a_later_system_renumbers() {
    let mut session = (SAMPLE_4_5.open)();
    let mut spike = mura();
    (spike.x, spike.y) = IN_NYTHRAN_EXPANSE;
    let home = spike.lanes[0];
    spike.lanes.clear();
    let (mura, later) = (SAMPLE_4_5.id, SAMPLE_4_5.id + 1);
    let other = session
        .graph()
        .systems
        .values()
        .filter(|s| ![PHARGIS, home].contains(&s.id))
        .min_by(|a, b| {
            let d = |s: &sgf_core::projections::galaxy::SystemNode| {
                (s.x - IN_NYTHRAN_EXPANSE.0).hypot(s.y - IN_NYTHRAN_EXPANSE.1)
            };
            d(a).total_cmp(&d(b))
        })
        .expect("a third neighbour")
        .id;
    let steps = [
        add(spike),
        Op::AddLanes {
            from: mura,
            to: vec![(PHARGIS, true), (home, false), (other, true)],
        },
        Op::SetLaneLength {
            a: mura,
            b: home,
            length: 123.5,
        },
        add(second(SAMPLE_4_5)),
    ];
    for op in steps {
        session.apply(op).expect("set the system up");
    }
    let nebula = session.system(mura).expect("the system").nebula;
    assert!(nebula.is_some(), "it stands in Nythran Expanse");
    // Once removed and put back, the later system is 601 and this one 602.
    let lanes = lanes_as(&session, mura, &[(later, mura)]);
    let cloud_before = cloud(&session, mura).expect("its cloud");

    let result = session.apply(remove(mura)).expect("remove");
    assert_eq!(result.renumbered, [(mura, None), (later, Some(mura))]);
    assert!(
        matches!(&result.inverse, Op::Batch { ops, .. } if ops.len() > 1),
        "{:?}",
        result.inverse
    );
    session.apply(result.inverse).expect("apply the inverse");

    let again = session.system(later).expect("the system added back");
    assert_eq!(again.nebula, nebula);
    assert_eq!(lanes_as(&session, later, &[]), lanes);
    assert_eq!(cloud(&session, later), Some(cloud_before));
}

#[test]
fn a_moved_and_restyled_system_comes_out_whole() {
    for sample in &SAMPLES {
        let (mut session, spike, first) = ((sample.open)(), (sample.spike)(), sample.id);
        let session = &mut session;
        session.apply(add(spike.clone())).expect("add");
        let star = planet_ids(session, first)[0];
        let steps = [
            Op::MoveSystem {
                system: first,
                x: spike.x + 3.0,
                y: spike.y,
            },
            Op::SetStarClass {
                system: first,
                class: "sc_m".to_owned(),
                bodies: vec![sgf_core::ops::StarBody {
                    body: star,
                    class: "pc_m_star".to_owned(),
                }],
            },
            Op::SetBodySize {
                body: star,
                size: 30,
            },
        ];
        for op in steps {
            round_trip_step(session, &format!("{op:?}"), op);
        }
        let result = round_trip_step(session, "remove", remove(first));
        assert_eq!(result.renumbered, [(first, None)]);
        assert_eq!(current(session), session.doc().original());
        assert!(session.system(first).is_none());
        assert!(!system_entity(session, first));
    }
}

/// A spec with every angle zeroed, since one read back is measured from the coordinates.
fn without_angles(spec: &SystemSpec) -> SystemSpec {
    let mut spec = spec.clone();
    for planet in &mut spec.planets {
        planet.angle = 0.0;
        planet.moons.iter_mut().for_each(|moon| moon.angle = 0.0);
    }
    spec
}

#[test]
fn a_belted_system_comes_out_whole_and_its_removal_adds_it_back() {
    for sample in &SAMPLES {
        let (mut session, first) = ((sample.open)(), sample.id);
        let spike = belted((sample.spike)());
        let mut other = spike.clone();
        other.name = "Tau_Ceti".to_owned();
        (other.x, other.y) = sample.spots[0];
        let session = &mut session;
        session.apply(add(spike.clone())).expect("add");
        let added = current(session);
        round_trip_step(session, "add another", add(other));
        let both = current(session);

        let result = round_trip_step(session, "remove the first", remove(first));
        let Op::AddSystemFromSpec { spec } = &result.inverse else {
            panic!("{:?}", result.inverse);
        };
        assert_eq!(without_angles(spec), without_angles(&spike));
        session.undo().expect("undo").expect("an op to undo");
        assert_eq!(current(session), both);

        round_trip_step(session, "remove the other", remove(first + 1));
        assert_eq!(current(session), added);
        let result = round_trip_step(session, "remove it", remove(first));
        assert_eq!(current(session), session.doc().original());
        session.apply(result.inverse).expect("apply the inverse");
        assert_eq!(current(session), added, "the same text at the same id");
    }
}
