//! The types a stage's `on_build_complete` swaps its finished row for, and on what: the
//! save's global flags and the class of the star it stands at. Gigastructural Engineering
//! builds its star-class Dyson Spheres, Swarms, Matrioshka Brains and Star Lifters this way.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use sgf_core::cst::Node;

use crate::condition::{Condition, MAX_DEPTH};
use crate::install::script::Def;
use crate::install::walk::{self, Branch, Flow, Script, Statement, Visitor};
use crate::registries::megastructures::MegastructureTypes;
use crate::registries::scripted_triggers::ScriptedTriggers;

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

    /// Whether the completion makes this swap in a save with the global `flags`, the row
    /// standing at the clicked body of class `class`: a star's class for a swap that tests it,
    /// `None` in empty space or where the class is not known.
    pub fn holds(&self, class: Option<&str>, flags: &[String]) -> bool {
        let flagged = |flag: &String| flags.contains(flag);
        self.resolved
            && self.flags.iter().all(flagged)
            && !self.no_flags.iter().any(flagged)
            && self
                .classes
                .as_ref()
                .is_none_or(|classes| class.is_some_and(|class| classes.iter().any(|c| c == class)))
            && class.is_none_or(|class| !self.not_classes.iter().any(|c| c == class))
    }
}

/// The type the game makes of a finished row of type `kind` added at the clicked body of class
/// `class`, `None` in empty space, in a save with the global `flags`. The stage nearest
/// `kind` back through each stage's first `upgrade_from` whose completion swaps its row, with
/// a swap that holds, starts a chain: the type swapped in, then each type first built over the
/// one before. The type made is the one as many stages along that chain as `kind` is past the
/// swapping stage. It is `kind` itself when no stage on the way swaps, none of the nearest
/// one's swaps holds, the chain is too short, or `kind` is on the chain already, made only by
/// the swap.
pub fn made_at(
    types: &MegastructureTypes,
    kind: &str,
    class: Option<&str>,
    flags: &[String],
) -> String {
    let mut at = kind;
    let mut past = 0;
    let mut seen = vec![kind];
    let swaps = loop {
        let Some(def) = types.get(at) else {
            return kind.to_owned();
        };
        if !def.swaps.is_empty() {
            break &def.swaps;
        }
        match def.upgrade_from.first() {
            Some(from) if !seen.contains(&from.as_str()) => {
                at = from;
                past += 1;
                seen.push(from);
            }
            _ => return kind.to_owned(),
        }
    };
    let Some(swap) = swaps.iter().find(|swap| swap.holds(class, flags)) else {
        return kind.to_owned();
    };
    let chain = swap_chain(types, &swap.into);
    if chain.contains(&kind) {
        return kind.to_owned();
    }
    chain
        .get(past)
        .map_or_else(|| kind.to_owned(), |&made| made.to_owned())
}

/// `into`, then each type first built over the one before, ruins and repairs left out.
fn swap_chain<'t>(types: &'t MegastructureTypes, into: &'t str) -> Vec<&'t str> {
    let mut chain = Vec::new();
    let mut at = types.get(into).map(|def| def.key.as_str());
    while let Some(key) = at {
        chain.push(key);
        at = types
            .iter()
            .filter(|def| def.variant_of.is_none())
            .find(|def| {
                def.upgrade_from.first().map(String::as_str) == Some(key)
                    && !chain.contains(&def.key.as_str())
            })
            .map(|def| def.key.as_str());
    }
    chain
}

/// Every swap `def`'s `on_build_complete` makes, in the order it is written.
pub(crate) fn read(def: &Def, triggers: &ScriptedTriggers) -> Vec<Swap> {
    let Some(block) = def.node.find("on_build_complete", &def.src) else {
        return Vec::new();
    };
    let script = Script::of_def(def);
    let mut swaps = Swaps {
        triggers,
        out: Vec::new(),
    };
    let at = At {
        guard: Vec::new(),
        in_row: false,
        removes: removes_row(block, &script),
    };
    walk::block(&mut swaps, &script, &at, block);
    swaps.out
}

struct Swaps<'a> {
    triggers: &'a ScriptedTriggers,
    out: Vec<Swap>,
}

/// Where the swap walk stands.
#[derive(Clone)]
struct At {
    /// The conditions every branch on the way asks, each of the row's own read as asked
    /// from `fromfrom`.
    guard: Vec<Condition>,
    /// Inside `fromfrom`, the row itself.
    in_row: bool,
    /// The block removes the row with `remove_megastructure = fromfrom`.
    removes: bool,
}

impl At {
    fn inside(&self, node: &Node, script: &Script<'_>, guard: Vec<Condition>) -> Self {
        Self {
            guard: [self.guard.as_slice(), guard.as_slice()].concat(),
            in_row: self.in_row,
            removes: removes_row(node, script),
        }
    }

    /// `condition` as asked from where the walk started.
    fn asked(&self, condition: Condition) -> Condition {
        match self.in_row {
            true => Condition::Scoped(ROW.to_owned(), Box::new(condition)),
            false => condition,
        }
    }
}

impl Visitor for Swaps<'_> {
    type At = At;
    /// The `limit` of each earlier branch of the chain.
    type Chain = Vec<Condition>;

    fn branch(
        &mut self,
        script: &Script<'_>,
        at: &At,
        branch: Branch,
        node: &Node,
        earlier: &mut Vec<Condition>,
    ) -> Flow {
        let not_earlier = Condition::Not(Box::new(Condition::Any(earlier.clone())));
        match branch {
            Branch::If | Branch::ElseIf => {
                let limit = node
                    .find("limit", script.src())
                    .map_or(Condition::All(Vec::new()), |limit| {
                        Condition::in_walk(limit, script)
                    });
                let limit = at.asked(limit);
                let inner = at.inside(node, script, vec![not_earlier, limit.clone()]);
                walk::block(self, script, &inner, node);
                earlier.push(limit);
            }
            Branch::Else => {
                walk::block(
                    self,
                    script,
                    &at.inside(node, script, vec![not_earlier]),
                    node,
                );
                earlier.clear();
            }
        }
        Flow::Go
    }

    fn statement(&mut self, script: &Script<'_>, at: &At, statement: Statement<'_>) -> Flow {
        let Statement { key, value, node } = statement;
        let into = match key {
            ROW if !at.in_row && node.scalar_span().is_none() => {
                let mut inner = at.inside(node, script, Vec::new());
                inner.in_row = true;
                walk::block(self, script, &inner, node);
                None
            }
            "upgrade_megastructure_to" if at.in_row => value.map(str::to_owned),
            "spawn_megastructure" if at.removes => script.field(node, "type"),
            _ => None,
        };
        if let Some(into) = into {
            let swap = swap(into, &at.guard, self.triggers);
            self.out.push(swap);
        }
        Flow::Go
    }
}

/// The scope a stage's completion names its row by.
const ROW: &str = "fromfrom";

/// Whether block `node` removes the row its completion runs for.
pub(crate) fn removes_row(node: &Node, script: &Script<'_>) -> bool {
    script.children(node).iter().any(|kept| {
        script.key(kept.node).as_deref() == Some("remove_megastructure")
            && script.kept_value(kept).as_deref() == Some(ROW)
    })
}

fn swap(into: String, guard: &[Condition], triggers: &ScriptedTriggers) -> Swap {
    let mut out = Swap {
        into,
        flags: Vec::new(),
        no_flags: Vec::new(),
        classes: None,
        not_classes: Vec::new(),
        resolved: true,
    };
    let reading = Reading {
        triggers,
        in_row: false,
    };
    for condition in guard {
        reading.add(&mut out, condition, true);
    }
    out
}

/// How a swap reads its conditions: as asked of the completion's scope or of the row.
#[derive(Clone, Copy)]
struct Reading<'a> {
    triggers: &'a ScriptedTriggers,
    in_row: bool,
}

impl Reading<'_> {
    /// The scope the star is asked in.
    fn star(&self) -> &'static str {
        if self.in_row {
            "planet"
        } else {
            "fromfrom.planet"
        }
    }

    fn row(&self) -> Self {
        Self {
            in_row: true,
            ..*self
        }
    }

    /// Put into `out` that `condition` holds, or that it does not when `holds` is false; a
    /// swap whose condition is no flag or star class, or that holds only in part, is
    /// unresolved.
    fn add(&self, out: &mut Swap, condition: &Condition, holds: bool) {
        match condition {
            Condition::Not(inner) => self.add(out, inner, !holds),
            Condition::All(items) if holds => {
                items.iter().for_each(|item| self.add(out, item, true));
            }
            Condition::Any(items) if !holds => {
                items.iter().for_each(|item| self.add(out, item, false));
            }
            Condition::All(items) | Condition::Any(items) if items.len() == 1 => {
                self.add(out, &items[0], holds);
            }
            Condition::Any(items) => {
                let classes: Option<Vec<Vec<String>>> =
                    items.iter().map(|item| self.classes_held(item)).collect();
                match classes {
                    Some(classes) => restrict(out, &classes.concat(), true),
                    None => out.resolved = false,
                }
            }
            Condition::GlobalFlag(flag) if holds => out.flags.push(flag.clone()),
            Condition::GlobalFlag(flag) => out.no_flags.push(flag.clone()),
            Condition::Scoped(key, inner) if key == ROW && !self.in_row => {
                self.row().add(out, inner, holds);
            }
            Condition::Scoped(key, inner) if key == self.star() => {
                let Condition::All(items) = &**inner else {
                    out.resolved = false;
                    return;
                };
                if !holds && items.len() != 1 {
                    out.resolved = false;
                    return;
                }
                for item in items {
                    match self.star_classes(item) {
                        Some((classes, held)) => restrict(out, &classes, held == holds),
                        None => out.resolved = false,
                    }
                }
            }
            _ => out.resolved = false,
        }
    }

    /// The classes the star must be one of for `condition` to hold, when it asks only that.
    fn classes_held(&self, condition: &Condition) -> Option<Vec<String>> {
        match condition {
            Condition::All(items) if items.len() == 1 => self.classes_held(&items[0]),
            Condition::Any(items) => {
                let mut out = Vec::new();
                for item in items {
                    out.extend(self.classes_held(item)?);
                }
                Some(out)
            }
            Condition::Scoped(key, inner) if key == ROW && !self.in_row => {
                self.row().classes_held(inner)
            }
            Condition::Scoped(key, inner) if key == self.star() => match &**inner {
                Condition::All(items) if items.len() == 1 => match self.star_classes(&items[0]) {
                    Some((classes, true)) => Some(classes),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        }
    }

    /// What one condition on the star asks of its class: the classes, and whether the star
    /// must be one of them or none.
    fn star_classes(&self, condition: &Condition) -> Option<(Vec<String>, bool)> {
        match condition {
            Condition::Not(inner) => Some((self.classes(inner, 0)?, false)),
            Condition::Call(name, false) => {
                let called = Condition::Call(name.clone(), true);
                Some((self.classes(&called, 0)?, false))
            }
            other => Some((self.classes(other, 0)?, true)),
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

/// The star must be one of `classes`, or when `held` is false none of them.
fn restrict(out: &mut Swap, classes: &[String], held: bool) {
    if held {
        out.classes = Some(match out.classes.take() {
            Some(earlier) => earlier
                .into_iter()
                .filter(|c| classes.contains(c))
                .collect(),
            None => classes.to_vec(),
        });
    } else {
        for class in classes {
            if !out.not_classes.contains(class) {
                out.not_classes.push(class.clone());
            }
        }
    }
}
