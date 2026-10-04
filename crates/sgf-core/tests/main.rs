//! The integration tests as one binary, so `common` builds once and every test runs in parallel.

mod common;

mod archive;
mod cepheus;
mod constants;
mod cst;
mod cygnus;
mod details;
mod details_geometry;
mod emit;
mod entity;
mod export;
mod export_paint;
mod export_write;
mod fe_links;
mod fe_zones;
mod galaxy;
mod game_setup;
mod header_counts;
mod header_list;
mod index;
mod issues;
mod marauders;
mod op_kinds;
mod ops_add_body;
mod ops_add_special_system;
mod ops_add_system;
mod ops_add_system_ids;
mod ops_add_system_refusals;
mod ops_anomaly;
mod ops_belts;
mod ops_black_hole_names;
mod ops_bodies;
mod ops_body_parents;
mod ops_deposit_slots;
mod ops_deposits;
mod ops_dig_site;
mod ops_empire_name;
mod ops_flag;
mod ops_header;
mod ops_history;
mod ops_lanes;
mod ops_lgate;
mod ops_map_colors;
mod ops_move_planet;
mod ops_move_planet_stations;
mod ops_move_planet_targets;
mod ops_move_wormhole;
mod ops_nebula;
mod ops_nebula_add_remove;
mod ops_nebula_footprint;
mod ops_nebula_names;
mod ops_planet_class;
mod ops_planet_entity;
mod ops_planet_modifier;
mod ops_planet_ring;
mod ops_planet_size;
mod ops_prevent;
mod ops_remove_added_system;
mod ops_remove_added_system_inverse;
mod ops_remove_planet;
mod ops_remove_planet_restore;
mod ops_rename_added_system;
mod ops_rename_planet;
mod ops_replace_added_system;
mod ops_scenario_bulk;
mod ops_scenario_history;
mod ops_scenario_incremental;
mod ops_scenario_lanes;
mod ops_scenario_positions;
mod ops_scenario_scale;
mod ops_scenario_systems;
mod ops_spawn_read;
mod ops_spawn_refusals;
mod ops_spawn_weight;
mod ops_star_class;
mod ops_system_height;
mod ops_wormhole_pair;
mod orbit_rules;
mod overlay;
mod planet_page;
mod scenario;
mod scenario_paint;
mod scenario_provenance;
mod search;
mod waylines;
mod wormhole_pairs;

#[test]
fn every_test_file_is_declared_here() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests");
    let declared = include_str!("main.rs");
    let own_targets: Vec<&str> = include_str!("../Cargo.toml")
        .lines()
        .filter_map(|line| line.strip_prefix("path = \"tests/")?.strip_suffix(".rs\""))
        .collect();
    let mut missing: Vec<String> = std::fs::read_dir(&dir)
        .expect("read the tests directory")
        .map(|entry| entry.expect("a directory entry").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "rs"))
        .filter_map(|path| Some(path.file_stem()?.to_str()?.to_owned()))
        .filter(|stem| !own_targets.contains(&stem.as_str()))
        .filter(|stem| !declared.lines().any(|line| line == format!("mod {stem};")))
        .collect();
    missing.sort();
    assert!(
        missing.is_empty(),
        "tests/main.rs does not declare these test files, so they never run: {missing:?}"
    );
}
