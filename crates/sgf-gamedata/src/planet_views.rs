//! What the planet page draws from the install: a row per deposit type, a row per
//! planet or timed modifier, and the colony's designation, each carrying its
//! localised text and texture keys so the app needs no further lookups.

use serde::{Deserialize, Serialize};
use sgf_core::projections::galaxy::display_name;
use ts_rs::TS;

use crate::GameData;
use crate::registries::deposits::DepositDef;
use crate::registries::static_modifiers::StaticModifierDef;
use crate::textures::{DEPOSIT_ICONS, TextureKey};

const DEPOSIT_FALLBACK: &str = "GFX_deposit_unknown";
const BLOCKER_FALLBACK: &str = "GFX_deposit_blocker_unknown";
const MODIFIER_FRAMES: &str = "GFX_modifier_frames";
const ICONS_DIR: &str = "gfx/interface/icons/";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ResourceAmountView {
    pub resource: String,
    pub amount: f64,
    /// The resource's localised name.
    pub name: String,
    /// A `sprite:` texture key; `None` when the install has no icon for it.
    pub icon: Option<String>,
}

/// One `modifier = value` line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ModifierLineView {
    pub key: String,
    pub value: f64,
    /// As the game's tooltip prints it: "+3 Max Agriculture Districts".
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TechView {
    pub key: String,
    pub name: String,
}

/// Lines that apply once the planet's owner has researched `tech`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DepositSideEffectView {
    pub tech: TechView,
    pub effects: Vec<ModifierLineView>,
}

/// What clearing a blocker takes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DepositClearingView {
    pub cost: Vec<ResourceAmountView>,
    pub days: Option<u32>,
    pub techs: Vec<TechView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DepositTypeView {
    pub key: String,
    /// The localised name with its icon markup removed. An orbital deposit's
    /// localisation is its yield ("+2").
    pub name: String,
    /// `deposit:<icon>`, or the game's unknown-deposit sprite when the art is missing.
    pub texture_key: String,
    /// Its `deposit_categories` entry says `blocker = yes`.
    pub blocker: bool,
    /// Its `deposit_categories` entry says `important = yes`: the planet view lists it as rare.
    pub rare: bool,
    /// Worked by an orbital station rather than by the colony.
    pub orbital: bool,
    pub category: Option<String>,
    pub station: Option<String>,
    pub yields: Vec<ResourceAmountView>,
    pub effects: Vec<ModifierLineView>,
    pub side_effects: Vec<DepositSideEffectView>,
    /// Blockers only.
    pub clearing: Option<DepositClearingView>,
}

/// A planet modifier (`pm_*`) or a static modifier a `timed_modifier` names.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ModifierView {
    pub key: String,
    pub name: String,
    /// The static modifier it applies: `key` itself for a `timed_modifier`.
    pub static_modifier: Option<String>,
    /// An `icon:` or `sprite:` texture key.
    pub icon: Option<String>,
    /// `sprite:GFX_modifier_frames#<n>`, the coloured border drawn over the icon.
    pub icon_frame: Option<String>,
    pub effects: Vec<ModifierLineView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ColonyTypeView {
    pub key: String,
    pub name: String,
    /// A `sprite:` texture key: a frame of the `GFX_colony_type` sheet.
    pub icon: Option<String>,
}

impl GameData {
    /// One view per key the install defines, in order; unknown keys are left out.
    pub fn deposit_type_views(&self, keys: &[String]) -> Vec<DepositTypeView> {
        keys.iter()
            .filter_map(|key| self.deposit_type_view(key))
            .collect()
    }

    pub fn deposit_type_view(&self, key: &str) -> Option<DepositTypeView> {
        let def = self.deposits.get(key)?;
        let category = def
            .category
            .as_deref()
            .and_then(|c| self.deposit_categories.get(c));
        let blocker = category.is_some_and(|c| c.blocker);
        let clearing = blocker.then(|| DepositClearingView {
            cost: self.resource_amounts(&def.cost),
            days: def.time.filter(|t| *t >= 0.0).map(|t| t.round() as u32),
            techs: def.prerequisites.iter().map(|t| self.tech(t)).collect(),
        });
        Some(DepositTypeView {
            key: def.key.clone(),
            name: self.name_of(&def.key),
            texture_key: self.deposit_texture_key(def, blocker),
            blocker,
            rare: category.is_some_and(|c| c.important),
            orbital: !def.is_for_colonizable,
            category: def.category.clone(),
            station: def.station.clone(),
            yields: self.resource_amounts(&def.produces),
            effects: self.modifier_lines(&def.planet_modifier),
            side_effects: def
                .side_effects
                .iter()
                .map(|side| DepositSideEffectView {
                    tech: self.tech(&side.tech),
                    effects: self.modifier_lines(&side.modifiers),
                })
                .collect(),
            clearing,
        })
    }

    /// One view per key the install defines, in order; unknown keys are left out.
    pub fn modifier_views(&self, keys: &[String]) -> Vec<ModifierView> {
        keys.iter()
            .filter_map(|key| self.modifier_view(key))
            .collect()
    }

    /// A `pm_*` key through the static modifier it applies, as the game does, or a
    /// static modifier's own key.
    pub fn modifier_view(&self, key: &str) -> Option<ModifierView> {
        let static_key = match self.planet_modifiers.get(key) {
            Some(pm) => pm.modifier.clone(),
            None => Some(self.static_modifiers.get(key)?.key.clone()),
        };
        let def = static_key
            .as_deref()
            .and_then(|k| self.static_modifiers.get(k));
        let name = self
            .loc
            .get(key)
            .or_else(|| self.loc.get(static_key.as_deref()?))
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| display_name(key));
        Some(ModifierView {
            key: key.to_owned(),
            name,
            static_modifier: static_key,
            icon: def.and_then(|d| self.static_modifier_icon(d)),
            icon_frame: def
                .and_then(|d| d.icon_frame)
                .map(|frame| format!("sprite:{MODIFIER_FRAMES}#{frame}")),
            effects: def.map_or_else(Vec::new, |d| self.modifier_lines(&d.modifiers)),
        })
    }

    /// One view per key the install defines, in order; unknown keys are left out.
    pub fn colony_type_views(&self, keys: &[String]) -> Vec<ColonyTypeView> {
        keys.iter()
            .filter_map(|key| self.colony_type_view(key))
            .collect()
    }

    pub fn colony_type_view(&self, key: &str) -> Option<ColonyTypeView> {
        let def = self.colony_types.get(key)?;
        Some(ColonyTypeView {
            key: def.key.clone(),
            name: self.name_of(&def.key),
            icon: def
                .icon
                .as_deref()
                .filter(|sprite| self.sprites.get(sprite).is_some())
                .map(|sprite| format!("sprite:{sprite}")),
        })
    }

    fn deposit_texture_key(&self, def: &DepositDef, blocker: bool) -> String {
        let icon = def.texture_icon();
        let key = TextureKey::Deposit {
            icon: icon.to_owned(),
        }
        .to_string();
        let found = key.parse::<TextureKey>().is_ok()
            && self
                .layout
                .resolve_file(&format!("{DEPOSIT_ICONS}/{icon}.dds"))
                .is_some();
        match (found, blocker) {
            (true, _) => key,
            (false, true) => format!("sprite:{BLOCKER_FALLBACK}"),
            (false, false) => format!("sprite:{DEPOSIT_FALLBACK}"),
        }
    }

    fn static_modifier_icon(&self, def: &StaticModifierDef) -> Option<String> {
        let icon = def.icon.as_deref()?.replace('\\', "/");
        if icon.starts_with("GFX_") {
            return self
                .sprites
                .get(&icon)
                .is_some()
                .then(|| format!("sprite:{icon}"));
        }
        let key = TextureKey::Icon {
            path: icon.strip_prefix(ICONS_DIR)?.to_owned(),
        }
        .to_string();
        let found = key.parse::<TextureKey>().is_ok() && self.layout.resolve_file(&icon).is_some();
        found.then_some(key)
    }

    fn modifier_lines(&self, lines: &[(String, f64)]) -> Vec<ModifierLineView> {
        lines
            .iter()
            .map(|(key, value)| ModifierLineView {
                key: key.clone(),
                value: *value,
                text: self.loc.modifier_line(key, *value),
            })
            .collect()
    }

    fn resource_amounts(&self, amounts: &[(String, f64)]) -> Vec<ResourceAmountView> {
        amounts
            .iter()
            .map(|(resource, amount)| ResourceAmountView {
                resource: resource.clone(),
                amount: *amount,
                name: self.name_of(resource),
                icon: self
                    .resource_icon(resource)
                    .map(|sprite| format!("sprite:{sprite}")),
            })
            .collect()
    }

    fn tech(&self, key: &str) -> TechView {
        TechView {
            key: key.to_owned(),
            name: self.name_of(key),
        }
    }

    fn name_of(&self, key: &str) -> String {
        self.loc
            .get(key)
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| display_name(key))
    }
}
