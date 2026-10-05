//! The hand-written install the generator tests roll from, and what they share over it.

use sgf_core::ops::SystemSpec;
use sgf_gamedata::GameData;
use sgf_gamedata::generate::generate;
use sgf_gamedata::install::script::Range;

use super::{ABUNDANCE, SPOT, hand_written as install_of};

pub const SEEDS: u64 = 1000;

pub const FILES: [(&str, &str); 6] = [
    (
        "common/scripted_variables/00_fx.txt",
        "@fx_min = 60\n@fx_max = 100\n@fx_odds = 0.5\n@fx_moon = 10\n",
    ),
    (
        "common/star_classes/00_stars.txt",
        "sc_sun = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 30\n\tnum_planets = { min = 2 max = 5 }\n\tpc_meadow = { spawn_odds = 0.25 }\n}\n\
         sc_ember = {\n\tclass = ember_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 10\n}\n\
         sc_pair = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 5\n}\n\
         sc_blaze = {\n\tclass = blaze_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 90\n}\n",
    ),
    (
        "common/star_classes/randomizers/00_lists.txt",
        "rl_single = {\n\tstars = {\n\t\t\"sc_sun\"\n\t\t\"sc_ember\"\n\t}\n}\n\
         rl_pair = {\n\tstars = { \"sc_pair\" }\n}\n\
         rl_warm = {\n\tstars = { sc_sun sc_blaze }\n}\n",
    ),
    (
        "common/planet_classes/00_planets.txt",
        "pc_sun_star = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 30 }\n}\n\
         pc_meadow = {\n\tmin_distance_from_sun = @fx_min\n\tmax_distance_from_sun = @fx_max\n\tspawn_odds = @fx_odds\n\tchance_of_ring = 0.2\n\textra_orbit_size = 0\n\textra_planet_count = 0\n\tplanet_size = { min = 12 max = 20 }\n\tmoon_size = { min = 8 max = 10 }\n\tcolonizable = yes\n}\n\
         pc_rock = {\n\tmin_distance_from_sun = 0\n\tmax_distance_from_sun = 1000\n\tspawn_odds = 10\n\tplanet_size = { min = 10 max = 20 }\n\tmoon_size = { min = 5 max = 8 }\n}\n\
         pc_puff = {\n\tmin_distance_from_sun = 40\n\tmax_distance_from_sun = 1000\n\tspawn_odds = 6\n\textra_orbit_size = 0\n\textra_planet_count = 2\n\tcan_be_moon = no\n\tplanet_size = { min = 20 max = 30 }\n\tmoon_size = { min = 8 max = 15 }\n}\n\
         pc_shell = {\n\tmin_distance_from_sun = 0\n\tmax_distance_from_sun = 1000\n\tspawn_odds = 50\n\tplanet_size = 9\n\tmoon_size = 3\n\tis_artificial_planet = yes\n}\n\
         pc_boulder = {\n\tasteroid = yes\n\tspawn_odds = 10\n\tplanet_size = 5\n}\n",
    ),
    (
        "common/solar_system_initializers/00_fx.txt",
        "fx_plain = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { count = 1 class = star orbit_distance = 0 orbit_angle = 1 size = { min = 20 max = 30 } }\n\
         \tchange_orbit = 30\n\tchange_orbit = 10\n\
         \tplanet = {\n\t\tcount = { min = 2 max = 4 }\n\t\torbit_distance = 20\n\t\torbit_angle = { min = 90 max = 270 }\n\t\tchange_orbit = @fx_moon\n\t\tmoon = { count = { min = 0 max = 1 } orbit_distance = 5 orbit_angle = { min = 90 max = 270 } }\n\t}\n}\n\
         fx_warm = {\n\tclass = rl_warm\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { count = 1 class = star orbit_distance = 0 orbit_angle = 1 size = { min = 20 max = 30 } }\n\
         \tchange_orbit = 40\n\
         \tplanet = {\n\t\tcount = { min = 2 max = 4 }\n\t\torbit_distance = 20\n\t\torbit_angle = { min = 90 max = 270 }\n\t}\n}\n\
         fx_rocks = {\n\tclass = rl_single\n\tasteroid_belt = { type = rocky_asteroid_belt radius = 40 }\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n\tchange_orbit = 40\n\tplanet = { count = { min = 2 max = 4 } class = pc_boulder orbit_distance = 0 orbit_angle = { min = 90 max = 270 } }\n\tchange_orbit = -10\n\tplanet = { count = 1 orbit_distance = 40 }\n}\n\
         fx_moonrock = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n\tchange_orbit = 40\n\tplanet = { count = 1 class = pc_boulder orbit_distance = 0 moon = { count = 1 orbit_distance = 5 } }\n}\n\
         fx_unmeasured = {\n\tclass = rl_single\n\tasteroid_belt = { type = rocky_asteroid_belt }\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n}\n\
         fx_pair = {\n\tclass = rl_pair\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n}\n\
         fx_effect = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = 5\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n\tinit_effect = { set_star_flag = fx }\n}\n\
         fx_conditional = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = { base = 5 }\n\tplanet = { count = 1 class = star orbit_distance = 0 }\n}\n",
    ),
    ("localisation/english/fx_l_english.yml", "l_english:\n"),
];

pub fn hand_written() -> (tempfile::TempDir, GameData) {
    install_of(&FILES)
}

pub fn specs(gd: &GameData) -> Vec<SystemSpec> {
    (0..SEEDS)
        .map(|seed| generate(gd, seed, "Gen", SPOT, None, ABUNDANCE).expect("a system"))
        .collect()
}

pub fn within(size: u32, range: Range) -> bool {
    range.contains(f64::from(size))
}
