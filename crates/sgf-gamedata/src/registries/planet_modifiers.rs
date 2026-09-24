//! `common/planet_modifiers`: the `pm_*` keys a planet's `planet_modifier`
//! names, each applying one static modifier.

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};

pub type PlanetModifiers = Registry<PlanetModifierDef>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanetModifierDef {
    pub key: String,
    /// The `common/static_modifiers` key it applies.
    pub modifier: Option<String>,
}

impl FromDef for PlanetModifierDef {
    const DIR: &'static str = "common/planet_modifiers";

    fn read(key: String, def: &Def) -> Self {
        Self {
            modifier: def.scalar("modifier").map(str::to_owned),
            key,
        }
    }
}
