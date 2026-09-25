//! A guard (a `limit` or `trigger` block) judged against one scenario system's facts.
//!
//! A condition the facts cannot answer holds: a claim is shown rather than silently
//! dropped. It taints the verdict as `assumed` only where the rest of the expression did
//! not settle the matter anyway.

use std::collections::BTreeSet;

use crate::condition::{Condition, Subject};

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

impl Subject for Facts<'_> {
    fn leaf(&self, leaf: &Condition) -> Option<bool> {
        match leaf {
            Condition::StarFlag(flag) => Some(self.star_flags.contains(flag)),
            Condition::GlobalFlag(flag) => Some(self.global_flags.contains(flag)),
            Condition::Exists(scope) if scope == "starbase" => Some(self.has_starbase),
            Condition::Exists(scope) => scope
                .strip_prefix("event_target:")
                .map(|token| self.saved_targets.contains(token)),
            _ => None,
        }
    }
}

/// The facts with every condition they cannot judge taken to hold.
struct Assuming<'f, 'a>(&'f Facts<'a>);

impl Subject for Assuming<'_, '_> {
    fn leaf(&self, leaf: &Condition) -> Option<bool> {
        self.0.leaf(leaf).or(Some(true))
    }
}

impl Condition {
    /// Whether the guard holds for `facts`, a condition they cannot judge taken to hold.
    pub fn verdict(&self, facts: &Facts<'_>) -> Verdict {
        match self.evaluate(facts) {
            Some(holds) => Verdict::definite(holds),
            None => Verdict {
                holds: self.evaluate(&Assuming(facts)).unwrap_or(true),
                assumed: true,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use sgf_core::cst;

    fn compile(src: &str) -> Condition {
        let bytes = src.as_bytes();
        let root = cst::parse_script(bytes, 0).expect("parse_script");
        let limit = root.find("limit", bytes).expect("limit");
        Condition::compile(limit, bytes)
    }

    fn set(items: &[&str]) -> BTreeSet<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    fn flag(name: &str) -> Condition {
        Condition::StarFlag(name.to_owned())
    }

    #[test]
    fn the_conditions_it_knows_compile_and_the_facts_judge_only_theirs() {
        assert_eq!(
            compile(
                "limit = {\n\thas_star_flag = claimed\n\thas_global_flag = spawned\n\texists = starbase\n\texists = event_target:empire\n\tis_capital = yes\n\texists = no\n}\n"
            ),
            Condition::All(vec![
                flag("claimed"),
                Condition::GlobalFlag("spawned".to_owned()),
                Condition::Exists("starbase".to_owned()),
                Condition::Exists("event_target:empire".to_owned()),
                Condition::Call("is_capital".to_owned(), true),
                Condition::Exists("no".to_owned()),
            ])
        );
        let none = BTreeSet::new();
        let facts = Facts {
            star_flags: &none,
            global_flags: &none,
            saved_targets: &none,
            has_starbase: false,
        };
        for unjudged in [
            Condition::Call("is_capital".to_owned(), true),
            Condition::Exists("no".to_owned()),
        ] {
            assert_eq!(
                unjudged.verdict(&facts),
                Verdict {
                    holds: true,
                    assumed: true
                },
                "{unjudged:?}"
            );
        }
    }

    #[test]
    fn connectives_nest_and_a_bare_block_is_an_implicit_and() {
        assert_eq!(
            compile(
                "limit = {\n\tNOT = { exists = starbase }\n\tOR = { has_star_flag = a AND = { has_global_flag = b } }\n\tNOR = { has_star_flag = c has_star_flag = d }\n}\n"
            ),
            Condition::All(vec![
                Condition::Not(Box::new(Condition::Any(vec![Condition::Exists(
                    "starbase".to_owned()
                )]))),
                Condition::Any(vec![
                    flag("a"),
                    Condition::All(vec![Condition::GlobalFlag("b".to_owned())]),
                ]),
                Condition::Not(Box::new(Condition::Any(vec![flag("c"), flag("d")]))),
            ])
        );
    }

    #[test]
    fn always_is_settled_whatever_the_facts() {
        let none = BTreeSet::new();
        let facts = Facts {
            star_flags: &none,
            global_flags: &none,
            saved_targets: &none,
            has_starbase: false,
        };
        let never = compile("limit = {\n\talways = no\n}\n");
        assert_eq!(never.verdict(&facts), Verdict::definite(false));
        let always = compile("limit = {\n\talways = yes\n}\n");
        assert_eq!(always.verdict(&facts), Verdict::definite(true));
    }

    #[test]
    fn a_guard_written_as_a_scalar_is_assumed() {
        let bytes = b"limit = yes\n";
        let root = cst::parse_script(bytes, 0).expect("parse_script");
        let limit = root.find("limit", bytes).expect("limit");
        let none = BTreeSet::new();
        let facts = Facts {
            star_flags: &none,
            global_flags: &none,
            saved_targets: &none,
            has_starbase: false,
        };
        assert!(Condition::compile(limit, bytes).verdict(&facts).assumed);
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
        assert_eq!(guard.verdict(&facts), Verdict::definite(true));

        let walled = Facts {
            has_starbase: true,
            ..facts
        };
        assert_eq!(guard.verdict(&walled), Verdict::definite(false));

        let unflagged = BTreeSet::new();
        let bare = Facts {
            star_flags: &unflagged,
            ..facts
        };
        assert_eq!(guard.verdict(&bare), Verdict::definite(false));
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
                Condition::All(vec![
                    flag("absent"),
                    Condition::Unknown("is_in_cluster".to_owned()),
                ]),
                Verdict {
                    holds: false,
                    assumed: false,
                },
            ),
            (
                Condition::All(vec![
                    flag("present"),
                    Condition::Unknown("is_in_cluster".to_owned()),
                ]),
                Verdict {
                    holds: true,
                    assumed: true,
                },
            ),
            (
                Condition::Any(vec![
                    flag("present"),
                    Condition::Unknown("is_in_cluster".to_owned()),
                ]),
                Verdict {
                    holds: true,
                    assumed: false,
                },
            ),
            (
                Condition::Any(vec![
                    flag("absent"),
                    Condition::Unknown("is_in_cluster".to_owned()),
                ]),
                Verdict {
                    holds: true,
                    assumed: true,
                },
            ),
            (
                Condition::Not(Box::new(Condition::All(vec![
                    flag("absent"),
                    Condition::Unknown("is_in_cluster".to_owned()),
                ]))),
                Verdict {
                    holds: true,
                    assumed: false,
                },
            ),
            (
                Condition::Not(Box::new(Condition::Unknown("is_in_cluster".to_owned()))),
                Verdict {
                    holds: false,
                    assumed: true,
                },
            ),
        ];
        for (trigger, want) in cases {
            assert_eq!(trigger.verdict(&facts), want, "{trigger:?}");
        }
    }
}
