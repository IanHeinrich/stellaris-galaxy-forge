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
    /// The key without its trailing `_<number>` when two or more types share that stem and
    /// yield the same resources, as `d_energy_1` to `d_energy_10` do; the key itself
    /// otherwise.
    pub family: String,
    /// A family member's amount: its one yield, or else its key's number. `None` for a type
    /// that is a family of its own.
    pub amount: Option<f64>,
    pub category: DepositCategory,
    /// The game's roll could place it on the planet asked about.
    pub usual: bool,
}

/// Every deposit type but the null one, in the install's order, for a planet `body` that
/// holds `deposits`.
pub fn deposit_choices(
    gd: &GameData,
    body: &RollBody<'_>,
    deposits: &[String],
) -> Vec<DepositChoice> {
    let usual: HashSet<&str> = fitting(gd, body, deposits)
        .into_iter()
        .map(|d| d.key.as_str())
        .collect();
    let offered: Vec<&DepositDef> = gd.deposits.iter().filter(|d| !d.roll.is_null).collect();
    let families = families(&offered);
    offered
        .into_iter()
        .map(|d| {
            let family = families.get(d.key.as_str()).copied();
            DepositChoice {
                key: d.key.clone(),
                family: family.map_or_else(|| d.key.clone(), str::to_owned),
                amount: family.and_then(|_| amount(d)),
                category: category(gd, d),
                usual: usual.contains(d.key.as_str()),
            }
        })
        .collect()
}

/// `d_energy_3` as its stem `d_energy` and its number 3.
fn numbered(key: &str) -> Option<(&str, &str)> {
    let (stem, number) = key.rsplit_once('_')?;
    (!number.is_empty() && number.bytes().all(|b| b.is_ascii_digit())).then_some((stem, number))
}

/// The resources a type yields, by name.
fn resources(d: &DepositDef) -> BTreeSet<&str> {
    d.produces.iter().map(|(r, _)| r.as_str()).collect()
}

/// Each key that belongs to a family, with the family's stem: two or more numbered keys
/// sharing a stem and the resources they yield.
fn families<'a>(offered: &[&'a DepositDef]) -> HashMap<&'a str, &'a str> {
    let mut by_stem: HashMap<(&str, BTreeSet<&str>), Vec<&str>> = HashMap::new();
    for d in offered {
        if let Some((stem, _)) = numbered(&d.key) {
            by_stem
                .entry((stem, resources(d)))
                .or_default()
                .push(&d.key);
        }
    }
    by_stem
        .into_iter()
        .filter(|(_, keys)| keys.len() > 1)
        .flat_map(|((stem, _), keys)| keys.into_iter().map(move |key| (key, stem)))
        .collect()
}

/// A family member's amount: its one yield, or else its key's number.
fn amount(d: &DepositDef) -> Option<f64> {
    match d.produces.as_slice() {
        [(_, amount)] => Some(*amount),
        _ => numbered(&d.key).and_then(|(_, n)| n.parse().ok()),
    }
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
