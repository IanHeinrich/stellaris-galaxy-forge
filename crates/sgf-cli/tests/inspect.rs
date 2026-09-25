//! `sgf inspect`.
use crate::common::{SAMPLE, SCENARIO, ok, sgf, stdout};

#[test]
fn inspect_reports_header_sections_and_entities() {
    let out = sgf(&["inspect", SAMPLE]);
    ok(&out);
    let text = stdout(&out);
    assert!(text.contains("Pegasus v4.4.6"), "{text}");

    let row = |key: &str| -> Vec<String> {
        text.lines()
            .find(|l| l.starts_with(&format!("{key} ")))
            .unwrap_or_else(|| panic!("no row for {key} in:\n{text}"))
            .split_whitespace()
            .map(str::to_owned)
            .collect()
    };
    let planets = row("planets");
    let bytes: usize = planets[1].parse().unwrap();
    assert!(
        (5_400_000..=5_500_000).contains(&bytes),
        "planets bytes {bytes}"
    );
    assert_eq!(row("galactic_object")[3], "791");
}

#[test]
fn inspect_galaxy_summarises_systems_and_lanes() {
    let out = sgf(&["inspect", SAMPLE, "--galaxy"]);
    ok(&out);
    let text = stdout(&out);
    let line = |key: &str| -> String {
        text.lines()
            .find(|l| l.starts_with(key))
            .unwrap_or_else(|| {
                panic!(
                    "no {key} line in:
{text}"
                )
            })
            .to_owned()
    };
    assert!(line("systems:").contains("791"), "{text}");
    assert!(line("lanes:").contains("1092"), "{text}");
    assert!(line("lanes:").contains("125 bridge"), "{text}");
    assert!(line("lane-less:").contains("789, 790"), "{text}");
    assert!(line("nebulae:").contains('9'), "{text}");
    assert!(line("radius:").contains("499.9288"), "{text}");
}

#[test]
fn inspect_refuses_a_scenario() {
    let out = sgf(&["inspect", SCENARIO]);
    assert_eq!(out.status.code(), Some(1), "{}", stdout(&out));
    assert!(
        stdout(&out).contains("inspect: ") && stdout(&out).contains("reads saves only"),
        "{}",
        stdout(&out)
    );
}
