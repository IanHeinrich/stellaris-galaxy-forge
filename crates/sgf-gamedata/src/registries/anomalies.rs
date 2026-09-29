//! `common/anomalies`: the categories a planet's `anomaly="<key>"` names, each with its
//! level, its `spawn_chance` for the survey roll, and whether it runs `on_spawn`, which
//! the game runs only when the roll places the category.

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};
use crate::weight::Weight;

pub type AnomalyCategories = Registry<AnomalyCategoryDef>;

/// The prefix of the categories the AI's own anomalies use.
pub const AI_PREFIX: &str = "AIANOM_";

#[derive(Debug, Clone, PartialEq)]
pub struct AnomalyCategoryDef {
    pub key: String,
    /// `level`, 1 to 10, `@variables` substituted.
    pub level: Option<u32>,
    /// The localisation key of its description: `desc` when a plain key, else `<key>_desc`.
    pub desc: String,
    pub on_spawn: bool,
    /// Its `spawn_chance` asks about an event chain the finder has running or has finished.
    pub chain: bool,
    pub spawn_chance: Weight,
}

impl FromDef for AnomalyCategoryDef {
    const DIR: &'static str = "common/anomalies";

    fn read(key: String, def: &Def) -> Self {
        let src = &def.src;
        let spawn_chance = def.node.find("spawn_chance", src);
        let chain = spawn_chance.is_some_and(|node| {
            let text = String::from_utf8_lossy(node.span().slice(src));
            text.contains("has_event_chain") || text.contains("has_completed_event_chain_counter")
        });
        Self {
            level: def
                .number("level")
                .filter(|level| *level >= 0.0)
                .map(|level| level.round() as u32),
            desc: def.scalar("desc").map_or_else(
                || format!("{key}_desc"),
                |desc| desc.trim_matches('"').to_owned(),
            ),
            on_spawn: def.node.find("on_spawn", src).is_some(),
            chain,
            spawn_chance: spawn_chance
                .map_or_else(|| Weight::fixed(0.0), |node| Weight::read(node, def, 0.0)),
            key,
        }
    }
}

impl AnomalyCategoryDef {
    /// Whether an edit may write it on a planet: no `on_spawn`, which would not run, no AI
    /// category and no category an event chain gates.
    pub fn offered(&self) -> bool {
        !self.on_spawn && !self.chain && !self.key.starts_with(AI_PREFIX)
    }
}
