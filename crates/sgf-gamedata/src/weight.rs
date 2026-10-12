//! A weight block as the install writes one: a layout's `usage_odds`, a deposit's
//! `drop_weight`, an anomaly's `spawn_chance` and a dig site's `weight`. A base, times every
//! top-level `factor`, then each `modifier` whose conditions hold, in order.

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
    /// The weight `parent`'s `key` writes, `None` when it writes none. Its `weight` or `base`,
    /// or `base` when it writes neither. A `key` that is a number is a fixed weight.
    pub(crate) fn read(parent: &Node, key: &str, def: &Def, base: f64) -> Option<Self> {
        let src = &def.src;
        let node = parent.find(key, src)?;
        if node.scalar_str(src).is_some() {
            return Some(Self::fixed(def.number_in(parent, key).unwrap_or(base)));
        }
        let number = |node: &Node, key: &str| def.number_in(node, key);
        let children = node.children();
        Some(Self {
            base: number(node, "weight")
                .or_else(|| number(node, "base"))
                .unwrap_or(base),
            factor: (0..children.len())
                .filter(|&at| children[at].key_str(src) == Some("factor"))
                .filter_map(|at| def.number_at(node, at))
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
        })
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
            if modifier.when.evaluate(subject) == Some(true) {
                weight = modifier.apply(weight);
            }
        }
        weight
    }

    /// The weight for `subject` when it settles every modifier's conditions; `None` when it
    /// cannot settle one.
    pub fn settled(&self, subject: &dyn Subject) -> Option<f64> {
        let mut weight = self.base * self.factor;
        for modifier in &self.modifiers {
            if modifier.when.evaluate(subject)? {
                weight = modifier.apply(weight);
            }
        }
        Some(weight)
    }

    /// Whether some subject like `subject` could draw a weight above zero: every modifier
    /// whose conditions could hold adds, and only those that surely hold multiply or set it.
    pub fn could_be_positive(&self, subject: &dyn Subject) -> bool {
        let mut weight = self.base * self.factor;
        for modifier in &self.modifiers {
            match modifier.when.evaluate(subject) {
                Some(true) => weight = modifier.apply(weight),
                Some(false) => {}
                None => weight += modifier.add.unwrap_or(0.0),
            }
        }
        weight > 0.0
    }

    /// Whether any subject could draw a weight above zero: it starts above zero, or a
    /// modifier adds or sets one.
    pub fn ever_positive(&self) -> bool {
        self.base * self.factor > 0.0
            || self
                .modifiers
                .iter()
                .any(|m| m.add.is_some_and(|a| a > 0.0) || m.weight.is_some_and(|w| w > 0.0))
    }
}

impl WeightModifier {
    /// `weight` after this modifier, its conditions holding.
    fn apply(&self, weight: f64) -> f64 {
        if let Some(set) = self.weight {
            return set;
        }
        let factor = self.factor.unwrap_or(1.0);
        let add = self.add.unwrap_or(0.0);
        match FACTOR_BEFORE_ADD {
            true => weight * factor + add,
            false => (weight + add) * factor,
        }
    }
}
