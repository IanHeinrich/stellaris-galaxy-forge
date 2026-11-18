//! The modifiers a scenario system's page offers to add: every static modifier an
//! `add_modifier` adds with a system as its scope in the install's initializers, scripted
//! effects, events and on_actions, and those the system's file already holds, less the ones
//! the nebula writes. An initializer's own block and a `system_event` run on their system, a
//! body or anything else they enter is a scope of its own, and `solar_system` and the system
//! iterators enter a system from anywhere. A scripted effect runs in its caller's scope, so its
//! own top level counts only where a system-scope statement calls it. Any other event, and an
//! on_action's `effect`, runs in a scope the walk cannot name; the events an on_action fires
//! are walked as events, not from it.

use std::collections::{BTreeSet, HashMap};

use sgf_core::cst::Node;
use sgf_core::format::save::NEBULA_MODIFIERS;

use crate::GameData;
use crate::install::script::Names;
use crate::install::walk::{self, Branch, Called, Flow, Followed, Script, Statement, Visitor};
use crate::modifier_choices::{ModifierCategory, ModifierChoice};
use crate::scripts::ScriptIndex;
use crate::scripts::index::{EVENTS_DIR, ON_ACTIONS_DIR};
use crate::scripts::scope::{Scopes, is_guard};

/// The blocks of an event whose effects run.
const EVENT_EFFECTS: [&str; 3] = ["immediate", "after", "option"];

/// The scope links that name a system, written alone or at the end of a chain
/// (`capital_scope.solar_system`).
const SYSTEM_LINKS: [&str; 4] = [
    "solar_system",
    "closest_system",
    "last_created_system",
    "target_system",
];

/// What an `every_`, `random_` or `ordered_` iterator that runs on systems iterates, as the
/// game's `effects.log` lists them.
const SYSTEMS_ITERATED: [&str; 11] = [
    "system",
    "neighbor_system",
    "neighbor_system_euclidean",
    "rim_system",
    "system_within_border",
    "system_with_aura",
    "system_within_storm",
    "system_added_to_storm",
    "system_removed_from_storm",
    "system_in_cluster",
    "system_in_cosmic_storm_influence_field",
];

const ITERATORS: [&str; 3] = ["every_", "random_", "ordered_"];

impl GameData {
    /// Every modifier a scenario system's page offers, by key: those the install's
    /// initializers, scripted effects, events and on_actions add to a system, and each of
    /// `present`, the modifiers the system's file already holds. A key of `present` the install
    /// defines no static modifier for is dropped, since the choices are what can be added.
    pub fn system_modifier_choices(&self, present: &[String]) -> Vec<ModifierChoice> {
        let scripted = self
            .system_modifiers
            .get_or_init(|| scripted_system_modifiers(self));
        let mut keys = scripted.clone();
        keys.extend(present.iter().cloned());
        keys.into_iter()
            .filter(|key| !NEBULA_MODIFIERS.contains(&key.as_str()))
            .filter_map(|key| {
                let def = self.static_modifiers.get(&key)?;
                self.choice(&key, None, ModifierCategory::framed(def), Vec::new())
            })
            .collect()
    }
}

/// Where a statement runs, as far as a system's modifiers go.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
enum Scope {
    /// A scope the walk cannot name: a scripted effect's own top level, walked without a
    /// caller, an event other than a `system_event`, or an on_action.
    #[default]
    Unknown,
    System,
    Other,
}

fn opens(key: &str) -> Scope {
    let link = key.rsplit('.').next().unwrap_or(key);
    let iterated = ITERATORS
        .iter()
        .find_map(|prefix| key.strip_prefix(prefix))
        .is_some_and(|rest| SYSTEMS_ITERATED.contains(&rest));
    match iterated || SYSTEM_LINKS.contains(&link) {
        true => Scope::System,
        false => Scope::Other,
    }
}

/// Every modifier key a system-scope `add_modifier` names, through each initializer's block,
/// scripted effect, event and on_action, with the effects they call followed. A key a caller
/// leaves a `$param$` in is no key.
fn scripted_system_modifiers(gd: &GameData) -> BTreeSet<String> {
    let mut walk = SystemModifiers {
        scripts: &gd.scripts,
        root: Scope::Unknown,
        followed: HashMap::new(),
        found: BTreeSet::new(),
    };
    let system = Scopes::new(Scope::System);
    for init in gd.initializers.iter() {
        if let Some(def) = gd.initializers.spliced(&init.name) {
            walk::block(&mut walk, &Script::of_def(def), &system, &def.node);
        }
    }
    let unknown = Scopes::new(Scope::Unknown);
    for effect in gd.scripts.effects() {
        walk::block(&mut walk, &Script::of_def(effect), &unknown, &effect.node);
    }
    for (dir, blocks) in [
        (EVENTS_DIR, &EVENT_EFFECTS[..]),
        (ON_ACTIONS_DIR, &["effect"]),
    ] {
        for file in gd.layout.files_in(dir) {
            let Some(parsed) = gd.scripts.parsed(&file) else {
                continue;
            };
            let (src, root) = (&parsed.src[..], &parsed.root);
            let names = Names::of_file(root.children(), src, gd.variables.clone());
            let script = Script::of_file(src, names);
            for top in root.children() {
                walk.root = match top.key_str(src) {
                    Some("system_event") if dir == EVENTS_DIR => Scope::System,
                    _ => Scope::Unknown,
                };
                let at = Scopes::new(walk.root);
                for node in top.children() {
                    if node.key_str(src).is_some_and(|key| blocks.contains(&key)) {
                        walk::block(&mut walk, &script, &at, node);
                    }
                }
            }
        }
    }
    walk.found
}

struct SystemModifiers<'a> {
    scripts: &'a ScriptIndex,
    /// What `root` names: a `system_event`'s system, else a scope the walk cannot name.
    root: Scope,
    /// The scripted effects followed from each root, scope and scope it was entered from, as
    /// one called from a system adds to it, the same call from a planet does not, and `prev`
    /// in it reads where the caller came from.
    followed: HashMap<(Scope, Scope, Scope), Followed>,
    found: BTreeSet<String>,
}

impl SystemModifiers<'_> {
    /// The scope `key`'s block runs in. `switch` and its cases, `random` and `this` keep the
    /// scope here, which the shared rules leave to each walk.
    fn inside(&self, at: &Scopes<Scope>, key: &str) -> Scopes<Scope> {
        match key {
            "random" | "this" => at.clone(),
            "root" => at.entered(self.root),
            _ => at.descend(key, || opens(key)),
        }
    }
}

impl Visitor for SystemModifiers<'_> {
    type At = Scopes<Scope>;
    type Chain = ();

    fn branch(
        &mut self,
        script: &Script<'_>,
        at: &Scopes<Scope>,
        _: Branch,
        node: &Node,
        _: &mut (),
    ) -> Flow {
        walk::block(self, script, at, node);
        Flow::Go
    }

    fn statement(
        &mut self,
        script: &Script<'_>,
        at: &Scopes<Scope>,
        statement: Statement<'_>,
    ) -> Flow {
        let Statement { key, node, .. } = statement;
        if is_guard(key) {
            return Flow::Go;
        }
        if key == "add_modifier" {
            if *at.here() == Scope::System {
                let named = script.field(node, "modifier");
                self.found.extend(named.filter(|name| !name.contains('$')));
            }
            return Flow::Go;
        }
        if key == "switch" {
            for case in node.children().iter().filter(|c| c.scalar_span().is_none()) {
                walk::block(self, script, at, case);
            }
            return Flow::Go;
        }
        let memo = (self.root, *at.here(), *at.outer());
        let followed = self.followed.entry(memo).or_default();
        match walk::call_once(Some(self.scripts), script, key, node, followed) {
            Called::First(effect, inner) => {
                walk::block(self, &inner, at, &effect.node);
            }
            Called::Again => {}
            Called::Not if node.scalar_span().is_none() => {
                walk::block(self, script, &self.inside(at, key), node);
            }
            Called::Not => {}
        }
        Flow::Go
    }
}
