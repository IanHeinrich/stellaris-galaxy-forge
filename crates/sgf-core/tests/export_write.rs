//! Writing a scenario file: the backup of the file it replaces, and the pruning that keeps
//! the backups few.
use std::collections::BTreeSet;
use std::path::Path;

use sgf_core::export;

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
