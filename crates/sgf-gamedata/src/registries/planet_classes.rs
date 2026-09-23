//! `common/planet_classes`: what a `planets.planet_class` (or one of a
//! `galactic_object.star_class`'s `planet_keys`) looks like and whether it
//! can be colonised.

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};

pub type PlanetClasses = Registry<PlanetClassDef>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanetClassDef {
    pub key: String,
    pub icon: Option<String>,
    pub colonizable: bool,
    pub star: bool,
    pub climate: Option<String>,
}

impl FromDef for PlanetClassDef {
    const DIR: &'static str = "common/planet_classes";

    fn read(key: String, def: &Def) -> Self {
        Self {
            icon: def.scalar("icon").map(str::to_owned),
            colonizable: def.flag("colonizable"),
            star: def.flag("star"),
            climate: def.scalar("climate").map(str::to_owned),
            key,
        }
    }
}
