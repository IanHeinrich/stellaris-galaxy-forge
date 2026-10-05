//! The hand-written install the deposit roll tests read, and the rolls they share.

use std::collections::BTreeSet;

use sgf_gamedata::GameData;
use sgf_gamedata::deposit_roll::{Kind, RollBody, roll_deposits};
use sgf_gamedata::rng::Rng;

use super::hand_written as install_of;

pub const FILES: [(&str, &str); 8] = [
    (
        "common/defines/00_defines.txt",
        "NGraphics = {\n\tBORDER_SYSTEM_RADIUS = 35\n}\nNGameplay = {\n\tMIN_BLOCKED_DEPOSITS = 1\n\tMIN_UNBLOCKED_DEPOSITS = 3\n\
         \tCOLONY_DEPOSITS_FIXED_BASE = 5\n\tCOLONY_DEPOSITS_RANDOM_BASE = 2\n\tCOLONY_DEPOSITS_FIXED_FROM_SIZE = 0.2\n\tCOLONY_DEPOSITS_RANDOM_FROM_SIZE = 0.2\n\
         \tNON_COLONY_DEPOSITS_FIXED_BASE = 1\n\tRESOURCE_ABUNDANCE_DEFAULT = 2\n\tRESOURCE_ABUNDANCE_MAX = 5\n}\n",
    ),
    (
        "common/defines/99_fx.txt",
        "NGameplay = {\n\tMIN_BLOCKED_DEPOSITS = 2\n}\nNGraphics = {\n\tBORDER_SYSTEM_RADIUS = 40\n}\n",
    ),
    (
        "common/planet_classes/00_fx.txt",
        "pc_fx_star = {\n\tstar = yes\n\tplanet_size = 25\n}\n\
         pc_fx_rock = {\n\tplanet_size = { min = 10 max = 20 }\n}\n\
         pc_fx_meadow = {\n\tclimate = wet\n\tcolonizable = yes\n\tplanet_size = { min = 12 max = 20 }\n}\n",
    ),
    (
        "common/scripted_triggers/00_fx.txt",
        "is_rocky = {\n\toptimize_memory\n\tis_planet_class = pc_fx_rock\n}\n\
         is_wet = {\n\thas_climate = wet\n}\n\
         is_fx_class = {\n\tis_planet_class = $CLASS$\n}\n\
         is_fx_optional = {\n\t[[ROCK]\n\t\tis_planet_class = pc_fx_rock\n\t]\n}\n",
    ),
    (
        "common/deposit_categories/00_fx.txt",
        "deposit_cat_blockers = {\n\tblocker = yes\n}\ndeposit_cat_food = {}\n",
    ),
    (
        "common/deposits/00_fx.txt",
        "@fx_ore = 20\n\
         d_null_deposit = {\n\tis_null = yes\n\tpotential = { is_primary_star = no }\n\tdrop_weight = { weight = 100 }\n}\n\
         d_fx_star_energy = {\n\tis_for_colonizable = no\n\tpotential = { is_star = yes }\n\tdrop_weight = { weight = 3 }\n}\n\
         d_fx_star_physics = {\n\tis_for_colonizable = no\n\tpotential = { is_star = yes }\n}\n\
         d_fx_ore = {\n\tis_for_colonizable = no\n\tpotential = { is_rocky = yes }\n\
         \tdrop_weight = {\n\t\tweight = @fx_ore\n\t\tmodifier = { factor = 0 mystery_scope = { x = y } }\n\t}\n}\n\
         d_fx_unmarked = {\n\tpotential = { NOT = { is_star = yes } is_moon = no }\n\tdrop_weight = { weight = 5 }\n}\n\
         d_fx_moon_only = {\n\tis_for_colonizable = no\n\tpotential = { is_moon = yes }\n\tdrop_weight = { weight = 25 }\n}\n\
         d_fx_mystery = {\n\tis_for_colonizable = no\n\tpotential = { mystery_scope = { x = y } }\n\tdrop_weight = { weight = 1000 }\n}\n\
         d_fx_param_value = {\n\tis_for_colonizable = no\n\tpotential = { NOT = { is_fx_class = yes } }\n\tdrop_weight = { weight = 1000 }\n}\n\
         d_fx_param_block = {\n\tis_for_colonizable = no\n\tpotential = { is_fx_optional = yes }\n\tdrop_weight = { weight = 1000 }\n}\n\
         d_fx_event_only = {\n\tis_for_colonizable = no\n\tdrop_weight = { weight = 0 }\n}\n\
         d_fx_planet_scope = {\n\tis_for_colonizable = no\n\tpotential = { planet = { is_planet_class = pc_fx_rock } }\n\tdrop_weight = { weight = 1000 }\n}\n",
    ),
    (
        "common/deposits/01_fx_features.txt",
        "d_fx_farmland = {\n\tcategory = deposit_cat_food\n\tis_for_colonizable = yes\n\tuse_for_min_max_adjustments = yes\n\tpotential = { is_wet = yes }\n\tdrop_weight = { weight = 10 }\n}\n\
         d_fx_dry_farmland = {\n\tcategory = deposit_cat_food\n\tis_for_colonizable = yes\n\tpotential = { is_wet = no }\n}\n\
         d_fx_blocker = {\n\tcategory = deposit_cat_blockers\n\tis_for_colonizable = yes\n\
         \tdrop_weight = {\n\t\tweight = 2\n\t\tmodifier = { factor = 0 planet_size < 10 }\n\t\tmodifier = { factor = 0 num_free_districts = { type = district_city value < 2 } }\n\t}\n}\n\
         d_fx_swamp = {\n\tcategory = deposit_cat_food\n\tis_for_colonizable = yes\n\
         \tdrop_weight = {\n\t\tweight = 5\n\t\tmodifier = { factor = 0 has_deposit = d_fx_bog }\n\t}\n}\n\
         d_fx_bog = {\n\tcategory = deposit_cat_food\n\tis_for_colonizable = yes\n\
         \tdrop_weight = {\n\t\tweight = 5\n\t\tmodifier = { factor = 0 has_deposit = d_fx_swamp }\n\t}\n}\n",
    ),
    ("localisation/english/fx_l_english.yml", "l_english:\n"),
];

pub fn hand_written() -> (tempfile::TempDir, GameData) {
    install_of(&FILES)
}

pub fn body(class: &str, size: u32) -> RollBody<'_> {
    RollBody {
        class,
        size,
        kind: Kind::Planet,
    }
}

/// The share of `n` rolls of `body` that got a deposit, and every key seen.
pub fn share(
    gd: &GameData,
    body: &RollBody<'_>,
    abundance: f64,
    n: u32,
) -> (f64, BTreeSet<String>) {
    let mut unit = Rng::new(7);
    let mut with = 0;
    let mut seen = BTreeSet::new();
    for _ in 0..n {
        let rolled = roll_deposits(gd, body, abundance, &mut unit);
        assert!(rolled.len() <= 1, "{}: {rolled:?}", body.class);
        with += u32::from(!rolled.is_empty());
        seen.extend(rolled);
    }
    (f64::from(with) / f64::from(n), seen)
}

pub fn blockers(gd: &GameData, rolled: &[String]) -> usize {
    rolled.iter().filter(|key| gd.is_blocker(key)).count()
}

pub fn keys(items: &[&str]) -> BTreeSet<String> {
    items.iter().map(|&k| k.to_owned()).collect()
}
