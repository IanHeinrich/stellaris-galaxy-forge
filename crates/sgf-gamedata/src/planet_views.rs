//! What the planet page draws from the install: a row per deposit type, a row per
//! planet or timed modifier, and the colony's designation, each carrying its
//! localised text and texture keys so the app needs no further lookups.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::GameData;
use crate::loc::localisation::Localisation;
use crate::registries::deposits::DepositDef;
use crate::registries::static_modifiers::StaticModifierDef;
use crate::textures::{ICONS, TextureKey};

const DEPOSIT_FALLBACK: &str = "GFX_deposit_unknown";
const BLOCKER_FALLBACK: &str = "GFX_deposit_blocker_unknown";
const MODIFIER_FRAMES: &str = "GFX_modifier_frames";

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
        let category = self.deposit_category(def);
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
            orbital: def.orbital(),
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
            .name(key)
            .or_else(|| self.loc.name(static_key.as_deref()?))
            .unwrap_or_else(|| Localisation::readable(key));
        Some(ModifierView {
            key: key.to_owned(),
            name,
            static_modifier: static_key,
            icon: def.and_then(|d| self.static_modifier_icon(d)),
            icon_frame: def
                .and_then(|d| d.icon_frame)
                .and_then(|frame| TextureKey::sprite(MODIFIER_FRAMES, Some(frame)))
                .map(|key| key.to_string()),
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
                .and_then(|sprite| self.sprite_key(sprite)),
        })
    }

    fn deposit_texture_key(&self, def: &DepositDef, blocker: bool) -> String {
        let fallback = match blocker {
            true => BLOCKER_FALLBACK,
            false => DEPOSIT_FALLBACK,
        };
        TextureKey::deposit(def.texture_icon())
            .filter(|key| key.exists(&self.layout))
            .or_else(|| TextureKey::sprite(fallback, None))
            .map(|key| key.to_string())
            .unwrap_or_default()
    }

    fn static_modifier_icon(&self, def: &StaticModifierDef) -> Option<String> {
        let icon = def.icon.as_deref()?.replace('\\', "/");
        if icon.starts_with("GFX_") {
            return self.sprite_key(&icon);
        }
        let key = TextureKey::icon(icon.strip_prefix(ICONS)?.strip_prefix('/')?)?;
        key.exists(&self.layout).then(|| key.to_string())
    }

    /// The key of a sprite the install defines.
    fn sprite_key(&self, sprite: &str) -> Option<String> {
        self.sprites.get(sprite)?;
        TextureKey::sprite(sprite, None).map(|key| key.to_string())
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
                    .and_then(|sprite| TextureKey::sprite(&sprite, None))
                    .map(|key| key.to_string()),
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
        self.loc.name_or_readable(key)
    }
}
