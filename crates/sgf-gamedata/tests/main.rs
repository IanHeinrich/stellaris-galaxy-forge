//! One binary for every integration test, so `common` builds once and all tests run in parallel.

mod common;

mod anomaly_choices;
mod belt_kinds;
mod converted_layouts;
mod deposit_choices;
mod deposit_roll;
mod deposit_roll_install;
mod details;
mod details_colonies;
mod details_layout;
mod details_stars;
mod dig_site_choices;
mod first_wins;
mod flags;
mod fonts;
mod galaxy_shapes;
mod galaxy_sizes;
mod generate;
mod generate_effects;
mod generate_pinned;
mod generate_star_class;
mod initializers;
mod install;
mod layering;
mod localisation;
mod look_only_classes;
mod naming;
mod picks;
mod planet_disc_shapes;
mod planet_discs;
mod planet_view_choices;
mod planet_views;
mod playset_report;
mod precursors;
mod prepare;
mod registries;
mod reload;
mod roll_body;
mod save_bodies;
mod scripts_bypasses;
mod scripts_claim_rows;
mod scripts_claims;
mod scripts_lgate;
mod scripts_owners;
mod scripts_rows;
mod special;
mod special_generation;
mod special_layout_bodies;
mod special_layouts;
mod special_menu;
mod star_discs;
mod star_placeholders;
mod system_radii;
mod terraform_links;
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
