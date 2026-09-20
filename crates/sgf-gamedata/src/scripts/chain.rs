//! What a system's `init_effect` chain does: who it gives the system to,
//! which flags and event targets it sets, which scripted effects it calls
//! and which initializers it spawns.
//!
//! Unlike [`crate::initializers`], which only wants the `create_country`
//! blocks, this descends into `planet` and `moon` bodies: the mod route
//! writes `set_owner` inside a planet's own `init_effect`.

use std::collections::{HashSet, VecDeque};
use std::path::Path;

use sgf_core::cst::{self, Node};

use crate::initializers::Initializers;
use crate::scripts::index::ScriptIndex;
use crate::scripts::scope::{is_call, is_country_scope, keeps_scope};
use crate::scripts::view::ScriptRef;

/// How far `neighbor_system` / `spawn_system` chains are followed.
const SPAWN_DEPTH: usize = 4;
const SPAWN_LIMIT: usize = 64;

/// Bodies that still describe this system, the branches every script walk
/// keeps aside. Anything else (a country, a fleet, an ambient object,
/// another system) is a scope of its own, and a target saved there names
/// that, not the system the walk started in.
const SYSTEM_BODIES: [&str; 7] = [
    "planet",
    "moon",
    "star",
    "solar_system",
    "random_system_planet",
    "every_system_planet",
    "any_system_planet",
];

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Chain {
    /// `event_target:` tokens the chain gives the system to.
    pub owner_tokens: Vec<String>,
    /// Owner statements that name a scope; the literal text, for the user.
    pub unresolved: Vec<String>,
    pub saved_targets: Vec<(String, ScriptRef)>,
    /// The subset of `saved_targets` saved without leaving the system's own
    /// scope: the only ones a script naming them is talking about this system by.
    pub system_targets: Vec<String>,
    pub star_flags: Vec<String>,
    pub global_flags: Vec<String>,
    pub planet_flags: Vec<String>,
    /// `(country flag, token)` from a `random_country`-style scope.
    pub country_flag_targets: Vec<(String, String)>,
    pub called_effects: Vec<String>,
    /// The chain plants a starbase, whoever it belongs to.
    pub has_starbase: bool,
    /// Initializers this one places nearby, transitively, nearest first.
    pub spawned: Vec<String>,
}

impl Chain {
    fn push(list: &mut Vec<String>, value: &str) {
        if !value.is_empty() && !list.iter().any(|v| v == value) {
            list.push(value.to_owned());
        }
    }
}

/// Walk `name`'s body, the scripted effects it calls one level deep, and the
/// initializers it spawns.
pub fn walk(index: &ScriptIndex, initializers: &Initializers, name: &str) -> Chain {
    let mut walk = Walk {
        index,
        chain: Chain::default(),
        expanded: HashSet::new(),
    };
    if let Some(def) = initializers.def(name) {
        let scope = Scope {
            src: &def.src,
            file: Some(&def.file),
            expand: true,
            in_system: true,
        };
        walk.collect(&def.node, scope);
    }
    let mut chain = walk.chain;
    if let Some(init) = initializers.get(name) {
        for flag in &init.flags {
            Chain::push(&mut chain.star_flags, flag);
        }
        chain.has_starbase |= init.starbase.is_some();
    }
    chain.spawned = spawned(initializers, name);
    chain
}

/// The same walk over a scenario system statement's own `effect = { … }`,
/// which runs where the initializer's chain leaves off and so describes the
/// same system. Unparsable text contributes nothing.
pub fn walk_effect(index: &ScriptIndex, text: &str) -> Chain {
    let src = text.as_bytes();
    let Ok(root) = cst::parse_script(src, 0) else {
        return Chain::default();
    };
    let mut walk = Walk {
        index,
        chain: Chain::default(),
        expanded: HashSet::new(),
    };
    let scope = Scope {
        src,
        file: None,
        expand: true,
        in_system: true,
    };
    walk.collect(&root, scope);
    walk.chain
}

#[derive(Clone, Copy)]
struct Scope<'a> {
    src: &'a [u8],
    /// `None` for the scenario document, which is not a game-data file.
    file: Option<&'a Path>,
    /// Scripted effect bodies are expanded at the initializer's level only.
    expand: bool,
    /// Every block open since the initializer still describes this system.
    in_system: bool,
}

impl Scope<'_> {
    fn descend(self, key: &str) -> Self {
        Self {
            in_system: self.in_system && keeps_system_scope(key),
            ..self
        }
    }
}

fn keeps_system_scope(key: &str) -> bool {
    SYSTEM_BODIES.contains(&key) || keeps_scope(key)
}

struct Walk<'a> {
    index: &'a ScriptIndex,
    chain: Chain,
    expanded: HashSet<String>,
}

impl Walk<'_> {
    fn collect(&mut self, node: &Node, scope: Scope) {
        for child in node.children() {
            let Some(key) = child.key_str(scope.src) else {
                self.collect(child, scope);
                continue;
            };
            match key {
                // A guard is read as true, so its body says nothing about the system.
                "limit" | "trigger" => continue,
                "set_owner" => owner(&mut self.chain, child, scope.src),
                "save_global_event_target_as" | "save_event_target_as" => {
                    self.saved(child, scope);
                }
                "set_star_flag" => flag(child, scope.src, &mut self.chain.star_flags),
                "set_global_flag" => flag(child, scope.src, &mut self.chain.global_flags),
                "set_planet_flag" => flag(child, scope.src, &mut self.chain.planet_flags),
                "create_starbase" => {
                    self.chain.has_starbase = true;
                    if let Some(node) = child.find("owner", scope.src) {
                        owner(&mut self.chain, node, scope.src);
                    }
                }
                _ => self.call(key, child, scope),
            }
            self.collect(child, scope.descend(key));
        }
    }

    fn saved(&mut self, node: &Node, scope: Scope) {
        let Some(value) = node.scalar_str(scope.src) else {
            return;
        };
        if !self.chain.saved_targets.iter().any(|(t, _)| t == value) {
            let location = match scope.file {
                Some(file) => self.index.node_ref(file, scope.src, node),
                None => scenario_ref(scope.src, node),
            };
            self.chain.saved_targets.push((value.to_owned(), location));
        }
        if scope.in_system {
            Chain::push(&mut self.chain.system_targets, value);
        }
    }

    /// A scripted effect runs in the scope that called it, so its body is
    /// walked with the caller's.
    fn call(&mut self, key: &str, node: &Node, scope: Scope) {
        if is_country_scope(key) {
            country_scope(&mut self.chain, node, scope.src);
            return;
        }
        if !is_call(node, scope.src) {
            return;
        }
        let Some(def) = self.index.effect(key) else {
            return;
        };
        Chain::push(&mut self.chain.called_effects, key);
        if scope.expand && self.expanded.insert(key.to_owned()) {
            let body = Scope {
                src: &def.src,
                file: Some(&def.file),
                expand: false,
                in_system: scope.in_system,
            };
            self.collect(&def.node, body);
        }
    }
}

/// A line of the scenario document itself, counted from the effect's start.
fn scenario_ref(src: &[u8], node: &Node) -> ScriptRef {
    let upto = node.span().start.min(src.len());
    let lines = src[..upto].iter().filter(|&&b| b == b'\n').count();
    let line = u32::try_from(lines + 1).unwrap_or(u32::MAX);
    ScriptRef {
        file: None,
        display: format!("scenario:{line}"),
        line,
        layer: "scenario".to_owned(),
    }
}

fn owner(chain: &mut Chain, node: &Node, src: &[u8]) {
    match node.scalar_str(src) {
        Some(value) => match value.strip_prefix("event_target:") {
            Some(token) => Chain::push(&mut chain.owner_tokens, token),
            None => Chain::push(&mut chain.unresolved, &format!("set_owner = {value}")),
        },
        None => Chain::push(&mut chain.unresolved, "set_owner = { … }"),
    }
}

fn flag(node: &Node, src: &[u8], into: &mut Vec<String>) {
    let value = node
        .scalar_str(src)
        .or_else(|| node.find("flag", src)?.scalar_str(src));
    if let Some(value) = value {
        Chain::push(into, value);
    }
}

fn country_scope(chain: &mut Chain, node: &Node, src: &[u8]) {
    let Some(flag) = node
        .find("limit", src)
        .and_then(|l| l.find("has_country_flag", src))
        .and_then(|f| f.scalar_str(src))
    else {
        return;
    };
    for target in node.find_all("save_global_event_target_as", src) {
        if let Some(token) = target.scalar_str(src) {
            let pair = (flag.to_owned(), token.to_owned());
            if !chain.country_flag_targets.contains(&pair) {
                chain.country_flag_targets.push(pair);
            }
        }
    }
}

fn spawned(initializers: &Initializers, name: &str) -> Vec<String> {
    let mut seen: HashSet<&str> = HashSet::from([name]);
    let mut queue = VecDeque::from([(name, 0usize)]);
    let mut found = Vec::new();
    while let Some((current, depth)) = queue.pop_front() {
        if depth == SPAWN_DEPTH || found.len() >= SPAWN_LIMIT {
            continue;
        }
        let Some(init) = initializers.get(current) else {
            continue;
        };
        for child in &init.spawns {
            if !seen.insert(child.as_str()) {
                continue;
            }
            found.push(child.clone());
            queue.push_back((child.as_str(), depth + 1));
            if found.len() >= SPAWN_LIMIT {
                break;
            }
        }
    }
    found
}
