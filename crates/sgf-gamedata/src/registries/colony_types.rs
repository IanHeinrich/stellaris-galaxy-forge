//! `common/colony_types`: the designations a colony's `final_designation` names.

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};

pub type ColonyTypes = Registry<ColonyTypeDef>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColonyTypeDef {
    pub key: String,
    /// A `GFX_colony_type_*` sprite, a frame of the `GFX_colony_type` sheet.
    pub icon: Option<String>,
}

impl FromDef for ColonyTypeDef {
    const DIR: &'static str = "common/colony_types";

    fn read(key: String, def: &Def) -> Self {
        Self {
            icon: def.scalar("icon").map(str::to_owned),
            key,
        }
    }
}
