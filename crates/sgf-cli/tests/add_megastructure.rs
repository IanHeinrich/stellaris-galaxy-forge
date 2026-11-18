//! `sgf add-megastructure`, through the join the app calls.
use crate::common::{SAMPLE_4_5, SCENARIO, ok, sgf, stdout, without_install};

#[test]
fn add_megastructure_adds_a_row_on_a_body_and_writes_it() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("nexus.sav");
    let out_str = out_path.to_str().unwrap();
    let nexus = sgf(&[
        "add-megastructure",
        SAMPLE_4_5,
        "169",
        "think_tank_3",
        "--body",
        "6",
        "--no-mods",
        "-o",
        out_str,
    ]);
    if without_install(&nexus) {
        return;
    }
    ok(&nexus);
    let text = stdout(&nexus);
    assert!(
        text.contains("Added megastructure #16 (think_tank_3) in Alari system #169"),
        "{text}"
    );
    assert_eq!(sgf(&["validate", out_str]).status.code(), Some(0));
}

#[test]
fn add_megastructure_refuses_a_place_its_type_does_not_take() {
    let dir = tempfile::tempdir().unwrap();
    let never = dir.path().join("never.sav");
    let relay = sgf(&[
        "add-megastructure",
        SAMPLE_4_5,
        "169",
        "hyper_relay",
        "--body",
        "6",
        "--no-mods",
        "-o",
        never.to_str().unwrap(),
    ]);
    if without_install(&relay) {
        return;
    }
    assert_eq!(relay.status.code(), Some(1));
    let err = String::from_utf8_lossy(&relay.stderr);
    assert!(
        err.contains("Hyper Relay goes in empty space, not on a planet or star."),
        "{err}"
    );
    assert!(!never.exists());
}

#[test]
fn add_megastructure_without_a_place_is_a_usage_error() {
    let out = sgf(&["add-megastructure", SAMPLE_4_5, "169", "think_tank_3"]);
    assert_eq!(out.status.code(), Some(2));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("--body"), "{err}");
}

#[test]
fn add_megastructure_writes_a_ruin_into_a_scenario_system() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("ruin.txt");
    let out_str = out_path.to_str().unwrap();
    let gateway = sgf(&[
        "add-megastructure",
        SCENARIO,
        "1",
        "gateway_ruined",
        "--at",
        "100,0",
        "--no-mods",
        "-o",
        out_str,
    ]);
    if without_install(&gateway) {
        return;
    }
    ok(&gateway);
    let text = stdout(&gateway);
    assert!(text.contains("gateway_ruined"), "{text}");
    let written = std::fs::read_to_string(&out_path).unwrap();
    assert!(
        written.contains("spawn_megastructure = { type = \"gateway_ruined\""),
        "{written}"
    );
    assert_eq!(sgf(&["validate", out_str]).status.code(), Some(0));
}
