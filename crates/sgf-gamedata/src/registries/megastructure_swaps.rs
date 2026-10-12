//! The types a stage's `on_build_complete` swaps its finished row for, and on what: the
//! save's global flags and the class of the star it stands at. Gigastructural Engineering
//! builds its star-class Dyson Spheres, Swarms, Matrioshka Brains and Star Lifters this way.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use sgf_core::cst::Node;

use crate::condition::Condition;
use crate::install::script::Def;
use crate::registries::scripted_triggers::ScriptedTriggers;

/// How deep scripted triggers may call each other before a star condition is unresolved.
const MAX_DEPTH: usize = 16;

/// One swap of the finished row, with the conditions every branch on the way to it asks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, rename = "MegastructureSwap")]
pub struct Swap {
    /// The type the row becomes.
    pub into: String,
    /// The global flags the save must have.
    pub flags: Vec<String>,
    /// The global flags the save must not have.
    pub no_flags: Vec<String>,
    /// The classes the star must be one of; `None` for any class.
    pub classes: Option<Vec<String>>,
    /// The classes the star must not be.
    pub not_classes: Vec<String>,
    /// Every condition on the way is one of the above. An unresolved swap is never applied.
    pub resolved: bool,
}

impl Swap {
    /// The swap asks nothing: the completion makes it whatever happens.
    pub fn always(&self) -> bool {
        self.resolved
            && self.flags.is_empty()
            && self.no_flags.is_empty()
            && self.classes.is_none()
            && self.not_classes.is_empty()
    }
}

/// One condition a branch asks, or one this reading cannot state.
#[derive(Debug, Clone, PartialEq)]
enum Term {
    Flag(String, bool),
    Classes(Vec<String>, bool),
    Unresolved,
}

impl Term {
    fn negated(&self) -> Self {
        match self {
            Self::Flag(flag, holds) => Self::Flag(flag.clone(), !holds),
            Self::Classes(classes, holds) => Self::Classes(classes.clone(), !holds),
            Self::Unresolved => Self::Unresolved,
        }
    }
}

/// What a branch's `limit` does not hold: one term negated, else unresolved.
fn negation(terms: &[Term]) -> Term {
    match terms {
        [one] => one.negated(),
        _ => Term::Unresolved,
    }
}

/// Every swap `def`'s `on_build_complete` makes, in the order it is written.
pub(crate) fn read(def: &Def, triggers: &ScriptedTriggers) -> Vec<Swap> {
    let Some(block) = def.node.find("on_build_complete", &def.src) else {
        return Vec::new();
    };
    let mut walk = Walk {
        def,
        triggers,
        out: Vec::new(),
    };
    walk.block(block, &[], false);
    walk.out
}

struct Walk<'a> {
    def: &'a Def,
    triggers: &'a ScriptedTriggers,
    out: Vec<Swap>,
}

impl Walk<'_> {
    /// The swaps below `node`, reached through `terms`; `in_row` once inside `fromfrom`, the
    /// row itself.
    fn block(&mut self, node: &Node, terms: &[Term], in_row: bool) {
        let src = &self.def.src;
        let removes = node.children().iter().any(|child| {
            child.key_str(src) == Some("remove_megastructure")
                && child.scalar_str(src) == Some("fromfrom")
        });
        let mut earlier: Vec<Vec<Term>> = Vec::new();
        for child in node.children() {
            let Some(key) = child.key_str(src) else {
                continue;
            };
            match key {
                "if" => {
                    let own = self.limit(child, in_row);
                    self.block(child, &[terms, own.as_slice()].concat(), in_row);
                    earlier = vec![own];
                }
                "else_if" => {
                    let own = self.limit(child, in_row);
                    let mut reached: Vec<Term> = terms.to_vec();
                    reached.extend(earlier.iter().map(|terms| negation(terms)));
                    reached.extend(own.iter().cloned());
                    self.block(child, &reached, in_row);
                    earlier.push(own);
                }
                "else" => {
                    let mut reached: Vec<Term> = terms.to_vec();
                    reached.extend(earlier.iter().map(|terms| negation(terms)));
                    self.block(child, &reached, in_row);
                    earlier.clear();
                }
                "fromfrom" if !in_row && child.scalar_span().is_none() => {
                    self.block(child, terms, true);
                }
                "upgrade_megastructure_to" if in_row => {
                    if let Some(into) = child.scalar_str(src) {
                        self.out.push(swap(into, terms));
                    }
                }
                "spawn_megastructure" if removes => {
                    if let Some(into) = child.find("type", src).and_then(|t| t.scalar_str(src)) {
                        self.out.push(swap(into, terms));
                    }
                }
                _ => {}
            }
        }
    }

    /// The terms of a branch's `limit`, all of which hold; none without one.
    fn limit(&self, branch: &Node, in_row: bool) -> Vec<Term> {
        let Some(limit) = branch.find("limit", &self.def.src) else {
            return Vec::new();
        };
        self.all(limit, in_row)
    }

    fn all(&self, node: &Node, in_row: bool) -> Vec<Term> {
        node.children()
            .iter()
            .filter(|child| child.key.is_some())
            .flat_map(|child| self.terms(child, in_row))
            .collect()
    }

    fn terms(&self, node: &Node, in_row: bool) -> Vec<Term> {
        let src = &self.def.src;
        let key = node.key_str(src).unwrap_or_default();
        let star = if in_row { "planet" } else { "fromfrom.planet" };
        let block = node.scalar_span().is_none();
        match key.to_ascii_uppercase().as_str() {
            "AND" if block => return self.all(node, in_row),
            "NOT" | "NOR" if block => {
                return node
                    .children()
                    .iter()
                    .filter(|child| child.key.is_some())
                    .map(|child| negation(&self.terms(child, in_row)))
                    .collect();
            }
            "OR" if block => {
                let mut classes = Vec::new();
                for child in node.children().iter().filter(|c| c.key.is_some()) {
                    match self.terms(child, in_row).as_slice() {
                        [Term::Classes(some, true)] => classes.extend(some.iter().cloned()),
                        _ => return vec![Term::Unresolved],
                    }
                }
                return vec![Term::Classes(classes, true)];
            }
            _ => {}
        }
        if key == "has_global_flag" {
            return match node.scalar_str(src) {
                Some(flag) => vec![Term::Flag(flag.to_owned(), true)],
                None => vec![Term::Unresolved],
            };
        }
        if key == star && block {
            return match Condition::of_def(node, self.def) {
                Condition::All(items) => items.iter().map(|item| self.star(item)).collect(),
                _ => vec![Term::Unresolved],
            };
        }
        vec![Term::Unresolved]
    }

    /// What one condition on the star asks of its class.
    fn star(&self, condition: &Condition) -> Term {
        let (inner, holds) = match condition {
            Condition::Not(inner) => (inner.as_ref(), false),
            Condition::Call(name, false) => {
                let called = Condition::Call(name.clone(), true);
                return match self.classes(&called, 0) {
                    Some(classes) => Term::Classes(classes, false),
                    None => Term::Unresolved,
                };
            }
            other => (other, true),
        };
        match self.classes(inner, 0) {
            Some(classes) => Term::Classes(classes, holds),
            None => Term::Unresolved,
        }
    }

    /// The classes `condition` holds for, when it asks nothing but the class.
    fn classes(&self, condition: &Condition, depth: usize) -> Option<Vec<String>> {
        match condition {
            Condition::PlanetClass(class) => Some(vec![class.clone()]),
            Condition::Any(items) => {
                let mut out = Vec::new();
                for item in items {
                    out.extend(self.classes(item, depth)?);
                }
                Some(out)
            }
            Condition::All(items) => match items.as_slice() {
                [one] => self.classes(one, depth),
                _ => None,
            },
            Condition::Call(name, true) if depth < MAX_DEPTH => {
                self.classes(&self.triggers.get(name)?.condition, depth + 1)
            }
            _ => None,
        }
    }
}

fn swap(into: &str, terms: &[Term]) -> Swap {
    let mut out = Swap {
        into: into.to_owned(),
        flags: Vec::new(),
        no_flags: Vec::new(),
        classes: None,
        not_classes: Vec::new(),
        resolved: true,
    };
    for term in terms {
        match term {
            Term::Flag(flag, true) => out.flags.push(flag.clone()),
            Term::Flag(flag, false) => out.no_flags.push(flag.clone()),
            Term::Classes(classes, true) => {
                out.classes = Some(match out.classes.take() {
                    Some(earlier) => earlier
                        .into_iter()
                        .filter(|c| classes.contains(c))
                        .collect(),
                    None => classes.clone(),
                });
            }
            Term::Classes(classes, false) => {
                for class in classes {
                    if !out.not_classes.contains(class) {
                        out.not_classes.push(class.clone());
                    }
                }
            }
            Term::Unresolved => out.resolved = false,
        }
    }
    out
}
