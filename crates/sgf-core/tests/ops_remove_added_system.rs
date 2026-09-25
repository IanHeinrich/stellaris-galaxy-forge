//! Removing a system added since the save was opened, on the 4.5 and the 4.4 sample: what
//! the add wrote comes out byte for byte, the systems added after it take the ids below
//! theirs, undo and redo are byte-exact, belts and asteroid names come out with it, and a
//! system the file held is refused.

use std::collections::BTreeSet;
use std::fmt::Write as _;

use sgf_core::entity::views::NodeValue;
use sgf_core::entity::{EntityAddr, EntityKind, get_entity};
use sgf_core::ops::{BodySpec, Op, OpError, SystemMove, SystemSpec};
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;
use similar::{Algorithm, TextDiff};

use crate::common;
use common::diff::{assert_fresh, round_trip_step};
use common::spec::{belted, body, dorellion, mura, star};
use common::{current, open, open_4_5, text};

const GENERATION: u32 = 1 << 24;
const SLOT_MASK: u32 = GENERATION - 1;
/// Inside Nythran Expanse's radius on the 4.5 sample and clear of its systems.
const IN_NYTHRAN_EXPANSE: (f64, f64) = (-330.0, -75.0);
/// A member of Nythran Expanse on the 4.5 sample.
const PHARGIS: u32 = 171;

/// One sample with the ids and systems a test adds to it.
struct Sample {
    session: Session,
    /// The spike's system, which takes `first`.
    spike: SystemSpec,
    first: u32,
    /// Two more beside it: the second linked to the spike and to `second_home`, the third
    /// to both of them and to `third_home`.
    second: (&'static str, (f64, f64), u32),
    third: (&'static str, (f64, f64), u32),
    /// A system the file holds that a later `AddLane` joins to the third.
    joiner: u32,
}

fn samples() -> [Sample; 2] {
    [
        Sample {
            session: open_4_5(),
            spike: mura(),
            first: 601,
            second: ("Tau_Ceti", (-270.0, -130.0), 420),
            third: ("Fellix", (-300.0, -120.0), 544),
            joiner: 149,
        },
        Sample {
            session: open(),
            spike: dorellion(),
            first: 791,
            second: ("Tau_Ceti", (415.0, -190.0), 217),
            third: ("Romin", (420.0, -222.0), 278),
            joiner: 614,
        },
    ]
}

fn add(spec: SystemSpec) -> Op {
    Op::AddSaveSystem { spec }
}

fn remove(id: u32) -> Op {
    Op::RemoveSystem { id }
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
        star: star(body("pc_k_star", 20, 0.0, 0.0, 0)),
        planets: vec![planet],
        lanes,
        ..SystemSpec::default()
    }
}

/// The sample with its spike system and the two small ones after it, and a lane from
/// `joiner` to the third, each step round-tripped.
fn three(sample: &mut Sample) -> SystemSpec {
    let first = sample.first;
    let (name, at, home) = sample.second;
    let second = small(name, at, vec![first, home]);
    let (name, at, home) = sample.third;
    let third = small(name, at, vec![first, first + 1, home]);
    let session = &mut sample.session;
    round_trip_step(session, "spike", add(sample.spike.clone()));
    round_trip_step(session, "second", add(second));
    round_trip_step(session, "third", add(third.clone()));
    round_trip_step(
        session,
        "join",
        Op::AddLane {
            a: sample.joiner,
            b: first + 2,
            bridge: false,
        },
    );
    third
}

fn findings(session: &Session) -> BTreeSet<(IssueCode, Vec<u32>, String)> {
    session
        .validate()
        .into_iter()
        .map(|issue| (issue.code, issue.systems, issue.message))
        .collect()
}

fn lanes_of(session: &Session, id: u32) -> BTreeSet<u32> {
    let system = session.system(id).expect("the system");
    system.lanes.iter().map(|lane| lane.to).collect()
}

/// The planets the details list for system `id`.
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
fn adding_one_and_removing_it_gives_back_the_file_as_opened() {
    for mut sample in samples() {
        let id = sample.first;
        let session = &mut sample.session;
        round_trip_step(session, "add", add(sample.spike.clone()));
        let result = round_trip_step(session, "remove", remove(id));
        assert_eq!(result.renumbered, [(id, None)]);
        assert_eq!(current(session), session.doc.original());
        assert!(session.system(id).is_none());
        assert!(get_entity(&session.doc, EntityAddr::new(EntityKind::System, id), &[]).is_err());
    }
}

#[test]
fn removing_the_middle_of_three_renumbers_the_third() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for mut sample in samples() {
        let before = findings(&sample.session);
        let third = three(&mut sample);
        let (first, joiner) = (sample.first, sample.joiner);
        let (middle, last) = (first + 1, first + 2);
        let third_planets = planets_of(&sample.session, last);
        let session = &mut sample.session;

        let result = round_trip_step(session, "remove the middle", remove(middle));
        assert_eq!(result.renumbered, [(middle, None), (last, Some(middle))]);
        let edit = session.edit_result(result.clone());
        assert_eq!(edit.delta.renumbered, result.renumbered);
        assert_eq!(edit.delta.removed, [last]);

        assert!(session.system(last).is_none());
        let moved = session.system(middle).expect("the third, renumbered");
        assert_eq!(moved.name.key, third.name);
        assert_eq!((moved.x, moved.y), (third.x, third.y));
        let (.., second_home) = sample.second;
        let (.., third_home) = sample.third;
        assert_eq!(
            lanes_of(session, middle),
            BTreeSet::from([first, third_home, joiner])
        );
        assert!(lanes_of(session, first).contains(&middle));
        assert!(!lanes_of(session, first).contains(&last));
        assert!(lanes_of(session, joiner).contains(&middle));
        assert!(!lanes_of(session, second_home).contains(&middle));
        assert_eq!(planets_of(session, middle), third_planets);
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
        get_entity(
            &session.doc,
            EntityAddr::new(EntityKind::System, middle),
            &[],
        )
        .expect("the inspector finds the renumbered system");

        let undone = session.undo().expect("undo").expect("an op to undo");
        assert_eq!(undone.renumbered, [(middle, Some(last))]);
        assert_eq!(planets_of(session, last), third_planets);
        get_entity(&session.doc, EntityAddr::new(EntityKind::System, last), &[])
            .expect("the inspector finds the third at its own id again");
        let redone = session.redo().expect("redo").expect("an op to redo");
        assert_eq!(redone.renumbered, result.renumbered);
        assert_eq!(planets_of(session, middle), third_planets);
        assert!(get_entity(&session.doc, EntityAddr::new(EntityKind::System, last), &[]).is_err());

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
    let mut sample = samples().into_iter().next().expect("the 4.5 sample");
    three(&mut sample);
    let session = &mut sample.session;
    let before = text(session);
    let result = session.apply(remove(sample.first + 1)).expect("remove");
    let after = text(session);
    let mut report = String::new();
    writeln!(report, "{}", result.entry.description).unwrap();
    writeln!(report, "renumbered: {:?}", result.renumbered).unwrap();
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
    common::snapshot("remove_the_middle_of_three", &report);
}

#[test]
fn a_system_the_file_held_is_refused() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for mut sample in samples() {
        let home = sample.spike.lanes[0];
        let session = &mut sample.session;
        let error = session.apply(remove(home)).expect_err("refused");
        assert!(
            matches!(error, OpError::SystemNotAdded(id) if id == home),
            "{error}"
        );
        let error = session.apply(remove(99_999)).expect_err("refused");
        assert!(matches!(error, OpError::UnknownSystem(99_999)), "{error}");

        session.apply(add(sample.spike.clone())).expect("add");
        let path = dir.path().join(format!("{}.sav", sample.first));
        session.save_as(&path).expect("save");
        let error = session
            .apply(Op::RemoveSystems {
                ids: vec![sample.first, home],
            })
            .expect_err("one of them was in the file");
        assert!(
            matches!(error, OpError::SystemNotAdded(id) if id == home),
            "{error}"
        );
        assert!(!session.is_dirty(), "a refusal writes nothing");
        session
            .apply(remove(sample.first))
            .expect("still removable after a save, in the session that added it");

        let mut reopened = Session::open(&path).expect("reopen");
        let error = reopened.apply(remove(sample.first)).expect_err("refused");
        assert!(
            matches!(error, OpError::SystemNotAdded(id) if id == sample.first),
            "{error}"
        );
        assert!(!reopened.is_dirty());
    }
}

#[test]
fn reused_slots_get_their_tombstones_back() {
    let mut session = open_4_5();
    let mut second = mura();
    second.name = "Tau_Ceti".to_owned();
    (second.x, second.y) = (-270.0, -130.0);
    round_trip_step(&mut session, "first", add(mura()));
    round_trip_step(&mut session, "second", add(second.clone()));
    let later = planets_of(&session, 602);
    round_trip_step(&mut session, "remove the first", remove(601));

    let text = text(&session);
    assert!(text.contains("\n\t\t57=none\n"), "the planet's tombstone");
    for deposit in [0, 1] {
        assert!(
            text.contains(&format!("\n\t{deposit}=none\n")),
            "deposit {deposit}'s tombstone"
        );
    }
    assert_eq!(planets_of(&session, 601), later, "planet ids do not change");

    let mut again = mura();
    (again.x, again.y) = (-300.0, -120.0);
    session.apply(add(again)).expect("add a third");
    assert_eq!(
        planets_of(&session, 602)[0],
        57 | 1 << 24,
        "the next add takes the freed slot"
    );
}

#[test]
fn the_name_returns_to_the_pool() {
    for mut sample in samples() {
        let name = sample.spike.name.clone();
        let first = sample.first;
        let session = &mut sample.session;
        assert_eq!(pooled(session, &name), 1);
        session.apply(add(sample.spike.clone())).expect("add");
        let mut twin = sample.spike.clone();
        let (_, at, _) = sample.second;
        (twin.x, twin.y) = at;
        session.apply(add(twin)).expect("add one of the same name");
        assert_eq!(pooled(session, &name), 0);

        session.apply(remove(first)).expect("remove the first");
        assert_eq!(pooled(session, &name), 0, "the other still holds the name");
        session.apply(remove(first)).expect("remove the other");
        assert_eq!(pooled(session, &name), 1);
        assert_eq!(current(session), session.doc.original());
    }
}

#[test]
fn the_adds_inverse_takes_it_out_again() {
    for sample in samples() {
        let mut session = sample.session;
        let result = session.apply(add(sample.spike)).expect("add");
        assert_eq!(result.inverse, remove(sample.first));
        session.apply(result.inverse).expect("apply the inverse");
        assert_eq!(current(&session), session.doc.original());
        assert_fresh(&session, "the inverse applied");
    }
}

#[test]
fn a_removals_inverse_adds_the_system_back() {
    for sample in samples() {
        let mut session = sample.session;
        session.apply(add(sample.spike.clone())).expect("add");
        let added = current(&session);
        let result = session.apply(remove(sample.first)).expect("remove");
        let Op::AddSaveSystem { spec } = &result.inverse else {
            panic!("{:?}", result.inverse);
        };
        assert_eq!(spec.lanes, sample.spike.lanes);
        assert_eq!(spec.planets.len(), sample.spike.planets.len());
        session.apply(result.inverse).expect("apply the inverse");
        assert_eq!(current(&session), added, "the same text at the same id");
    }
}

/// What a removal's inverse puts back besides the spec: the nebula the system stood in,
/// with its cloud and cloaking, a bridge lane and a lane length set by hand.
#[test]
fn a_removals_inverse_puts_back_its_nebula_its_bridge_and_a_set_length() {
    let mut session = common::open_4_5();
    let mut spike = mura();
    (spike.x, spike.y) = IN_NYTHRAN_EXPANSE;
    let (mura, home) = (601, spike.lanes[0]);
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
    let before = text(&session);

    let result = session.apply(remove(mura)).expect("remove");
    session.apply(result.inverse).expect("apply the inverse");
    let after = text(&session);
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(&before, &after);
    assert!(
        before == after,
        "{}",
        diff.unified_diff()
            .context_radius(3)
            .header("before", "after")
    );
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
    let mut session = common::open_4_5();
    let mut spike = mura();
    (spike.x, spike.y) = IN_NYTHRAN_EXPANSE;
    let home = spike.lanes[0];
    spike.lanes.clear();
    let (mura, later) = (601, 602);
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
        add(small("Tau_Ceti", (-270.0, -130.0), vec![mura, 420])),
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
fn removing_two_at_once_renumbers_what_follows_both() {
    let mut sample = samples().into_iter().next().expect("the 4.5 sample");
    three(&mut sample);
    let first = sample.first;
    let fourth = small("Altair", (-280.0, -150.0), vec![first + 2]);
    round_trip_step(&mut sample.session, "fourth", add(fourth));
    let result = round_trip_step(
        &mut sample.session,
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
    let session = &sample.session;
    assert_eq!(session.system(first).unwrap().name.key, "Tau_Ceti");
    assert_eq!(session.system(first + 1).unwrap().name.key, "Altair");
    assert!(session.system(first + 2).is_none());
}

#[test]
fn a_batch_reports_the_renumbering_of_its_members_as_one() {
    let mut sample = samples().into_iter().next().expect("the 4.5 sample");
    three(&mut sample);
    let first = sample.first;
    let result = round_trip_step(
        &mut sample.session,
        "remove the first twice over",
        Op::Batch {
            description: "Removed two".to_owned(),
            ops: vec![remove(first), remove(first)],
        },
    );
    assert_eq!(
        result.renumbered,
        [(first, None), (first + 1, None), (first + 2, Some(first))]
    );
}

#[test]
fn a_moved_and_restyled_system_comes_out_whole() {
    for mut sample in samples() {
        let first = sample.first;
        let session = &mut sample.session;
        round_trip_step(session, "add", add(sample.spike.clone()));
        let star = planets_of(session, first)[0];
        let steps = [
            Op::MoveSystem {
                id: first,
                x: sample.spike.x + 3.0,
                y: sample.spike.y,
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
        round_trip_step(session, "remove", remove(first));
        assert_eq!(current(session), session.doc.original());
    }
}

#[test]
fn nebula_member_lines_follow_the_renumbering() {
    let mut sample = samples().into_iter().nth(1).expect("the 4.4 sample");
    three(&mut sample);
    let (middle, last) = (sample.first + 1, sample.first + 2);
    let (x, y) = common::NEBULA_0_CENTRE;
    let session = &mut sample.session;
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
    for mut sample in samples() {
        assert!(no_slot_missing(&sample.session), "the sample as opened");
        three(&mut sample);
        let (first, middle) = (sample.first, sample.first + 1);
        let freed = planets_of(&sample.session, middle);
        let session = &mut sample.session;
        round_trip_step(session, "remove the middle", remove(middle));
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
        let (name, at, _) = sample.second;
        let again = small(name, at, vec![first]);
        let expected: Vec<u32> = freed.iter().map(|&p| p | GENERATION).collect();
        let taken = round_trip_step(session, "add again", add(again.clone())).touched;
        assert!(taken.contains(&(first + 2)));
        assert_eq!(
            planets_of(session, first + 2),
            expected,
            "{first}: in the session"
        );
        reopened.apply(add(again)).expect("add after reopening");
        assert_eq!(
            planets_of(&reopened, first + 2),
            expected,
            "{first}: reopened"
        );
        assert!(no_slot_missing(session) && no_slot_missing(&reopened));
    }
}

#[test]
fn a_name_the_removal_put_back_is_taken_again() {
    for mut sample in samples() {
        let name = sample.spike.name.clone();
        let session = &mut sample.session;
        let opened = current(session);
        session.apply(add(sample.spike.clone())).expect("add");
        let added = current(session);
        session.apply(remove(sample.first)).expect("remove");
        assert_eq!(pooled(session, &name), 1);
        round_trip_step(session, "add it again", add(sample.spike.clone()));
        assert_eq!(pooled(session, &name), 0);
        assert_eq!(
            current(session),
            added,
            "the pool line goes as the first add took it"
        );
        session.undo().expect("undo").expect("an op to undo");
        assert_eq!(current(session), opened);
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
    for mut sample in samples() {
        let first = sample.first;
        let spike = belted(sample.spike.clone());
        let mut other = belted(sample.spike.clone());
        other.name = "Tau_Ceti".to_owned();
        (other.x, other.y) = sample.second.1;
        let session = &mut sample.session;
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
