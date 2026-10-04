//! Ids and names of systems added to a save: consecutive adds take consecutive ids and no
//! shared slot, slots are reused lowest first, the name leaves the pool only when the pool
//! holds it, later ops work on the new system, and a batch undoes as one step.

use std::collections::BTreeSet;

use sgf_core::entity::{EntityAddr, EntityKind, get_entity};
use sgf_core::ops::{Op, OpError, StarBody};

use crate::common;
use crate::ops_add_system::{add, beside, bodies, body_names};
use crate::ops_add_system_refusals::with_asteroid_pool;
use common::diff::{round_trip, round_trip_step};
use common::spec::{SAMPLE_4_5, SAMPLES, belted, dorellion, mura};
use common::{current, open_4_5, pooled, text};

const GENERATION: u32 = 1 << 24;

/// The name database as the text holds it, up to a point past the star names.
fn pool(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes).into_owned();
    let start = text.find("\nrandom_name_database=").expect("the pool");
    text[start..start + 200_000].to_owned()
}

/// The spike's system takes the next id and its name out of the pool, and search and the
/// inspector find it; a second one under a name the pool lacks takes the id after it, no
/// slot of the first and nothing from the pool; and once both are undone, the add writes
/// the same text again.
#[test]
fn two_adds_take_consecutive_ids_share_no_slot_and_one_name_from_the_pool() {
    for sample in &SAMPLES {
        let (mut session, spec, id) = ((sample.open)(), (sample.spike)(), sample.id);
        assert_eq!(pooled(&session, "star_names", &spec.name), 1);
        round_trip_step(&mut session, "first", add(spec.clone()));
        assert_eq!(pooled(&session, "star_names", &spec.name), 0);
        let first_added = current(&session);

        let hits = session
            .search(&spec.name, 20, &|_| None, &|_| Vec::new())
            .hits;
        assert!(hits.iter().any(|h| h.id == id), "{hits:?}");
        let star = bodies(&session, id)[0].0;
        let system = get_entity(session.doc(), EntityAddr::new(EntityKind::System, id), &[])
            .expect("the system's entity");
        assert_eq!(system.addr.id, id);
        get_entity(
            session.doc(),
            EntityAddr::new(EntityKind::Planet, star),
            &[],
        )
        .expect("the star's entity");

        round_trip_step(&mut session, "second", add(beside(&spec, id)));
        assert_eq!(pool(&current(&session)), pool(&first_added));
        assert!(text(&session).contains("key=\"Sgf_Second\""));
        assert!(session.system(id + 1).is_some());
        assert_eq!(
            session.graph().order[session.graph().order.len() - 2..],
            [id, id + 1]
        );
        let lane = session
            .graph()
            .lane(id, id + 1)
            .expect("the lane between them");
        assert!(!lane.stale);

        let first: Vec<u32> = bodies(&session, id).iter().map(|b| b.0).collect();
        let next: Vec<u32> = bodies(&session, id + 1).iter().map(|b| b.0).collect();
        assert!(
            first.iter().all(|p| !next.contains(p)),
            "{first:?} {next:?}"
        );
        let deposits = |id: u32| -> BTreeSet<String> {
            let doc = session.doc();
            bodies(&session, id)
                .iter()
                .flat_map(|&(planet, ..)| {
                    let addr = EntityAddr::new(EntityKind::Planet, planet);
                    let view = get_entity(doc, addr, &["deposits".to_owned()]).ok();
                    view.into_iter()
                        .flat_map(|v| v.nodes.into_iter().map(|n| format!("{:?}", n.value)))
                })
                .collect()
        };
        let (held, next_held) = (deposits(id), deposits(id + 1));
        assert_eq!((held.len(), next_held.len()), (5, 5), "{held:?}");
        assert!(held.is_disjoint(&next_held), "{held:?} {next_held:?}");

        session.undo().unwrap().unwrap();
        session.undo().unwrap().unwrap();
        assert_eq!(current(&session), session.doc().original());
        assert!(session.system(id).is_none());
        session.apply(add(spec)).expect("add again");
        assert_eq!(
            current(&session),
            first_added,
            "the same ids and the same text"
        );
    }
}

#[test]
fn later_ops_work_on_the_new_system_and_undo_back_to_the_original() {
    for sample in &SAMPLES {
        let (mut session, spec, id) = ((sample.open)(), (sample.spike)(), sample.id);
        let home = sample.home();
        session.apply(add(spec.clone())).expect("add");
        let star = bodies(&session, id)[0].0;
        let far = *session
            .graph()
            .order
            .iter()
            .find(|&&other| {
                other != home && other != id && session.graph().lane(id, other).is_none()
            })
            .expect("a system to link");
        let x = spec.x + 3.0;
        let steps = [
            Op::MoveSystem {
                system: id,
                x,
                y: spec.y,
            },
            Op::AddLane {
                a: far,
                b: id,
                bridge: false,
            },
            Op::RemoveLane { a: id, b: home },
            Op::SetStarClass {
                system: id,
                class: "sc_m".to_owned(),
                bodies: vec![StarBody {
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
            let label = format!("{op:?}");
            round_trip_step(&mut session, &label, op);
        }
        let system = session.system(id).unwrap();
        assert_eq!((system.x, system.star_class.as_str()), (x, "sc_m"));
        assert_eq!(bodies(&session, id)[0].1, "pc_m_star");
        while session.undo().expect("undo").is_some() {}
        assert_eq!(current(&session), session.doc().original());
        assert!(session.system(id).is_none());
        assert!(!session.doc().is_dirty());
    }
}

#[test]
fn the_lowest_dead_slots_are_taken_first_one_generation_on() {
    let mut session = open_4_5();
    assert!(text(&session).contains("\n\t\t57=none\n"));
    assert!(text(&session).contains("\n\t0=none\n"));
    session.apply(add(mura())).expect("add the system");
    let text = text(&session);
    let star = 57 | GENERATION;
    assert!(!text.contains("\n\t\t57=none\n"), "the tombstone is taken");
    assert!(text.contains("\n\t\t56="));
    assert!(text.contains(&format!(
        "\n\t\t{star}=\n\t\t{{\n\t\t\tplanet_class=\"pc_g_star\""
    )));
    let listed = bodies(&session, SAMPLE_4_5.id);
    assert_eq!(listed[0].0, star);
    assert_eq!(
        listed[1].0, 6375,
        "then past the highest slot, generation 0"
    );
    let table = &text[text.find("\ndeposit=\n{").expect("the deposit table")..];
    for (slot, deposit) in [(0, "d_energy_5"), (1, "d_black_soil")] {
        let id = slot | GENERATION;
        assert!(
            table.starts_with("\ndeposit=\n{\n\t")
                && !table[..200].contains(&format!("\n\t{slot}=none\n"))
        );
        assert!(table.contains(&format!("\n\t{id}=\n\t{{\n\t\ttype=\"{deposit}\"")));
    }
    let deposit = get_entity(
        session.doc(),
        EntityAddr::new(EntityKind::Deposit, GENERATION),
        &[],
    )
    .expect("the reused deposit's entity");
    assert_eq!(deposit.addr.id, GENERATION);
}

#[test]
fn two_adds_in_one_batch_undo_as_one_step() {
    for sample in &SAMPLES {
        let spec = (sample.spike)();
        let second = beside(&spec, sample.id);
        round_trip(
            (sample.open)(),
            Op::Batch {
                description: "Added two systems".to_owned(),
                ops: vec![add(spec), add(second)],
            },
        );
    }
}

/// A refused member rolls back the batch, and the entities the first member wrote leave
/// the document's list of added ones with its bytes: the next add takes the same ids.
#[test]
fn a_refused_batch_forgets_the_system_it_wrote() {
    for sample in &SAMPLES {
        let (mut session, spec, id) = ((sample.open)(), (sample.spike)(), sample.id);
        let fresh = {
            let mut fresh = (sample.open)();
            fresh.apply(add(spec.clone())).expect("add");
            current(&fresh)
        };
        let mut refused_member = spec.clone();
        refused_member.name = String::new();
        let error = session
            .apply(Op::Batch {
                description: "Added two systems".to_owned(),
                ops: vec![add(spec.clone()), add(refused_member)],
            })
            .expect_err("the second member is refused");
        assert!(
            matches!(error, OpError::EmptyText { what: "a name" }),
            "{error}"
        );
        assert!(!session.doc().is_dirty());
        assert!(session.system(id).is_none());
        let planet = EntityAddr::new(EntityKind::System, id);
        assert!(get_entity(session.doc(), planet, &[]).is_err());
        session.apply(add(spec)).expect("add");
        assert_eq!(current(&session), fresh);
    }
}

/// AA- has no suffix left and BB- one: the first asteroid takes it, the rest use it again.
const SPENT_POOL: &str = "\tasteroid_prefix=\n\t{\n\t\t\"AA-\"\n\t\t\"BB-\"\n\t}\n\tasteroid_postfix=\n\t{\n\t}\n\tasteroid_postfix=\n\t{\n\t\t\"1\"\n\t}\n";

#[test]
fn a_spent_asteroid_pool_names_asteroids_again() {
    let mut session = with_asteroid_pool(SPENT_POOL);
    round_trip_step(&mut session, "add", add(belted(dorellion())));
    let asteroids: Vec<String> = body_names(&session, 791)
        .into_iter()
        .filter(|(key, _)| key == "ASTEROID_NAME_FORMAT")
        .map(|(_, name)| name)
        .collect();
    assert_eq!(asteroids, ["BB-1"; 4]);
    let spent = SPENT_POOL.replace("\t\t\"1\"\n", "");
    assert!(
        text(&session).contains(&spent),
        "the one suffix leaves the pool"
    );

    session
        .apply(Op::RemoveSystem { system: 791 })
        .expect("remove");
    assert_eq!(current(&session), session.doc().original());
}
