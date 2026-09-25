//! `sgf special`.
use crate::common::{SAMPLE, ok, sgf, stdout};

#[test]
fn special_from_flags_alone_lists_systems_and_the_per_kind_footer() {
    let out = sgf(&["special", SAMPLE, "--no-gamedata"]);
    ok(&out);
    let text = stdout(&out);
    assert!(
        text.contains("special: 100 system(s) (save flags only)"),
        "{text}"
    );
    let footer = |kind: &str| -> Vec<String> {
        text.lines()
            .find(|l| l.trim_start().starts_with(&format!("{kind} ")))
            .unwrap_or_else(|| panic!("no footer row for {kind} in:\n{text}"))
            .split_whitespace()
            .map(str::to_owned)
            .collect()
    };
    assert_eq!(footer("leviathan")[1], "6");
    assert_eq!(footer("enclave")[1], "14");
    assert_eq!(footer("landmark")[1..], ["11", "11"]);
    assert!(
        text.lines().any(|l| l.starts_with('#')
            && l.contains("guardians_init_dragon")
            && l.contains("leviathan")),
        "{text}"
    );
}
