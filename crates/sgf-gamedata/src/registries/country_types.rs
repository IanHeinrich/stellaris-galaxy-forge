//! `common/country_types`: the attributes the special-systems classifier reads.

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};

pub type CountryTypes = Registry<CountryType>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CountryType {
    pub name: String,
    pub is_space_critter: bool,
    pub destroys_starbases: bool,
    /// `faction = { space_creatures = yes }`: roaming fauna, not a guardian.
    pub space_creatures: bool,
    /// `faction = { generate_borders = no }` turns the map border off; absent means on.
    pub generate_borders: bool,
    pub is_enclave: bool,
    pub fallen_empire: bool,
    pub playable: bool,
}

impl CountryType {
    /// A stationary boss critter: what the game calls a guardian or leviathan.
    pub fn is_leviathan(&self) -> bool {
        self.is_space_critter && self.destroys_starbases && !self.space_creatures
    }
}

impl FromDef for CountryType {
    const DIR: &'static str = "common/country_types";

    fn read(name: String, def: &Def) -> Self {
        let faction = def.node.find("faction", &def.src);
        let faction_scalar =
            |key: &str| faction.and_then(|f| f.find(key, &def.src)?.scalar_str(&def.src));
        Self {
            name,
            is_space_critter: def.flag("is_space_critter"),
            destroys_starbases: def.flag("destroys_starbases"),
            space_creatures: faction_scalar("space_creatures") == Some("yes"),
            generate_borders: faction_scalar("generate_borders") != Some("no"),
            is_enclave: def.flag("is_enclave"),
            fallen_empire: def.flag("fallen_empire"),
            playable: def.flag("playable"),
        }
    }
}
