//! `common/star_classes`: how a `galactic_object.star_class` is drawn, and the weighted
//! lists (`randomizers`) an initializer draws one from.

use crate::install::script::{self, Def, Range};
use crate::registries::registry::{FromDef, Registry};

pub type StarClasses = Registry<StarClass>;
pub type StarLists = Registry<StarList>;

#[derive(Debug, Clone, PartialEq)]
pub struct StarClass {
    pub key: String,
    pub class: String,
    pub icon: Option<String>,
    pub icon_scale: f64,
    /// Each `planet = { key = pc_… }` in order: the planet class of each star body, two
    /// or three of them for a binary or trinary system.
    pub planet_keys: Vec<String>,
    /// The class the game swaps this one for during a crisis, when it has one.
    pub crisis_star_class: Option<String>,
    /// The weight a fresh galaxy draws this class with; `0` when the definition omits it, as
    /// crisis variants and classes set only by events do.
    pub spawn_odds: f64,
    /// How many planets a system of this class spawns when its initializer leaves it open.
    pub num_planets: Option<Range>,
    /// `pc_… = { spawn_odds = n }`: what a random draw multiplies that planet class's own
    /// odds by around this star.
    pub planet_odds: Vec<(String, f64)>,
}

impl StarClass {
    pub fn texture_icon(&self) -> &str {
        self.icon.as_deref().unwrap_or(&self.class)
    }

    /// The factor this star puts on `planet_class`'s odds; `1` unless it names the class.
    pub fn planet_odds(&self, planet_class: &str) -> f64 {
        self.planet_odds
            .iter()
            .find(|(key, _)| key == planet_class)
            .map_or(1.0, |(_, odds)| *odds)
    }
}

impl FromDef for StarClass {
    const DIR: &'static str = "common/star_classes";

    /// The weighted lists beside the classes (`rl_binary_stars = { stars = { … } }`) have no
    /// `class`; a placeholder class with no bodies still has one.
    fn skip(def: &Def) -> bool {
        def.scalar("class").is_none()
    }

    fn read(key: String, def: &Def) -> Self {
        let planet_keys = def
            .node
            .find_all("planet", &def.src)
            .filter_map(|p| p.find("key", &def.src)?.scalar_str(&def.src))
            .map(str::to_owned)
            .collect();
        let planet_odds = def
            .node
            .children()
            .iter()
            .filter_map(|child| {
                let class = child.key_str(&def.src)?.strip_prefix("pc_")?;
                let odds = child.find("spawn_odds", &def.src)?.scalar_str(&def.src)?;
                Some((format!("pc_{class}"), def.number_of(odds)?))
            })
            .collect();
        Self {
            key,
            class: def.scalar("class").unwrap_or_default().to_owned(),
            icon: def.scalar("icon").map(str::to_owned),
            icon_scale: def.number("icon_scale").unwrap_or(1.0),
            planet_keys,
            crisis_star_class: def.scalar("crisis_star_class").map(str::to_owned),
            spawn_odds: def.number("spawn_odds").unwrap_or(0.0),
            num_planets: def.range("num_planets"),
            planet_odds,
        }
    }
}

/// `rl_… = { stars = { sc_… } }`: the star classes an initializer's `class` draws from,
/// each weighted by its own `spawn_odds`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StarList {
    pub key: String,
    pub stars: Vec<String>,
}

impl FromDef for StarList {
    const DIR: &'static str = "common/star_classes";

    fn skip(def: &Def) -> bool {
        def.node.find("stars", &def.src).is_none()
    }

    fn read(key: String, def: &Def) -> Self {
        Self {
            key,
            stars: script::list_items(&def.node, "stars", &def.src),
        }
    }
}
