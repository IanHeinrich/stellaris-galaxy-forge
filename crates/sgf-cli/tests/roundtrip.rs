//! `sgf roundtrip`.
use crate::common::{SAMPLE, SCENARIO, backups, ok, sgf, stdout};

#[test]
fn roundtrip_check_is_byte_identical_and_writes_nothing_twice() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("copy.sav");
    let out_str = out_path.to_str().unwrap();

    let out = sgf(&["roundtrip", SAMPLE, out_str, "--check"]);
    ok(&out);
    assert!(
        stdout(&out).contains("roundtrip: byte-identical"),
        "{}",
        stdout(&out)
    );
    assert_eq!(backups(dir.path()).len(), 0);

    let out = sgf(&["roundtrip", SAMPLE, out_str, "--check"]);
    ok(&out);
    assert!(
        stdout(&out).contains("roundtrip: byte-identical"),
        "{}",
        stdout(&out)
    );
    let backups = backups(dir.path());
    assert_eq!(
        backups.len(),
        0,
        "identical bytes make no backup: {backups:?}"
    );
    assert!(!stdout(&out).contains("backup "), "{}", stdout(&out));
}

#[test]
fn roundtrip_refuses_a_scenario() {
    let dir = tempfile::tempdir().unwrap();
    let copy = dir.path().join("copy.txt");
    let out = sgf(&["roundtrip", SCENARIO, copy.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(1), "{}", stdout(&out));
    assert!(
        stdout(&out).contains("roundtrip: ") && stdout(&out).contains("reads saves only"),
        "{}",
        stdout(&out)
    );
    assert!(!copy.exists());
}
