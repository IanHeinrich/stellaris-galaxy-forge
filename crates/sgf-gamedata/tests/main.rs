//! One binary for every integration test, so `common` builds once and all tests run in parallel.

mod common;

mod deposit_roll;
mod galaxy_shapes;
mod galaxy_sizes;
mod generate;
mod initializers;
mod install;
mod layering;
mod localisation;
mod naming;
mod planet_discs;
mod planet_views;
mod registries;
mod reload;
mod scripts_bypasses;
mod scripts_claims;
mod scripts_lgate;
mod scripts_owners;
mod scripts_rows;
mod special;
mod special_layouts;
mod textures;

#[test]
fn every_test_file_is_declared_in_main() {
    use std::path::Path;

    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests");
    let main_rs = include_str!("main.rs");
    let mut missing = Vec::new();
    for entry in std::fs::read_dir(&dir).expect("tests directory reads") {
        let entry = entry.expect("directory entry reads");
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
            continue;
        }
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap();
        if stem == "main" {
            continue;
        }
        let declared = main_rs
            .lines()
            .any(|line| line.trim() == format!("mod {stem};"));
        if !declared {
            missing.push(stem.to_string());
        }
    }
    assert!(
        missing.is_empty(),
        "tests/{{{}}}.rs missing a `mod` declaration in tests/main.rs",
        missing.join(", ")
    );
}
