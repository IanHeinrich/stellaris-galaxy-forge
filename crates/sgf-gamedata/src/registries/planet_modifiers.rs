//! `common/planet_modifiers`: the `pm_*` keys a planet's `planet_modifier`
//! names, each applying one static modifier, and how often a new body rolls each.

use crate::condition::Condition;
use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};
use crate::weight::Weight;

pub type PlanetModifiers = Registry<PlanetModifierDef>;

#[derive(Debug, Clone, PartialEq)]
pub struct PlanetModifierDef {
    pub key: String,
    /// The `common/static_modifiers` key it applies.
    pub modifier: Option<String>,
    /// `is_null = yes`: drawing it gives the body no feature.
    pub is_null: bool,
    /// `spawn_chance`: its weight in a new body's draw; nothing when it writes none.
    pub spawn_chance: Weight,
    /// `potential`: what a body must be for the draw to give it at all.
    pub potential: Option<Condition>,
}

impl FromDef for PlanetModifierDef {
    const DIR: &'static str = "common/planet_modifiers";

    fn read(key: String, def: &Def) -> Self {
        let src = &def.src;
        Self {
            modifier: def.scalar("modifier").map(str::to_owned),
            is_null: def.flag("is_null"),
            spawn_chance: def
                .node
                .find("spawn_chance", src)
                .map_or_else(|| Weight::fixed(0.0), |node| Weight::read(node, def, 0.0)),
            potential: def
                .node
                .find("potential", src)
                .map(|node| Condition::of_def(node, def)),
            key,
        }
    }
}
