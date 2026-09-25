//! Timed round-trip over the user's local save corpus (`SGF_CORPUS_DIR`), a system added
//! to and removed from each 4.x save in it, and the Paint a Galaxy export of every save
//! read back and checked.
use std::path::{Path, PathBuf};
use std::time::Instant;

use sgf_core::archive;
use sgf_core::document::Document;
use sgf_core::export::policy::{Category, classify};
use sgf_core::export::{self, ScenarioProfile};
use sgf_core::ops::{Op, OpError};
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;
use sgf_core::views::Capabilities;

mod common;

use common::diff::round_trip_step;
use common::export::{default_capitals, no_names, no_sources};
use common::paint::{assert_paint_export_holds_together, left_out};
use common::spec::dorellion;

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
        "{:<40} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8}{note}",
        "file",
        "MB",
        "systems",
        "lanes",
        "read",
        "galaxy",
        "parse",
        "open",
        "validate",
        "details",
        "save",
        "add",
        "remove"
    );

    let tmp = tempfile::tempdir().expect("tempdir");
    let mut over_budget = Vec::new();
    let mut took_a_system = 0;

    for path in &saves {
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let size_mb = std::fs::metadata(path).expect("metadata").len() as f64 / 1_048_576.0;

        let t = Instant::now();
        let raw = archive::read_sav(path).expect("read_sav");
        let read_ms = t.elapsed().as_millis();

        let t = Instant::now();
        let settings = archive::read_galaxy_settings(path).expect("read_galaxy_settings");
        let galaxy_ms = t.elapsed().as_millis();

        let t = Instant::now();
        Document::from_bytes(raw.gamestate.clone(), raw.meta.clone())
            .expect("Document::from_bytes");
        let parse_ms = t.elapsed().as_millis();

        let t = Instant::now();
        let mut session = Session::open(path).expect("Session::open");
        let open_ms = t.elapsed().as_millis();
        let setup = session.graph.setup.as_ref().expect("a setup");
        assert_eq!(
            settings.shape.as_deref(),
            Some(setup.shape.as_str()),
            "{name}"
        );
        assert_eq!(settings.num_empires, Some(setup.num_empires), "{name}");

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

        let systems = session.graph.systems.len();
        let lanes: usize = session.graph.systems.values().map(|s| s.lanes.len()).sum();
        let timed = add_and_remove(&mut session, &name);
        took_a_system += usize::from(timed.is_some());
        let (add_column, remove_column) = timed.map_or_else(
            || ("-".to_owned(), "-".to_owned()),
            |(add, remove)| (add.to_string(), remove.to_string()),
        );

        println!(
            "{:<40} {:>8.1} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8}",
            name,
            size_mb,
            systems,
            lanes,
            read_ms,
            galaxy_ms,
            parse_ms,
            open_ms,
            validate_ms,
            details_ms,
            save_ms,
            add_column,
            remove_column
        );

        if open_ms > budget {
            over_budget.push(format!("{name} ({open_ms} ms)"));
        }
    }

    println!(
        "added and removed a system on {took_a_system} of {} saves; a 3.x or Ironman save takes none",
        saves.len()
    );
    assert!(
        over_budget.is_empty(),
        "Session::open exceeded {budget} ms budget for: {over_budget:?}"
    );
}

/// On a save that takes added systems, add the in-game spike's Dorellion one jump from
/// system 0, at the first place near it the op accepts, and remove it again: the add
/// round-trips, the removal gives back the bytes as opened and its undo the bytes of the
/// add. Returns how long the add and the removal took to apply, in ms, or `None` when the
/// save takes no added system.
fn add_and_remove(session: &mut Session, name: &str) -> Option<(u128, u128)> {
    if !Capabilities::of(&session.doc).added_systems {
        return None;
    }
    let id = u32::try_from(session.graph.systems.len()).expect("a system count");
    let home = &session.graph.systems[&0];
    let (x0, y0) = (home.x, home.y);
    let spots = (1..=8).flat_map(|ring| {
        (0..12).map(move |turn| {
            let (distance, angle) = (f64::from(ring) * 10.0, f64::from(turn * 30).to_radians());
            (x0 + distance * angle.cos(), y0 + distance * angle.sin())
        })
    });
    let original = session.doc.original().to_vec();
    for (x, y) in spots {
        let spec = sgf_core::ops::SystemSpec {
            x,
            y,
            lanes: vec![0],
            ..dorellion()
        };
        match session.apply(Op::AddSaveSystem { spec: spec.clone() }) {
            Ok(_) => {
                session.undo().expect("undo the probe").expect("the probe");
                round_trip_step(session, name, Op::AddSaveSystem { spec: spec.clone() });
                session.undo().expect("undo the add").expect("the add");
                let t = Instant::now();
                session
                    .apply(Op::AddSaveSystem { spec })
                    .unwrap_or_else(|e| panic!("{name}: add: {e}"));
                let add_ms = t.elapsed().as_millis();
                let added = common::current(session);
                let t = Instant::now();
                session
                    .apply(Op::RemoveSystem { id })
                    .unwrap_or_else(|e| panic!("{name}: remove: {e}"));
                let remove_ms = t.elapsed().as_millis();
                assert!(
                    common::current(session) == original,
                    "{name}: the removal left the save changed"
                );
                session
                    .undo()
                    .expect("undo the removal")
                    .expect("the removal");
                assert!(
                    common::current(session) == added,
                    "{name}: undoing the removal wrote other bytes"
                );
                return Some((add_ms, remove_ms));
            }
            Err(OpError::TooClose { .. } | OpError::OutsideGalaxy { .. }) => {}
            Err(e) => panic!("{name}: add: {e}"),
        }
    }
    panic!("{name}: no room one jump from system 0");
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
            &no_names,
            &no_sources,
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

        let capitals = default_capitals(&save);
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
