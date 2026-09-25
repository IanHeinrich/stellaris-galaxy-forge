//! A trigger block (a `limit`, a `potential`, a weight's `modifier`, a scripted trigger's
//! body) compiled once to the conditions this crate can judge, and judged against what a
//! caller knows: the DLC a save was played with, a body the generator has just made, or a
//! scenario system's flags. What the subject cannot answer is unknown, and the connectives
//! fold it in three-valued logic.

use std::collections::BTreeSet;

use sgf_core::cst::Node;

use crate::install::script::Def;
use crate::registries::scripted_triggers::ScriptedTriggers;

/// How deep scripted triggers may call each other before the answer is unknown.
const MAX_DEPTH: usize = 16;

#[derive(Debug, Clone, PartialEq)]
pub enum Condition {
    /// `always = yes` or `no`.
    Always(bool),
    /// `host_has_dlc = "…"`, named as the save's `required_dlcs` names it.
    HostDlc(String),
    /// A scripted trigger by name, `= yes` or `= no`.
    Call(String, bool),
    StarFlag(String),
    GlobalFlag(String),
    /// `exists = …`: `starbase`, `event_target:name`, or another scope.
    Exists(String),
    InsideNebula(bool),
    PlanetClass(String),
    Climate(String),
    Star(bool),
    PrimaryStar(bool),
    Moon(bool),
    Asteroid(bool),
    Colonizable(bool),
    Size(Comparison, f64),
    HasDeposit(String),
    Not(Box<Condition>),
    All(Vec<Condition>),
    Any(Vec<Condition>),
    /// Any other condition, by its key: a cluster, the galaxy's setup, a neighbour.
    Unknown(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Comparison {
    Less,
    LessOrEqual,
    Greater,
    GreaterOrEqual,
    Equal,
    NotEqual,
}

impl Comparison {
    fn parse(op: &str) -> Option<Self> {
        Some(match op {
            "<" => Self::Less,
            "<=" => Self::LessOrEqual,
            ">" => Self::Greater,
            ">=" => Self::GreaterOrEqual,
            "=" | "==" | "?=" => Self::Equal,
            "!=" => Self::NotEqual,
            _ => return None,
        })
    }

    pub fn holds(self, left: f64, right: f64) -> bool {
        match self {
            Self::Less => left < right,
            Self::LessOrEqual => left <= right,
            Self::Greater => left > right,
            Self::GreaterOrEqual => left >= right,
            Self::Equal => left == right,
            Self::NotEqual => left != right,
        }
    }
}

/// What a condition is judged against.
pub trait Subject {
    /// The answer to a condition that is no connective, or a call when there are no
    /// [`Self::triggers`]; `None` when this subject cannot judge it.
    fn leaf(&self, leaf: &Condition) -> Option<bool>;

    /// The scripted triggers a call is judged through.
    fn triggers(&self) -> Option<&ScriptedTriggers> {
        None
    }
}

impl Condition {
    /// A block's keyed children, all of which must hold, with numbers as written; a guard
    /// written as a scalar is unknown.
    pub fn compile(node: &Node, src: &[u8]) -> Self {
        Compiler {
            src,
            number: &|text| text.parse().ok(),
        }
        .block(node, &[])
    }

    /// A definition's block, its `@variables` substituted.
    pub(crate) fn of_def(node: &Node, def: &Def) -> Self {
        Self::of_def_without(node, def, &[])
    }

    /// A definition's block but its children keyed `skip`: a weight `modifier`'s conditions
    /// beside its `factor` and `add`.
    pub(crate) fn of_def_without(node: &Node, def: &Def, skip: &[&str]) -> Self {
        Compiler {
            src: &def.src,
            number: &|text| def.number_of(text),
        }
        .block(node, skip)
    }

    /// `Some` when `subject` settles it, `None` when a condition it cannot judge could
    /// change the answer.
    pub fn evaluate(&self, subject: &dyn Subject) -> Option<bool> {
        self.judge(subject, 0)
    }

    fn judge(&self, s: &dyn Subject, depth: usize) -> Option<bool> {
        match self {
            Self::Always(holds) => Some(*holds),
            Self::Not(inner) => inner.judge(s, depth).map(|holds| !holds),
            Self::All(items) => settle(items, s, depth, false),
            Self::Any(items) => settle(items, s, depth, true),
            Self::Call(name, want) => {
                let Some(triggers) = s.triggers() else {
                    return s.leaf(self);
                };
                if depth >= MAX_DEPTH {
                    return None;
                }
                triggers
                    .get(name)?
                    .condition
                    .judge(s, depth + 1)
                    .map(|holds| holds == *want)
            }
            leaf => s.leaf(leaf),
        }
    }

    /// The keys of every condition `subject` cannot judge, through the scripted triggers it
    /// calls; a call to a trigger the install does not define counts by its name.
    pub fn unknown_keys(&self, subject: &dyn Subject, out: &mut BTreeSet<String>) {
        self.collect_unknown(subject, &mut BTreeSet::new(), out);
    }

    fn collect_unknown(
        &self,
        subject: &dyn Subject,
        seen: &mut BTreeSet<String>,
        out: &mut BTreeSet<String>,
    ) {
        match self {
            Self::Always(_) => {}
            Self::Not(inner) => inner.collect_unknown(subject, seen, out),
            Self::All(items) | Self::Any(items) => {
                for item in items {
                    item.collect_unknown(subject, seen, out);
                }
            }
            Self::Call(name, _) if subject.triggers().is_some() => {
                match subject.triggers().and_then(|t| t.get(name)) {
                    Some(called) => {
                        if seen.insert(name.clone()) {
                            called.condition.collect_unknown(subject, seen, out);
                        }
                    }
                    None => {
                        out.insert(name.clone());
                    }
                }
            }
            leaf => {
                if subject.leaf(leaf).is_none() {
                    out.insert(leaf.key().to_owned());
                }
            }
        }
    }

    /// Every DLC the condition names, directly or through a trigger that checks nothing
    /// else.
    pub(crate) fn dlcs(&self, triggers: &ScriptedTriggers, out: &mut Vec<String>) {
        let named = match self {
            Self::HostDlc(dlc) => Some(dlc.clone()),
            Self::Call(name, _) => triggers.get(name).and_then(|t| t.host_dlc.clone()),
            Self::Not(inner) => return inner.dlcs(triggers, out),
            Self::All(items) | Self::Any(items) => {
                return items.iter().for_each(|c| c.dlcs(triggers, out));
            }
            _ => None,
        };
        if let Some(dlc) = named
            && !out.contains(&dlc)
        {
            out.push(dlc);
        }
    }

    /// The script key this condition is written with.
    pub fn key(&self) -> &str {
        match self {
            Self::Always(_) => "always",
            Self::HostDlc(_) => "host_has_dlc",
            Self::Call(name, _) | Self::Unknown(name) => name,
            Self::StarFlag(_) => "has_star_flag",
            Self::GlobalFlag(_) => "has_global_flag",
            Self::Exists(_) => "exists",
            Self::InsideNebula(_) => "is_inside_nebula",
            Self::PlanetClass(_) => "is_planet_class",
            Self::Climate(_) => "has_climate",
            Self::Star(_) => "is_star",
            Self::PrimaryStar(_) => "is_primary_star",
            Self::Moon(_) => "is_moon",
            Self::Asteroid(_) => "is_asteroid",
            Self::Colonizable(_) => "is_colonizable",
            Self::Size(..) => "planet_size",
            Self::HasDeposit(_) => "has_deposit",
            Self::Not(_) => "NOT",
            Self::All(_) => "AND",
            Self::Any(_) => "OR",
        }
    }
}

/// Kleene logic: `deciding` (`false` for `All`, `true` for `Any`) settles the connective
/// outright; otherwise an unknown item leaves it unknown.
fn settle(items: &[Condition], s: &dyn Subject, depth: usize, deciding: bool) -> Option<bool> {
    let mut unknown = false;
    for item in items {
        match item.judge(s, depth) {
            Some(holds) if holds == deciding => return Some(deciding),
            Some(_) => {}
            None => unknown = true,
        }
    }
    (!unknown).then_some(!deciding)
}

struct Compiler<'a> {
    src: &'a [u8],
    number: &'a dyn Fn(&str) -> Option<f64>,
}

impl Compiler<'_> {
    /// A block's keyed children but those keyed `skip`, an implicit `AND`; bare items such as
    /// `optimize_memory` say nothing. A scalar where a block belongs is unknown.
    fn block(&self, node: &Node, skip: &[&str]) -> Condition {
        if node.scalar_span().is_some() {
            return Condition::Unknown(node.key_str(self.src).unwrap_or_default().to_owned());
        }
        Condition::All(self.group(node, skip))
    }

    fn group(&self, node: &Node, skip: &[&str]) -> Vec<Condition> {
        node.children()
            .iter()
            .filter(|c| c.key_str(self.src).is_some_and(|key| !skip.contains(&key)))
            .map(|c| self.condition(c))
            .collect()
    }

    fn condition(&self, node: &Node) -> Condition {
        let key = node.key_str(self.src).unwrap_or_default();
        let value = node.scalar_str(self.src);
        let yes = match value {
            Some("yes") => Some(true),
            Some("no") => Some(false),
            _ => None,
        };
        let unknown = || Condition::Unknown(key.to_owned());
        let block = |make: fn(Vec<Condition>) -> Condition| match value {
            None => make(self.group(node, &[])),
            Some(_) => unknown(),
        };
        let flag = |make: fn(bool) -> Condition| yes.map_or_else(unknown, make);
        let named =
            |make: fn(String) -> Condition| value.map_or_else(unknown, |v| make(v.to_owned()));
        match key {
            "AND" => block(Condition::All),
            "OR" => block(Condition::Any),
            "NOT" | "NOR" => block(|items| Condition::Not(Box::new(Condition::Any(items)))),
            "NAND" => block(|items| Condition::Not(Box::new(Condition::All(items)))),
            "always" => flag(Condition::Always),
            "host_has_dlc" => named(Condition::HostDlc),
            "has_star_flag" => named(Condition::StarFlag),
            "has_global_flag" => named(Condition::GlobalFlag),
            "exists" => named(Condition::Exists),
            "is_inside_nebula" => flag(Condition::InsideNebula),
            "is_planet_class" => named(Condition::PlanetClass),
            "has_climate" => named(Condition::Climate),
            "has_deposit" => named(Condition::HasDeposit),
            "is_star" => flag(Condition::Star),
            "is_primary_star" => flag(Condition::PrimaryStar),
            "is_moon" => flag(Condition::Moon),
            "is_asteroid" => flag(Condition::Asteroid),
            "is_colonizable" => flag(Condition::Colonizable),
            "planet_size" => self.size(node).unwrap_or_else(unknown),
            _ => match yes {
                Some(want) => Condition::Call(key.to_owned(), want),
                None => unknown(),
            },
        }
    }

    /// `planet_size < 15`: the operator is whatever the file writes between key and value.
    fn size(&self, node: &Node) -> Option<Condition> {
        let key = node.key?;
        let value = node.scalar_span()?;
        let op = std::str::from_utf8(self.src.get(key.end..value.start)?).ok()?;
        let cmp = Comparison::parse(op.trim())?;
        let n = (self.number)(node.scalar_str(self.src)?)?;
        Some(Condition::Size(cmp, n))
    }
}
