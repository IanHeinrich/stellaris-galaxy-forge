//! What the editor knows of particular mods that their files do not say, one file per mod,
//! each written as facts any mod could have: which megastructure families the add dialog
//! holds back, how a shader draws, and the Workshop items the app links to. Mod content is
//! otherwise detected by what its data does, and only this module names a mod.

pub mod giga;
pub mod paint_a_galaxy;
pub mod vanilla;

/// What a mod's keys start with, which the mod-name test looks for in string literals outside
/// this module. A new mod's file adds its prefixes here.
pub const MOD_PREFIXES: [&str; 7] = [
    "giga_",
    "ehof_",
    "frameworld_",
    "blokkat_",
    "pc_pd_",
    "pdengine",
    "nsc_",
];

/// A megastructure family the add dialog leaves out for now: its first stage's key, and why.
pub type HeldBack = (&'static str, &'static str);

const NOT_OFFERED_YET_COUNT: usize = vanilla::HELD_BACK.len() + giga::HELD_BACK.len();

/// The first stages of every family the add dialog leaves out for now, with every stage
/// after them and their ruins: each mod's [`HeldBack`] keys.
pub const NOT_OFFERED_YET: [&str; NOT_OFFERED_YET_COUNT] = {
    let mut keys = [""; NOT_OFFERED_YET_COUNT];
    let mut i = 0;
    while i < vanilla::HELD_BACK.len() {
        keys[i] = vanilla::HELD_BACK[i].0;
        i += 1;
    }
    let mut j = 0;
    while j < giga::HELD_BACK.len() {
        keys[i + j] = giga::HELD_BACK[j].0;
        j += 1;
    }
    keys
};

/// How the game draws the meshes of each shader one source names, as the shader's effect
/// file sets it. A shader no table names is drawn opaque, one face, tinted by the owner.
#[derive(Debug, Clone, Copy)]
pub struct Shaders {
    /// Blended at their diffuse alpha (`BlendStateAlphaBlend` and its kin).
    pub alpha_blended: &'static [&'static str],
    /// Added onto what is behind them (`BlendStateAdditiveBlend`) and drawn. The game's own
    /// additive shaders are glows, which the model baker skips.
    pub added: &'static [&'static str],
    /// Drawn only where their diffuse alpha is whole (`ALPHA_TEST`), opaque there.
    pub alpha_tested: &'static [&'static str],
    /// See-through shaders that leave the specular map's red alone: they run
    /// `PixelPdxMeshStandard`, which recolours by it only with `ADD_COLOR`. The ship pixel
    /// shader the others run tints the masked parts in the owner's colour.
    pub unmasked: &'static [&'static str],
    /// Both faces drawn (`CULL_NONE`).
    pub double_sided: &'static [&'static str],
}

/// The shader tables of the game and of each mod whose shaders draw unlike the default.
pub const SHADERS: [&Shaders; 2] = [&vanilla::SHADERS, &giga::SHADERS];
