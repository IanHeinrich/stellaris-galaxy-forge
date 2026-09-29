//! The archaeological dig site types a save planet's page knows: every type with a stage. The
//! picker offers those a site written into the save can stand for. It leaves out a type with
//! an `on_create` effect, which such a site never runs: in the base game
//! `site_percussive_maintenance`, which places an abandoned station, and `site_the_library`,
//! which clears the planet's deposits and glasses it. The page still reads their stage counts
//! for a site the game created.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::GameData;
use crate::loc::localisation::Localisation;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DigSiteChoice {
    /// The type's key, which the site's `type` names.
    pub key: String,
    /// Its localised name, or the key made readable.
    pub name: String,
    /// The localised text its `desc` names, or else its `<key>_desc`, when the install has one.
    pub description: Option<String>,
    /// The first stage's difficulty, which a new site starts at; 0 when it cannot be read.
    pub difficulty: i32,
    /// How many stages it has.
    pub stages: u32,
    /// The survey roll can pick it; otherwise only an event or an initializer creates one.
    pub rolled: bool,
    /// The picker offers it: it has no `on_create` effect, and its first stage's difficulty
    /// can be read.
    pub offered: bool,
}

impl GameData {
    /// Every dig site type with a stage, by key, each saying whether the picker offers it.
    pub fn dig_site_choices(&self) -> Vec<DigSiteChoice> {
        self.dig_site_types
            .iter()
            .filter(|def| !def.difficulties.is_empty())
            .map(|def| {
                let first = def.difficulties.first().copied().flatten();
                DigSiteChoice {
                    key: def.key.clone(),
                    name: self
                        .loc
                        .name(&def.key)
                        .unwrap_or_else(|| Localisation::readable(&def.key)),
                    description: def
                        .desc
                        .as_deref()
                        .and_then(|desc| self.loc.description(desc))
                        .or_else(|| self.loc.description(&format!("{}_desc", def.key))),
                    difficulty: first.unwrap_or(0),
                    stages: u32::try_from(def.difficulties.len()).unwrap_or(u32::MAX),
                    rolled: def.rolled,
                    offered: !def.on_create && first.is_some(),
                }
            })
            .collect()
    }
}
