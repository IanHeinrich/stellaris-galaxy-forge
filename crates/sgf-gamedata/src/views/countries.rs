use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::hex;
use crate::GameData;
use crate::registries::colors::ColorDef;
use crate::registries::country_types::CountryType;
use crate::registries::flags::{EmblemCategory, FlagFile, Flags};
use crate::registries::ship_sizes::ShipSizeDef;
use crate::registries::starbase_levels::StarbaseLevelDef;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MapColor {
    pub name: String,
    /// `"#rrggbb"`.
    pub map: String,
    pub flag: String,
    pub ship: String,
}

impl From<&ColorDef> for MapColor {
    fn from(c: &ColorDef) -> Self {
        Self {
            name: c.name.clone(),
            map: hex(c.map),
            flag: hex(c.flag),
            ship: hex(c.ship),
        }
    }
}

/// Every emblem category and every background of the loaded game data's `flags/`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FlagParts {
    pub emblems: Vec<EmblemCategory>,
    pub backgrounds: Vec<FlagFile>,
}

impl From<&Flags> for FlagParts {
    fn from(f: &Flags) -> Self {
        Self {
            emblems: f.emblems.clone(),
            backgrounds: f.backgrounds.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StarbaseLevelView {
    pub key: String,
    pub icon_frame: Option<u32>,
    pub empire_shield: bool,
}

impl From<&StarbaseLevelDef> for StarbaseLevelView {
    fn from(s: &StarbaseLevelDef) -> Self {
        Self {
            key: s.key.clone(),
            icon_frame: s.icon_frame,
            empire_shield: s.empire_shield,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ShipSizeView {
    pub key: String,
    /// Bare `common/ship_sizes` icon key; the UI resolves `GFX_<icon>`.
    pub icon: Option<String>,
}

impl From<&ShipSizeDef> for ShipSizeView {
    fn from(s: &ShipSizeDef) -> Self {
        Self {
            key: s.key.clone(),
            icon: s.icon.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CountryTypeView {
    pub name: String,
    pub is_space_critter: bool,
    pub space_creatures: bool,
    pub generate_borders: bool,
    pub is_enclave: bool,
    pub fallen_empire: bool,
    pub playable: bool,
    pub leviathan: bool,
}

impl From<&CountryType> for CountryTypeView {
    fn from(ct: &CountryType) -> Self {
        Self {
            name: ct.name.clone(),
            is_space_critter: ct.is_space_critter,
            space_creatures: ct.space_creatures,
            generate_borders: ct.generate_borders,
            is_enclave: ct.is_enclave,
            fallen_empire: ct.fallen_empire,
            playable: ct.playable,
            leviathan: ct.is_leviathan(),
        }
    }
}

impl GameData {
    /// Every country type, sorted by name.
    pub fn country_type_views(&self) -> Vec<CountryTypeView> {
        self.country_types
            .iter()
            .map(CountryTypeView::from)
            .collect()
    }
}
