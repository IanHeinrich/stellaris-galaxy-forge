//! The classes the add-system and add-body menus offer, each named as the game names it.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::GameData;
use crate::generate::{body_classes, star_classes};

/// A class a body added to a save may take, named as the game names it, with the sizes a
/// random one of it is drawn from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BodyClassPick {
    pub key: String,
    pub name: String,
    pub min_size: u32,
    pub max_size: u32,
}

/// A star class a rolled system may have, named as the game names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StarClassPick {
    pub key: String,
    pub name: String,
}

impl GameData {
    /// The classes a planet, or with `moon` a moon, added to a save may take, by name.
    pub fn body_class_picks(&self, moon: bool) -> Vec<BodyClassPick> {
        let mut picks: Vec<BodyClassPick> = body_classes(self, moon)
            .into_iter()
            .filter_map(|class| {
                let range = class.size(moon)?;
                Some(BodyClassPick {
                    key: class.key.clone(),
                    name: self.class_name(&class.key),
                    min_size: range.min.round() as u32,
                    max_size: range.max.round() as u32,
                })
            })
            .collect();
        tell_apart(&mut picks, |p| (&p.key, &mut p.name));
        picks.sort_by(|a, b| a.name.cmp(&b.name));
        picks
    }

    /// The star classes a rolled system can have, in the order the install's layouts name
    /// them.
    pub fn star_class_picks(&self) -> Vec<StarClassPick> {
        let mut picks: Vec<StarClassPick> = star_classes(self)
            .into_iter()
            .map(|key| StarClassPick {
                name: self.class_name(&key),
                key,
            })
            .collect();
        tell_apart(&mut picks, |p| (&p.key, &mut p.name));
        picks
    }

    /// A class's localised name, else its key: an empty entry names nothing.
    fn class_name(&self, key: &str) -> String {
        self.loc.name(key).unwrap_or_else(|| key.to_owned())
    }
}

/// Classes can share a name (`pc_nanotech` is named `$pc_gray_goo$`, `pc_barren_cold` is
/// "Barren World" like `pc_barren`), so each of them shows its key after the name.
fn tell_apart<T>(picks: &mut [T], parts: impl Fn(&mut T) -> (&String, &mut String)) {
    let mut seen: Vec<String> = Vec::new();
    let mut shared: Vec<String> = Vec::new();
    for pick in picks.iter_mut() {
        let (_, name) = parts(pick);
        match seen.contains(name) {
            true => shared.push(name.clone()),
            false => seen.push(name.clone()),
        }
    }
    for pick in picks.iter_mut() {
        let (key, name) = parts(pick);
        if shared.contains(name) {
            *name = format!("{name} ({key})");
        }
    }
}
