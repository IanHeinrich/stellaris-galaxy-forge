//! Timed round-trip over the user's local save corpus (`SGF_CORPUS_DIR`).
use std::path::{Path, PathBuf};
use std::time::Instant;

use sgf_core::archive;
use sgf_core::document::Document;
use sgf_core::session::Session;

const OPEN_BUDGET_MS: u128 = 3000;

/// Every documented command builds in debug, which is several times slower than the
/// release build the budget above was measured for.
const DEBUG_BUDGET_MS: u128 = OPEN_BUDGET_MS * 3;

fn corpus_saves(dir: &Path) -> Vec<PathBuf> {
    let mut saves: Vec<PathBuf> = std::fs::read_dir(dir)
        .expect("read SGF_CORPUS_DIR")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|ext| ext == "sav"))
        .collect();
    saves.sort();
    saves
}

#[test]
fn corpus_round_trips_within_budget() {
    let Some(dir) = std::env::var_os("SGF_CORPUS_DIR") else {
        println!("skipped: SGF_CORPUS_DIR unset");
        return;
    };
    let dir = PathBuf::from(dir);
    if !dir.is_dir() {
        println!("skipped: SGF_CORPUS_DIR is not a directory");
        return;
    }

    let saves = corpus_saves(&dir);
    let budget = if cfg!(debug_assertions) {
        DEBUG_BUDGET_MS
    } else {
        OPEN_BUDGET_MS
    };
    let note = format!(" (open budget {budget} ms)");
    println!(
        "{:<40} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8}{note}",
        "file", "MB", "systems", "lanes", "read", "parse", "open", "validate", "details", "save"
    );

    let tmp = tempfile::tempdir().expect("tempdir");
    let mut over_budget = Vec::new();

    for path in &saves {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let size_mb = std::fs::metadata(path).expect("metadata").len() as f64 / 1_048_576.0;

        let t = Instant::now();
        let raw = archive::read_sav(path).expect("read_sav");
        let read_ms = t.elapsed().as_millis();

        let t = Instant::now();
        Document::from_bytes(raw.gamestate.clone(), raw.meta.clone())
            .expect("Document::from_bytes");
        let parse_ms = t.elapsed().as_millis();

        let t = Instant::now();
        let mut session = Session::open(path).expect("Session::open");
        let open_ms = t.elapsed().as_millis();

        let t = Instant::now();
        session.validate();
        let validate_ms = t.elapsed().as_millis();

        let t = Instant::now();
        session.details().expect("details");
        let details_ms = t.elapsed().as_millis();

        let out_path = tmp.path().join(&name);
        let t = Instant::now();
        session.save_as(&out_path).expect("save_as");
        let save_ms = t.elapsed().as_millis();

        let written = archive::read_sav(&out_path).expect("read written save");
        assert_eq!(
            written.gamestate, raw.gamestate,
            "{name}: gamestate diverged"
        );
        assert_eq!(written.meta, raw.meta, "{name}: meta diverged");

        println!(
            "{:<40} {:>8.1} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8}",
            name,
            size_mb,
            session.graph.systems.len(),
            session
                .graph
                .systems
                .values()
                .map(|s| s.lanes.len())
                .sum::<usize>(),
            read_ms,
            parse_ms,
            open_ms,
            validate_ms,
            details_ms,
            save_ms
        );

        if open_ms > budget {
            over_budget.push(format!("{name} ({open_ms} ms)"));
        }
    }

    assert!(
        over_budget.is_empty(),
        "Session::open exceeded {budget} ms budget for: {over_budget:?}"
    );
}
