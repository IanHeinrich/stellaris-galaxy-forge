//! New random zones as Bare shell draws them on both sample saves opened as Paint a Galaxy
//! scenarios: how many it puts on the galaxy's edge.

use sgf_core::document::Document;
use sgf_core::export::{self, ScenarioProfile};
use sgf_core::format::scenario::FeZone;
use sgf_core::format::scenario::fe_zone::{centre, distance};
use sgf_core::format::scenario::header_counts::is_seat;
use sgf_core::prepare::{self, PrepareOptions, PreparePreset, PrepareRow, RowSystems};
use sgf_core::projections::galaxy::SystemNode;
use sgf_core::session::Session;

use crate::common;

/// How far either side of a zone's bearing the farthest system marks the galaxy's edge.
const WEDGE_DEGREES: f64 = 15.0;

/// The sample `save` opened as an unsaved Paint a Galaxy scenario.
fn painted(save: Session) -> Session {
    let options = export::options_for_session(&save, "sample");
    let (text, _) = export::scenario_text(
        save.graph(),
        &options,
        &|_| None,
        &|_| None,
        ScenarioProfile::PaintAGalaxy,
    );
    let doc = Document::from_scenario_bytes(text).expect("index the scenario");
    Session::from_document(None, doc).expect("project the scenario")
}

/// The rows Bare shell's zones depend on: the seats it draws again and the zones it takes
/// away. It keeps no other row, so the rest change nothing it draws.
fn rows(session: &Session) -> Vec<RowSystems> {
    let graph = session.graph();
    let standing = |keep: fn(&SystemNode) -> bool| {
        graph
            .order
            .iter()
            .filter(|id| keep(&graph.systems[id]))
            .copied()
            .collect()
    };
    vec![
        RowSystems {
            row: PrepareRow::EmpireSeats,
            systems: standing(is_seat),
        },
        RowSystems {
            row: PrepareRow::FallenEmpires,
            systems: standing(|s| s.fe_zone.is_some()),
        },
    ]
}

/// The new zones Bare shell draws from `seed`.
fn drawn(session: &Session, rows: &[RowSystems], seed: u64) -> Vec<(u32, FeZone)> {
    let choices = PreparePreset::BareShell.choices(ScenarioProfile::PaintAGalaxy);
    let options = PrepareOptions {
        seed,
        ..PrepareOptions::default()
    };
    prepare::drawn(session, rows, &choices, &options)
        .expect("draw")
        .zones
}

/// How many of `zones` have their centre at or beyond the farthest system within
/// [`WEDGE_DEGREES`] of the centre's bearing from the galaxy's centre.
fn on_edge(session: &Session, zones: &[(u32, FeZone)]) -> usize {
    let graph = session.graph();
    let wedge = WEDGE_DEGREES.to_radians();
    zones
        .iter()
        .map(|(id, zone)| {
            let anchor = &graph.systems[id];
            centre((anchor.x, anchor.y), zone)
        })
        .filter(|&c| {
            let bearing = c.1.atan2(c.0);
            let edge = graph
                .systems
                .values()
                .filter(|s| {
                    let turn = s.y.atan2(s.x) - bearing;
                    turn.sin().atan2(turn.cos()).abs() <= wedge
                })
                .map(|s| s.x.hypot(s.y))
                .fold(0.0, f64::max);
            distance(c, (0.0, 0.0)) >= edge
        })
        .count()
}

#[test]
fn bare_shell_puts_at_most_two_new_zones_on_the_edge_whatever_lies_beyond_it_elsewhere() {
    for (name, save) in [("4.4", common::open()), ("4.5", common::open_4_5())] {
        let session = painted(save);
        let rows = rows(&session);
        for seed in 0..8 {
            let zones = drawn(&session, &rows, seed);
            let edge = on_edge(&session, &zones);
            assert!(
                edge <= 2,
                "{name} seed {seed}: {edge} of {} zones on the edge",
                zones.len()
            );
            assert!(!zones.is_empty(), "{name} seed {seed}: no zones");
        }
    }
}
