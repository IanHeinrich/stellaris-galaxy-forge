//! A weight block as the install writes one: a layout's `usage_odds` and a deposit's
//! `drop_weight`. A base, times every top-level `factor`, then each `modifier` whose
//! conditions hold, in order.

use sgf_core::cst::Node;

use crate::condition::{Condition, Subject};
use crate::install::script::Def;

/// Whether a `modifier` that writes both `factor` and `add` multiplies before it adds. No
/// vanilla modifier writes both.
pub const FACTOR_BEFORE_ADD: bool = true;

#[derive(Debug, Clone, PartialEq)]
pub struct Weight {
    pub base: f64,
    /// Every top-level `factor`, multiplied together.
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

impl Weight {
    /// `node`'s `weight` or `base`, or `base` when it writes neither.
    pub(crate) fn read(node: &Node, def: &Def, base: f64) -> Self {
        let src = &def.src;
        let number = |node: &Node, key: &str| def.number_of(node.find(key, src)?.scalar_str(src)?);
        Self {
            base: number(node, "weight")
                .or_else(|| number(node, "base"))
                .unwrap_or(base),
            factor: node
                .find_all("factor", src)
                .filter_map(|f| def.number_of(f.scalar_str(src)?))
                .product(),
            modifiers: node
                .find_all("modifier", src)
                .map(|m| WeightModifier {
                    when: Condition::of_def_without(m, def, &["factor", "add", "weight"]),
                    factor: number(m, "factor"),
                    add: number(m, "add"),
                    weight: number(m, "weight"),
                })
                .collect(),
        }
    }

    /// A fixed weight with no modifiers.
    pub fn fixed(base: f64) -> Self {
        Self {
            base,
            factor: 1.0,
            modifiers: Vec::new(),
        }
    }

    /// The weight for `subject`; a modifier whose conditions it cannot settle is skipped.
    pub fn evaluate(&self, subject: &dyn Subject) -> f64 {
        let mut weight = self.base * self.factor;
        for modifier in &self.modifiers {
            if modifier.when.evaluate(subject) != Some(true) {
                continue;
            }
            let factor = modifier.factor.unwrap_or(1.0);
            let add = modifier.add.unwrap_or(0.0);
            weight = match FACTOR_BEFORE_ADD {
                true => weight * factor + add,
                false => (weight + add) * factor,
            };
            if let Some(set) = modifier.weight {
                weight = set;
            }
        }
        weight
    }
}
