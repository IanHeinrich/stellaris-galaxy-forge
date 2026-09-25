//! `sgf validate`.
use crate::common::{SAMPLE, sgf, stdout};

/// A scenario of the fixture's shape whose system 0 writes both axes as ranges.
const RANGED_SCENARIO: &str = r#"static_galaxy_scenario = {
	name = "sgf_ranged"
	priority = 5
	supports_shape = elliptical
	num_empires = { min = 0 max = 2 }
	num_empire_default = 2
	random_hyperlanes = no
	core_radius = 112.5

	system = { id = "0" name = "Ranged" position = { x = { min = 1 max = 3 } y = { min = 2 max = 4 } } initializer = basic_init_01 }
	system = { id = "1" name = "Fixed" position = { x = 40 y = 50 } initializer = basic_init_02 }

	add_hyperlane = { from = "0" to = "1" }
}
"#;

#[test]
fn validate_reports_warnings_and_passes_a_vanilla_save() {
    // A game-written save must validate with exit 0. The sample carries the game's own
    // duplicate lane entries (154<->708, 401<->521), which are notes, and two lane-less
    // systems, of which 789 rides a wormhole to 788 and only 790 is unreachable.
    let out = sgf(&["validate", SAMPLE]);
    assert_eq!(out.status.code(), Some(0), "{}", stdout(&out));
    let text = stdout(&out);
    assert!(
        !text.contains("system_isolated: system 789"),
        "789 has a wormhole: {text}"
    );
    assert!(
        text.contains("warning system_isolated: system 790"),
        "{text}"
    );
    assert!(text.contains("info lane_duplicate: system 154"), "{text}");
    assert!(
        text.contains("validate: 1 warning(s), 0 error(s), 2 note(s)"),
        "{text}"
    );
}

#[test]
fn validate_reports_a_scenarios_ranged_position() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ranged.txt");
    std::fs::write(&path, RANGED_SCENARIO).unwrap();

    let out = sgf(&["validate", path.to_str().unwrap()]);
    let text = stdout(&out);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{text}{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        text.contains("warning position_range: system 0 position was a range"),
        "{text}"
    );
    assert!(!text.contains("position_range: system 1"), "{text}");
}
