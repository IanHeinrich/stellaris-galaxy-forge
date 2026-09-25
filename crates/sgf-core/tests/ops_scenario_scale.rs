//! Scenario edits timed on a synthetic 8,800-system grid with 17,410 lanes, and the same
//! paint on the exported sample scenario for comparison. Ignored by default: run with
//! `cargo test -p sgf-core --test integration ops_scenario_scale -- --ignored --nocapture`.

use std::fmt::Write as _;
use std::path::Path;
use std::time::{Duration, Instant};

use serde::Serialize;
use sgf_core::emit;
use sgf_core::ops::Op;
use sgf_core::session::{OpResult, Session};

use crate::common;
use common::brush::{grid, new_system, paint};
use common::current;
use common::fixture::EXPORTED;

/// The huge galaxy: a grid of `GRID_COLS` by `GRID_ROWS` systems 10 apart, centred on
/// the origin, each jittered by up to ±3 and laned to its right and lower neighbour.
const GRID_COLS: u32 = 110;
const GRID_ROWS: u32 = 80;
const SEAT_EVERY: u32 = 550;

/// A paint stroke: `PAINT_COLS` by `PAINT_ROWS` systems 10 apart, laned the same way.
const PAINT_COLS: u32 = 20;
const PAINT_ROWS: u32 = 15;

const SMALL_EDITS: u32 = 20;
const SMALL_EDIT_SYSTEMS: u32 = 5;

struct Rng(u64);

impl Rng {
    fn next_f64(&mut self) -> f64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        (x >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn huge_scenario_text() -> String {
    let sample = EXPORTED.text();
    let start = sample
        .find("static_galaxy_scenario")
        .expect("a scenario block");
    let end = sample.find("\n\tsystem = {").expect("a system statement");
    let header = sample[start..=end].replace("name = \"2206.11.16\"", "name = \"huge_grid\"");

    let mut rng = Rng(0x5EED_CAFE_F00D_1234);
    let mut text = String::with_capacity(2_000_000);
    text.push_str(&header);
    text.push('\n');
    for row in 0..GRID_ROWS {
        for col in 0..GRID_COLS {
            let id = row * GRID_COLS + col;
            let jitter = |rng: &mut Rng| ((rng.next_f64() - 0.5) * 600.0).round() / 100.0;
            let x = f64::from(col) * 10.0 - 545.0 + jitter(&mut rng);
            let y = f64::from(row) * 10.0 - 395.0 + jitter(&mut rng);
            write!(
                text,
                "\tsystem = {{ id = \"{id}\" name = \"Grid_{id}\" position = {{ x = {} y = {} }} initializer = basic_init_01",
                emit::coord(x),
                emit::coord(y)
            )
            .unwrap();
            if id.is_multiple_of(SEAT_EVERY) {
                text.push_str(" spawn_weight = { base = 1 }");
            }
            text.push_str(" }\n");
        }
    }
    text.push('\n');
    for row in 0..GRID_ROWS {
        for col in 0..GRID_COLS {
            let id = row * GRID_COLS + col;
            if col + 1 < GRID_COLS {
                writeln!(
                    text,
                    "\tadd_hyperlane = {{ from = \"{id}\" to = \"{}\" }}",
                    id + 1
                )
                .unwrap();
            }
            if row + 1 < GRID_ROWS {
                writeln!(
                    text,
                    "\tadd_hyperlane = {{ from = \"{id}\" to = \"{}\" }}",
                    id + GRID_COLS
                )
                .unwrap();
            }
        }
    }
    text.push('\n');
    for (i, (x, y)) in [(-300.0, -200.0), (0.0, 100.0), (250.0, -50.0)]
        .into_iter()
        .enumerate()
    {
        writeln!(
            text,
            "\tnebula = {{ name = \"Grid_Nebula_{i}\" position = {{ x = {x} y = {y} }} radius = 30 }}"
        )
        .unwrap();
    }
    text.push_str("}\n");
    text
}

fn next_id(session: &Session) -> u32 {
    session.graph.systems.keys().max().map_or(1, |max| max + 1)
}

/// What the app receives after an edit, built and serialised piece by piece.
fn report_edit(session: &Session, label: &str, applied: Duration, result: OpResult) {
    let start = Instant::now();
    let issues = sgf_core::validate::validate(&session.graph);
    let validate_time = start.elapsed();
    let start = Instant::now();
    let history = session.history();
    let history_time = start.elapsed();
    let start = Instant::now();
    let edit = session.edit_result(result);
    let edit_time = start.elapsed();
    let start = Instant::now();
    let total = to_json(&edit).len();
    let json_time = start.elapsed();
    println!(
        "  {label}: apply {applied:?} (its validate alone {validate_time:?}, {} issues) | \
         edit_result {edit_time:?} (history alone {history_time:?}) | \
         EditResult JSON {total} B in {json_time:?}: delta {} B ({} systems, {} removed), \
         issues {} B ({}), history {} B ({} undo, {} redo)",
        issues.len(),
        to_json(&edit.delta).len(),
        edit.delta.systems.len(),
        edit.delta.removed.len(),
        to_json(&edit.issues).len(),
        edit.issues.len(),
        to_json(&edit.history).len(),
        history.undo.len(),
        history.redo.len(),
    );
}

fn paint_and_undo(session: &mut Session, label: &str, origin: (f64, f64)) {
    let before = current(session);
    let systems_before = session.graph.systems.len();
    let (systems, lanes) = grid(next_id(session), origin, PAINT_COLS, PAINT_ROWS);
    let op = paint(systems, lanes);
    println!("{label}: paint op JSON {} B", to_json(&op).len());

    let start = Instant::now();
    let painted = session.apply(op).expect("paint");
    let apply_time = start.elapsed();
    assert_eq!(
        painted.entry.description,
        "Painted 300 systems and 565 lanes"
    );
    assert_eq!(session.graph.systems.len(), systems_before + 300);
    report_edit(session, "paint", apply_time, painted);

    let start = Instant::now();
    let undone = session.undo().expect("undo").expect("the paint to undo");
    let undo_time = start.elapsed();
    report_edit(session, "paint undo", undo_time, undone);
    assert_eq!(current(session), before, "undo is not byte-identical");
    assert_eq!(session.graph.systems.len(), systems_before);
}

fn delete_all_and_undo(session: &mut Session) {
    let before = current(session);
    let mut ids: Vec<u32> = session.graph.systems.keys().copied().collect();
    ids.sort_unstable();
    let count = ids.len();
    let op = Op::Batch {
        description: format!("Deleted {count} systems"),
        ops: vec![Op::RemoveSystems { ids }],
    };
    println!("delete all: op JSON {} B", to_json(&op).len());

    let start = Instant::now();
    let removed = session.apply(op).expect("delete all");
    let apply_time = start.elapsed();
    assert_eq!(session.graph.systems.len(), 0);
    report_edit(session, "delete all", apply_time, removed);

    let start = Instant::now();
    let undone = session.undo().expect("undo").expect("the delete to undo");
    let undo_time = start.elapsed();
    report_edit(session, "delete all undo", undo_time, undone);
    assert_eq!(current(session), before, "undo is not byte-identical");
    assert_eq!(session.graph.systems.len(), count);
}

fn open_timed(path: &Path, label: &str) -> Session {
    let size = std::fs::metadata(path).expect("the scenario file").len();
    let start = Instant::now();
    let session = Session::open(path).expect("open the scenario");
    println!(
        "{label}: open {:?} ({size} B, {} systems)",
        start.elapsed(),
        session.graph.systems.len()
    );
    session
}

#[test]
#[ignore]
fn huge_scenario_edit_timings() {
    let build = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    println!("build: {build}");

    let mut sample = open_timed(Path::new(EXPORTED.path), "sample scenario");
    paint_and_undo(&mut sample, "sample scenario", (1000.0, -200.0));

    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("huge_grid.txt");
    std::fs::write(&path, huge_scenario_text()).expect("write the huge scenario");
    let mut session = open_timed(&path, "huge scenario");
    let grid = (GRID_COLS * GRID_ROWS) as usize;
    assert_eq!(session.graph.systems.len(), grid);
    let lane_ends: usize = session.graph.systems.values().map(|s| s.lanes.len()).sum();
    assert_eq!(
        lane_ends,
        2 * ((GRID_COLS - 1) * GRID_ROWS + GRID_COLS * (GRID_ROWS - 1)) as usize
    );
    assert_eq!(current(&session), std::fs::read(&path).unwrap());

    paint_and_undo(&mut session, "huge scenario", (700.0, 500.0));

    delete_all_and_undo(&mut session);

    let start = Instant::now();
    for i in 0..SMALL_EDITS {
        let first = next_id(&session);
        let systems = (0..SMALL_EDIT_SYSTEMS)
            .map(|k| {
                new_system(
                    first + k,
                    -700.0 - f64::from(k) * 10.0,
                    -400.0 + f64::from(i) * 40.0,
                )
            })
            .collect();
        session
            .apply(Op::AddSystems { systems })
            .expect("a small edit");
    }
    println!(
        "{SMALL_EDITS} small edits of {SMALL_EDIT_SYSTEMS} systems: {:?} in all",
        start.elapsed()
    );
    assert_eq!(
        session.graph.systems.len(),
        grid + (SMALL_EDITS * SMALL_EDIT_SYSTEMS) as usize
    );
    assert_eq!(session.history().undo.len(), SMALL_EDITS as usize);
    paint_and_undo(
        &mut session,
        "huge scenario after small edits",
        (700.0, 500.0),
    );
}

fn to_json<T: Serialize + ?Sized>(value: &T) -> Vec<u8> {
    serde_json::to_vec(value).expect("serialise")
}
