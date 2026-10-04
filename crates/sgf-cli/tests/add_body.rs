//! `sgf add-body`, rolled from the install's rules.
use crate::common::{SAMPLE_4_5, ok, sgf, stdout, without_install};

#[test]
fn add_body_rolls_a_body_from_a_seed_and_writes_it() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("rolled.sav");
    let out_str = out_path.to_str().unwrap();
    let roll = |extra: &[&str]| {
        let mut args = vec!["add-body", SAMPLE_4_5, "408", "--radius", "15"];
        args.extend_from_slice(extra);
        args.extend_from_slice(&["-o", out_str]);
        sgf(&args)
    };

    let moon = roll(&["--moon-of", "138", "--angle", "90", "--seed", "7"]);
    if without_install(&moon) {
        return;
    }
    ok(&moon);
    let text = stdout(&moon);
    assert!(text.contains("Added moon #"), "{text}");
    assert!(text.contains("of planet #138 in Meissa #408"), "{text}");
    assert_eq!(sgf(&["validate", out_str]).status.code(), Some(0));
    assert_eq!(
        stdout(&roll(&["--moon-of", "138", "--angle", "90", "--seed", "7"]))
            .lines()
            .next(),
        text.lines().next(),
        "the same seed rolls the same moon"
    );

    let planet = roll(&[
        "--class",
        "pc_desert",
        "--size",
        "12",
        "--angle",
        "200",
        "--seed",
        "3",
    ]);
    ok(&planet);
    assert!(
        stdout(&planet).contains("(pc_desert, size 12)"),
        "{}",
        stdout(&planet)
    );
}

#[test]
fn add_body_without_a_seed_is_a_usage_error() {
    let dir = tempfile::tempdir().unwrap();
    let never = dir.path().join("never.sav");
    let out = sgf(&[
        "add-body",
        SAMPLE_4_5,
        "408",
        "--class",
        "pc_desert",
        "--size",
        "12",
        "--radius",
        "45",
        "--angle",
        "0",
        "-o",
        never.to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(2));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("--seed"), "{err}");
    assert!(!never.exists());
}
