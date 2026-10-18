//! One binary for every integration test, so `common` builds once and all tests run in parallel.

mod common;

mod anomaly_choices;
mod belt_kinds;
mod converted_layouts;
mod deposit_choices;
mod deposit_roll;
mod deposit_roll_install;
mod details;
mod details_at;
mod details_colonies;
mod details_layout;
mod details_spawn;
mod details_spawn_install;
mod details_stars;
mod details_structures;
mod dig_site_choices;
mod disc_scales;
mod first_wins;
mod flags;
mod fonts;
mod galaxy_shapes;
mod galaxy_sizes;
mod generate;
mod generate_effects;
mod generate_many;
mod generate_pinned;
mod generate_star_class;
mod initializer_corpus;
mod initializer_definition;
mod initializers;
mod inline_maths;
mod inline_script_reload;
mod install;
mod layering;
mod localisation;
mod look_only_classes;
mod megastructure_construction;
mod megastructure_host_planet;
mod megastructure_inline_scripts;
mod megastructure_layouts;
mod megastructure_layouts_added;
mod megastructure_layouts_giga;
mod megastructure_layouts_join;
mod megastructure_offers;
mod megastructure_swaps;
mod megastructure_views;
mod megastructures;
mod mod_names;
mod model_sprites;
mod model_sprites_install;
mod model_sprites_surfaces;
mod model_thumbnails;
mod multi_star;
mod multi_star_builder;
mod naming;
mod picks;
mod planet_disc_shapes;
mod planet_discs;
mod planet_view_choices;
mod planet_views;
mod playset_report;
mod precursors;
mod prepare_rows;
mod prepare_seats;
mod prepare_shells;
mod prepare_sol;
mod registries;
mod reload;
mod roll_body;
mod sample_install_facts;
mod save_bodies;
mod scripts_bypasses;
mod scripts_claim_rows;
mod scripts_claims;
mod scripts_fallen;
mod scripts_lgate;
mod scripts_owners;
mod scripts_rows;
mod special;
mod special_clusters;
mod special_extras;
mod special_generation;
mod special_layout_bodies;
mod special_layouts;
mod special_megastructures;
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
