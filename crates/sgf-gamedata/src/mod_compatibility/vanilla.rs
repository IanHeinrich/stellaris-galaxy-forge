//! The base game's facts the editor keeps by hand: the families it holds back and how its
//! shaders draw.

use super::{HeldBack, Shaders};

/// The base game's megastructure families the add dialog leaves out for now.
pub const HELD_BACK: [HeldBack; 9] = [
    (
        "crisis_sphere_0",
        "the Aetherophasic Engine, built on the crisis path",
    ),
    ("galactic_crucible_0", "built on the crisis path"),
    ("cosmogenesis_needle", "built on the crisis path"),
    ("behemoth_egg", "a story structure: the Behemoth's egg"),
    (
        "behemoth_chrysalis",
        "a story structure: the Behemoth's egg",
    ),
    (
        "behemoth_chrysalis_big",
        "a story structure: the Behemoth's egg",
    ),
    ("dyson_sphere_disco", "a story structure"),
    ("shroud_seal", "a story structure"),
    (
        "waystation_megastructure",
        "a Nomad origin's waystation, which makes a starbase",
    ),
];

/// How the base game's shaders draw. `PdxMeshAlphaBlend` is alpha tested, whatever its name
/// says. `PdxMeshExtraDimensionalShip` adds onto what is behind it, but its pixel shader
/// builds its colour from a rim light and the owner's colour, so it is drawn opaque.
pub const SHADERS: Shaders = Shaders {
    alpha_blended: &[
        "AlphaBlend_00",
        "AlphaBlendNoDepth",
        "AlphaBlendNoDepth_00",
        "PdxMeshTerraAlphaBlend",
        "PdxMeshShipDiffuseEmissiveAlpha",
        "PdxMeshClouds",
        "PdxMeshRingworldClouds",
        "PdxMeshPlanetRings",
    ],
    added: &[],
    alpha_tested: &["PdxMeshAlphaBlend", "PdxMeshTerraAlphaTest"],
    unmasked: &[
        "PdxMeshTerraAlphaBlend",
        "PdxMeshClouds",
        "PdxMeshRingworldClouds",
        "PdxMeshPlanetRings",
    ],
    double_sided: &["PdxMeshPlanetRings", "PdxMeshExtraDimensionalShip"],
};
