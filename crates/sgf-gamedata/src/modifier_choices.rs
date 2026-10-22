//! The modifiers a save planet's page offers to add. Static modifiers name no scope, so a
//! planet's are taken to be every planet feature's (`pm_*`) static modifier, offered as the
//! feature, every terraforming candidate modifier, and those the game draws with a planet
//! modifier icon (`gfx/interface/icons/planet_modifiers/`) that change something beyond
//! the empire and its ships. A planet-modifier-icon modifier with no effects is offered when
//! a scripted effect adds it beside planet flags, with those flags.

use std::collections::{HashMap, HashSet};
use std::mem;

use serde::{Deserialize, Serialize};
use sgf_core::cst::Node;
use ts_rs::TS;

use crate::GameData;
use crate::install::walk::{self, Branch, Called, Flow, Followed, Script, Statement, Visitor};
use crate::planet_views::ModifierView;
use crate::registries::static_modifiers::StaticModifierDef;
use crate::scripts::ScriptIndex;

const PLANET_MODIFIER_ICONS: &str = "gfx/interface/icons/planet_modifiers/";
/// The `icon_frame`s that mark a modifier positive (green) and negative (red).
const GREEN_FRAME: u32 = 1;
const RED_FRAME: u32 = 3;

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
    /// The planet flags the game sets with it, in the order set; written beside the modifier
    /// and taken off with it.
    pub flags: Vec<String>,
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
            let category = ModifierCategory::Feature;
            if let Some(choice) = self.choice(modifier, Some(&pm.key), category, Vec::new()) {
                choices.push(choice);
            }
        }
        let terraforming: HashSet<&str> = self
            .terraform_links
            .candidates(&self.static_modifiers)
            .map(|(modifier, _)| modifier)
            .collect();
        let marked = marker_flags(&self.scripts);
        let flags_of = |def: &StaticModifierDef| {
            let marker = planet_icon(def) && def.modifiers.is_empty();
            marker.then(|| marked.get(&def.key)).flatten()
        };
        let mut rest: Vec<&StaticModifierDef> = self
            .static_modifiers
            .iter()
            .filter(|def| !featured.contains(&def.key))
            .filter(|def| {
                terraforming.contains(def.key.as_str())
                    || (planet_icon(def) && on_planet(def))
                    || flags_of(def).is_some()
            })
            .collect();
        rest.sort_by(|a, b| a.key.cmp(&b.key));
        for def in rest {
            let terraform = terraforming.contains(def.key.as_str());
            let category = match (terraform, def.icon_frame) {
                (true, _) => ModifierCategory::Terraforming,
                (false, Some(GREEN_FRAME)) => ModifierCategory::Positive,
                (false, Some(RED_FRAME)) => ModifierCategory::Negative,
                _ => ModifierCategory::Other,
            };
            let flags = match terraform {
                true => Vec::new(),
                false => flags_of(def).cloned().unwrap_or_default(),
            };
            choices.extend(self.choice(&def.key, None, category, flags));
        }
        choices
    }

    fn choice(
        &self,
        modifier: &str,
        feature: Option<&str>,
        category: ModifierCategory,
        flags: Vec<String>,
    ) -> Option<ModifierChoice> {
        let described = |key: &str| self.loc.description(&format!("{key}_desc"));
        Some(ModifierChoice {
            modifier: modifier.to_owned(),
            feature: feature.map(str::to_owned),
            category,
            flags,
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

/// Whether any of its effects is not an empire's (`country_*`) or its ships' (`ship_*`).
fn on_planet(def: &StaticModifierDef) -> bool {
    def.modifiers
        .iter()
        .any(|(key, _)| !key.starts_with("country_") && !key.starts_with("ship_"))
}

/// Each modifier a scripted effect adds in the same block as it sets planet flags, with those
/// flags, as the effect's callers bind its parameters. A name its callers leave a `$param$`
/// in is no name, so a parameterised key never stands for every key it could spell.
fn marker_flags(scripts: &ScriptIndex) -> HashMap<String, Vec<String>> {
    let mut markers = Markers {
        scripts,
        followed: Followed::new(),
        open: Block::default(),
        found: HashMap::new(),
    };
    for effect in scripts.effects() {
        markers.within(&Script::of_def(effect), &effect.node);
    }
    markers.found
}

struct Markers<'a> {
    scripts: &'a ScriptIndex,
    followed: Followed,
    /// What the block the walk is in has set and added so far.
    open: Block,
    found: HashMap<String, Vec<String>>,
}

#[derive(Default)]
struct Block {
    flags: Vec<String>,
    modifiers: Vec<String>,
}

impl Markers<'_> {
    /// Walk `node` as a block of its own, then keep what it added beside the flags it set.
    fn within(&mut self, script: &Script<'_>, node: &Node) {
        let outer = mem::take(&mut self.open);
        walk::block(self, script, &(), node);
        let block = mem::replace(&mut self.open, outer);
        let named = |name: &String| !name.contains('$');
        let flags: Vec<String> = block.flags.into_iter().filter(named).collect();
        if flags.is_empty() {
            return;
        }
        for modifier in block.modifiers.into_iter().filter(named) {
            self.found.entry(modifier).or_insert_with(|| flags.clone());
        }
    }
}

impl Visitor for Markers<'_> {
    type At = ();
    type Chain = ();

    fn branch(&mut self, script: &Script<'_>, _: &(), _: Branch, node: &Node, _: &mut ()) -> Flow {
        self.within(script, node);
        Flow::Go
    }

    fn statement(&mut self, script: &Script<'_>, _: &(), statement: Statement<'_>) -> Flow {
        let Statement { key, value, node } = statement;
        match key {
            "set_planet_flag" => self.open.flags.extend(value.map(str::to_owned)),
            "add_modifier" => self.open.modifiers.extend(script.field(node, "modifier")),
            _ => match walk::call_once(Some(self.scripts), script, key, node, &mut self.followed) {
                Called::First(effect, inner) => self.within(&inner, &effect.node),
                Called::Again => {}
                Called::Not if node.scalar_span().is_none() => self.within(script, node),
                Called::Not => {}
            },
        }
        Flow::Go
    }
}
