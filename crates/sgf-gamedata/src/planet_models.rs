//! The models a save planet's page offers: every entity the install and its mods give a
//! planet, from the `entity` of an initializer's `planet` and `moon` blocks and from every
//! `set_planet_entity` in the scripts, with the planet classes each is used on.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;

use serde::{Deserialize, Serialize};
use sgf_core::cst::{self, Node};
use ts_rs::TS;

use crate::GameData;
use crate::initializers::{InitPlanet, Initializer};
use crate::loc::localisation::Localisation;
use crate::registries::registry::FromDef;
use crate::scripts::index::{EFFECTS_DIR, EVENTS_DIR, ON_ACTIONS_DIR};

/// The directories whose scripts can run `set_planet_entity` that the script index parses.
const INDEXED_DIRS: [&str; 4] = [EFFECTS_DIR, ON_ACTIONS_DIR, EVENTS_DIR, Initializer::DIR];
/// The other directories whose scripts can run `set_planet_entity`.
const OTHER_DIRS: [&str; 4] = [
    "common/decisions",
    "common/megastructures",
    "common/buildings",
    "common/inline_scripts",
];

const SET_PLANET_ENTITY: &str = "set_planet_entity";

/// Models never offered: the arc furnace's turret model hides the planet in game.
const DENIED: [&str; 1] = ["invisible_turret_entity"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetModelChoice {
    /// The entity a save writes as `entity_name`.
    pub entity: String,
    /// Its localisation, else a name made from the key; unique among the choices.
    pub label: String,
    /// The planet classes the install uses it on, by key, sorted.
    pub classes: Vec<String>,
}

impl GameData {
    /// Every model a planet's page offers, by label. A model named with an owner's graphical
    /// culture is left out, since the save names the culture's own model, and so are a
    /// star's models and a planet class named in place of a model, which resets it.
    pub fn planet_model_choices(&self) -> Vec<PlanetModelChoice> {
        let mut found: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for init in self.initializers.iter() {
            self.models_of_bodies(&init.planets, &mut found);
        }
        for dir in INDEXED_DIRS {
            for file in self.layout.files_in(dir) {
                if let Some(parsed) = self.scripts.parsed(&file)
                    && sets_planet_entity(&parsed.src)
                {
                    self.models_of_script(&parsed.root, None, &parsed.src, &mut found);
                }
            }
        }
        for dir in OTHER_DIRS {
            for file in self.layout.files_in(dir) {
                let Ok(src) = fs::read(&file) else {
                    continue;
                };
                if sets_planet_entity(&src)
                    && let Ok(root) = cst::parse_script(&src, 0)
                {
                    self.models_of_script(&root, None, &src, &mut found);
                }
            }
        }

        let bases: Vec<(&str, &str)> = self
            .planet_classes
            .iter()
            .filter(|c| !c.star)
            .filter_map(|c| Some((c.key.as_str(), c.entity.as_deref()?)))
            .collect();
        let stars: BTreeSet<&str> = self
            .planet_classes
            .iter()
            .filter(|c| c.star)
            .filter_map(|c| c.entity.as_deref())
            .collect();
        let mut choices: Vec<(PlanetModelChoice, Option<&str>)> = found
            .into_iter()
            .filter(|(entity, _)| {
                self.planet_classes.get(entity).is_none()
                    && !bases.iter().any(|(_, base)| base == entity)
                    && !stars.contains(entity.as_str())
                    && !entity.ends_with("_star_entity")
                    && !DENIED.contains(&entity.as_str())
            })
            .map(|(entity, mut classes)| {
                let own = own_class(&entity, &bases);
                classes.extend(own.map(str::to_owned));
                let choice = PlanetModelChoice {
                    label: self.model_label(&entity, &bases),
                    classes: classes.into_iter().collect(),
                    entity,
                };
                (choice, own)
            })
            .collect();
        self.tell_apart(&mut choices);
        let mut choices: Vec<PlanetModelChoice> = choices.into_iter().map(|(c, _)| c).collect();
        choices.sort_by(|a, b| a.label.cmp(&b.label).then(a.entity.cmp(&b.entity)));
        choices
    }

    fn models_of_bodies(
        &self,
        bodies: &[InitPlanet],
        found: &mut BTreeMap<String, BTreeSet<String>>,
    ) {
        for body in bodies {
            if let Some(entity) = &body.entity {
                let classes = found.entry(entity.clone()).or_default();
                if let Some(class) = body.class.named().filter(|c| self.is_planet_class(c)) {
                    classes.insert(class.to_owned());
                }
            }
            self.models_of_bodies(&body.moons, found);
        }
    }

    /// Each `set_planet_entity` under `node`, with the planet class of the switch case it
    /// sits in when `parent` names one.
    fn models_of_script(
        &self,
        node: &Node,
        parent: Option<&str>,
        src: &[u8],
        found: &mut BTreeMap<String, BTreeSet<String>>,
    ) {
        let key = node.key_str(src);
        if key == Some(SET_PLANET_ENTITY) {
            if node.find("graphical_culture", src).is_some() {
                return;
            }
            let entity = node.find("entity", src).and_then(|e| e.scalar_str(src));
            if let Some(entity) = entity.filter(|e| is_identifier(e)) {
                let classes = found.entry(entity.to_owned()).or_default();
                if let Some(class) = parent.filter(|c| self.is_planet_class(c)) {
                    classes.insert(class.to_owned());
                }
            }
            return;
        }
        for child in node.children() {
            self.models_of_script(child, key, src, found);
        }
    }

    fn is_planet_class(&self, key: &str) -> bool {
        self.planet_classes.get(key).is_some_and(|c| !c.star)
    }

    /// Its localisation, by the key without `_entity` or by the short name; else the short
    /// name made readable, or the whole key where nothing but a number is left.
    fn model_label(&self, entity: &str, bases: &[(&str, &str)]) -> String {
        let stem = entity.strip_suffix("_entity").unwrap_or(entity);
        let short = short_name(stem, bases);
        let localised = self
            .loc
            .name(stem)
            .or_else(|| short.and_then(|s| self.loc.name(s)));
        localised.unwrap_or_else(|| readable(short.unwrap_or(stem)))
    }

    /// Labels two models share, told apart by the class each belongs to, else by the key.
    fn tell_apart(&self, choices: &mut [(PlanetModelChoice, Option<&str>)]) {
        let shared = |choices: &[(PlanetModelChoice, Option<&str>)]| {
            let mut counts: HashMap<String, usize> = HashMap::new();
            for (choice, _) in choices.iter() {
                *counts.entry(choice.label.clone()).or_default() += 1;
            }
            counts
        };
        let counts = shared(choices);
        for (choice, own) in choices.iter_mut() {
            if counts[&choice.label] > 1
                && let Some(class) = own.or(choice.classes.first().map(String::as_str))
            {
                let class = self.loc.name(class).unwrap_or_else(|| readable(class));
                choice.label = format!("{} ({class})", choice.label);
            }
        }
        let counts = shared(choices);
        for (choice, _) in choices.iter_mut() {
            if counts[&choice.label] > 1 {
                let stem = choice
                    .entity
                    .strip_suffix("_entity")
                    .unwrap_or(&choice.entity);
                choice.label = readable(stem);
            }
        }
    }
}

/// The class whose own model name starts the key, `pc_desert` for `desert_planet_earth_entity`;
/// the longest when several do.
fn own_class<'a>(entity: &str, bases: &[(&'a str, &str)]) -> Option<&'a str> {
    bases
        .iter()
        .filter(|(_, base)| {
            entity
                .strip_prefix(base)
                .is_some_and(|rest| rest.starts_with('_'))
        })
        .max_by_key(|(_, base)| base.len())
        .map(|(class, _)| *class)
}

/// The key without its class's model name and a trailing variant number, and without
/// `_planet` before that number: `earth` for `continental_planet_earth`, `ocean_paradise`
/// for `ocean_paradise_planet_01`. `None` when that leaves no word.
fn short_name<'a>(stem: &'a str, bases: &[(&str, &str)]) -> Option<&'a str> {
    let mut short = bases
        .iter()
        .filter_map(|(_, base)| stem.strip_prefix(base)?.strip_prefix('_'))
        .min_by_key(|rest| rest.len())
        .unwrap_or(stem);
    if let Some((rest, number)) = short.rsplit_once('_')
        && !number.is_empty()
        && number.bytes().all(|b| b.is_ascii_digit())
    {
        short = rest.strip_suffix("_planet").unwrap_or(rest);
    }
    short
        .bytes()
        .any(|b| b.is_ascii_alphabetic())
        .then_some(short)
}

/// `sea_of_conciousness` as `Sea of Conciousness`, and `gas_giant_02` as `Gas Giant 2`.
fn readable(key: &str) -> String {
    let words: Vec<String> = Localisation::readable(key)
        .split(' ')
        .enumerate()
        .map(|(i, word)| match word {
            "Of" | "The" | "And" if i > 0 => word.to_lowercase(),
            _ if word.bytes().all(|b| b.is_ascii_digit()) => match word.trim_start_matches('0') {
                "" => "0".to_owned(),
                number => number.to_owned(),
            },
            _ => word.to_owned(),
        })
        .collect();
    words.join(" ")
}

fn sets_planet_entity(src: &[u8]) -> bool {
    src.windows(SET_PLANET_ENTITY.len())
        .any(|w| w == SET_PLANET_ENTITY.as_bytes())
}

/// A model named outright, not a `$PARAMETER$` or `@variable` a scripted effect fills in.
fn is_identifier(text: &str) -> bool {
    text.starts_with(|c: char| c.is_ascii_alphabetic())
        && text.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}
