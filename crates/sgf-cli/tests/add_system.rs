//! `sgf add-system`, rolled from the install's rules.
use std::path::Path;

use crate::common::{SAMPLE_4_5, ok, sgf, stdout, without_install};

/// `--then-remove` reaches the app's bulk delete: it removes the systems among its ids the
/// command added, as one step, and leaves the file's own alone.
#[test]
fn add_system_then_remove_removes_only_the_systems_it_added() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("removed.sav");
    let out_str = out_path.to_str().unwrap();
    let run = |extra: &[&str]| {
        let mut args = vec![
            "add-system",
            SAMPLE_4_5,
            "--seed",
            "11",
            "--at",
            "-292.23404,-137.62265",
            "--lane",
            "169",
            "--no-mods",
        ];
        args.extend_from_slice(extra);
        args.extend_from_slice(&["-o", out_str]);
        sgf(&args)
    };
    let out = run(&["--then-remove", "601", "--then-remove", "0"]);
    if without_install(&out) {
        return;
    }
    ok(&out);
    let text = stdout(&out);
    assert!(text.contains("Added "), "{text}");
    assert!(
        text.contains("Removed ") && text.contains(" #601 "),
        "{text}"
    );
    assert!(
        !text.contains("(#0)"),
        "the file's own system stays: {text}"
    );
    assert!(text.contains(&format!("wrote {out_str}")), "{text}");
    std::fs::remove_file(&out_path).unwrap();

    let refused = run(&["--then-remove", "0"]);
    assert_eq!(refused.status.code(), Some(1));
    let err = String::from_utf8_lossy(&refused.stderr);
    assert!(
        err.contains("none of the systems --then-remove names"),
        "{err}"
    );
    assert!(!out_path.exists());
}

#[test]
fn add_system_generates_a_system_from_a_seed_and_writes_it() {
    let dir = tempfile::tempdir().unwrap();
    let printed_path = dir.path().join("printed.sav");
    let out_path = dir.path().join("generated.sav");
    let out_str = out_path.to_str().unwrap();
    let args = |out: &Path, extra: &[&str]| -> Vec<String> {
        let mut args: Vec<String> = [
            "add-system",
            SAMPLE_4_5,
            "--seed",
            "11",
            "--at",
            "-292.23404,-137.62265",
            "--lane",
            "169",
            "--no-mods",
        ]
        .iter()
        .chain(extra)
        .map(|arg| (*arg).to_owned())
        .collect();
        args.extend(["-o".to_owned(), out.to_str().unwrap().to_owned()]);
        args
    };
    let run = |args: Vec<String>| sgf(&args.iter().map(String::as_str).collect::<Vec<_>>());

    let printed = run(args(&printed_path, &["--print-spec"]));
    if without_install(&printed) {
        return;
    }
    ok(&printed);
    assert!(!printed_path.exists(), "--print-spec writes nothing");
    let spec: serde_json::Value =
        serde_json::from_str(&stdout(&printed)).expect("the spec as JSON");
    assert_eq!(spec["lanes"], serde_json::json!([169]));
    assert_eq!(spec["x"], serde_json::json!(-292.23404));
    let name = spec["name"]
        .as_str()
        .expect("a name from the pool")
        .to_owned();
    assert!(!name.is_empty());

    let out = run(args(&out_path, &[]));
    ok(&out);
    let text = stdout(&out);
    assert!(text.contains(&format!("seed 11: {name} ")), "{text}");
    assert!(text.contains(&format!("Added {name} #601")), "{text}");
    assert!(text.contains(" deposits "), "{text}");
    assert_eq!(sgf(&["validate", out_str]).status.code(), Some(0));
}

#[test]
fn add_system_needs_its_seed_and_place_and_refuses_clashing_options() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("refused.sav");
    let out = out_path.to_str().unwrap();
    for args in [
        &["--at", "0,0"][..],
        &["--seed", "1"],
        &[
            "--seed",
            "1",
            "--at",
            "0,0",
            "--print-spec",
            "--then-remove",
            "601",
        ],
        &[
            "--seed",
            "1",
            "--at",
            "0,0",
            "--print-spec",
            "--then-reroll",
            "2",
        ],
        &[
            "--seed",
            "1",
            "--at",
            "0,0",
            "--star-class",
            "sc_g",
            "--layout",
            "trappist_initializer",
        ],
        &["--seed", "1", "--at", "0,0", "--keep-special"],
    ] {
        let mut command = vec!["add-system", SAMPLE_4_5];
        command.extend_from_slice(args);
        command.extend_from_slice(&["-o", out]);
        let refused = sgf(&command);
        assert_eq!(refused.status.code(), Some(2), "a usage error: {args:?}");
        assert!(!out_path.exists(), "{args:?}");
    }
}

#[test]
fn add_system_generates_around_the_star_class_asked_for() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("classed.sav");
    let out_str = out_path.to_str().unwrap();
    let out = sgf(&[
        "add-system",
        SAMPLE_4_5,
        "--seed",
        "11",
        "--at",
        "-292.23404,-137.62265",
        "--lane",
        "169",
        "--star-class",
        "sc_m",
        "--no-mods",
        "-o",
        out_str,
    ]);
    if without_install(&out) {
        return;
    }
    ok(&out);
    assert!(stdout(&out).contains(" sc_m ("), "{}", stdout(&out));
    assert_eq!(sgf(&["validate", out_str]).status.code(), Some(0));
}

#[test]
fn add_system_generates_the_special_layout_asked_for() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("trappist.sav");
    let out_str = out_path.to_str().unwrap();
    let out = sgf(&[
        "add-system",
        SAMPLE_4_5,
        "--seed",
        "4",
        "--at",
        "-292.23404,-137.62265",
        "--lane",
        "169",
        "--layout",
        "trappist_initializer",
        "--no-mods",
        "-o",
        out_str,
    ]);
    if without_install(&out) {
        return;
    }
    ok(&out);
    let text = stdout(&out);
    assert!(
        text.contains("NAME_Trappist sc_m (trappist_initializer, capped)"),
        "{text}"
    );
    assert!(text.contains("(named after the system)"), "{text}");
    assert!(text.contains("modifiers terraforming_candidate"), "{text}");
    assert_eq!(sgf(&["validate", out_str]).status.code(), Some(0));
}

/// `--then-reroll` reaches the app's reroll: the system keeps its name and position, and
/// with `--keep-special` a Special menu layout is built from that layout again.
#[test]
fn add_system_then_reroll_keeps_the_name_and_with_keep_special_the_layout() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("rerolled.sav");
    let out_str = out_path.to_str().unwrap();
    let kept = sgf(&[
        "add-system",
        SAMPLE_4_5,
        "--seed",
        "5",
        "--at",
        "-292.23404,-137.62265",
        "--layout",
        "wenkwort_initializer",
        "--then-reroll",
        "6",
        "--keep-special",
        "--no-mods",
        "-o",
        out_str,
    ]);
    if without_install(&kept) {
        return;
    }
    ok(&kept);
    let text = stdout(&kept);
    let rolls: Vec<&str> = text.lines().filter(|l| l.starts_with("seed ")).collect();
    let [added, again] = rolls[..] else {
        panic!("one line per roll: {text}");
    };
    let name = |line: &str| {
        let (_, rest) = line.split_once(": ").expect("seed N: name class (layout)");
        let head = rest.split(" (").next().unwrap_or_default();
        head.rsplit_once(' ')
            .map_or(head, |(name, _)| name)
            .to_owned()
    };
    assert!(added.starts_with("seed 5: "), "{text}");
    assert!(again.starts_with("seed 6: "), "{text}");
    assert_eq!(name(again), name(added), "the name stays: {text}");
    assert!(again.contains("(wenkwort_initializer"), "{text}");
    ok(&sgf(&["validate", out_str]));
}
