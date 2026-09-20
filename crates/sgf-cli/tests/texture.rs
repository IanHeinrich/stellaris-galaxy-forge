//! `sgf texture` through the binary.
use std::process::Command;

#[test]
fn texture_with_a_bad_key_fails_before_touching_the_install() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("out.png");
    let result = Command::new(env!("CARGO_BIN_EXE_sgf"))
        .args(["texture", "planet:pc_desert", "-o", out.to_str().unwrap()])
        .output()
        .expect("run sgf");
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert_eq!(result.status.code(), Some(1), "{stderr}");
    assert!(
        stderr.contains("bad texture key `planet:pc_desert`"),
        "{stderr}"
    );
    assert!(!out.exists());
}
