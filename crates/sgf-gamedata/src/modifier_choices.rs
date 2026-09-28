//! The modifiers a save planet's page offers to add. Static modifiers name no scope, so a
//! planet's are taken to be those the game draws with a planet modifier icon
//! (`gfx/interface/icons/planet_modifiers/`), every planet feature's (`pm_*`) static
//! modifier, offered as the feature, and every terraforming candidate modifier.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::GameData;
use crate::planet_views::ModifierView;
use crate::registries::static_modifiers::StaticModifierDef;

const PLANET_MODIFIER_ICONS: &str = "gfx/interface/icons/planet_modifiers/";

/// Where the picker files a modifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ModifierCategory {
    /// A planet feature: its `planet_modifier` line and its static modifier.
    Feature,
    /// A modifier that makes a planet class a terraforming candidate.
    Terraforming,
    /// The game frames its icon green.
    Positive,
    /// The game frames its icon red.
    Negative,
    /// Framed yellow, or not at all.
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ModifierChoice {
    /// The static modifier a `timed_modifier` item names.
    pub modifier: String,
    /// The planet feature (`pm_*`) that applies it, written beside it.
    pub feature: Option<String>,
    pub category: ModifierCategory,
    /// Its localised `<key>_desc`, the feature's first.
    pub description: Option<String>,
    /// Its name, icon and effects; keyed by the feature for a feature.
    pub view: ModifierView,
}

impl GameData {
    /// Every modifier a planet's page offers, features first, then by key.
    pub fn modifier_choices(&self) -> Vec<ModifierChoice> {
        let mut choices = Vec::new();
        let mut featured = HashSet::new();
        for pm in self.planet_modifiers.iter() {
            let Some(modifier) = pm.modifier.as_deref() else {
                continue;
            };
            if self.static_modifiers.get(modifier).is_none() {
                continue;
            }
            featured.insert(modifier.to_owned());
            if let Some(choice) = self.choice(modifier, Some(&pm.key), ModifierCategory::Feature) {
                choices.push(choice);
            }
        }
        let terraforming: HashSet<&str> = self
            .terraform_links
            .candidates(&self.static_modifiers)
            .map(|(modifier, _)| modifier)
            .collect();
        let mut rest: Vec<&StaticModifierDef> = self
            .static_modifiers
            .iter()
            .filter(|def| !featured.contains(&def.key))
            .filter(|def| terraforming.contains(def.key.as_str()) || planet_icon(def))
            .collect();
        rest.sort_by(|a, b| a.key.cmp(&b.key));
        for def in rest {
            let category = match (terraforming.contains(def.key.as_str()), def.icon_frame) {
                (true, _) => ModifierCategory::Terraforming,
                (false, Some(1)) => ModifierCategory::Positive,
                (false, Some(3)) => ModifierCategory::Negative,
                _ => ModifierCategory::Other,
            };
            choices.extend(self.choice(&def.key, None, category));
        }
        choices
    }

    fn choice(
        &self,
        modifier: &str,
        feature: Option<&str>,
        category: ModifierCategory,
    ) -> Option<ModifierChoice> {
        let described = |key: &str| self.loc.name(&format!("{key}_desc"));
        Some(ModifierChoice {
            modifier: modifier.to_owned(),
            feature: feature.map(str::to_owned),
            category,
            description: feature.and_then(described).or_else(|| described(modifier)),
            view: self.modifier_view(feature.unwrap_or(modifier))?,
        })
    }
}

fn planet_icon(def: &StaticModifierDef) -> bool {
    def.icon
        .as_deref()
        .is_some_and(|icon| icon.replace('\\', "/").starts_with(PLANET_MODIFIER_ICONS))
}
