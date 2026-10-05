//! `common/star_classes`: how a `galactic_object.star_class` is drawn, and the weighted
//! lists (`randomizers`) an initializer draws one from.

use std::path::PathBuf;

use crate::GameData;
use crate::install::layers::VANILLA;
use crate::install::script::{self, Def, Range};
use crate::registries::registry::{FromDef, Registry};

pub type StarClasses = Registry<StarClass>;
pub type StarLists = Registry<StarList>;

#[derive(Debug, Clone, PartialEq)]
pub struct StarClass {
    pub key: String,
    /// The file the winning definition was read from.
    pub source: PathBuf,
    pub class: String,
    pub icon: Option<String>,
    pub icon_scale: f64,
    /// Each `planet = { key = pc_… class = … }`: the planet class of each star body, with the
    /// `class` it is lit as, which names its `gfx/worldgfx` settings; an entry without one
    /// takes the system's own `class`.
    pub planets: Vec<StarPlanet>,
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
    /// Its definition writes only a `class` and zero `spawn_odds`: a key kept valid for the
    /// scripts that name it, with no star body, planet count or anything else a system uses.
    pub placeholder: bool,
    /// It lists more star bodies than any class a new galaxy rolls has, so the list holds the
    /// stars a system of it may have rather than one entry per star.
    pub alternatives: bool,
}

/// One `planet = { key = pc_… class = … }` of a [`StarClass`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StarPlanet {
    pub key: String,
    pub lighting: String,
}

impl StarClass {
    pub fn texture_icon(&self) -> &str {
        self.icon.as_deref().unwrap_or(&self.class)
    }

    /// Each `planet = { key = pc_… }` in order: the planet class of each star body, two or
    /// three of them for a binary or trinary system.
    pub fn planet_keys(&self) -> impl Iterator<Item = &str> {
        self.planets.iter().map(|p| p.key.as_str())
    }

    /// The factor this star puts on `planet_class`'s odds; `1` unless it names the class.
    pub fn planet_odds(&self, planet_class: &str) -> f64 {
        self.planet_odds
            .iter()
            .find(|(key, _)| key == planet_class)
            .map_or(1.0, |(_, odds)| *odds)
    }
}

impl StarClasses {
    /// These classes, each marked [`StarClass::alternatives`] against the most star bodies a
    /// class with `spawn_odds` above 0 has, or one when none has any.
    pub(crate) fn marked(&self) -> Self {
        let rolled = self
            .iter()
            .filter(|c| c.spawn_odds > 0.0)
            .map(|c| c.planets.len())
            .max()
            .unwrap_or(0)
            .max(1);
        self.iter()
            .map(|class| {
                let class = StarClass {
                    alternatives: class.planets.len() > rolled,
                    ..class.clone()
                };
                (class.key.clone(), class)
            })
            .collect()
    }
}

impl GameData {
    /// The mod star class `class` comes from, by its name, when this install knows it; `None`
    /// for the base game.
    pub fn star_class_source(&self, class: &str) -> Option<String> {
        let def = self.star_classes.get(class)?;
        let (layer, _) = self.layout.layer_of(&def.source)?;
        (layer.name != VANILLA).then(|| layer.name.clone())
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
        let class = def.scalar("class").unwrap_or_default().to_owned();
        let planets: Vec<StarPlanet> = def
            .node
            .find_all("planet", &def.src)
            .filter_map(|p| {
                let key = p.find("key", &def.src)?.scalar_str(&def.src)?.to_owned();
                let lighting = p
                    .find("class", &def.src)
                    .and_then(|c| c.scalar_str(&def.src))
                    .unwrap_or(&class)
                    .to_owned();
                Some(StarPlanet { key, lighting })
            })
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
        let spawn_odds = def.number("spawn_odds").unwrap_or(0.0);
        let only_named = def
            .node
            .children()
            .iter()
            .all(|child| matches!(child.key_str(&def.src), Some("class" | "spawn_odds")));
        Self {
            key,
            source: def.file.clone(),
            class,
            icon: def.scalar("icon").map(str::to_owned),
            icon_scale: def.number("icon_scale").unwrap_or(1.0),
            planets,
            crisis_star_class: def.scalar("crisis_star_class").map(str::to_owned),
            spawn_odds,
            num_planets: def.range("num_planets"),
            planet_odds,
            placeholder: only_named && spawn_odds == 0.0,
            alternatives: false,
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
