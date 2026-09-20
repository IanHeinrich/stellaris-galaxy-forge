//! `common/star_classes`: how a `galactic_object.star_class` is drawn.

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};

pub type StarClasses = Registry<StarClass>;

#[derive(Debug, Clone, PartialEq)]
pub struct StarClass {
    pub key: String,
    pub class: String,
    pub icon: Option<String>,
    pub icon_scale: f64,
    /// The first `planet = { key = pc_… }`: the star's planet class.
    pub planet_key: Option<String>,
}

impl StarClass {
    pub fn texture_icon(&self) -> &str {
        self.icon.as_deref().unwrap_or(&self.class)
    }
}

impl FromDef for StarClass {
    const DIR: &'static str = "common/star_classes";

    fn read(key: String, def: &Def) -> Self {
        let planet_key = def
            .node
            .find("planet", &def.src)
            .and_then(|p| p.find("key", &def.src)?.scalar_str(&def.src));
        Self {
            key,
            class: def.scalar("class").unwrap_or_default().to_owned(),
            icon: def.scalar("icon").map(str::to_owned),
            icon_scale: def
                .scalar("icon_scale")
                .and_then(|s| s.parse().ok())
                .unwrap_or(1.0),
            planet_key: planet_key.map(str::to_owned),
        }
    }
}
