//! Scenario export through the public API: the sample save's galaxy written out, read
//! back and compared against the committed fixture.
use std::collections::BTreeSet;
use std::path::Path;

use sgf_core::document;
use sgf_core::emit::rounded;
use sgf_core::export;
use sgf_core::projections::galaxy::Galaxy;
use sgf_core::session::Session;
use sgf_core::views::DocumentKind;

mod common;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/2206.11.16.scenario.txt"
);
const GRAMMAR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/scenario_grammar.txt"
);
/// The fixture's name: the sample save's file stem, as the exporter defaults to.
const NAME: &str = "2206.11.16";

/// No game data, so every name is written as the save holds it.
fn no_names(_: &str) -> Option<String> {
    None
}

/// Every undirected lane once, ascending.
fn lanes(galaxy: &Galaxy) -> BTreeSet<(u32, u32)> {
    let mut pairs = BTreeSet::new();
    for system in galaxy.systems.values() {
        for lane in &system.lanes {
            pairs.insert((system.id.min(lane.to), system.id.max(lane.to)));
        }
    }
    pairs
}

fn exported(session: &Session, name: &str) -> Vec<u8> {
    let options = export::options_for(&session.graph, name);
    export::scenario_text(&session.graph, &options, &no_names)
}

#[test]
fn the_sample_exports_to_the_committed_fixture_and_reads_back_as_the_same_galaxy() {
    let save = common::open();
    let committed = std::fs::read(FIXTURE).expect("read the committed scenario fixture");
    assert_eq!(
        exported(&save, NAME),
        committed,
        "the fixture is generated: re-export it with `sgf export-scenario`"
    );

    let scenario = Session::open(FIXTURE).expect("open the exported scenario");
    assert_eq!(scenario.kind(), DocumentKind::Scenario);
    assert_eq!(scenario.title(), NAME);
    assert_eq!(scenario.graph.order, save.graph.order);
    assert_eq!(scenario.graph.systems.len(), 791);
    for (id, system) in &save.graph.systems {
        let written = &scenario.graph.systems[id];
        assert_eq!(
            (written.x, written.y),
            (rounded(system.x), rounded(system.y))
        );
        assert_eq!(written.initializer, system.initializer);
    }
    assert_eq!(lanes(&scenario.graph), lanes(&save.graph));
    assert_eq!(scenario.graph.nebulae.len(), 9);

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("roundtrip.txt");
    let mut scenario = scenario;
    scenario.save_as(&path).expect("save the scenario back out");
    assert_eq!(std::fs::read(&path).unwrap(), committed);
}

#[test]
fn a_save_opens_as_an_unsaved_scenario_of_the_same_galaxy() {
    let mut session = export::open_save_as_scenario(Path::new(common::SAMPLE), &no_names)
        .expect("open as scenario");
    assert_eq!(session.kind(), DocumentKind::Scenario);
    assert_eq!(session.title(), NAME);
    assert_eq!(session.path, None);
    assert!(session.is_dirty());

    let error = session
        .save_to(None)
        .expect_err("a pathless document cannot save in place");
    assert!(matches!(error, document::Error::NoPath), "{error:?}");

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("from_save.txt");
    session.save_as(&path).expect("save_as names the file");
    assert_eq!(session.path.as_deref(), Some(path.as_path()));
    assert!(!session.is_dirty());

    let reopened = Session::open(&path).expect("reopen what was saved");
    assert_eq!(reopened.graph.order, session.graph.order);
    assert_eq!(lanes(&reopened.graph), lanes(&session.graph));

    let error = export::open_save_as_scenario(Path::new(GRAMMAR), &no_names)
        .expect_err("a scenario is not a save");
    assert!(error.to_string().contains("already a scenario"), "{error}");
}

#[test]
fn a_new_scenario_is_a_header_with_nothing_in_it() {
    let mut session = export::new_scenario("sgf_test", 0.0).expect("new scenario");
    assert_eq!(session.kind(), DocumentKind::Scenario);
    assert_eq!(session.title(), "sgf_test");
    assert!(session.graph.systems.is_empty());
    assert!(session.graph.nebulae.is_empty());
    assert_eq!(session.graph.galaxy_radius, 0.0);
    assert_eq!(session.path, None);
    assert!(session.is_dirty());

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sgf_test.txt");
    session.save_as(&path).expect("save the new scenario");

    let reopened = Session::open(&path).expect("reopen the new scenario");
    assert_eq!(reopened.title(), "sgf_test");
    assert!(reopened.graph.systems.is_empty());
    common::snapshot(
        "new_scenario",
        &String::from_utf8(std::fs::read(&path).unwrap()).unwrap(),
    );
}

#[test]
fn a_scenario_name_that_cannot_be_quoted_is_refused_or_dropped() {
    for name in ["My \"Best\" Galaxy", "back\\slash", "two\nlines", ""] {
        let error = export::new_scenario(name, 0.0).expect_err("refused");
        assert!(
            error.to_string().contains("scenario name"),
            "{name:?}: {error}"
        );
    }

    let save = common::open();
    let doc = document::Document::from_scenario_bytes(exported(&save, "My \"Best\" Galaxy"))
        .expect("an exported scenario reads back");
    let scenario = Session::from_document(None, doc).expect("project the exported scenario");
    assert_eq!(scenario.title(), "My Best Galaxy");
    assert_eq!(scenario.graph.order, save.graph.order);
}

#[test]
fn writing_over_a_scenario_backs_the_old_one_up() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.txt");

    let first = export::write_scenario(&path, b"first").expect("write");
    assert_eq!(first.backup, None);

    let second = export::write_scenario(&path, b"second").expect("write over");
    let backup = second.backup.expect("a backup of the displaced file");
    assert!(
        backup
            .file_name()
            .unwrap()
            .to_string_lossy()
            .contains(".bak-"),
        "{}",
        backup.display()
    );
    assert_eq!(std::fs::read(&backup).unwrap(), b"first");
    assert_eq!(std::fs::read(&path).unwrap(), b"second");
}

fn backup_names(dir: &Path, prefix: &str) -> BTreeSet<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(prefix))
        .collect()
}

#[test]
fn pruning_keeps_the_original_the_newest_three_and_a_spread() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.txt");
    std::fs::write(&path, b"first").unwrap();
    let seeded = [
        "20260101-000000",
        "20260101-020000",
        "20260101-020005",
        "20260101-020005-1",
        "20260101-060000",
        "20260101-060003",
        "20260101-120000",
        "20260101-180000",
        "20260101-180010",
        "20260101-230000",
        "20260101-235959",
    ];
    for stamp in seeded {
        std::fs::write(dir.path().join(format!("target.txt.bak-{stamp}")), stamp).unwrap();
    }
    for name in ["other.txt.bak-20260101-000000", "target.txt.bak-junk"] {
        std::fs::write(dir.path().join(name), b"untouched").unwrap();
    }

    let outcome = export::write_scenario(&path, b"second").expect("write over");
    let newest = outcome.backup.expect("a backup of the displaced file");
    assert_eq!(std::fs::read(&newest).unwrap(), b"first");

    let expected: BTreeSet<String> = [
        "20260101-000000",
        "20260101-020005-1",
        "20260101-060003",
        "20260101-120000",
        "20260101-180000",
        "20260101-230000",
        "20260101-235959",
    ]
    .into_iter()
    .map(|stamp| format!("target.txt.bak-{stamp}"))
    .chain(std::iter::once(
        newest.file_name().unwrap().to_string_lossy().into_owned(),
    ))
    .collect();
    let mut remaining = backup_names(dir.path(), "target.txt.bak-");
    assert!(remaining.remove("target.txt.bak-junk"), "{remaining:?}");
    assert_eq!(remaining.len(), 8, "{remaining:?}");
    assert_eq!(remaining, expected);
    assert!(dir.path().join("other.txt.bak-20260101-000000").exists());
}

#[test]
fn writing_identical_bytes_makes_no_backup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.txt");

    export::write_scenario(&path, b"first").expect("write");
    let changed = export::write_scenario(&path, b"same").expect("write over");
    assert!(changed.backup.is_some());

    let unchanged = export::write_scenario(&path, b"same").expect("write the same again");
    assert_eq!(unchanged.backup, None);
    assert_eq!(std::fs::read(&path).unwrap(), b"same");
    assert_eq!(backup_names(dir.path(), "target.txt.bak-").len(), 1);
}
