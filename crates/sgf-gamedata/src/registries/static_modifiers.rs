//! `common/static_modifiers`: named modifier sets, among them what a planet
//! modifier or a `timed_modifier` applies.

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};

pub type StaticModifiers = Registry<StaticModifierDef>;

#[derive(Debug, Clone, PartialEq)]
pub struct StaticModifierDef {
    pub key: String,
    /// A texture path (`gfx/interface/icons/planet_modifiers/….dds`) or, rarely, a `GFX_`
    /// sprite.
    pub icon: Option<String>,
    /// The `GFX_modifier_frames` border drawn round the icon: 1 green, 2 yellow, 3 red.
    pub icon_frame: Option<u32>,
    pub modifiers: Vec<(String, f64)>,
}

impl FromDef for StaticModifierDef {
    const DIR: &'static str = "common/static_modifiers";

    fn read(key: String, def: &Def) -> Self {
        let mut modifiers = def.numbers(&def.node);
        modifiers.retain(|(key, _)| key != "icon_frame");
        Self {
            icon: def.scalar("icon").map(str::to_owned),
            icon_frame: def.scalar("icon_frame").and_then(|f| f.parse().ok()),
            modifiers,
            key,
        }
    }
}
