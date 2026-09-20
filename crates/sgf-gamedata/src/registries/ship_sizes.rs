//! `common/ship_sizes`: the `icon` field names the map icon sprite frame
//! (`GFX_<icon>` in `interface/icons.gfx`) a ship of this size draws with.

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};

pub type ShipSizes = Registry<ShipSizeDef>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShipSizeDef {
    pub key: String,
    pub icon: Option<String>,
    /// The frame of the starbase icon sheet; `icon_frame = -1` means none.
    pub icon_frame: Option<u32>,
}

impl FromDef for ShipSizeDef {
    const DIR: &'static str = "common/ship_sizes";

    fn read(key: String, def: &Def) -> Self {
        Self {
            key,
            icon: def.scalar("icon").map(str::to_owned),
            icon_frame: def
                .scalar("icon_frame")
                .and_then(|s| s.parse::<i64>().ok())
                .filter(|&n| n >= 0)
                .and_then(|n| u32::try_from(n).ok()),
        }
    }
}
