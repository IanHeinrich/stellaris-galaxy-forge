//! `common/starbase_levels` joined with `common/ship_sizes`: a starbase's
//! level names the ship size that draws it, and the ship size names the
//! map icon frame (outpost..citadel = 1..5; swarm and the other special
//! sizes use `-1`, meaning none).

use std::sync::Arc;

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::install::script::{self, Variables};
use crate::registries::registry::Registry;
use crate::registries::ship_sizes::ShipSizes;

pub type StarbaseLevels = Registry<StarbaseLevelDef>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StarbaseLevelDef {
    pub key: String,
    pub ship_size: Option<String>,
    pub icon_frame: Option<u32>,
    /// `display_empire_shield = yes`: the map shows the owner's flag for this station.
    pub empire_shield: bool,
}

pub(crate) fn load(
    layout: &Layout,
    sizes: &ShipSizes,
    globals: &Arc<Variables>,
    diagnostics: &mut Vec<Diagnostic>,
) -> StarbaseLevels {
    script::parse_dir(layout, "common/starbase_levels", globals, diagnostics)
        .into_iter()
        .map(|(key, def)| {
            let ship_size = def.scalar("ship_size").map(str::to_owned);
            let icon_frame = ship_size
                .as_deref()
                .and_then(|s| sizes.get(s))
                .and_then(|size| size.icon_frame);
            (
                key.clone(),
                StarbaseLevelDef {
                    key,
                    ship_size,
                    icon_frame,
                    empire_shield: def.flag("display_empire_shield"),
                },
            )
        })
        .collect()
}
