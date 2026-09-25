//! `sgf gamedata`.
use crate::common::sgf;

#[test]
fn gamedata_with_a_bogus_install_fails_naming_the_searched_paths() {
    let dir = tempfile::tempdir().unwrap();
    let out = sgf(&["gamedata", "--install", dir.path().to_str().unwrap()]);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "{stderr}");
    assert!(
        stderr.contains("no Stellaris install found; searched"),
        "{stderr}"
    );
    assert!(stderr.contains(dir.path().to_str().unwrap()), "{stderr}");
}
