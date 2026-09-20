//! `common/bypass`: the frame of the map's `GFX_ship_class_small` sheet each
//! kind of bypass draws with (gateway 25, wormhole 12, L-Gate 30 in vanilla).

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};

pub type Bypasses = Registry<BypassDef>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BypassDef {
    pub key: String,
    /// The frame of the map icon sheet; a negative `icon_frame` means none.
    pub icon_frame: Option<u32>,
}

impl FromDef for BypassDef {
    const DIR: &'static str = "common/bypass";

    fn read(key: String, def: &Def) -> Self {
        Self {
            key,
            icon_frame: def
                .scalar("icon_frame")
                .and_then(|s| s.parse::<i64>().ok())
                .filter(|&n| n >= 0)
                .and_then(|n| u32::try_from(n).ok()),
        }
    }
}
