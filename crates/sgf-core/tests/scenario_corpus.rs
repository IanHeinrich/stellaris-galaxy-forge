//! Round trip over a directory of real scenario scripts (`SGF_SCENARIO_DIR`).
use std::path::{Path, PathBuf};

use sgf_core::document;
use sgf_core::format::scenario::index as scenario;
use sgf_core::session::{Session, SessionError};

/// The map this suite knows the shape of, when the directory holds it.
const KNOWN: &str = "swnd_canon_huge_map.txt";

fn scenarios(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .expect("read SGF_SCENARIO_DIR")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|ext| ext == "txt"))
        .collect();
    files.sort();
    files
}

#[test]
fn every_scenario_opens_and_round_trips() {
    let Some(dir) = std::env::var_os("SGF_SCENARIO_DIR") else {
        println!("skipped: SGF_SCENARIO_DIR unset");
        return;
    };
    let dir = PathBuf::from(dir);
    if !dir.is_dir() {
        println!("skipped: SGF_SCENARIO_DIR is not a directory");
        return;
    }

    let tmp = tempfile::tempdir().expect("tempdir");
    println!(
        "{:<40} {:>8} {:>8} {:>8} {:>8}",
        "file", "KB", "systems", "lanes", "nebulae"
    );

    let mut checked = 0usize;
    for path in scenarios(&dir) {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let original = std::fs::read(&path).expect("read the scenario");
        // A mod overriding a vanilla scenario with an empty file, or with a dynamic one,
        // is not a document this editor opens; the rest must round-trip.
        let mut session = match Session::open(&path) {
            Ok(session) => session,
            Err(SessionError::Document(document::Error::Scenario(
                e @ (scenario::Error::NotAScenario | scenario::Error::Dynamic),
            ))) => {
                println!("{name:<40} skipped: {e}");
                continue;
            }
            Err(e) => panic!("{name}: {e}"),
        };
        let scenario = session.doc.scenario().expect("a scenario document");
        let statements: Vec<_> = scenario.lane_statements().collect();
        let added = statements.iter().filter(|l| !l.prevent).count();

        println!(
            "{:<40} {:>8} {:>8} {:>8} {:>8}",
            name,
            original.len() / 1024,
            session.graph.systems.len(),
            added,
            session.graph.nebulae.len()
        );

        if name == KNOWN {
            // The file's text holds 1662 `system` and 2234 `add_hyperlane` occurrences;
            // 4 and 12 of those are inside comments and are not statements.
            assert_eq!(session.graph.systems.len(), 1658, "{name}: systems");
            assert_eq!(session.graph.nebulae.len(), 15, "{name}: nebulae");
            assert_eq!(added, 2222, "{name}: add_hyperlane statements");
        }

        let out = tmp.path().join(&name);
        session
            .save_as(&out)
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        let written = std::fs::read(&out).expect("read the written scenario");
        assert_eq!(written, original, "{name}: bytes diverged");
        checked += 1;
    }

    assert!(checked > 0, "no scenario in {} opened", dir.display());
}
