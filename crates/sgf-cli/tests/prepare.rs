//! `sgf prepare`.
use crate::common::{SAMPLE, SCENARIO, ok, sgf, stdout, without_install};

fn temp_scenario() -> tempfile::TempPath {
    tempfile::Builder::new()
        .suffix(".txt")
        .tempfile()
        .expect("a temporary file")
        .into_temp_path()
}

#[test]
fn a_preset_with_a_row_over_it_is_written_as_one_edit() {
    let out = temp_scenario();
    let run = sgf(&[
        "prepare",
        SCENARIO,
        "--preset",
        "fresh",
        "--row",
        "system_names=game_names",
        "--no-mods",
        "-o",
        out.to_str().expect("a UTF-8 path"),
    ]);
    if without_install(&run) {
        return;
    }
    ok(&run);
    let text = stdout(&run);
    assert!(text.contains("home_starts: 4\n"), "{text}");
    assert!(text.contains("system_names: 791\n"), "{text}");
    assert!(
        text.contains("Prepared 791 systems for a new game"),
        "{text}"
    );
    let written = std::fs::read_to_string(&out).expect("the prepared scenario");
    assert!(!written.contains("name = \"Grugmora\""), "names are gone");
    assert!(!written.contains("initializer = une_deneb_system"));
}

#[test]
fn faithful_writes_nothing() {
    let out = temp_scenario();
    std::fs::remove_file(&out).expect("no file yet");
    let run = sgf(&[
        "prepare",
        SCENARIO,
        "--preset",
        "faithful",
        "--no-mods",
        "-o",
        out.to_str().expect("a UTF-8 path"),
    ]);
    if without_install(&run) {
        return;
    }
    ok(&run);
    assert!(stdout(&run).ends_with("nothing to change\n"));
    assert!(!out.exists());
}

#[test]
fn a_save_and_an_unknown_choice_are_refused() {
    let save = sgf(&["prepare", SAMPLE, "--preset", "fresh"]);
    assert_eq!(save.status.code(), Some(1));
    assert!(stdout(&save).contains("reads scenarios only"));
    let unknown = sgf(&[
        "prepare",
        SCENARIO,
        "--preset",
        "fresh",
        "--row",
        "system_names=plain_please",
    ]);
    assert_eq!(unknown.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&unknown.stderr).contains("plain_please is none of"));
}
