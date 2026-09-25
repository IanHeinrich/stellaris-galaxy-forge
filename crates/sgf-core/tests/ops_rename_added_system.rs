//! Renaming a system added since the save was opened, on the 4.5 and the 4.4 sample: its
//! star, planets and moons carry the new name, the pool of unused star names gets the old
//! one back and gives up the new one, undo is byte-exact, a removal after it gives back
//! the file as opened, and what the op refuses.

use sgf_core::ops::{Op, OpError, SystemSpec, free_star_names};
use sgf_core::session::Session;

use crate::common;
use common::diff::{round_trip_step, step_report};
use common::spec::{SAMPLE_4_5, SAMPLES, belted, rerolled};
use common::{current, text};

const UNPOOLED: &str = "Sgf_Renamed";

fn add(spec: SystemSpec) -> Op {
    Op::AddSaveSystem { spec }
}

fn rename(system: u32, name: &str) -> Op {
    Op::RenameSaveSystem {
        system,
        name: name.to_owned(),
    }
}

fn pooled(session: &Session, name: &str) -> usize {
    common::pooled(session, "star_names", name)
}

fn keyed(session: &Session, name: &str) -> usize {
    text(session).matches(&format!("key=\"{name}\"\n")).count()
}

/// A name the pool holds that is not the spike's.
fn free_name(session: &Session, spike: &SystemSpec) -> String {
    free_star_names(&session.doc)
        .into_iter()
        .find(|name| *name != spike.name)
        .expect("a free name")
}

#[test]
fn the_diff_a_rename_writes() {
    let (mut session, spike) = ((SAMPLE_4_5.open)(), (SAMPLE_4_5.spike)());
    let name = free_name(&session, &spike);
    session.apply(add(spike)).expect("add");
    let report = step_report(&mut session, rename(SAMPLE_4_5.id, &name));
    common::snapshot("rename_mura", &report);
}

#[test]
fn the_system_and_every_body_named_after_it_take_the_new_name() {
    for sample in &SAMPLES {
        let (mut session, spike, id) = ((sample.open)(), (sample.spike)(), sample.id);
        let old = spike.name.clone();
        let held = keyed(&session, &old);
        round_trip_step(&mut session, "add", add(spike.clone()));
        let bodies = 1 + spike
            .planets
            .iter()
            .map(|p| 1 + p.moons.len())
            .sum::<usize>();
        assert_eq!(keyed(&session, &old), held + 1 + bodies);

        let result = round_trip_step(&mut session, "rename", rename(id, UNPOOLED));
        assert_eq!(result.inverse, rename(id, &old));
        assert_eq!(keyed(&session, UNPOOLED), 1 + bodies, "{id}");
        assert_eq!(keyed(&session, &old), held, "{id}");
        let system = session.system(id).expect("the system");
        assert_eq!(system.name.key, UNPOOLED);
        assert!(system.added);
        let hits = session
            .search(UNPOOLED, 20, &|_| None, &|_| Vec::new())
            .hits;
        assert!(hits.iter().any(|h| h.id == id), "{hits:?}");
    }
}

/// Renames between a pooled name, one outside the pool and back swap the entries; a name
/// a twin still holds stays out of the pool until the twin is renamed too.
#[test]
fn the_pool_gets_the_old_name_back_and_gives_up_the_new_one() {
    for sample in &SAMPLES {
        let (mut session, spike, id) = ((sample.open)(), (sample.spike)(), sample.id);
        let old = spike.name.clone();
        let new = free_name(&session, &spike);
        session.apply(add(spike)).expect("add");
        assert_eq!((pooled(&session, &old), pooled(&session, &new)), (0, 1));

        round_trip_step(&mut session, "to a pooled name", rename(id, &new));
        assert_eq!((pooled(&session, &old), pooled(&session, &new)), (1, 0));
        round_trip_step(&mut session, "out of the pool", rename(id, UNPOOLED));
        assert_eq!((pooled(&session, &old), pooled(&session, &new)), (1, 1));
        round_trip_step(&mut session, "back", rename(id, &old));
        assert_eq!((pooled(&session, &old), pooled(&session, &new)), (0, 1));

        let mut twin = (sample.spike)();
        (twin.x, twin.y) = sample.spots[0];
        twin.lanes.clear();
        session.apply(add(twin)).expect("add its twin");
        session.apply(rename(id, UNPOOLED)).expect("rename one");
        assert_eq!(pooled(&session, &old), 0, "the twin still holds it");
        session
            .apply(rename(id + 1, UNPOOLED))
            .expect("rename the twin");
        assert_eq!(pooled(&session, &old), 1);
    }
}

#[test]
fn rename_then_remove_gives_back_the_file_as_opened() {
    for sample in &SAMPLES {
        let (mut session, spike, id) = ((sample.open)(), (sample.spike)(), sample.id);
        let pooled_name = free_name(&session, &spike);
        round_trip_step(&mut session, "add", add(spike.clone()));
        round_trip_step(&mut session, "rename", rename(id, &pooled_name));
        let mut again = rerolled(spike);
        again.name = pooled_name;
        round_trip_step(
            &mut session,
            "reroll",
            Op::ReplaceSaveSystem {
                system: id,
                spec: again,
            },
        );
        round_trip_step(&mut session, "rename again", rename(id, UNPOOLED));
        round_trip_step(&mut session, "remove", Op::RemoveSystem { id });
        assert_eq!(current(&session), session.doc.original(), "{id}");
    }
}

#[test]
fn what_a_rename_refuses() {
    for sample in &SAMPLES {
        let (mut session, spike, id) = ((sample.open)(), (sample.spike)(), sample.id);
        let home = sample.home();
        let error = session.apply(rename(home, UNPOOLED)).expect_err("original");
        assert!(
            matches!(error, OpError::SystemNotAdded(held) if held == home),
            "{error}"
        );
        let error = session
            .apply(rename(99_999, UNPOOLED))
            .expect_err("unknown");
        assert!(matches!(error, OpError::UnknownSystem(99_999)), "{error}");

        let name = spike.name.clone();
        session.apply(add(spike)).expect("add");
        let written = current(&session);
        for (bad, check) in [
            (
                "",
                (|e: &OpError| matches!(e, OpError::EmptyText { what: "a name" }))
                    as fn(&OpError) -> bool,
            ),
            ("Bad\"Name", |e| {
                matches!(e, OpError::InvalidText { what: "a name", .. })
            }),
            (name.as_str(), |e| matches!(e, OpError::NameUnchanged(..))),
        ] {
            let error = session.apply(rename(id, bad)).expect_err("refused");
            assert!(check(&error), "{bad:?}: {error}");
        }
        assert_eq!(current(&session), written, "a refusal writes nothing");
    }
}

/// Each body of system `id` as the details list it: the name, and whether it is an
/// asteroid's.
fn body_names(session: &Session, id: u32) -> Vec<(String, bool)> {
    let details = session.details().expect("details");
    let raw = details.raw(id).expect("the system's details");
    raw.planets
        .iter()
        .map(|p| {
            (
                format!("{:?}", p.name),
                p.name.key == "ASTEROID_NAME_FORMAT",
            )
        })
        .collect()
}

#[test]
fn a_belted_system_keeps_its_asteroid_names_and_renames_every_other_body() {
    for sample in &SAMPLES {
        let (mut session, spike, id) = ((sample.open)(), (sample.spike)(), sample.id);
        let old = format!("{:?}", spike.name);
        round_trip_step(&mut session, "add", add(belted(spike)));
        let before = body_names(&session, id);
        assert_eq!(before.iter().filter(|(_, asteroid)| *asteroid).count(), 4);
        round_trip_step(&mut session, "rename", rename(id, UNPOOLED));
        let after = body_names(&session, id);
        assert_eq!(after.len(), before.len());
        for ((was, asteroid), (now, _)) in before.iter().zip(&after) {
            if *asteroid {
                assert_eq!(now, was, "{id}: an asteroid keeps its name");
            } else {
                assert!(
                    was.contains(&old) && !now.contains(&old) && now.contains(UNPOOLED),
                    "{id}: {was} became {now}"
                );
            }
        }
    }
}
