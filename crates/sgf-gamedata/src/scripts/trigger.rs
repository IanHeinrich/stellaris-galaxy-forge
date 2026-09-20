//! A guard (a `limit` or `trigger` block) compiled to the few conditions
//! this editor can judge, and evaluated against one system's facts.
//!
//! Anything else compiles to [`Trigger::Unknown`], which holds: a claim is
//! shown rather than silently dropped. It taints the verdict as `assumed`
//! only where the rest of the expression did not settle the matter anyway.

use std::collections::BTreeSet;

use sgf_core::cst::Node;

/// What a guard says about a system.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Trigger {
    StarFlag(String),
    GlobalFlag(String),
    Starbase,
    EventTarget(String),
    Not(Box<Trigger>),
    All(Vec<Trigger>),
    Any(Vec<Trigger>),
    Unknown,
}

/// What a guard is judged against: the system's own facts and the
/// galaxy-wide sets every initializer has already contributed to.
#[derive(Debug, Clone, Copy)]
pub struct Facts<'a> {
    pub star_flags: &'a BTreeSet<String>,
    pub global_flags: &'a BTreeSet<String>,
    /// Targets some chain saved, for `exists = event_target:X`.
    pub saved_targets: &'a BTreeSet<String>,
    pub has_starbase: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Verdict {
    pub holds: bool,
    /// The verdict rests on a condition this editor cannot judge.
    pub assumed: bool,
}

impl Verdict {
    const fn definite(holds: bool) -> Self {
        Self {
            holds,
            assumed: false,
        }
    }
}

impl Trigger {
    /// Compile a `limit = { … }` / `trigger = { … }` node. Its children are
    /// an implicit `AND`.
    pub fn compile(node: &Node, src: &[u8]) -> Self {
        match group(node, src) {
            Some(items) => Self::All(items),
            None => Self::Unknown,
        }
    }

    pub fn evaluate(&self, facts: &Facts<'_>) -> Verdict {
        match self {
            Self::StarFlag(flag) => Verdict::definite(facts.star_flags.contains(flag)),
            Self::GlobalFlag(flag) => Verdict::definite(facts.global_flags.contains(flag)),
            Self::Starbase => Verdict::definite(facts.has_starbase),
            Self::EventTarget(token) => Verdict::definite(facts.saved_targets.contains(token)),
            Self::Not(inner) => {
                let inner = inner.evaluate(facts);
                Verdict {
                    holds: !inner.holds,
                    assumed: inner.assumed,
                }
            }
            Self::All(items) => combine(items, facts, false),
            Self::Any(items) => combine(items, facts, true),
            Self::Unknown => Verdict {
                holds: true,
                assumed: true,
            },
        }
    }
}

/// `deciding` is the value that settles the connective outright: `false` for
/// `All`, `true` for `Any`. Reaching it definitely ends the matter, so an
/// unjudgeable sibling only taints a verdict it could have changed.
fn combine(items: &[Trigger], facts: &Facts<'_>, deciding: bool) -> Verdict {
    let mut decided = false;
    let mut assumed = false;
    for item in items {
        let verdict = item.evaluate(facts);
        if verdict.holds == deciding {
            if !verdict.assumed {
                return Verdict::definite(deciding);
            }
            decided = true;
        }
        assumed |= verdict.assumed;
    }
    Verdict {
        holds: if decided { deciding } else { !deciding },
        assumed,
    }
}

fn condition(node: &Node, src: &[u8]) -> Trigger {
    let Some(key) = node.key_str(src) else {
        return Trigger::Unknown;
    };
    match key {
        "has_star_flag" => named(node, src, Trigger::StarFlag),
        "has_global_flag" => named(node, src, Trigger::GlobalFlag),
        "exists" => exists(node, src),
        // `NOT` holds when none of its children do, as `NOR` does.
        "NOT" | "NOR" => match group(node, src) {
            Some(items) => Trigger::Not(Box::new(Trigger::Any(items))),
            None => Trigger::Unknown,
        },
        "OR" => match group(node, src) {
            Some(items) => Trigger::Any(items),
            None => Trigger::Unknown,
        },
        "AND" => match group(node, src) {
            Some(items) => Trigger::All(items),
            None => Trigger::Unknown,
        },
        _ => Trigger::Unknown,
    }
}

/// The compiled children of a block; `None` for a scalar, which no
/// connective this reads is written as.
fn group(node: &Node, src: &[u8]) -> Option<Vec<Trigger>> {
    if node.scalar_span().is_some() {
        return None;
    }
    Some(node.children().iter().map(|c| condition(c, src)).collect())
}

fn named(node: &Node, src: &[u8], make: fn(String) -> Trigger) -> Trigger {
    match node.scalar_str(src) {
        Some(value) => make(value.to_owned()),
        None => Trigger::Unknown,
    }
}

fn exists(node: &Node, src: &[u8]) -> Trigger {
    match node.scalar_str(src) {
        Some("starbase") => Trigger::Starbase,
        Some(value) => match value.strip_prefix("event_target:") {
            Some(token) => Trigger::EventTarget(token.to_owned()),
            None => Trigger::Unknown,
        },
        None => Trigger::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use sgf_core::cst;

    fn compile(src: &str) -> Trigger {
        let bytes = src.as_bytes();
        let root = cst::parse_script(bytes, 0).expect("parse_script");
        let limit = root.find("limit", bytes).expect("limit");
        Trigger::compile(limit, bytes)
    }

    fn set(items: &[&str]) -> BTreeSet<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    fn flag(name: &str) -> Trigger {
        Trigger::StarFlag(name.to_owned())
    }

    #[test]
    fn the_conditions_it_knows_compile_and_everything_else_is_unknown() {
        assert_eq!(
            compile(
                "limit = {\n\thas_star_flag = claimed\n\thas_global_flag = spawned\n\texists = starbase\n\texists = event_target:empire\n\tis_capital = yes\n\texists = no\n}\n"
            ),
            Trigger::All(vec![
                flag("claimed"),
                Trigger::GlobalFlag("spawned".to_owned()),
                Trigger::Starbase,
                Trigger::EventTarget("empire".to_owned()),
                Trigger::Unknown,
                Trigger::Unknown,
            ])
        );
    }

    #[test]
    fn connectives_nest_and_a_bare_block_is_an_implicit_and() {
        assert_eq!(
            compile(
                "limit = {\n\tNOT = { exists = starbase }\n\tOR = { has_star_flag = a AND = { has_global_flag = b } }\n\tNOR = { has_star_flag = c has_star_flag = d }\n}\n"
            ),
            Trigger::All(vec![
                Trigger::Not(Box::new(Trigger::Any(vec![Trigger::Starbase]))),
                Trigger::Any(vec![
                    flag("a"),
                    Trigger::All(vec![Trigger::GlobalFlag("b".to_owned())]),
                ]),
                Trigger::Not(Box::new(Trigger::Any(vec![flag("c"), flag("d")]))),
            ])
        );
    }

    #[test]
    fn a_compiled_guard_reads_the_facts() {
        let star_flags = set(&["claimed"]);
        let global_flags = set(&["spawned"]);
        let saved_targets = set(&["empire"]);
        let facts = Facts {
            star_flags: &star_flags,
            global_flags: &global_flags,
            saved_targets: &saved_targets,
            has_starbase: false,
        };
        let guard = compile(
            "limit = {\n\tNOT = { exists = starbase }\n\thas_star_flag = claimed\n\thas_global_flag = spawned\n\texists = event_target:empire\n}\n",
        );
        assert_eq!(guard.evaluate(&facts), Verdict::definite(true));

        let walled = Facts {
            has_starbase: true,
            ..facts
        };
        assert_eq!(guard.evaluate(&walled), Verdict::definite(false));

        let unflagged = BTreeSet::new();
        let bare = Facts {
            star_flags: &unflagged,
            ..facts
        };
        assert_eq!(guard.evaluate(&bare), Verdict::definite(false));
    }

    #[test]
    fn an_unjudgeable_condition_taints_only_a_verdict_it_could_have_changed() {
        let star_flags = set(&["present"]);
        let empty = BTreeSet::new();
        let facts = Facts {
            star_flags: &star_flags,
            global_flags: &empty,
            saved_targets: &empty,
            has_starbase: false,
        };
        let cases = [
            (
                Trigger::All(vec![flag("absent"), Trigger::Unknown]),
                Verdict {
                    holds: false,
                    assumed: false,
                },
            ),
            (
                Trigger::All(vec![flag("present"), Trigger::Unknown]),
                Verdict {
                    holds: true,
                    assumed: true,
                },
            ),
            (
                Trigger::Any(vec![flag("present"), Trigger::Unknown]),
                Verdict {
                    holds: true,
                    assumed: false,
                },
            ),
            (
                Trigger::Any(vec![flag("absent"), Trigger::Unknown]),
                Verdict {
                    holds: true,
                    assumed: true,
                },
            ),
            (
                Trigger::Not(Box::new(Trigger::All(vec![
                    flag("absent"),
                    Trigger::Unknown,
                ]))),
                Verdict {
                    holds: true,
                    assumed: false,
                },
            ),
            (
                Trigger::Not(Box::new(Trigger::Unknown)),
                Verdict {
                    holds: false,
                    assumed: true,
                },
            ),
        ];
        for (trigger, want) in cases {
            assert_eq!(trigger.evaluate(&facts), want, "{trigger:?}");
        }
    }
}
