//! Removing a system added since the save was opened, on the 4.5 and the 4.4 sample: what
//! the add wrote comes out byte for byte, the systems added after it take the ids below
//! theirs, undo and redo are byte-exact, the name goes back to the pool, belts and
//! asteroid names come out with it, and a system the file held is refused.

use std::collections::BTreeSet;

use sgf_core::entity::views::NodeValue;
use sgf_core::entity::{EntityAddr, EntityKind, get_entity};
use sgf_core::ops::{Op, OpError, SystemMove, SystemSpec};
use sgf_core::session::Session;

use crate::common;
use common::diff::{assert_fresh, round_trip_step, step_report};
use common::spec::{SAMPLE_4_4, SAMPLE_4_5, SAMPLES, Sample, belted, mura, small};
use common::{current, findings, planet_ids, pooled, text};

const GENERATION: u32 = 1 << 24;
const SLOT_MASK: u32 = GENERATION - 1;
/// Inside Nythran Expanse's radius on the 4.5 sample and clear of its systems.
const IN_NYTHRAN_EXPANSE: (f64, f64) = (-330.0, -75.0);
/// A member of Nythran Expanse on the 4.5 sample.
const PHARGIS: u32 = 171;

fn add(spec: SystemSpec) -> Op {
    Op::AddSaveSystem { spec }
}

fn remove(id: u32) -> Op {
    Op::RemoveSystem { id }
}

/// The second of three: a small system at the sample's first spot, linked to the spike
/// and to the system the file holds near it.
fn second(sample: &Sample) -> SystemSpec {
    small("Tau_Ceti", sample.spots[0], vec![sample.id, sample.near[0]])
}

/// `sample` with its spike system, the second and a third linked to both of them and to
/// the system near its spot, and a lane from the joiner to the third.
fn three(sample: &Sample) -> (Session, SystemSpec) {
    let first = sample.id;
    let third = small(
        "Fellix",
        sample.spots[1],
        vec![first, first + 1, sample.near[1]],
    );
    let mut session = (sample.open)();
    let steps = [
        add((sample.spike)()),
        add(second(sample)),
        add(third.clone()),
        Op::AddLane {
            a: sample.joiner,
            b: first + 2,
            bridge: false,
        },
    ];
    for op in steps {
        session.apply(op).expect("set the three systems up");
    }
    (session, third)
}

fn lanes_of(session: &Session, id: u32) -> BTreeSet<u32> {
    let system = session.system(id).expect("the system");
    system.lanes.iter().map(|lane| lane.to).collect()
}

fn system_entity(session: &Session, id: u32) -> bool {
    get_entity(&session.doc, EntityAddr::new(EntityKind::System, id), &[]).is_ok()
}

#[test]
fn removing_the_middle_of_three_renumbers_the_third() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for sample in &SAMPLES {
        let before = findings(&(sample.open)());
        let (mut session, third) = three(sample);
        let (first, joiner) = (sample.id, sample.joiner);
        let (middle, last) = (first + 1, first + 2);
        let third_planets = planet_ids(&session, last);
        let session = &mut session;

        let result = round_trip_step(session, "remove the middle", remove(middle));
        assert_eq!(result.renumbered, [(middle, None), (last, Some(middle))]);
        let edit = session.edit_result(result.clone());
        assert_eq!(edit.delta.renumbered, result.renumbered);
        assert_eq!(edit.delta.removed, [last]);

        assert!(session.system(last).is_none());
        let moved = session.system(middle).expect("the third, renumbered");
        assert_eq!(moved.name.key, third.name);
        assert_eq!((moved.x, moved.y), (third.x, third.y));
        assert_eq!(
            lanes_of(session, middle),
            BTreeSet::from([first, sample.near[1], joiner])
        );
        assert!(lanes_of(session, first).contains(&middle));
        assert!(!lanes_of(session, first).contains(&last));
        assert!(lanes_of(session, joiner).contains(&middle));
        assert!(!lanes_of(session, sample.near[0]).contains(&middle));
        assert_eq!(planet_ids(session, middle), third_planets);
        for planet in &third_planets {
            let addr = EntityAddr::new(EntityKind::Planet, *planet);
            let origin = get_entity(&session.doc, addr, &["coordinate".to_owned()])
                .expect("the planet")
                .nodes
                .into_iter()
                .find(|n| n.key.as_deref() == Some("origin"))
                .expect("its origin");
            assert!(
                matches!(&origin.value, NodeValue::Scalar { text, .. } if *text == middle.to_string()),
                "{origin:?}"
            );
        }
        let hits = session
            .search(&third.name, 20, &|_| None, &|_| Vec::new())
            .hits;
        assert!(hits.iter().any(|h| h.id == middle), "{hits:?}");
        assert!(
            system_entity(session, middle),
            "the inspector finds the renumbered system"
        );

        let undone = session.undo().expect("undo").expect("an op to undo");
        assert_eq!(undone.renumbered, [(middle, Some(last))]);
        assert_eq!(planet_ids(session, last), third_planets);
        assert!(
            system_entity(session, last),
            "the inspector finds the third at its own id again"
        );
        let redone = session.redo().expect("redo").expect("an op to redo");
        assert_eq!(redone.renumbered, result.renumbered);
        assert_eq!(planet_ids(session, middle), third_planets);
        assert!(!system_entity(session, last));

        let path = dir.path().join(format!("{first}.sav"));
        session.save_as(&path).expect("save");
        let reopened = Session::open(&path).expect("reopen");
        let ids: Vec<u32> = reopened
            .graph
            .systems
            .keys()
            .copied()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        assert_eq!(ids, (0..=middle).collect::<Vec<_>>(), "dense ids");
        assert!(text(&reopened).contains(&format!("\nlast_created_system={middle}\n")));
        assert_eq!(lanes_of(&reopened, middle), lanes_of(session, middle));
        assert_eq!(
            findings(&reopened),
            before,
            "{first}: the save's own findings"
        );
    }
}

#[test]
fn the_diff_a_removal_writes() {
    let (mut session, _) = three(SAMPLE_4_5);
    let report = step_report(&mut session, remove(SAMPLE_4_5.id + 1));
    common::snapshot("remove_the_middle_of_three", &report);
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
                ids: vec![first, home],
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

#[test]
fn reused_slots_get_their_tombstones_back() {
    let mut session = (SAMPLE_4_5.open)();
    let (first, spots) = (SAMPLE_4_5.id, SAMPLE_4_5.spots);
    let mut second = mura();
    second.name = "Tau_Ceti".to_owned();
    (second.x, second.y) = spots[0];
    session.apply(add(mura())).expect("the first");
    session.apply(add(second)).expect("the second");
    let later = planet_ids(&session, first + 1);
    session.apply(remove(first)).expect("remove the first");

    let text = text(&session);
    assert!(text.contains("\n\t\t57=none\n"), "the planet's tombstone");
    for deposit in [0, 1] {
        assert!(
            text.contains(&format!("\n\t{deposit}=none\n")),
            "deposit {deposit}'s tombstone"
        );
    }
    assert_eq!(
        planet_ids(&session, first),
        later,
        "planet ids do not change"
    );

    let mut again = mura();
    (again.x, again.y) = spots[1];
    session.apply(add(again)).expect("add a third");
    assert_eq!(
        planet_ids(&session, first + 1)[0],
        57 | GENERATION,
        "the next add takes the freed slot"
    );
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
        assert_eq!(current(session), session.doc.original());
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
        assert_eq!(current(session), session.doc.original());

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
        .graph
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

/// Two removals at once, then the same two as a batch of two removals of the first: each
/// reports the renumbering of what follows both as one.
#[test]
fn removing_two_at_once_renumbers_what_follows_both() {
    let (mut session, _) = three(SAMPLE_4_5);
    let first = SAMPLE_4_5.id;
    let fourth = small("Altair", (-280.0, -150.0), vec![first + 2]);
    session.apply(add(fourth)).expect("a fourth");
    let renumbered = [
        (first, None),
        (first + 1, None),
        (first + 2, Some(first)),
        (first + 3, Some(first + 1)),
    ];

    let result = round_trip_step(
        &mut session,
        "remove two",
        Op::RemoveSystems {
            ids: vec![first + 2, first],
        },
    );
    assert_eq!(
        result.renumbered,
        [
            (first, None),
            (first + 2, None),
            (first + 1, Some(first)),
            (first + 3, Some(first + 1)),
        ]
    );
    assert_eq!(session.system(first).unwrap().name.key, "Tau_Ceti");
    assert_eq!(session.system(first + 1).unwrap().name.key, "Altair");
    assert!(session.system(first + 2).is_none());

    session.undo().expect("undo").expect("the removal");
    let result = round_trip_step(
        &mut session,
        "remove the first twice over",
        Op::Batch {
            description: "Removed two".to_owned(),
            ops: vec![remove(first), remove(first)],
        },
    );
    assert_eq!(result.renumbered, renumbered);
    assert_eq!(session.system(first).unwrap().name.key, "Fellix");
}

#[test]
fn a_moved_and_restyled_system_comes_out_whole() {
    for sample in &SAMPLES {
        let (mut session, spike, first) = ((sample.open)(), (sample.spike)(), sample.id);
        let session = &mut session;
        round_trip_step(session, "add", add(spike.clone()));
        let star = planet_ids(session, first)[0];
        let steps = [
            Op::MoveSystem {
                id: first,
                x: spike.x + 3.0,
                y: spike.y,
            },
            Op::SetStarClass {
                id: first,
                class: "sc_m".to_owned(),
                bodies: vec![sgf_core::ops::StarBody {
                    planet: star,
                    class: "pc_m_star".to_owned(),
                }],
            },
            Op::SetPlanetSize { id: star, size: 30 },
        ];
        for op in steps {
            round_trip_step(session, &format!("{op:?}"), op);
        }
        let result = round_trip_step(session, "remove", remove(first));
        assert_eq!(result.renumbered, [(first, None)]);
        assert_eq!(current(session), session.doc.original());
        assert!(session.system(first).is_none());
        assert!(!system_entity(session, first));
    }
}

#[test]
fn nebula_member_lines_follow_the_renumbering() {
    let (mut session, _) = three(SAMPLE_4_4);
    let (middle, last) = (SAMPLE_4_4.id + 1, SAMPLE_4_4.id + 2);
    let (x, y) = common::NEBULA_0_CENTRE;
    let session = &mut session;
    round_trip_step(
        session,
        "into the cloud",
        Op::MoveSystems {
            moves: vec![
                SystemMove {
                    id: middle,
                    x: x + 3.0,
                    y,
                },
                SystemMove {
                    id: last,
                    x: x - 3.0,
                    y,
                },
            ],
        },
    );
    let members = |session: &Session| session.graph.nebulae[0].systems.clone();
    assert!(
        members(session).ends_with(&[middle, last]),
        "{:?}",
        members(session)
    );
    round_trip_step(session, "remove the middle", remove(middle));
    assert!(
        members(session).ends_with(&[middle]),
        "{:?}",
        members(session)
    );
    assert!(!members(session).contains(&last));
    assert_eq!(session.system(middle).unwrap().nebula, Some(0));
    assert!(text(session).contains(&format!("\tgalactic_object={middle}\n")));
    assert!(!text(session).contains(&format!("\tgalactic_object={last}\n")));
}

/// The slots of a table's entries, as the text holds them, and whether none is missing
/// between the lowest and the highest.
fn contiguous(text: &str, head: &str, close: &str, indent: &str) -> bool {
    let start = text.find(head).expect("the table") + head.len();
    let end = start + text[start..].find(close).expect("its end");
    let mut slots: Vec<u32> = text[start..end]
        .lines()
        .filter_map(|line| line.strip_prefix(indent))
        .filter(|line| !line.starts_with('\t'))
        .filter_map(|line| line.split_once('=')?.0.parse::<u32>().ok())
        .map(|id| id & SLOT_MASK)
        .collect();
    slots.sort_unstable();
    let (Some(&low), Some(&high)) = (slots.first(), slots.last()) else {
        return true;
    };
    slots == (low..=high).collect::<Vec<_>>()
}

fn no_slot_missing(session: &Session) -> bool {
    let text = text(session);
    let planets = "\nplanets=\n{\n\tplanet=\n\t{\n";
    let deposits = "\ndeposit=\n{\n";
    contiguous(&text, planets, "\n\t}\n", "\t\t") && contiguous(&text, deposits, "\n}\n", "\t")
}

#[test]
fn a_removal_leaves_no_slot_missing_and_the_next_add_takes_its_tombstones() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for sample in &SAMPLES {
        assert!(no_slot_missing(&(sample.open)()), "the sample as opened");
        let (mut session, _) = three(sample);
        let (first, middle) = (sample.id, sample.id + 1);
        let freed = planet_ids(&session, middle);
        let session = &mut session;
        session.apply(remove(middle)).expect("remove the middle");
        assert!(no_slot_missing(session), "{first}: after the removal");
        let text = text(session);
        for planet in &freed {
            assert!(
                text.contains(&format!("\n\t\t{planet}=none\n")),
                "{first}: planet {planet}'s tombstone"
            );
        }

        let path = dir.path().join(format!("{first}.sav"));
        session.save_as(&path).expect("save");
        let mut reopened = Session::open(&path).expect("reopen");
        assert!(no_slot_missing(&reopened), "{first}: reopened");
        let again = small("Tau_Ceti", sample.spots[0], vec![first]);
        let expected: Vec<u32> = freed.iter().map(|&p| p | GENERATION).collect();
        let taken = round_trip_step(session, "add again", add(again.clone())).touched;
        assert!(taken.contains(&(first + 2)));
        assert_eq!(
            planet_ids(session, first + 2),
            expected,
            "{first}: in the session"
        );
        reopened.apply(add(again)).expect("add after reopening");
        assert_eq!(
            planet_ids(&reopened, first + 2),
            expected,
            "{first}: reopened"
        );
        assert!(no_slot_missing(session) && no_slot_missing(&reopened));
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
        round_trip_step(session, "add", add(spike.clone()));
        let added = current(session);
        round_trip_step(session, "add another", add(other));
        let both = current(session);

        let result = round_trip_step(session, "remove the first", remove(first));
        let Op::AddSaveSystem { spec } = &result.inverse else {
            panic!("{:?}", result.inverse);
        };
        assert_eq!(without_angles(spec), without_angles(&spike));
        session.undo().expect("undo").expect("an op to undo");
        assert_eq!(current(session), both);

        round_trip_step(session, "remove the other", remove(first + 1));
        assert_eq!(current(session), added);
        let result = round_trip_step(session, "remove it", remove(first));
        assert_eq!(current(session), session.doc.original());
        session.apply(result.inverse).expect("apply the inverse");
        assert_eq!(current(session), added, "the same text at the same id");
    }
}
