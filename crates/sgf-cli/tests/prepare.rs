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
    assert!(text.contains("sol: 1\n"), "{text}");
    assert!(text.contains("kept clear around seats: 0\n"), "{text}");
    assert!(
        text.contains("Prepared 791 systems for a new game"),
        "{text}"
    );
    let written = std::fs::read_to_string(&out).expect("the prepared scenario");
    assert!(!written.contains("name = \"Grugmora\""), "names are gone");
    assert!(!written.contains("initializer = une_deneb_system"));
    assert!(!written.contains("initializer = random_empire_init_"));
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

/// Bare shell lists the 17 new seats and how many systems it kept clear around them. Rolling
/// around the seats keeps none clear, and another seed draws other seats.
#[test]
fn bare_shell_lists_the_new_seats_and_what_it_kept_clear_around_them() {
    let out = temp_scenario();
    let path = out.to_str().expect("a UTF-8 path");
    let shell = |more: &[&str]| {
        let mut args = vec![
            "prepare",
            SCENARIO,
            "--preset",
            "shell",
            "--no-mods",
            "-o",
            path,
        ];
        args.extend(more);
        let run = sgf(&args);
        if without_install(&run) {
            return None;
        }
        ok(&run);
        Some(stdout(&run))
    };
    let new_seats = |text: &str| {
        let line = text
            .lines()
            .find_map(|line| line.strip_prefix("new seats: "));
        line.unwrap_or_else(|| panic!("the new seats: {text}"))
            .to_owned()
    };
    let Some(first) = shell(&["--seed", "0"]) else {
        return;
    };
    let kept: usize = first
        .lines()
        .find_map(|line| line.strip_prefix("kept clear around seats: "))
        .expect("the count")
        .parse()
        .expect("a number");
    assert!(kept > 0, "{first}");
    let seats = new_seats(&first);
    assert_eq!(seats.split(", ").count(), 17, "{seats}");

    let rolled = shell(&["--seed", "1", "--roll-around-seats"]).expect("the install");
    assert!(!rolled.contains("kept clear around seats"), "{rolled}");
    assert_ne!(new_seats(&rolled), seats);
}
