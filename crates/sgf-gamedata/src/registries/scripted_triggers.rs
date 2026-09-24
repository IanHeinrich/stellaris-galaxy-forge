//! `common/scripted_triggers`: named conditions a script calls with `name = yes` or
//! `name = no`, compiled to the planet-scope [`Condition`]s a body the generator has just
//! made can be judged by.

use std::collections::BTreeSet;

use sgf_core::cst::Node;

use crate::install::script::Def;
use crate::registries::planet_classes::PlanetClassDef;
use crate::registries::registry::{FromDef, Registry};

pub type ScriptedTriggers = Registry<ScriptedTrigger>;

/// How deep scripted triggers may call each other before the answer is unknown.
const MAX_DEPTH: usize = 16;

#[derive(Debug, Clone, PartialEq)]
pub struct ScriptedTrigger {
    pub key: String,
    pub condition: Condition,
}

impl FromDef for ScriptedTrigger {
    const DIR: &'static str = "common/scripted_triggers";

    fn read(key: String, def: &Def) -> Self {
        let condition = if parameterised(def) {
            Condition::Unknown(key.clone())
        } else {
            Condition::compile(&def.node, def)
        };
        Self { key, condition }
    }
}

/// A trigger written for `$PARAM$` substitution or `[[PARAM] ... ]` sections, whose meaning
/// depends on what the caller passes.
fn parameterised(def: &Def) -> bool {
    let body = def.node.value_span().slice(&def.src);
    body.contains(&b'$') || body.windows(2).any(|w| w == b"[[")
}

/// A trigger block compiled to what a new, unowned body in a new system can be judged by.
#[derive(Debug, Clone, PartialEq)]
pub enum Condition {
    /// The same for every new body: `always`, `host_has_dlc`, and the nebula, flags,
    /// owner, `planet` scope, modifiers and districts a body only has once the game has run.
    Fixed(bool),
    PlanetClass(String),
    Climate(String),
    Star(bool),
    /// Every star the generator makes counts as primary, and nothing else does.
    PrimaryStar(bool),
    Moon(bool),
    Asteroid(bool),
    Colonizable(bool),
    Size(Comparison, f64),
    /// Among the deposits already drawn for the body.
    HasDeposit(String),
    /// A scripted trigger by name, `= yes` or `= no`.
    Call(String, bool),
    Not(Box<Condition>),
    All(Vec<Condition>),
    Any(Vec<Condition>),
    /// A condition this cannot judge, by its key.
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

    fn holds(self, left: f64, right: f64) -> bool {
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

/// The body a condition is judged against.
#[derive(Debug, Clone, Copy)]
pub struct Subject<'a> {
    pub class: &'a str,
    /// `None` for a class the install does not define.
    pub class_def: Option<&'a PlanetClassDef>,
    pub size: f64,
    pub star: bool,
    pub moon: bool,
    pub deposits: &'a [String],
    pub triggers: &'a ScriptedTriggers,
}

impl Condition {
    /// Compile a block's children, an implicit `AND`.
    pub(crate) fn compile(node: &Node, def: &Def) -> Self {
        Self::All(group(node, def))
    }

    /// A block's children but those keyed `skip`: a `modifier`'s conditions beside its
    /// `factor`.
    pub(crate) fn compile_without(node: &Node, def: &Def, skip: &[&str]) -> Self {
        Self::All(
            node.children()
                .iter()
                .filter(|c| c.key_str(&def.src).is_some_and(|k| !skip.contains(&k)))
                .map(|c| condition(c, def))
                .collect(),
        )
    }

    /// `Some` when the body settles it, `None` when an unknown condition could change the
    /// answer.
    pub fn evaluate(&self, subject: &Subject<'_>) -> Option<bool> {
        self.judge(subject, 0)
    }

    /// The keys of every unknown condition this reaches, through the scripted triggers it
    /// calls; a call to a trigger the install does not define counts by its name.
    pub fn unknown_keys(&self, triggers: &ScriptedTriggers, out: &mut BTreeSet<String>) {
        self.collect_unknown(triggers, &mut BTreeSet::new(), out);
    }

    fn judge(&self, s: &Subject<'_>, depth: usize) -> Option<bool> {
        let class = s.class_def;
        match self {
            Self::Fixed(holds) => Some(*holds),
            Self::PlanetClass(key) => Some(s.class == key),
            Self::Climate(climate) => Some(class?.climate.as_deref() == Some(climate)),
            Self::Star(want) | Self::PrimaryStar(want) => Some(s.star == *want),
            Self::Moon(want) => Some(s.moon == *want),
            Self::Asteroid(want) => Some(class?.asteroid == *want),
            Self::Colonizable(want) => Some(class?.colonizable == *want),
            Self::Size(cmp, n) => Some(cmp.holds(s.size, *n)),
            Self::HasDeposit(key) => Some(s.deposits.iter().any(|d| d == key)),
            Self::Call(name, want) => {
                if depth >= MAX_DEPTH {
                    return None;
                }
                let called = s.triggers.get(name)?;
                called
                    .condition
                    .judge(s, depth + 1)
                    .map(|holds| holds == *want)
            }
            Self::Not(inner) => inner.judge(s, depth).map(|holds| !holds),
            Self::All(items) => settle(items, s, depth, false),
            Self::Any(items) => settle(items, s, depth, true),
            Self::Unknown(_) => None,
        }
    }

    fn collect_unknown(
        &self,
        triggers: &ScriptedTriggers,
        seen: &mut BTreeSet<String>,
        out: &mut BTreeSet<String>,
    ) {
        match self {
            Self::Unknown(key) => {
                out.insert(key.clone());
            }
            Self::Call(name, _) => match triggers.get(name) {
                Some(called) => {
                    if seen.insert(name.clone()) {
                        called.condition.collect_unknown(triggers, seen, out);
                    }
                }
                None => {
                    out.insert(name.clone());
                }
            },
            Self::Not(inner) => inner.collect_unknown(triggers, seen, out),
            Self::All(items) | Self::Any(items) => {
                for item in items {
                    item.collect_unknown(triggers, seen, out);
                }
            }
            _ => {}
        }
    }
}

/// Kleene logic: `deciding` (`false` for `All`, `true` for `Any`) settles the connective
/// outright; otherwise an unknown item leaves it unknown.
fn settle(items: &[Condition], s: &Subject<'_>, depth: usize, deciding: bool) -> Option<bool> {
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

/// A block's keyed children compiled; bare items such as `optimize_memory` say nothing.
fn group(node: &Node, def: &Def) -> Vec<Condition> {
    node.children()
        .iter()
        .filter(|child| child.key.is_some())
        .map(|child| condition(child, def))
        .collect()
}

fn condition(node: &Node, def: &Def) -> Condition {
    let src = &def.src;
    let Some(key) = node.key_str(src) else {
        return Condition::Unknown(String::new());
    };
    let value = node.scalar_str(src);
    let yes = match value {
        Some("yes") => Some(true),
        Some("no") => Some(false),
        _ => None,
    };
    let unknown = || Condition::Unknown(key.to_owned());
    let block = |make: fn(Vec<Condition>) -> Condition| match value {
        None => make(group(node, def)),
        Some(_) => unknown(),
    };
    let flag = |make: fn(bool) -> Condition| yes.map_or_else(unknown, make);
    let named = |make: fn(String) -> Condition| value.map_or_else(unknown, |v| make(v.to_owned()));
    match key {
        "AND" => block(Condition::All),
        "OR" => block(Condition::Any),
        "NOT" | "NOR" => block(|items| Condition::Not(Box::new(Condition::Any(items)))),
        "NAND" => block(|items| Condition::Not(Box::new(Condition::All(items)))),
        "always" => flag(Condition::Fixed),
        "host_has_dlc" => Condition::Fixed(true),
        "is_inside_nebula" => flag(|yes| Condition::Fixed(!yes)),
        "has_star_flag" | "has_planet_flag" | "has_origin" | "has_modifier" | "has_building"
        | "exists" | "owner" | "planet" | "solar_system" | "num_free_districts" => {
            Condition::Fixed(false)
        }
        "is_planet_class" => named(Condition::PlanetClass),
        "has_climate" => named(Condition::Climate),
        "has_deposit" => named(Condition::HasDeposit),
        "is_star" => flag(Condition::Star),
        "is_primary_star" => flag(Condition::PrimaryStar),
        "is_moon" => flag(Condition::Moon),
        "is_asteroid" => flag(Condition::Asteroid),
        "is_colonizable" => flag(Condition::Colonizable),
        "planet_size" => size(node, def).unwrap_or_else(unknown),
        _ => match yes {
            Some(want) => Condition::Call(key.to_owned(), want),
            None => unknown(),
        },
    }
}

/// `planet_size < 15`: the operator is whatever the file writes between key and value.
fn size(node: &Node, def: &Def) -> Option<Condition> {
    let key = node.key?;
    let value = node.scalar_span()?;
    let op = std::str::from_utf8(def.src.get(key.end..value.start)?).ok()?;
    let cmp = Comparison::parse(op.trim())?;
    let n = def.number_of(node.scalar_str(&def.src)?)?;
    Some(Condition::Size(cmp, n))
}
