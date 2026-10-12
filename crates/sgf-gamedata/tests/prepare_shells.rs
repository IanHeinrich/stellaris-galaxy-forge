//! Bare shell and Faithful around the seats, and the systems taking out the wormhole pairs
//! cuts off, on the sample install.

use std::collections::BTreeSet;

use sgf_core::export::ScenarioProfile;
use sgf_core::format::scenario::header_counts;
use sgf_core::ops::Op;
use sgf_core::prepare::{
    self, PlainDraw, PrepareChoice, PrepareOptions, PreparePreset, PrepareRow, RowChoice,
};
use sgf_core::projections::galaxy::GalaxyGraph;
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;
use sgf_gamedata::prepare::{classify, plain_draw};

use crate::common;
use crate::common::prepare::{
    INITIALIZER_ROWS, build, current, initializer_of, row_of, samples, scenario,
};

/// `from` and every system within `jumps` lanes of it.
fn within(session: &Session, from: &BTreeSet<u32>, jumps: usize) -> BTreeSet<u32> {
    let systems = &session.graph().systems;
    let mut reached = from.clone();
    for _ in 0..jumps {
        let next: Vec<u32> = systems
            .values()
            .flat_map(|s| s.lanes.iter().map(move |lane| (s.id, lane.to)))
            .filter_map(
                |(a, b)| match (reached.contains(&a), reached.contains(&b)) {
                    (true, false) => Some(b),
                    (false, true) => Some(a),
                    _ => None,
                },
            )
            .collect();
        reached.extend(next);
    }
    reached
}

fn is_plain(session: &Session, draw: &PlainDraw, id: u32) -> bool {
    let held = initializer_of(session, id);
    held == "painted_galaxy_rl_basic" || draw.layouts.iter().any(|l| l.key == held)
}

/// The first system one lane from a seat that is no seat itself and has an initializer.
fn beside_a_seat(graph: &GalaxyGraph) -> u32 {
    let systems = graph.order.iter().filter_map(|id| graph.systems.get(id));
    let seats = systems.filter(|s| header_counts::is_seat(s));
    seats
        .flat_map(|seat| seat.lanes.iter().map(|lane| lane.to))
        .find(|id| {
            let next = &graph.systems[id];
            !header_counts::is_seat(next) && !next.initializer.is_empty()
        })
        .expect("a system beside a seat")
}

#[test]
fn bare_shell_gives_plain_systems_within_two_jumps_of_a_seat_unless_told_not_to() {
    let gd = common::sample_install();
    let draw = plain_draw(gd, 0);
    for (name, session) in samples() {
        let rows = classify(&session, gd);
        let choices = PreparePreset::BareShell.choices(prepare::profile(&session));
        let empty = session
            .graph()
            .systems
            .values()
            .filter(|s| s.initializer.is_empty() && !header_counts::is_seat(s));
        let rowed: BTreeSet<u32> = INITIALIZER_ROWS
            .into_iter()
            .chain([PrepareRow::OrdinarySystems, PrepareRow::FallenEmpires])
            .flat_map(|row| row_of(&rows, row))
            .collect();
        let old_capitals = row_of(&rows, PrepareRow::EmpireSeats)
            .into_iter()
            .filter(|id| !rowed.contains(id));
        let decided: BTreeSet<u32> = choices
            .iter()
            .filter(|c| c.choice == PrepareChoice::GameDecides)
            .flat_map(|c| row_of(&rows, c.row))
            .chain(empty.map(|s| s.id))
            .chain(old_capitals)
            .collect();
        let clear: BTreeSet<u32> =
            prepare::kept_clear(&session, &rows, &choices, &draw, &PrepareOptions::default())
                .expect("the choices are offered")
                .into_iter()
                .collect();
        assert!(!clear.is_empty(), "{name}");

        let mut on = session.clone();
        on.apply(build(gd, &session, &rows, &choices).expect("a change"))
            .expect("apply bare shell");
        let seats: BTreeSet<u32> = on
            .graph()
            .systems
            .values()
            .filter(|s| header_counts::is_seat(s))
            .map(|s| s.id)
            .collect();
        let decided: BTreeSet<u32> = decided.difference(&seats).copied().collect();
        let near = within(&on, &seats, prepare::CLEAR_JUMPS);
        let near: BTreeSet<u32> = decided.intersection(&near).copied().collect();
        let changed: BTreeSet<u32> = near
            .iter()
            .copied()
            .filter(|&id| !is_plain(&session, &draw, id))
            .collect();
        assert_eq!(clear, changed, "{name}");
        assert!(clear.len() < near.len(), "{name}: some are plain already");
        for &id in &decided {
            match near.contains(&id) {
                true if clear.contains(&id) => assert!(is_plain(&on, &draw, id)),
                true => assert_eq!(initializer_of(&on, id), initializer_of(&session, id)),
                false => assert_eq!(initializer_of(&on, id), "", "{name}: system {id}"),
            }
        }

        let mut off = session.clone();
        let options = PrepareOptions {
            clear_around_seats: false,
            ..PrepareOptions::default()
        };
        let op = prepare::build(&session, &rows, &choices, &draw, &options)
            .expect("build the batch")
            .expect("a change");
        off.apply(op).expect("apply bare shell");
        for system in off.graph().systems.values() {
            let id = system.id;
            if decided.contains(&id) {
                assert_eq!(system.initializer, "", "{name}: system {id}");
            }
            if !near.contains(&id) {
                assert_eq!(
                    system.initializer,
                    initializer_of(&on, id),
                    "{name}: system {id}"
                );
            }
        }
    }
}

#[test]
fn taking_out_the_wormhole_pairs_reports_the_systems_it_cuts_off() {
    let gd = common::sample_install();
    let mut session = scenario(common::open_4_5(), ScenarioProfile::PaintAGalaxy);
    let rows = classify(&session, gd);
    let names = [RowChoice {
        row: PrepareRow::SystemNames,
        choice: PrepareChoice::GameNames,
    }];
    let op = build(gd, &session, &rows, &names).expect("a change");
    assert_eq!(prepare::cut_off(&session, &op), Vec::<u32>::new());

    let pairs = [RowChoice {
        row: PrepareRow::WormholePairs,
        choice: PrepareChoice::None,
    }];
    let op = build(gd, &session, &rows, &pairs).expect("a change");
    let cut = prepare::cut_off(&session, &op);
    let mut expected = vec![591, 592];
    expected.extend(594..=600);
    assert_eq!(cut, expected);
    let graph = session.graph();
    assert!(header_counts::is_seat(&graph.systems[&592]));
    assert!(
        graph.systems[&591].lanes.is_empty(),
        "only its wormhole reaches it"
    );
    let alone = &graph.systems[&593];
    assert!(
        alone.lanes.is_empty() && alone.wormhole_pair.is_none(),
        "cut off already"
    );
    session.apply(op).expect("apply the batch");
    let disconnected: Vec<Vec<u32>> = session
        .validate()
        .into_iter()
        .filter(|issue| issue.code == IssueCode::Disconnected)
        .map(|issue| issue.systems)
        .collect();
    assert_eq!(disconnected, [cut]);
}

#[test]
fn faithful_fills_a_system_left_empty_beside_a_seat_unless_told_not_to() {
    let gd = common::sample_install();
    let draw = plain_draw(gd, 0);
    for profile in [ScenarioProfile::Plain, ScenarioProfile::PaintAGalaxy] {
        let faithful = PreparePreset::Faithful.choices(profile);
        let mut session = scenario(common::open_4_4(), profile);
        let graph = session.graph();
        let beside = beside_a_seat(graph);
        session
            .apply(Op::SetInitializer {
                system: beside,
                initializer: None,
            })
            .expect("empty the neighbour");
        let rows = classify(&session, gd);
        assert_eq!(
            prepare::kept_clear(
                &session,
                &rows,
                &faithful,
                &draw,
                &PrepareOptions::default()
            ),
            Ok(vec![beside]),
            "{profile:?}"
        );
        let op = build(gd, &session, &rows, &faithful).expect("a change");
        let Op::Batch { ops, .. } = &op else {
            panic!("one batch");
        };
        assert_eq!(ops.len(), 1, "{profile:?}");
        let before = current(&session);
        session.apply(op).expect("apply faithful");
        assert!(is_plain(&session, &draw, beside), "{profile:?}");
        session.undo().expect("undo").expect("an edit to undo");
        assert_eq!(current(&session), before, "undo is byte-exact");

        let off = PrepareOptions {
            clear_around_seats: false,
            ..PrepareOptions::default()
        };
        let left = prepare::build(&session, &rows, &faithful, &draw, &off);
        assert_eq!(left, Ok(None), "{profile:?}");
    }
}
