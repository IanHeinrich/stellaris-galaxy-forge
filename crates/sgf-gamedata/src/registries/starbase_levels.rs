//! `common/starbase_levels` joined with `common/ship_sizes` and
//! `common/section_templates`: a starbase's level names the ship size that
//! draws it, and the ship size names the map icon frame (outpost..citadel =
//! 1..5; swarm and the other special sizes use `-1`, meaning none) and the
//! slot whose section template names the station's model.

use std::sync::Arc;

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::install::script::{self, Variables};
use crate::registries::registry::Registry;
use crate::registries::section_templates::SectionTemplates;
use crate::registries::ship_sizes::ShipSizes;

pub(crate) const DIR: &str = "common/starbase_levels";

pub type StarbaseLevels = Registry<StarbaseLevelDef>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StarbaseLevelDef {
    pub key: String,
    pub ship_size: Option<String>,
    pub icon_frame: Option<u32>,
    /// `display_empire_shield = yes`: the map shows the owner's flag for this station.
    pub empire_shield: bool,
    /// The station's model, without its culture prefix: the `entity` of the section template
    /// that fits the first of its ship size's `section_slots`.
    pub station_entity: Option<String>,
    /// Its ship size's `scales_with_planet`: the station grows with the planet it rings.
    pub scales_with_planet: bool,
}

pub(crate) fn load(
    layout: &Layout,
    sizes: &ShipSizes,
    templates: &SectionTemplates,
    globals: &Arc<Variables>,
    diagnostics: &mut Vec<Diagnostic>,
) -> StarbaseLevels {
    script::parse_dir(layout, DIR, globals, diagnostics)
        .into_iter()
        .map(|(key, def)| {
            let ship_size = def.scalar("ship_size").map(str::to_owned);
            let size = ship_size.as_deref().and_then(|s| sizes.get(s));
            let icon_frame = size.and_then(|size| size.icon_frame);
            let station_entity = size.and_then(|size| {
                let slot = size.section_slots.first()?;
                templates.fitting(&size.key, slot)?.entity.clone()
            });
            (
                key.clone(),
                StarbaseLevelDef {
                    key,
                    ship_size,
                    icon_frame,
                    empire_shield: def.flag("display_empire_shield"),
                    station_entity,
                    scales_with_planet: size.is_some_and(|size| size.scales_with_planet),
                },
            )
        })
        .collect()
}
