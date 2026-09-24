//! The deposits a body the generator made would plausibly roll, by the install's own
//! rules: each deposit's `potential` and `drop_weight`, the draw counts in the defines,
//! and the galaxy's Resource Abundance.
//!
//! A star gets one draw that is never empty. Any other body the game cannot colonise gets
//! one draw, where `d_null_deposit` means none and every other weight is scaled by the
//! abundance. A habitable world draws `7 + 0.4 × size` times, is topped up to
//! `5 + 0.2 × size`, and then gets the minimum blockers and other deposits the defines
//! ask for. At abundance 0 nothing is rolled.

use sgf_core::cst::Node;

use crate::GameData;
use crate::install::script::Def;
use crate::registries::deposits::DepositDef;
use crate::registries::planet_classes::PlanetClassDef;
use crate::registries::scripted_triggers::{Condition, Subject};

/// What a habitable world's non-null weights are multiplied by, whatever the setting:
/// fitted to the saves, where habitable worlds roll the same from 0.25x to 5x.
const HABITABLE_FACTOR: f64 = 2.0;

/// A body the generator has made.
#[derive(Debug, Clone, Copy)]
pub struct RollBody<'a> {
    pub class: &'a str,
    pub size: u32,
    pub star: bool,
    pub moon: bool,
}

/// What the roll reads from a deposit definition.
#[derive(Debug, Clone, PartialEq)]
pub struct DepositRoll {
    /// `is_null = yes`: drawing it means the body gets nothing.
    pub is_null: bool,
    /// `is_for_colonizable`, which the roll reads as `no` when it is absent.
    pub for_colonizable: bool,
    pub potential: Option<Condition>,
    pub drop_weight: DropWeight,
}

/// `drop_weight`: the base `weight`, times every top-level `factor`, then each `modifier`
/// whose conditions hold, in order.
#[derive(Debug, Clone, PartialEq)]
pub struct DropWeight {
    pub base: f64,
    pub factor: f64,
    pub modifiers: Vec<WeightModifier>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WeightModifier {
    pub when: Condition,
    pub factor: Option<f64>,
    pub add: Option<f64>,
    /// Replaces the weight so far.
    pub weight: Option<f64>,
}

impl DepositRoll {
    pub(crate) fn read(def: &Def) -> Self {
        let src = &def.src;
        Self {
            is_null: def.flag("is_null"),
            for_colonizable: def.flag("is_for_colonizable"),
            potential: def
                .node
                .find("potential", src)
                .map(|node| Condition::compile(node, def)),
            drop_weight: def
                .node
                .find("drop_weight", src)
                .map_or_else(DropWeight::default, |node| DropWeight::read(node, def)),
        }
    }
}

impl Default for DropWeight {
    fn default() -> Self {
        Self {
            base: 1.0,
            factor: 1.0,
            modifiers: Vec::new(),
        }
    }
}

impl DropWeight {
    fn read(node: &Node, def: &Def) -> Self {
        let src = &def.src;
        let number = |node: &Node, key: &str| def.number_of(node.find(key, src)?.scalar_str(src)?);
        let base = number(node, "weight")
            .or_else(|| number(node, "base"))
            .unwrap_or(1.0);
        let factor = node
            .find_all("factor", src)
            .filter_map(|f| def.number_of(f.scalar_str(src)?))
            .product();
        let modifiers = node
            .find_all("modifier", src)
            .map(|m| WeightModifier {
                when: Condition::compile_without(m, def, &["factor", "add", "weight"]),
                factor: number(m, "factor"),
                add: number(m, "add"),
                weight: number(m, "weight"),
            })
            .collect();
        Self {
            base,
            factor,
            modifiers,
        }
    }

    /// The weight for `subject`; a modifier whose conditions cannot be judged is skipped.
    pub fn weight(&self, subject: &Subject<'_>) -> f64 {
        let mut weight = self.base * self.factor;
        for modifier in &self.modifiers {
            if modifier.when.evaluate(subject) != Some(true) {
                continue;
            }
            if let Some(factor) = modifier.factor {
                weight *= factor;
            }
            if let Some(add) = modifier.add {
                weight += add;
            }
            if let Some(set) = modifier.weight {
                weight = set;
            }
        }
        weight
    }
}

/// The deposit keys `body` rolls at `abundance`, the save's `galaxy.resource_abundance`
/// ([`crate::registries::defines::DepositDefines::abundance`] gives the fallback).
/// `unit` returns numbers in `[0, 1)`; the same stream gives the same deposits.
pub fn roll_deposits(
    gd: &GameData,
    body: &RollBody<'_>,
    abundance: f64,
    unit: &mut impl FnMut() -> f64,
) -> Vec<String> {
    if abundance <= 0.0 {
        return Vec::new();
    }
    let class_def = gd.planet_classes.get(body.class);
    let colonizable = !body.star && class_def.is_some_and(|c| c.colonizable);
    let defines = &gd.deposit_defines;
    let size = f64::from(body.size);
    let mut roll = Roll {
        gd,
        body,
        class_def,
        colonizable,
        factor: if colonizable {
            HABITABLE_FACTOR
        } else {
            abundance
        },
        have: Vec::new(),
        unit,
    };

    if body.star {
        roll.draw(false, Part::Any);
    } else if colonizable {
        for _ in 0..defines.colony.draws(size) {
            roll.draw(true, Part::Any);
        }
        while roll.have.len() < defines.colony.minimum(size) && roll.draw(false, Part::Any) {}
        while (roll.count(true) as f64) < defines.min_blocked && roll.draw(false, Part::Blockers) {}
        while (roll.count(false) as f64) < defines.min_unblocked && roll.draw(false, Part::Others) {
        }
    } else {
        let null = abundance < defines.abundance_max;
        for _ in 0..defines.non_colony.draws(size) {
            roll.draw(null, Part::Any);
        }
    }
    roll.have
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Part {
    Any,
    Blockers,
    Others,
}

struct Roll<'a, U> {
    gd: &'a GameData,
    body: &'a RollBody<'a>,
    class_def: Option<&'a PlanetClassDef>,
    colonizable: bool,
    factor: f64,
    have: Vec<String>,
    unit: &'a mut U,
}

impl<'a, U: FnMut() -> f64> Roll<'a, U> {
    /// Draw once from the pool; `false` when the pool was empty.
    fn draw(&mut self, null: bool, part: Part) -> bool {
        let pool = self.pool(null, part);
        let total: f64 = pool.iter().map(|(_, w)| w).sum();
        if total <= 0.0 {
            return false;
        }
        let mut pick = (self.unit)() * total;
        let mut drawn = pool.last().map(|(d, _)| *d);
        for (deposit, weight) in &pool {
            if pick < *weight {
                drawn = Some(*deposit);
                break;
            }
            pick -= weight;
        }
        if let Some(deposit) = drawn
            && !deposit.roll.is_null
        {
            self.have.push(deposit.key.clone());
        }
        true
    }

    fn pool(&self, null: bool, part: Part) -> Vec<(&'a DepositDef, f64)> {
        let gd: &'a GameData = self.gd;
        let subject = Subject {
            class: self.body.class,
            class_def: self.class_def,
            size: f64::from(self.body.size),
            star: self.body.star,
            moon: self.body.moon,
            deposits: &self.have,
            triggers: &gd.scripted_triggers,
        };
        gd.deposits
            .iter()
            .filter(|d| match d.roll.is_null {
                true => null,
                false => d.roll.for_colonizable == self.colonizable,
            })
            .filter(|d| match part {
                Part::Any => true,
                Part::Blockers => !d.roll.is_null && self.blocker(d),
                Part::Others => !d.roll.is_null && !self.blocker(d),
            })
            .filter(|d| {
                d.roll
                    .potential
                    .as_ref()
                    .is_none_or(|p| p.evaluate(&subject) == Some(true))
            })
            .filter_map(|d| {
                let weight = d.roll.drop_weight.weight(&subject);
                let weight = if d.roll.is_null {
                    weight
                } else {
                    weight * self.factor
                };
                (weight > 0.0).then_some((d, weight))
            })
            .collect()
    }

    fn blocker(&self, deposit: &DepositDef) -> bool {
        deposit
            .category
            .as_deref()
            .and_then(|c| self.gd.deposit_categories.get(c))
            .is_some_and(|c| c.blocker)
    }

    /// The deposits drawn so far that are blockers, or that are not.
    fn count(&self, blockers: bool) -> usize {
        self.have
            .iter()
            .filter_map(|key| self.gd.deposits.get(key))
            .filter(|d| self.blocker(d) == blockers)
            .count()
    }
}
