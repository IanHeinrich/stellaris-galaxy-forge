//! The Special menu of Add system: the special layouts a user picks by name, less those a
//! star-class pick already draws, each with a label no other entry shares.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sgf_core::session::Session;
use ts_rs::TS;

use crate::GameData;
use crate::body_effects;
use crate::generate;
use crate::initializers::{Initializer, expand};
use crate::layouts::{
    DlcNeed, SaveFacts, UNIQUE_SYSTEM, converted, notable, special_initializers, star_body,
};
use crate::loc::localisation::Localisation;

/// One entry of the Special menu.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SpecialLayout {
    /// The initializer's key, which the added system records.
    pub key: String,
    /// The localised fixed system name, else the notable bodies, modifiers and belts:
    /// `Arboreal World`. A layout with none of them, and labels that would repeat once they
    /// take their belts, have the key made readable: `Star Lifting System`.
    pub label: String,
    /// Its `flags` set [`UNIQUE_SYSTEM`], or its [`crate::layouts::Converted`] entry says
    /// so: one of the game's unique systems, which the menu lists apart from its other
    /// special systems.
    pub unique: bool,
    /// It has `max_instances`, which an add counts in `system_initializer_counter`.
    pub capped: bool,
    /// How many systems of the save record it as their `initializer`.
    pub in_galaxy: u32,
    /// The DLC its odds rule it out without, when they check one.
    pub dlc: Option<DlcNeed>,
}

/// The special layouts the Special menu offers: all but those a star-class pick of
/// [`crate::generate::generate`] already draws, in the install's key order.
pub fn menu_initializers(gd: &GameData) -> Vec<&Initializer> {
    let drawn: HashSet<&str> = generate::star_pick_layouts(gd)
        .into_iter()
        .map(|init| init.name.as_str())
        .collect();
    special_initializers(gd)
        .into_iter()
        .filter(|init| !drawn.contains(init.name.as_str()))
        .collect()
}

/// The Special menu's entries for `session`'s save, by label.
pub fn special_layouts(gd: &GameData, session: &Session) -> Vec<SpecialLayout> {
    let save = SaveFacts::read(session);
    let layouts = menu_initializers(gd);
    let labels = labels(gd, &layouts);
    let mut entries: Vec<SpecialLayout> = layouts
        .into_iter()
        .zip(labels)
        .map(|(init, label)| SpecialLayout {
            key: init.name.clone(),
            label,
            unique: converted(init).is_some_and(|layout| layout.unique)
                || init.flags.iter().any(|flag| flag == UNIQUE_SYSTEM),
            capped: init.max_instances.is_some(),
            in_galaxy: save.in_galaxy(&init.name),
            dlc: save.dlc_need(gd, init),
        })
        .collect();
    entries.sort_by(|a, b| a.label.cmp(&b.label).then_with(|| a.key.cmp(&b.key)));
    entries
}

/// What a label is built from: the fixed name, or the notable bodies and modifiers, and the
/// belts that tell it from another. A phenomenon's card shows its star, so its label
/// leaves the star out.
struct LabelParts {
    main: Vec<String>,
    belts: Vec<String>,
}

/// A label for each of `layouts`, no two alike.
fn labels(gd: &GameData, layouts: &[&Initializer]) -> Vec<String> {
    let parts: Vec<LabelParts> = layouts.iter().map(|init| label_parts(gd, init)).collect();
    let mut labels: Vec<String> = parts
        .iter()
        .zip(layouts)
        .map(|(parts, init)| {
            let main = match parts.main.is_empty() {
                true => &parts.belts,
                false => &parts.main,
            };
            match main.is_empty() {
                true => Localisation::readable(&init.name),
                false => main.join(", "),
            }
        })
        .collect();
    let base = labels.clone();
    for (i, part) in parts.iter().enumerate() {
        if repeated(&base, i) && !part.main.is_empty() && !part.belts.is_empty() {
            labels[i] = [part.main.clone(), part.belts.clone()].concat().join(", ");
        }
    }
    let first = labels.clone();
    for (i, init) in layouts.iter().enumerate() {
        if !repeated(&first, i) {
            continue;
        }
        let uncapped: Vec<usize> = (0..layouts.len())
            .filter(|&j| first[j] == first[i] && layouts[j].max_instances.is_none())
            .collect();
        if uncapped != [i] {
            labels[i] = Localisation::readable(&init.name);
        }
    }
    labels
}

fn repeated(labels: &[String], i: usize) -> bool {
    labels
        .iter()
        .enumerate()
        .any(|(j, label)| j != i && *label == labels[i])
}

fn label_parts(gd: &GameData, init: &Initializer) -> LabelParts {
    let loc = |key: &str| gd.loc.name_or_readable(key);
    let mut belts: Vec<String> = Vec::new();
    for belt in &init.asteroid_belts {
        let name = Localisation::readable(&belt.kind);
        if !belts.contains(&name) {
            belts.push(name);
        }
    }
    if let Some(key) = converted(init).and_then(|layout| layout.label) {
        let main = gd
            .loc
            .name(key)
            .unwrap_or_else(|| Localisation::readable(key.trim_start_matches("NAME_")));
        return LabelParts {
            main: vec![main],
            belts,
        };
    }
    if let Some(name) = &init.display_name {
        let main = gd
            .loc
            .name(name)
            .unwrap_or_else(|| Localisation::readable(&init.name));
        return LabelParts {
            main: vec![main],
            belts,
        };
    }
    let mut main: Vec<String> = Vec::new();
    let mut push = |part: String| {
        if !main.contains(&part) {
            main.push(part);
        }
    };
    for body in expand(&init.planets)
        .skip_while(|b| !star_body(gd, &b.block.class))
        .skip(1)
    {
        let class = body.block.class.named().and_then(|key| resolved(gd, key));
        if let Some(class) = class.filter(|c| notable(gd, c)) {
            push(loc(class));
        }
        for modifier in body_effects::modifiers(&body.block.effects) {
            push(loc(modifier));
        }
    }
    LabelParts { main, belts }
}

/// The one class a body can be: its fixed class, or the only class of its planet list.
fn resolved<'a>(gd: &'a GameData, class: &'a str) -> Option<&'a str> {
    match gd.planet_lists.get(class) {
        Some(list) if list.len() == 1 => Some(list[0].as_str()),
        Some(_) => None,
        None => Some(class),
    }
}
