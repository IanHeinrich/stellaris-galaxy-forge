//! `common/asteroid_belts`: the kinds a save's `asteroid_belt = { type }` names, and how
//! each looks, read from the meshes it scatters.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::install::script::Def;
use crate::registries::registry::{FromDef, Registry};

pub type AsteroidBelts = Registry<AsteroidBeltDef>;

/// What a belt's pieces look like, from the meshes its kind names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum BeltLook {
    Rocky,
    Icy,
    Crystal,
    /// Rocks mixed with shattered pieces, containers or billboards.
    Debris,
    /// Only shattered pieces: a sparse haze.
    Dust,
    Fauna,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AsteroidBeltDef {
    pub key: String,
    pub look: BeltLook,
    /// Drawn with the game's `AsteroidEmissive` shader: its pieces glow.
    pub emissive: bool,
    /// How wide the band is, and how many pieces it has, against a plain belt's; `1` when unset.
    pub width: f64,
    pub density: f64,
}

const FAUNA_MESHES: [&str; 4] = ["amoeba", "tiyanki", "leviathan", "fauna"];
const DEBRIS_MESHES: [&str; 3] = ["container", "billboard", "shatter"];

fn look_of(meshes: &[String]) -> BeltLook {
    let any = |words: &[&str]| meshes.iter().any(|m| words.iter().any(|w| m.contains(w)));
    if any(&FAUNA_MESHES) {
        BeltLook::Fauna
    } else if any(&["crystal"]) {
        BeltLook::Crystal
    } else if any(&["ice"]) {
        BeltLook::Icy
    } else if !meshes.is_empty() && meshes.iter().all(|m| m.contains("shatter")) {
        BeltLook::Dust
    } else if any(&DEBRIS_MESHES) {
        BeltLook::Debris
    } else {
        BeltLook::Rocky
    }
}

impl FromDef for AsteroidBeltDef {
    const DIR: &'static str = "common/asteroid_belts";

    fn read(key: String, def: &Def) -> Self {
        let meshes: Vec<String> = def
            .node
            .find_all("mesh", &def.src)
            .filter_map(|m| m.scalar_str(&def.src))
            .map(str::to_ascii_lowercase)
            .collect();
        let emissive = def
            .scalar("shader")
            .is_some_and(|s| s.to_ascii_lowercase().contains("emissive"));
        Self {
            key,
            look: look_of(&meshes),
            emissive,
            width: def.number("width").unwrap_or(1.0),
            density: def.number("density").unwrap_or(1.0),
        }
    }
}
