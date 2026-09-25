//! What every `sgf` test shares: the binary, the sample files and the checks on its output.
#![allow(dead_code)]

use std::path::Path;
use std::process::{Command, Output};

pub const SAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/2206.11.16.sav");
pub const SAMPLE_4_5: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/2201.03.25.sav");
pub const SCENARIO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/2206.11.16.scenario.txt"
);
/// The system the in-game spike added to the 4.5 sample, as an `add-system` spec.
pub const MURA: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/mura.json");
/// The system the in-game spike added to the 4.4 sample, as an `add-system` spec.
pub const DORELLION: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/dorellion.json");

/// A spec under `tests/fixtures`, by its file stem.
pub fn fixture(name: &str) -> String {
    format!("{}/tests/fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"))
}

pub fn sgf(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_sgf"))
        .args(args)
        .output()
        .expect("run sgf")
}

pub fn stdout(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// The command exited 0; the failure shows what it printed to stderr.
pub fn ok(out: &Output) {
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// The backups a save in place left in `dir`, by name.
pub fn backups(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains(".bak-"))
        .collect();
    names.sort();
    names
}

/// Whether `out` failed for want of a Stellaris install, which skips the test unless
/// `SGF_REQUIRE_INSTALL` is set.
pub fn without_install(out: &Output) -> bool {
    let missing = String::from_utf8_lossy(&out.stderr).contains("no Stellaris install found");
    let required = std::env::var_os("SGF_REQUIRE_INSTALL").is_some_and(|v| !v.is_empty());
    assert!(!(missing && required), "SGF_REQUIRE_INSTALL is set");
    if missing {
        eprintln!("skipped: no Stellaris install");
    }
    missing
}
