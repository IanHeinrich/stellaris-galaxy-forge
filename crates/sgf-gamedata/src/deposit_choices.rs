//! The deposit types a save planet's page offers to add: every type but the null one, each
//! with the family it shares with types that differ only in their amount, the category the
//! picker files it under, and whether the game's roll could place it on the planet.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::GameData;
use crate::deposit_roll::{RollBody, fitting};
use crate::registries::deposits::DepositDef;
use crate::weight::Weight;

/// Where the picker files a deposit type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum DepositCategory {
    Energy,
    Minerals,
    Food,
    Research,
    Strategic,
    /// A natural feature the roll places, with no resource of its own to extract.
    Features,
    /// A type no roll ever places: only events and scripts do.
    Special,
    Blockers,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DepositChoice {
    pub key: String,
    /// Types that yield the same resources share it, as `d_energy_1` to `d_energy_10` do and
    /// every "Minor Artifacts" deposit does; a type that yields nothing has its own key.
    pub family: String,
    /// What it yields of its first resource; `None` for a type that yields nothing.
    pub amount: Option<f64>,
    pub category: DepositCategory,
    /// The game's roll could place it on the planet asked about.
    pub usual: bool,
    /// Its localised `<key>_desc`, when the install has one.
    pub description: Option<String>,
    /// No roll ever places it: only events and scripts do. A blocker is filed under
    /// [`DepositCategory::Blockers`] all the same, so this says it.
    pub event_only: bool,
}

/// The planet a picker is asked about, any of whose class and size may be left to a random
/// draw, as in a system initializer's planet block.
#[derive(Debug, Clone, Copy)]
pub struct AskedBody<'a> {
    pub class: Option<&'a str>,
    pub size: Option<u32>,
    pub moon: bool,
}

/// Every deposit type but the null one, by key, for the planet `asked` that holds `deposits`.
/// Of two types in one family with the same yields and the same planet modifiers, only one
/// is offered: the one the roll could place here, else the first by key. With no class none
/// is usual. With no size a type is usual when the roll could place it at any size the
/// class draws.
pub fn deposit_choices(
    gd: &GameData,
    asked: &AskedBody<'_>,
    deposits: &[String],
) -> Vec<DepositChoice> {
    let usual = usual_keys(gd, asked, deposits);
    let offered: Vec<&DepositDef> = gd.deposits.iter().filter(|d| !d.roll.is_null).collect();
    let mut kept: HashMap<(String, String), &DepositDef> = HashMap::new();
    for d in &offered {
        let slot = kept.entry((family(d), sameness(d))).or_insert(d);
        if !usual.contains(slot.key.as_str()) && usual.contains(d.key.as_str()) {
            *slot = d;
        }
    }
    let kept: HashSet<&str> = kept.values().map(|d| d.key.as_str()).collect();
    let mut choices: Vec<DepositChoice> = offered
        .into_iter()
        .filter(|d| kept.contains(d.key.as_str()))
        .map(|d| DepositChoice {
            key: d.key.clone(),
            family: family(d),
            amount: d.produces.first().map(|&(_, amount)| amount),
            category: category(gd, d),
            usual: usual.contains(d.key.as_str()),
            description: gd.loc.description(&format!("{}_desc", d.key)),
            event_only: never_rolled(&d.roll.drop_weight),
        })
        .collect();
    split_differing(&mut choices, gd);
    choices
}

/// The keys the roll could place on `asked`.
fn usual_keys<'a>(
    gd: &'a GameData,
    asked: &AskedBody<'_>,
    deposits: &[String],
) -> HashSet<&'a str> {
    let Some(class) = asked.class else {
        return HashSet::new();
    };
    let class_def = gd.planet_classes.get(class);
    let sizes = match (asked.size, class_def.and_then(|c| c.size(asked.moon))) {
        (Some(size), _) => size..=size,
        (None, Some(range)) => range.min.round() as u32..=range.max.round() as u32,
        (None, None) => return HashSet::new(),
    };
    sizes
        .flat_map(|size| {
            let body = RollBody {
                class,
                size,
                star: class_def.is_some_and(|c| c.star),
                moon: asked.moon,
            };
            fitting(gd, &body, deposits)
        })
        .map(|d| d.key.as_str())
        .collect()
}

/// Orbital and habitat deposits yielding the same resources share a family, which the
/// picker shows as one row with a button per amount, as the game names them by what they
/// yield: "Energy", "Minor Artifacts". Any other type, a named planetary feature or a
/// blocker even when it yields, is a family of its own.
fn family(d: &DepositDef) -> String {
    let by_amount = d
        .resource_category
        .as_deref()
        .is_some_and(|c| c.starts_with("orbital_") || c.starts_with("hab_"));
    if d.produces.is_empty() || !by_amount {
        return d.key.clone();
    }
    let joined: Vec<&str> = resources(d).into_iter().collect();
    format!("yields:{}", joined.join("+"))
}

/// What makes two types of a family the same deposit to a player: their yields and the planet
/// modifiers they bring.
fn sameness(d: &DepositDef) -> String {
    let mut parts: Vec<String> = d.produces.iter().map(|(r, n)| format!("{r}={n}")).collect();
    parts.sort();
    let mut modifiers: Vec<String> = d
        .planet_modifier
        .iter()
        .map(|(m, n)| format!("{m}={n}"))
        .collect();
    modifiers.sort();
    format!("{}|{}", parts.join(" "), modifiers.join(" "))
}

/// A family member left with the same amount as another but different planet modifiers takes
/// a family of its own, so each keeps a button.
fn split_differing(choices: &mut [DepositChoice], gd: &GameData) {
    let mut seen: HashSet<(String, String)> = HashSet::new();
    for choice in choices.iter_mut() {
        let Some(amount) = choice.amount else {
            continue;
        };
        if !seen.insert((choice.family.clone(), amount.to_string())) {
            let differs = gd.deposits.get(&choice.key).map_or(String::new(), sameness);
            choice.family = format!("{}|{differs}", choice.family);
        }
    }
}

/// The resources a type yields, by name.
fn resources(d: &DepositDef) -> BTreeSet<&str> {
    d.produces.iter().map(|(r, _)| r.as_str()).collect()
}

/// Blockers first, then a type no roll places, then a type by the resources it yields, and
/// a feature when it yields none.
fn category(gd: &GameData, d: &DepositDef) -> DepositCategory {
    if gd.is_blocker(&d.key) {
        return DepositCategory::Blockers;
    }
    if never_rolled(&d.roll.drop_weight) {
        return DepositCategory::Special;
    }
    let yields = resources(d);
    if yields.is_empty() {
        return DepositCategory::Features;
    }
    let has = |resource: &str| yields.contains(resource);
    if yields.iter().any(|r| r.starts_with("sr_")) {
        DepositCategory::Strategic
    } else if has("energy") {
        DepositCategory::Energy
    } else if has("minerals") {
        DepositCategory::Minerals
    } else if has("food") {
        DepositCategory::Food
    } else if yields.iter().any(|r| r.ends_with("_research")) {
        DepositCategory::Research
    } else {
        DepositCategory::Strategic
    }
}

/// A weight that is zero whatever the body: nothing in it multiplies from above zero, adds
/// or sets one.
fn never_rolled(weight: &Weight) -> bool {
    weight.base * weight.factor <= 0.0
        && weight
            .modifiers
            .iter()
            .all(|m| m.add.is_none_or(|a| a <= 0.0) && m.weight.is_none_or(|w| w <= 0.0))
}
