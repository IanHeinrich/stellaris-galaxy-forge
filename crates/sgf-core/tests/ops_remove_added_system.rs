//! Removing a system added since the save was opened, on the 4.5 and the 4.4 sample: what
//! the add wrote comes out byte for byte, the systems added after it take the ids below
//! theirs, reused slots get their tombstones back, and undo and redo are byte-exact.

use std::collections::BTreeSet;

use sgf_core::entity::views::NodeValue;
use sgf_core::entity::{EntityAddr, EntityKind, get_entity};
use sgf_core::ops::{Op, SystemMove, SystemSpec};
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip_step, step_report};
use common::spec::{SAMPLE_4_4, SAMPLE_4_5, SAMPLES, Sample, mura, small};
use common::{findings, planet_ids, text};

const GENERATION: u32 = 1 << 24;
const SLOT_MASK: u32 = GENERATION - 1;

pub(crate) fn add(spec: SystemSpec) -> Op {
    Op::AddSystemFromSpec { spec }
}

pub(crate) fn remove(id: u32) -> Op {
    Op::RemoveSystem { system: id }
}

/// The second of three: a small system at the sample's first spot, linked to the spike
/// and to the system the file holds near it.
pub(crate) fn second(sample: &Sample) -> SystemSpec {
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

pub(crate) fn system_entity(session: &Session, id: u32) -> bool {
    get_entity(session.doc(), EntityAddr::new(EntityKind::System, id), &[]).is_ok()
}

#[test]
fn removing_the_middle_of_three_renumbers_the_third() {
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
            let origin = get_entity(session.doc(), addr, &["coordinate".to_owned()])
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

        let reopened = common::reopened(session);
        let ids: Vec<u32> = reopened
            .graph()
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
            systems: vec![first + 2, first],
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
                    system: middle,
                    x: x + 3.0,
                    y,
                },
                SystemMove {
                    system: last,
                    x: x - 3.0,
                    y,
                },
            ],
        },
    );
    let members = |session: &Session| session.graph().nebulae[0].systems.clone();
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

        let mut reopened = common::reopened(session);
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
