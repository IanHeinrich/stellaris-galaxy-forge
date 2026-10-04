//! The hand-written install the special-layout tests read, and the layout generator over it.

use std::sync::LazyLock;

use sgf_core::ops::SystemSpec;
use sgf_gamedata::GameData;
use sgf_gamedata::generate::{GenerateError, generate_layout_for};
use sgf_gamedata::layouts::SaveFacts;

use super::{ABUNDANCE, hand_written as install_of, open_4_5};

/// The 4.5 sample's DLC, which the `if`s of a layout's bodies read.
static SAMPLE_4_5_FACTS: LazyLock<SaveFacts> = LazyLock::new(|| SaveFacts::read(&open_4_5()));

/// A system of the layout `key`, added to the 4.5 sample.
pub fn by_name(
    gd: &GameData,
    seed: u64,
    name: &str,
    at: (f64, f64),
    key: &str,
) -> Result<SystemSpec, GenerateError> {
    generate_layout_for(gd, &SAMPLE_4_5_FACTS, seed, name, at, key, ABUNDANCE)
}

pub const FILES: [(&str, &str); 9] = [
    (
        "common/deposit_categories/00_fx.txt",
        "fx_blockers = {\n\tblocker = yes\n}\nfx_features = {\n}\n",
    ),
    (
        "common/deposits/00_fx.txt",
        "d_fx_block = {\n\tcategory = fx_blockers\n\tpotential = { always = no }\n}\n\
         d_fx_gem = {\n\tcategory = fx_features\n\tpotential = { always = no }\n}\n",
    ),
    (
        "common/star_classes/00_stars.txt",
        "sc_sun = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 30\n}\n\
         sc_hole = {\n\tclass = hole_star\n\tplanet = { key = pc_hole }\n\tspawn_odds = 5\n}\n\
         sc_pole = {\n\tclass = pole_star\n\tplanet = { key = pc_pole }\n\tspawn_odds = 1\n}\n",
    ),
    (
        "common/star_classes/randomizers/00_lists.txt",
        "rl_single = {\n\tstars = { sc_sun }\n}\nrl_both = {\n\tstars = { sc_sun sc_hole }\n}\n",
    ),
    (
        "common/planet_classes/00_planets.txt",
        "pc_sun_star = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 30 }\n}\n\
         pc_hole = {\n\tstar = yes\n\tplanet_size = { min = 30 max = 40 }\n}\n\
         pc_pole = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 20 }\n}\n\
         pc_lone = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 20 }\n}\n\
         pc_rock = {\n\tmin_distance_from_sun = 0\n\tmax_distance_from_sun = 1000\n\tspawn_odds = 10\n\tplanet_size = { min = 10 max = 20 }\n\tmoon_size = { min = 5 max = 8 }\n}\n\
         pc_meadow = {\n\tmin_distance_from_sun = 60\n\tmax_distance_from_sun = 100\n\tspawn_odds = 1\n\tchance_of_ring = 0.5\n\tcolonizable = yes\n\tplanet_size = { min = 12 max = 20 }\n\tmoon_size = { min = 8 max = 10 }\n}\n\
         pc_husk = {\n\tplanet_size = { min = 10 max = 12 }\n\tmoon_size = { min = 4 max = 6 }\n}\n\
         random_list = {\n\tname = \"rl_rocky\"\n\tplanets = {\n\t\t\"pc_rock\"\n\t\t\"pc_meadow\"\n\t}\n}\n\
         random_list = {\n\tname = \"rl_husks\"\n\tplanets = { pc_husk }\n}\n",
    ),
    (
        "common/scripted_triggers/00_fx.txt",
        "has_fx_pack = {\n\toptimize_memory\n\thost_has_dlc = \"Fx Pack\"\n}\n",
    ),
    (
        "common/solar_system_initializers/00_fx.txt",
        "fx_plain = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { class = star orbit_distance = 0 }\n\tchange_orbit = 60\n\
         \tplanet = { count = 2 orbit_distance = 20 }\n}\n\
         fx_haven = {\n\tname = \"NAME_Fx_Haven\"\n\tclass = sc_sun\n\tusage = misc_system_init\n\
         \tusage_odds = {\n\t\tbase = 3\n\t\tmodifier = { factor = 0 has_fx_pack = no }\n\t}\n\
         \tmax_instances = 1\n\tflags = { fx_haven unique_system }\n\
         \tasteroid_belt = { type = rocky_asteroid_belt radius = 50 }\n\
         \tplanet = { class = pc_sun_star orbit_distance = 0 size = 25 }\n\
         \tplanet = {\n\t\tname = \"NAME_Husk\"\n\t\tclass = pc_husk\n\t\torbit_distance = 70\n\t\thas_ring = yes\n\t\thome_planet = yes\n\t\tentity = \"husk_entity\"\n\
         \t\tinit_effect = {\n\t\t\tadd_modifier = { modifier = fx_mod days = -1 }\n\t\t\tset_deposit = d_fx_gem\n\t\t\tprevent_anomaly = yes\n\t\t}\n\
         \t\tmoon = { name = \"NAME_Husk_Moon\" class = rl_husks orbit_distance = 5 }\n\t}\n\
         \tplanet = { class = rl_rocky orbit_distance = 10 has_ring = no }\n\
         \tplanet = { class = random_colonizable orbit_distance = 10 }\n\
         \tplanet = {\n\t\tclass = random_non_colonizable orbit_distance = 100\n\t\tmoon = { class = random_non_colonizable orbit_distance = 5 }\n\t}\n\
         \tplanet = { class = pc_hole orbit_distance = 20 }\n\
         \tinit_effect = {\n\t\tset_star_flag = fx\n\t\tsave_global_event_target_as = fx_haven\n\t\tevery_system_planet = { limit = { is_star = no } set_planet_flag = fx }\n\t}\n}\n\
         fx_offcentre = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 2\n\
         \tplanet = { class = star count = { min = 1 max = 2 } orbit_distance = 40 }\n\
         \tchange_orbit = 60\n\tplanet = { class = pc_rock orbit_distance = 60 }\n}\n\
         fx_hole = {\n\tclass = sc_hole\n\tusage = misc_system_init\n\tusage_odds = 2\n\
         \tplanet = { class = star orbit_distance = 0 }\n\tplanet = { class = pc_husk orbit_distance = 60 }\n}\n\
         fx_fleet = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 4\n\
         \tplanet = { class = star orbit_distance = 0 }\n\tinit_effect = { create_fleet = { name = fx } }\n}\n\
         fx_event = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 0\n\
         \tplanet = { class = star orbit_distance = 0 }\n}\n\
         fx_guardian = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 4\n\tflags = { guardian }\n\
         \tplanet = { class = star orbit_distance = 0 }\n}\n\
         fx_inherit = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 4\n\
         \tplanet = { class = star orbit_distance = 0 }\n\
         \tplanet = { class = pc_rock orbit_distance = 60 init_effect = { change_pc = { class = pc_meadow inherit_entity = yes } } }\n}\n\
         fx_works = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 4\n\tmax_instances = 1\n\
         \tplanet = { class = star orbit_distance = 0 }\n\
         \tplanet = {\n\t\tclass = pc_rock orbit_distance = 60\n\t\tinit_effect = {\n\
         \t\t\tadd_deposit = d_fx_block\n\t\t\tadd_deposit = d_fx_gem\n\t\t\tclear_blockers = yes\n\
         \t\t\tadd_blocker = { type = d_fx_block }\n\t\t\twhile = { count = 3 add_deposit = d_fx_gem }\n\
         \t\t\tif = { limit = { has_fx_pack = yes } change_pc = pc_meadow set_planet_entity = { entity = fx_meadow_entity } }\n\
         \t\t\telse = { add_modifier = { modifier = fx_mod days = -1 } }\n\
         \t\t\tif = { limit = { always = yes } set_planet_flag = fx }\n\t\t}\n\
         \t\tplanet = { class = pc_rock orbit_distance = 10 }\n\t}\n}\n\
         fx_empire = {\n\tclass = sc_sun\n\tusage = empire_init\n\tusage_odds = 4\n\
         \tplanet = { class = star orbit_distance = 0 }\n}\n\
         fx_named_hole = {\n\tname = \"NAME_Fx_Named_Hole\"\n\tclass = sc_hole\n\tusage = misc_system_init\n\tusage_odds = 50\n\
         \tplanet = { class = star orbit_distance = 0 }\n}\n\
         fx_pole = {\n\tclass = sc_pole\n\tusage = misc_system_init\n\
         \tusage_odds = {\n\t\tbase = 0\n\t\tmodifier = { add = 3 has_fx_pack = yes }\n\t\tmodifier = { factor = 0 is_in_cluster = fx_cluster }\n\t}\n\
         \tmax_instances = 1\n\tplanet = { class = star orbit_distance = 0 }\n\tplanet = { class = pc_husk orbit_distance = 60 }\n}\n\
         fx_cluster = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\
         \tusage_odds = {\n\t\tbase = 0\n\t\tmodifier = { add = 2000000 is_in_cluster = fx_cluster }\n\t}\n\
         \tplanet = { class = star orbit_distance = 0 }\n}\n\
         fx_nested = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 4\n\
         \tplanet = { class = star orbit_distance = 0 }\n\
         \tplanet = { class = pc_rock orbit_distance = 60 init_effect = { if = { limit = { has_global_flag = fx_flag } add_deposit = d_fx_gem } } }\n}\n\
         fx_system_modifier = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 4\n\
         \tplanet = { class = star orbit_distance = 0 }\n\tinit_effect = { add_modifier = { modifier = fx_mod days = -1 } }\n}\n\
         fx_forced = {\n\tclass = rl_both\n\tusage = misc_system_init\n\tusage_odds = 4\n\tmax_instances = 1\n\
         \tplanet = { class = pc_hole orbit_distance = 0 }\n\tplanet = { class = pc_rock orbit_distance = 60 }\n}\n\
         fx_mismatch = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 4\n\
         \tplanet = { class = pc_lone orbit_distance = 0 }\n}\n",
    ),
    (
        "localisation/english/fx_l_english.yml",
        "l_english:\n NAME_Fx_Haven:0 \"Fx Haven\"\n sc_sun:0 \"Sun\"\n sc_pole:0 \"Pole\"\n sc_hole:0 \"Hole\"\n pc_hole:0 \"Hole\"\n pc_husk:0 \"Husk World\"\n fx_mod:0 \"Fx Blessing\"\n",
    ),
    (
        "common/random_names/base/00_names.txt",
        "star_names = {\n\tFx_Alpha\n\tFx_Beta\n}\n",
    ),
];

pub fn hand_written() -> (tempfile::TempDir, GameData) {
    install_of(&FILES)
}
