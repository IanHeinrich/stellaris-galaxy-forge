//! Timed round-trip over the user's local save corpus (`SGF_CORPUS_DIR`), and the
//! Paint a Galaxy export of every save in it read back and checked.
use std::path::{Path, PathBuf};
use std::time::Instant;

use sgf_core::archive;
use sgf_core::document::Document;
use sgf_core::export::policy::{Category, classify};
use sgf_core::export::{self, ScenarioProfile};
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;

mod common;

use common::paint::{assert_paint_export_holds_together, left_out};

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

/// No game data: names as the save holds them, every initializer vanilla.
fn none(_: &str) -> Option<String> {
    None
}

#[test]
fn corpus_paint_exports_read_back_and_hold_together() {
    let Some(dir) = std::env::var_os("SGF_CORPUS_DIR") else {
        println!("skipped: SGF_CORPUS_DIR unset");
        return;
    };
    let dir = PathBuf::from(dir);
    if !dir.is_dir() {
        println!("skipped: SGF_CORPUS_DIR is not a directory");
        return;
    }
    println!(
        "{:<40} {:>8} {:>8} {:>6} {:>8} {:>8} {:>8} {:>8} {:>8}",
        "file", "systems", "written", "seats", "fallen", "exact", "omitted", "zones", "isolated"
    );
    for path in &corpus_saves(&dir) {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let save = Session::open(path).expect("Session::open");
        let stem = path.file_stem().unwrap().to_string_lossy().into_owned();
        let options = export::ScenarioOptions {
            exported_from: Some(name.clone()),
            ..export::options_for(&save.graph, &stem)
        };
        let (text, report) = export::scenario_text(
            &save.graph,
            &options,
            &none,
            &none,
            ScenarioProfile::PaintAGalaxy,
        );
        let doc = Document::from_scenario_bytes(text).expect("the export reads back");
        let reopened = Session::from_document(None, doc).expect("project the export");
        let typed = assert_paint_export_holds_together(&save.graph, &reopened.graph, &report);
        let missing = left_out(&save.graph, &reopened.graph);

        let fallen: Vec<&sgf_core::projections::galaxy::CountryNode> = save
            .graph
            .countries
            .iter()
            .filter(|c| {
                matches!(
                    c.country_type.as_str(),
                    "fallen_empire" | "awakened_fallen_empire"
                ) && c
                    .capital_system
                    .is_some_and(|id| save.graph.systems.contains_key(&id))
            })
            .collect();
        assert_eq!(report.fallen_empires.len(), fallen.len(), "{name}");
        for (country, fe) in fallen.iter().zip(&report.fallen_empires) {
            let capital = country.capital_system.unwrap();
            assert!(missing.contains(&capital), "{name}: {capital} is written");
            assert!(
                fe.anchor.is_some(),
                "{name}: {} ({:?}) has nowhere to go",
                fe.name,
                fe.kind
            );
        }
        assert_eq!(typed.len(), fallen.len(), "{name}");
        let exact = report.fallen_empires.iter().filter(|f| f.exact).count();

        let capitals: std::collections::BTreeSet<u32> = save
            .graph
            .countries
            .iter()
            .filter(|c| c.country_type == "default")
            .filter_map(|c| c.capital_system)
            .collect();
        let lcluster: Vec<u32> = save
            .graph
            .systems
            .values()
            .filter(|s| {
                classify(&s.initializer, &s.flags, capitals.contains(&s.id)) == Category::LCluster
            })
            .map(|s| s.id)
            .collect();
        for id in &lcluster {
            assert!(
                missing.contains(id),
                "{name}: L-Cluster system {id} is written"
            );
        }
        let omitted: u32 = report.omitted.iter().map(|c| c.systems).sum();
        assert_eq!(omitted as usize, lcluster.len(), "{name}");

        let isolated_before: Vec<u32> = save
            .graph
            .systems
            .values()
            .filter(|s| s.lanes.is_empty())
            .map(|s| s.id)
            .collect();
        let isolated: Vec<u32> = sgf_core::validate::validate(&reopened.graph)
            .iter()
            .filter(|i| i.code == IssueCode::SystemIsolated)
            .flat_map(|i| i.systems.clone())
            .collect();
        let stranded: Vec<u32> = isolated
            .iter()
            .filter(|id| !isolated_before.contains(id))
            .copied()
            .collect();
        assert!(stranded.is_empty(), "{name}: {stranded:?} lost every lane");

        let zones = reopened
            .graph
            .systems
            .values()
            .filter(|s| s.fe_zone.is_some())
            .count();
        println!(
            "{:<40} {:>8} {:>8} {:>6} {:>8} {:>8} {:>8} {:>8} {:>8}",
            name,
            save.graph.systems.len(),
            reopened.graph.systems.len(),
            report.seats,
            report.fallen_empires.len(),
            exact,
            omitted,
            zones,
            isolated.len()
        );
    }
}
