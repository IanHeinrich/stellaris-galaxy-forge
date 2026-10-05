//! Planet moves offered and batched on the 4.5 sample: the targets a move lists, the dry run
//! that agrees with them, the warning for another country's system, and batches that move
//! several planets or none.

use sgf_core::ops::Op;
use sgf_core::views::{PlanetMoveTargets, PlanetMoveWarning, PlanetMoveWarningKind};

use crate::common;
use crate::ops_move_planet::{body, fleets};
use common::diff::snapshot_step;
use common::{current, findings, open, open_4_5, planets};

/// The systems the targets list, in order.
fn ids(targets: &PlanetMoveTargets) -> Vec<u32> {
    targets.systems.iter().map(|t| t.system).collect()
}

fn refusals(targets: &PlanetMoveTargets) -> Vec<(u32, &str)> {
    targets
        .refused
        .iter()
        .map(|r| (r.planet, r.reason.as_str()))
        .collect()
}

/// System 169 is country 0's home: gas giant 10 with moons 11, 12 and 13, and planets 8
/// and 14, have stations and no owner, and planet 2 is country 0's colony. Planet 402 is
/// country 16777226's colony in system 449.
#[test]
fn move_targets_drop_what_moves_with_its_parent_and_list_the_systems() {
    let session = open_4_5();

    let stations = session.planet_move_targets(&[11, 10, 13, 10, 14]);
    assert_eq!(stations.planets, [10, 14]);
    assert!(stations.refused.is_empty());
    let listed = ids(&stations);
    assert!(listed.contains(&2) && listed.contains(&216) && !listed.contains(&169));
    assert!(listed.is_sorted());

    assert_eq!(session.planet_move_targets(&[100]).planets, [100]);

    let colonies = session.planet_move_targets(&[402, 2]);
    assert!(colonies.refused.is_empty());
    let listed = ids(&colonies);
    for (to, expected) in [
        (378, true),
        (216, true),
        (2, true),
        (449, false),
        (169, false),
    ] {
        assert_eq!(listed.contains(&to), expected, "system {to}");
    }

    let refused = session.planet_move_targets(&[86, 936, 99, 99_999]);
    assert_eq!(refused.planets, [86, 936, 99, 99_999]);
    assert_eq!(
        refusals(&refused),
        [
            (
                86,
                "planet 86 is a star: only a planet can move to another system"
            ),
            (
                936,
                "planet 936 has a megastructure, so it cannot move to another system"
            ),
            (99_999, "planet 99999 does not exist"),
        ]
    );
    assert!(refused.systems.is_empty());
}

/// Every system the targets list takes the op the dry run passes, and no other, for a
/// neutral planet with moons, a moon, a colony, station planets, a star and colonies of
/// two countries. Every seventh system is checked, and every system with an owner.
#[test]
fn the_dry_run_agrees_with_the_targets() {
    for (session, sets) in [
        (
            open_4_5(),
            &[
                &[99][..],
                &[100],
                &[402],
                &[8, 10, 14],
                &[2],
                &[86],
                &[402, 2],
            ][..],
        ),
        (open(), &[&[59][..]][..]),
    ] {
        let bytes = current(&session);
        let mut systems: Vec<u32> = session.graph().systems.keys().copied().collect();
        systems.sort_unstable();
        for &set in sets {
            let targets = session.planet_move_targets(set);
            let checked = systems
                .iter()
                .enumerate()
                .filter(|&(i, id)| i % 7 == 0 || session.graph().systems[id].owner.is_some());
            for (_, &to) in checked {
                let check = session.planet_move_check(set, to, None);
                let target = targets.systems.iter().find(|t| t.system == to);
                assert_eq!(
                    check.refusal.is_none(),
                    target.is_some(),
                    "{set:?} to {to}: {check:?}"
                );
                let warnings = target.map(|t| t.warnings.clone()).unwrap_or_default();
                assert_eq!(check.warnings, warnings, "{set:?} to {to}");
            }
        }
        assert_eq!(current(&session), bytes);
        assert!(session.history().undo.is_empty() && !session.is_dirty());
    }
}

/// Station planets 8 and 14 and gas giant 10 of system 169 (moon 13 has station 364, 10
/// has 365 and 14 has 363) move into system 2 as one batch.
#[test]
fn a_batch_moves_station_planets_together() {
    let mut session = open_4_5();
    session.warm_details().expect("build details");
    let original = current(&session);
    let home = fleets(&session, 169);
    let before = findings(&session);

    let op = session
        .planet_move_op(&[8, 10, 14], 2, None)
        .expect("an op");
    let Op::Batch { description, ops } = &op else {
        panic!("a batch, not {op:?}");
    };
    assert_eq!(description, "Moved 3 planets to Millistamu #2");
    assert_eq!(ops.len(), 3);
    snapshot_step(&mut session, "batch_of_station_planets", op);

    let orbits = [8, 10, 14].map(|id| body(&session, 2, id).orbit.expect("an orbit"));
    assert!(orbits[0] < orbits[1] && orbits[1] < orbits[2], "{orbits:?}");
    let new: Vec<_> = findings(&session).difference(&before).cloned().collect();
    assert!(new.is_empty(), "new findings: {new:?}");
    let left = fleets(&session, 169);
    let mut moved: Vec<u32> = home.into_iter().filter(|f| !left.contains(f)).collect();
    let mut joined = fleets(&session, 2);
    moved.sort_unstable();
    joined.sort_unstable();
    assert_eq!(joined, moved);
    assert!(
        [363, 364, 365].iter().all(|f| moved.contains(f)),
        "{moved:?}"
    );

    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), original);
}

/// Planet 86 is a star: the batch moves 8, 10 and 14 and then is refused.
#[test]
fn a_batch_with_a_refused_planet_changes_nothing() {
    let mut session = open_4_5();
    let original = current(&session);
    let systems = [2, 169].map(|id| session.system(id).cloned());
    let set = [8, 10, 14, 86];
    let refusal = "planet 86 is a star: only a planet can move to another system";
    assert_eq!(
        session.planet_move_check(&set, 2, None).refusal.as_deref(),
        Some(refusal)
    );

    let op = session.planet_move_op(&set, 2, None).expect("an op");
    let error = session.apply(op).expect_err("86 is a star");
    assert_eq!(error.to_string(), refusal);
    assert_eq!(current(&session), original);
    assert!(session.history().undo.is_empty() && !session.is_dirty());
    assert_eq!([2, 169].map(|id| session.system(id).cloned()), systems);
}

/// Colony 402 is country 16777226's; system 169 is country 0's and 216 nobody's. Country 0
/// controls planet 14 of system 169 through research station 363, and country 16777226
/// owns system 378.
#[test]
fn a_move_into_another_countrys_system_warns() {
    let session = open_4_5();
    let warning = |planet, kind, owner, new_owner| PlanetMoveWarning {
        planet,
        kind,
        owner,
        new_owner,
    };
    let colony = session.planet_move_check(&[402], 169, None);
    assert_eq!(colony.refusal, None);
    assert_eq!(
        colony.warnings,
        [warning(402, PlanetMoveWarningKind::Colony, 16_777_226, 0)]
    );
    assert!(
        session
            .planet_move_check(&[402], 216, None)
            .warnings
            .is_empty()
    );
    assert_eq!(
        session.planet_move_check(&[14], 378, None).warnings,
        [warning(14, PlanetMoveWarningKind::Station, 0, 16_777_226)]
    );
    let targets = session.planet_move_targets(&[402]);
    let into = |to| {
        targets
            .systems
            .iter()
            .find(|t| t.system == to)
            .expect("listed")
    };
    assert_eq!(into(169).warnings, colony.warnings);
    assert!(into(216).warnings.is_empty());
}

#[test]
fn an_empty_set_is_refused() {
    let session = open_4_5();
    let check = session.planet_move_check(&[], 216, None);
    assert_eq!(check.refusal.as_deref(), Some("no planets to move"));
    let error = session
        .planet_move_op(&[], 216, None)
        .expect_err("no planets");
    assert_eq!(error.to_string(), "no planets to move");
}

/// Moons 11 and 12 of gas giant 10 in system 169 leave for system 216 in one batch; 10
/// keeps moon 13.
#[test]
fn a_batch_detaches_two_moons_of_one_planet() {
    let mut session = open_4_5();
    let original = current(&session);
    let op = session.planet_move_op(&[11, 12], 216, None).expect("an op");
    session.apply(op).expect("move 11 and 12");
    let under_10: Vec<u32> = planets(&session, 169)
        .iter()
        .filter(|p| p.parent == Some(10))
        .map(|p| p.id)
        .collect();
    assert_eq!(under_10, [13]);
    let [eleven, twelve] = [11, 12].map(|id| body(&session, 216, id));
    assert!(!eleven.moon && !twelve.moon && eleven.parent.is_none());
    assert!(
        eleven.orbit.expect("an orbit") < twelve.orbit.expect("an orbit"),
        "{eleven:?} {twelve:?}"
    );
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), original);
}
