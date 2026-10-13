//! A trigger block (a `limit`, a `potential`, a weight's `modifier`, a scripted trigger's
//! body) compiled once to the conditions this crate can judge, and judged against what a
//! caller knows: the DLC a save was played with, a body the generator has just made, a
//! scenario system's flags, or what an effect walk has run so far. What the subject cannot
//! answer is unknown, and the connectives fold it in three-valued logic.

use std::borrow::Cow;
use std::collections::BTreeSet;

use sgf_core::cst::Node;

use crate::install::script::{Def, written};
use crate::install::walk::Script;
use crate::registries::scripted_triggers::ScriptedTriggers;

/// How deep scripted triggers may call each other before the answer is unknown.
pub(crate) const MAX_DEPTH: usize = 16;

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
    /// `is_country_type = …`.
    CountryType(String),
    /// `exists = …`: `starbase`, `event_target:name`, or another scope.
    Exists(String),
    InsideNebula(bool),
    PlanetClass(String),
    /// `is_star_class = sc_…`: the class of the system's star.
    StarClass(String),
    Climate(String),
    Star(bool),
    PrimaryStar(bool),
    Moon(bool),
    Asteroid(bool),
    Colonizable(bool),
    Size(Comparison, f64),
    /// `num_modifiers`: how many planet features the planet has.
    Modifiers(Comparison, f64),
    HasDeposit(String),
    /// `has_modifier = …`: a timed or permanent modifier of the subject.
    HasModifier(String),
    /// `has_planet_flag = …`.
    PlanetFlag(String),
    /// `has_deposit_for = …`: a deposit worked by that station class.
    DepositFor(String),
    /// `is_megastructure_type = …`, read in an effect walk.
    MegastructureType(String),
    /// `graphical_culture = …`, read in an effect walk.
    GraphicalCulture(String),
    /// `check_variable = { which = … value > … }`, read in an effect walk.
    CheckVariable {
        which: String,
        cmp: Comparison,
        value: f64,
    },
    /// A block under any other key, read in an effect walk: the scope the key leads to, and
    /// what must hold there.
    Scoped(String, Box<Condition>),
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
            walk: None,
        }
        .block(node, &[])
    }

    /// A block of an effect script as a walk standing in `script` reads it: its keys and
    /// values with the walk's parameters put in, its numbers as the file names them, the
    /// leaves only a walk judges read, and each block under another key kept as a
    /// [`Self::Scoped`].
    pub(crate) fn in_walk(node: &Node, script: &Script<'_>) -> Self {
        Compiler {
            src: script.src(),
            number: &|text| script.number_of(text),
            walk: Some(script),
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
            walk: None,
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
                let Some(called) = s.triggers().and_then(|triggers| triggers.get(name)) else {
                    return s.leaf(self);
                };
                if depth >= MAX_DEPTH {
                    return None;
                }
                called
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
                        if subject.leaf(self).is_none() {
                            out.insert(name.clone());
                        }
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
            Self::Call(name, _) | Self::Unknown(name) | Self::Scoped(name, _) => name,
            Self::StarFlag(_) => "has_star_flag",
            Self::GlobalFlag(_) => "has_global_flag",
            Self::CountryType(_) => "is_country_type",
            Self::Exists(_) => "exists",
            Self::InsideNebula(_) => "is_inside_nebula",
            Self::PlanetClass(_) => "is_planet_class",
            Self::StarClass(_) => "is_star_class",
            Self::Climate(_) => "has_climate",
            Self::Star(_) => "is_star",
            Self::PrimaryStar(_) => "is_primary_star",
            Self::Moon(_) => "is_moon",
            Self::Asteroid(_) => "is_asteroid",
            Self::Colonizable(_) => "is_colonizable",
            Self::Size(..) => "planet_size",
            Self::Modifiers(..) => "num_modifiers",
            Self::HasDeposit(_) => "has_deposit",
            Self::HasModifier(_) => "has_modifier",
            Self::PlanetFlag(_) => "has_planet_flag",
            Self::DepositFor(_) => "has_deposit_for",
            Self::MegastructureType(_) => "is_megastructure_type",
            Self::GraphicalCulture(_) => "graphical_culture",
            Self::CheckVariable { .. } => "check_variable",
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

/// What the connective `key` makes of its items, its case as the game ignores it.
fn connective(key: &str) -> Option<fn(Vec<Condition>) -> Condition> {
    let make: fn(Vec<Condition>) -> Condition = match key.to_ascii_uppercase().as_str() {
        "AND" => Condition::All,
        "OR" => Condition::Any,
        "NOT" | "NOR" => |items| Condition::Not(Box::new(Condition::Any(items))),
        "NAND" => |items| Condition::Not(Box::new(Condition::All(items))),
        _ => return None,
    };
    Some(make)
}

struct Compiler<'a> {
    src: &'a [u8],
    number: &'a dyn Fn(&str) -> Option<f64>,
    /// The walk an effect script's block is read in.
    walk: Option<&'a Script<'a>>,
}

impl Compiler<'_> {
    fn put<'t>(&self, text: &'t str) -> Cow<'t, str> {
        match self.walk {
            Some(walk) => walk.put(text),
            None => Cow::Borrowed(text),
        }
    }

    /// A block's keyed children but those keyed `skip`, an implicit `AND`; bare items such as
    /// `optimize_memory` say nothing. A scalar where a block belongs is unknown.
    fn block(&self, node: &Node, skip: &[&str]) -> Condition {
        if node.scalar_span().is_some() {
            return Condition::Unknown(node.key_str(self.src).unwrap_or_default().to_owned());
        }
        Condition::All(self.group(node, skip))
    }

    fn group(&self, node: &Node, skip: &[&str]) -> Vec<Condition> {
        let items = node.children();
        (0..items.len())
            .filter(|&at| {
                items[at]
                    .key_str(self.src)
                    .is_some_and(|key| !skip.contains(&key))
            })
            .map(|at| self.condition(items, at))
            .collect()
    }

    /// The condition `siblings[at]` writes, read with the statements that follow it when
    /// they are the rest of its inline maths.
    fn condition(&self, siblings: &[Node], at: usize) -> Condition {
        let node = &siblings[at];
        let key = self.put(node.key_str(self.src).unwrap_or_default());
        let key = key.as_ref();
        let value = node.scalar_str(self.src).map(|v| self.put(v));
        let value = value.as_deref();
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
        if let Some(make) = connective(key) {
            return block(make);
        }
        if self.walk.is_some() {
            match key {
                "is_megastructure_type" => return named(Condition::MegastructureType),
                "graphical_culture" => return named(Condition::GraphicalCulture),
                "check_variable" => return self.check_variable(node).unwrap_or_else(unknown),
                _ => {}
            }
        }
        match key {
            "always" => flag(Condition::Always),
            "host_has_dlc" => named(Condition::HostDlc),
            "has_star_flag" => named(Condition::StarFlag),
            "has_global_flag" => named(Condition::GlobalFlag),
            "is_country_type" => named(Condition::CountryType),
            "exists" => named(Condition::Exists),
            "is_inside_nebula" => flag(Condition::InsideNebula),
            "is_planet_class" => named(Condition::PlanetClass),
            "is_star_class" => named(Condition::StarClass),
            "has_climate" => named(Condition::Climate),
            "has_deposit" => named(Condition::HasDeposit),
            "has_modifier" => named(Condition::HasModifier),
            "has_planet_flag" => named(Condition::PlanetFlag),
            "has_deposit_for" => named(Condition::DepositFor),
            "is_star" => flag(Condition::Star),
            "is_primary_star" => flag(Condition::PrimaryStar),
            "is_moon" => flag(Condition::Moon),
            "is_asteroid" => flag(Condition::Asteroid),
            "is_colonizable" => flag(Condition::Colonizable),
            "planet_size" => self.size(siblings, at).unwrap_or_else(unknown),
            "num_modifiers" => self
                .comparison(siblings, at)
                .map(|(cmp, n)| Condition::Modifiers(cmp, n))
                .unwrap_or_else(unknown),
            _ => match (yes, value) {
                (Some(want), _) => Condition::Call(key.to_owned(), want),
                (None, None) if self.walk.is_some() => {
                    Condition::Scoped(key.to_owned(), Box::new(block(Condition::All)))
                }
                _ => unknown(),
            },
        }
    }

    /// `check_variable = { which = … value > … }`.
    fn check_variable(&self, node: &Node) -> Option<Condition> {
        let which = self.put(node.find("which", self.src)?.scalar_str(self.src)?);
        let items = node.children();
        let at = items
            .iter()
            .position(|item| item.key_str(self.src) == Some("value"))?;
        let (cmp, value) = self.comparison(items, at)?;
        Some(Condition::CheckVariable {
            which: which.into_owned(),
            cmp,
            value,
        })
    }

    /// `planet_size < 15`: the operator is whatever the file writes between key and value.
    fn size(&self, siblings: &[Node], at: usize) -> Option<Condition> {
        let (cmp, n) = self.comparison(siblings, at)?;
        Some(Condition::Size(cmp, n))
    }

    /// The operator and number of `key < n`.
    fn comparison(&self, siblings: &[Node], at: usize) -> Option<(Comparison, f64)> {
        let node = &siblings[at];
        let key = node.key?;
        let value = node.scalar_span()?;
        let op = std::str::from_utf8(self.src.get(key.end..value.start)?).ok()?;
        let cmp = Comparison::parse(op.trim())?;
        let n = (self.number)(&self.put(&written(siblings, at, self.src)?))?;
        Some((cmp, n))
    }
}
