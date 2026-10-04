//! What every `sgf` test shares: the binary, the sample files and the checks on its output.
#![allow(dead_code)]

use std::path::Path;
use std::process::{Command, Output};

pub const SAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/4.4-early.sav");
pub const SAMPLE_4_5: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/4.5-day-one.sav"
);
pub const SCENARIO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/4.4-early.scenario.txt"
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

/// Run `sgf` with `args` and `-o` a new file, expecting success; what it printed and the file.
pub fn edited(args: &[&str]) -> (String, tempfile::TempPath) {
    let out = tempfile::Builder::new()
        .suffix(".sav")
        .tempfile()
        .expect("a temporary file")
        .into_temp_path();
    let mut args = args.to_vec();
    args.extend(["-o", out.to_str().expect("a UTF-8 path")]);
    let out_run = sgf(&args);
    ok(&out_run);
    (stdout(&out_run), out)
}

/// An edit file for `sgf apply` that holds `op`.
pub fn edit(op: &serde_json::Value) -> tempfile::TempPath {
    let file = tempfile::Builder::new()
        .suffix(".json")
        .tempfile()
        .expect("a temporary file");
    std::fs::write(file.path(), op.to_string()).expect("write the edit");
    file.into_temp_path()
}

/// `AddSystemFromSpec` for the spec at `path`, as an edit file's op.
pub fn add_system_op(path: &str) -> serde_json::Value {
    let spec: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("read the spec"))
            .expect("the spec as JSON");
    serde_json::json!({ "type": "AddSystemFromSpec", "spec": spec })
}
