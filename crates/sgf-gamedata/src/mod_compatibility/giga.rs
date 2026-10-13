//! Gigastructural Engineering's facts the editor keeps by hand: the families it holds back
//! and how its shaders draw.

use super::{HeldBack, Shaders};

const WARSHIP: &str = "becomes a warship";
const ACTION: &str = "an action stage of a finished structure";
const STORY: &str = "a story structure";
const FRAMEWORLD: &str = "a Frameworld origin structure";
const TURNED_OFF: &str = "turned off by the mod: its potential is always no";
const ELYSIUM: &str = "its completion puts one planet in the orbit of its body and removes the row, which has not been checked in game";

/// Gigastructural Engineering's megastructure families the add dialog leaves out for now.
pub const HELD_BACK: [HeldBack; 32] = [
    ("war_moon_0", WARSHIP),
    ("war_planet_0", WARSHIP),
    ("war_system_0", WARSHIP),
    ("nomad_war_moon_0", WARSHIP),
    ("nomad_war_planet_0", WARSHIP),
    ("kaiser_moon_1", WARSHIP),
    ("improbable_kaiser_moon_0", WARSHIP),
    ("stellarite_kaiser_moon_0", WARSHIP),
    ("blokkat_prison_1_empty", STORY),
    ("blokkat_shield_killer_0", STORY),
    ("blokkat_star_fix_0", STORY),
    ("blokkat_gigarelay_1", STORY),
    (
        "orbital_arcology_0",
        "a script spawns it, and its completion has not been checked in game",
    ),
    (
        "interstellar_habitat_0",
        "turned off in the mod's 4.0 rework",
    ),
    ("interstellar_habitat_2", TURNED_OFF),
    ("interstellar_habitat_4", TURNED_OFF),
    ("anti_sirens_shield", STORY),
    ("ehof_sm_forge_phase0", "a placeholder with no model"),
    (
        "ehof_presphere_dyson",
        "a story structure: the restored preservation sphere",
    ),
    (
        "r_square_world_ruined",
        "a ruin the mod never offers to build",
    ),
    ("frameworld_decompressor_1", FRAMEWORLD),
    ("frameworld_penrose_1", FRAMEWORLD),
    ("frameworld_salvage_habitat_0", FRAMEWORLD),
    (
        "pouchkinn_engine_1",
        "built only with the Deranged Researchers civic",
    ),
    ("penrose_bomb_armed", ACTION),
    ("lunar_macroreplicator_make_moon", ACTION),
    ("planetcraft_printer_make_planet", ACTION),
    ("substellar_compressor_5", ACTION),
    ("psychic_beacon_4", ACTION),
    ("orbital_elysium_0", ELYSIUM),
    ("orbital_elysium_origin_platform_0", ELYSIUM),
    ("orbital_elysium_origin_platform_1", ELYSIUM),
];

/// How Gigastructural Engineering's shaders draw. Its shells add onto what is behind them.
/// `PdxMeshAlphaBlendPlanetNoEmissiveMult` also tests alpha in its blend state and writes
/// depth, but blends. `OmniMeshED` and `OmniMeshEDSphere` add too, but their pixel shader
/// builds its colour from a rim light and the owner's colour, so they are drawn opaque.
pub const SHADERS: Shaders = Shaders {
    alpha_blended: &["PdxMeshAlphaBlendPlanetNoEmissiveMult"],
    added: &["OmniMeshMegaAlpha"],
    alpha_tested: &[],
    unmasked: &["PdxMeshAlphaBlendPlanetNoEmissiveMult", "OmniMeshMegaAlpha"],
    double_sided: &[
        "PdxMeshAlphaBlendPlanetNoEmissiveMult",
        "OmniMeshED",
        "OmniMeshEDSphere",
    ],
};
