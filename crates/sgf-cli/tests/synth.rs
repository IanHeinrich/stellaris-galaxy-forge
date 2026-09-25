//! `sgf synth`.
use crate::common::{ok, sgf, stdout};

#[test]
fn synth_writes_a_galaxy_that_inspects_and_validates() {
    let dir = tempfile::tempdir().unwrap();
    let sav = dir.path().join("synth.sav");
    let sav_str = sav.to_str().unwrap();
    let copy = dir.path().join("copy.sav");
    let copy_str = copy.to_str().unwrap();

    let out = sgf(&["synth", "--systems", "500", "-o", sav_str]);
    ok(&out);
    assert!(stdout(&out).contains("500 systems"), "{}", stdout(&out));

    let out = sgf(&["inspect", sav_str, "--galaxy"]);
    ok(&out);
    let text = stdout(&out);
    let line = |key: &str| -> String {
        text.lines()
            .find(|l| l.starts_with(key))
            .unwrap_or_else(|| panic!("no {key} line in:\n{text}"))
            .to_owned()
    };
    assert!(line("systems:").contains("500"), "{text}");
    let lanes = line("lanes:");
    let count: usize = lanes
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| panic!("no lane count in: {lanes}"));
    assert!(count > 0, "{lanes}");

    let out = sgf(&["validate", sav_str]);
    assert_eq!(out.status.code(), Some(0), "{}", stdout(&out));
    assert!(stdout(&out).contains(" 0 error(s)"), "{}", stdout(&out));

    let out = sgf(&["roundtrip", sav_str, copy_str, "--check"]);
    ok(&out);
    assert!(
        stdout(&out).contains("roundtrip: byte-identical"),
        "{}",
        stdout(&out)
    );
}

#[test]
fn synth_writes_the_waystation_networks_it_is_given() {
    let dir = tempfile::tempdir().unwrap();
    let sav = dir.path().join("waystations.sav");
    let sav_str = sav.to_str().unwrap();

    let out = sgf(&[
        "synth",
        "--systems",
        "12",
        "--waystations",
        "3,7,9",
        "-o",
        sav_str,
    ]);
    ok(&out);
    assert!(
        stdout(&out).contains("1 waystation network(s)"),
        "{}",
        stdout(&out)
    );

    let out = sgf(&["inspect", sav_str]);
    ok(&out);
    let text = stdout(&out);
    assert!(text.contains("waystation_networks"), "{text}");
    assert!(text.contains("starbase_mgr"), "{text}");

    let out = sgf(&["validate", sav_str]);
    assert_eq!(out.status.code(), Some(0), "{}", stdout(&out));
    assert!(stdout(&out).contains(" 0 error(s)"), "{}", stdout(&out));

    let copy = dir.path().join("copy.sav");
    let out = sgf(&["roundtrip", sav_str, copy.to_str().unwrap(), "--check"]);
    assert!(
        stdout(&out).contains("roundtrip: byte-identical"),
        "{}",
        stdout(&out)
    );
}

#[test]
fn synth_rejects_zero_systems() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("never.sav");
    let out = sgf(&["synth", "--systems", "0", "-o", out_path.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.starts_with("error: "), "{err}");
    assert!(!out_path.exists());
}
