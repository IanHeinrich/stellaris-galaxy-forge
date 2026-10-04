//! Static galaxy scenario files: saving and the file changed on disk, telling a scenario
//! from a save, and the listings of scenarios and their siblings.
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use sgf_core::document::{self, Document};
use sgf_core::format::scenario::listings::{
    ScenarioRoot, ScenarioSource, list_scenarios_in, sibling_names,
};
use sgf_core::ops::Op;
use sgf_core::session::Session;
use sgf_core::views::DocumentKind;

use crate::common;
use common::fixture::{GRAMMAR, PAINTED};
#[test]
fn saving_an_untouched_scenario_is_byte_identical_and_writes_nothing_twice() {
    let original = GRAMMAR.bytes();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("scenario_grammar.txt");

    let mut session = GRAMMAR.open();
    let outcome = session.save_as(&path).expect("save_as");
    assert_eq!(outcome.backup, None);
    assert_eq!(std::fs::read(&path).unwrap(), original);

    let outcome = session.save_as(&path).expect("save over the written file");
    assert_eq!(outcome.backup, None, "identical bytes make no backup");
    assert_eq!(std::fs::read(&path).unwrap(), original);
}

/// A session on a copy of the grammar fixture in `dir`, opened from that copy.
fn open_copy(dir: &Path) -> (Session, PathBuf) {
    let path = dir.join("scenario_grammar.txt");
    std::fs::write(&path, GRAMMAR.bytes()).unwrap();
    (Session::open(&path).expect("open the copy"), path)
}

/// What Stellaris does to the file behind the editor's back: new bytes and an mtime set
/// outright, so the change shows whatever the clock's resolution.
fn write_outside(path: &Path) -> Vec<u8> {
    let mut bytes = GRAMMAR.bytes();
    bytes.extend_from_slice(b"\n# written by something else\n");
    std::fs::write(path, &bytes).unwrap();
    let file = std::fs::File::options().write(true).open(path).unwrap();
    file.set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000_000))
        .unwrap();
    bytes
}

#[test]
fn saving_in_place_over_a_file_changed_on_disk_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (mut session, path) = open_copy(dir.path());
    let outside = write_outside(&path);

    for refused in [session.save_to(None), session.save_as(&path)] {
        match refused {
            Err(document::Error::ChangedOnDisk { path: p }) => assert_eq!(p, path),
            other => panic!("expected ChangedOnDisk, got {other:?}"),
        }
    }
    assert_eq!(
        std::fs::read(&path).unwrap(),
        outside,
        "nothing was written"
    );
}

#[test]
fn a_forced_save_writes_over_the_changed_file_and_keeps_it_as_the_backup() {
    let dir = tempfile::tempdir().unwrap();
    let (mut session, path) = open_copy(dir.path());
    let outside = write_outside(&path);

    let outcome = session
        .save_to_with(None, true, |_| {})
        .expect("forced save");
    let backup = outcome.backup.expect("the changed file is backed up");
    assert_eq!(std::fs::read(backup).unwrap(), outside);
    assert_eq!(std::fs::read(&path).unwrap(), GRAMMAR.bytes());

    session
        .save_to(None)
        .expect("the forced write is the new baseline");
}

#[test]
fn saving_in_place_twice_with_nothing_else_writing_is_not_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (mut session, _) = open_copy(dir.path());
    for x in [12.5, 30.0] {
        session
            .apply(Op::MoveSystem {
                system: 2,
                x,
                y: -60.25,
            })
            .expect("move a system");
        let outcome = session.save_to(None).expect("save in place");
        assert!(outcome.backup.is_some(), "the edit rewrote the file");
    }
    session.save_to(None).expect("an untouched save in place");
}

#[test]
fn saving_as_another_path_ignores_a_change_to_the_opened_file() {
    let dir = tempfile::tempdir().unwrap();
    let (mut session, path) = open_copy(dir.path());
    let outside = write_outside(&path);
    let other = dir.path().join("elsewhere.txt");

    session.save_as(&other).expect("save as another path");
    assert_eq!(session.path(), Some(other.as_path()));
    assert_eq!(
        std::fs::read(&path).unwrap(),
        outside,
        "the opened file is left alone"
    );
    session
        .save_to(None)
        .expect("the new path is the baseline now");
}

#[test]
fn the_kind_comes_from_the_bytes_not_the_extension() {
    let dir = tempfile::tempdir().unwrap();
    let misnamed = dir.path().join("actually_a_save.txt");
    std::fs::copy(common::SAMPLE, &misnamed).expect("copy the sample save");

    assert_eq!(document::sniff(&misnamed), DocumentKind::Save);
    assert_eq!(document::sniff(common::SAMPLE), DocumentKind::Save);
    assert_eq!(document::sniff(GRAMMAR.path), DocumentKind::Scenario);
    assert_eq!(
        Document::load(&misnamed)
            .expect("load the misnamed save")
            .kind(),
        DocumentKind::Save
    );
}

#[test]
fn a_file_that_is_not_one_static_galaxy_scenario_is_refused() {
    let refusal = |text: &str| {
        Document::from_scenario_bytes(text.as_bytes().to_vec())
            .err()
            .map(|e| e.to_string())
            .unwrap_or_else(|| panic!("expected a refusal for {text:?}"))
    };

    let dynamic = refusal("setup_scenario = { name = \"x\" }\n");
    assert!(dynamic.contains("dynamic shape scenario"), "{dynamic}");

    let commented = refusal("# everything here is commented out\n#static_galaxy_scenario = { }\n");
    assert!(
        commented.contains("no `static_galaxy_scenario` block"),
        "{commented}"
    );

    let id = refusal("static_galaxy_scenario = {\n\tsystem = { id = \"two\" }\n}\n");
    assert!(
        id.contains("system id `two`") && id.contains("at byte 44") && id.contains("not a number"),
        "{id}"
    );

    let two = refusal("static_galaxy_scenario = { }\nstatic_galaxy_scenario = { }\n");
    assert!(two.contains("2 top-level statements"), "{two}");
}

#[test]
fn each_listed_scenario_carries_its_header_summary() {
    let tmp = tempfile::tempdir().expect("temp dir");
    let dir = tmp.path().join("map/setup_scenarios");
    std::fs::create_dir_all(&dir).expect("scenario root");
    let testdata = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata");
    for file in ["paint_a_galaxy.txt", "4.4-early.scenario.txt"] {
        std::fs::copy(format!("{testdata}/{file}"), dir.join(file)).expect("copy a fixture");
    }
    std::fs::write(dir.join("unreadable.txt"), b"static_galaxy_scenario = {\n")
        .expect("write a scenario with no closing brace");
    let root = ScenarioRoot {
        dir,
        source: ScenarioSource::Install,
        mod_name: None,
        enabled: true,
        load_rank: Some(0),
        replaces: false,
    };
    let listings = list_scenarios_in(&[root]);
    let mut report = String::new();
    for listing in &listings {
        writeln!(report, "{}: {:#?}", listing.name, listing.summary).unwrap();
    }
    common::snapshot("header_summaries", &report);
    let painted: Vec<(&str, bool)> = listings
        .iter()
        .map(|l| (l.name.as_str(), l.painted))
        .collect();
    assert_eq!(
        painted,
        [
            ("4.4-early", false),
            ("Painted Reach", true),
            ("unreadable", false)
        ],
    );
}

#[test]
fn every_scenario_root_is_listed_with_its_name_count_and_overrides() {
    let tmp = tempfile::tempdir().expect("temp dir");
    let modded = tmp.path().join("star-maps/map/setup_scenarios");
    let install = tmp.path().join("install/map/setup_scenarios");
    std::fs::create_dir_all(&modded).expect("mod root");
    std::fs::create_dir_all(&install).expect("install root");
    std::fs::copy(GRAMMAR.path, modded.join("grammar.txt")).expect("copy the fixture");
    std::fs::copy(GRAMMAR.path, install.join("grammar.txt")).expect("copy the fixture");
    std::fs::write(
        modded.join("example.txt"),
        b"# the vanilla example, every line of it commented out\n# static_galaxy_scenario = { }\n",
    )
    .expect("write the commented-out example");

    let roots = [
        ScenarioRoot {
            dir: modded,
            source: ScenarioSource::Mod,
            mod_name: Some("Star Maps".to_owned()),
            enabled: true,
            load_rank: Some(1),
            replaces: false,
        },
        ScenarioRoot {
            dir: install,
            source: ScenarioSource::Install,
            mod_name: None,
            enabled: true,
            load_rank: Some(0),
            replaces: false,
        },
    ];
    let listings = list_scenarios_in(&roots);
    // The commented-out example holds no `static_galaxy_scenario` block: not a static
    // scenario, so not listed. Roots in the order given, files by name within each.
    assert_eq!(listings.len(), 2, "{listings:#?}");

    let winner = &listings[0];
    assert_eq!(winner.name, "sgf_grammar");
    assert_eq!(winner.systems, 8);
    assert_eq!(winner.error, None);
    assert_eq!(winner.shadowed_by, None);
    assert_eq!(winner.mod_name.as_deref(), Some("Star Maps"));
    assert!(winner.enabled);
    assert!(winner.size > 0 && winner.modified > 0);

    // Vanilla loads first, so the mod's file of the same name is the one the game reads.
    let shadowed = &listings[1];
    assert_eq!(shadowed.source, ScenarioSource::Install);
    assert_eq!(shadowed.name, "sgf_grammar");
    assert_eq!(shadowed.systems, 8);
    assert_eq!(shadowed.shadowed_by.as_deref(), Some("Star Maps"));
    assert_eq!(shadowed.mod_name, None);
}

#[test]
fn the_other_scenarios_beside_a_file_are_listed_by_name() {
    let dir = tempfile::tempdir().unwrap();
    let mine = dir.path().join("mine.txt");
    std::fs::copy(PAINTED.path, &mine).unwrap();
    std::fs::copy(GRAMMAR.path, dir.path().join("grammar.txt")).unwrap();
    std::fs::write(
        dir.path().join("other.txt"),
        "static_galaxy_scenario = {\n\tname = \"Other Reach\"\n}\n",
    )
    .unwrap();
    std::fs::write(dir.path().join("notes.txt"), "not a scenario").unwrap();
    std::fs::write(dir.path().join("mine.bak"), "static_galaxy_scenario = { }").unwrap();
    assert_eq!(
        sibling_names(&mine),
        [
            ("grammar.txt".to_owned(), "sgf_grammar".to_owned()),
            ("other.txt".to_owned(), "Other Reach".to_owned()),
        ]
    );
    assert_eq!(
        sibling_names(&dir.path().join("other.txt")),
        [
            ("grammar.txt".to_owned(), "sgf_grammar".to_owned()),
            ("mine.txt".to_owned(), "Painted Reach".to_owned()),
        ]
    );
}
