//! What the events `on_game_start` fires give away before the player's first
//! frame: every `create_starbase` / `set_owner` a galaxy-wide system loop
//! runs, and every bypass it spawns, with the guard each runs under.
//!
//! The forest is walked once per [`ScriptIndex`] build, and the one walk
//! yields both. Claims are kept in the order the on_actions list their
//! events, and indexed by the star flags a guard insists on, so a system
//! tries a handful and not all of them.

use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};

use sgf_core::cst::Node;

use crate::install::layers::Layout;
use crate::install::script;
use crate::scripts::index::ScriptIndex;
use crate::scripts::scope::{Scopes, is_call, is_country_scope};
use crate::scripts::trigger::Trigger;
use crate::scripts::view::BypassKind;

/// How long after the game starts a claim is still the map the player opens
/// on. A Stellaris month is 30 days: an outpost planted inside the first ten
/// is part of the scenario's setup, a later one is something that happened.
pub const DAY_ONE_DAYS: u32 = 10;

/// How far the `id`/`days` edges out of an event are followed.
const MAX_DEPTH: usize = 4;

/// Who a claim gives the system to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnerExpr {
    /// An `event_target:X` token, or a scope the block it sits in names.
    Token(String),
    /// `prev` / `root` / `this` / `from`, to resolve against the system.
    Scope(String),
    /// Anything else, as it is written.
    Unresolved(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimEffect {
    Starbase,
    SetOwner,
}

/// One owner statement inside a system loop, and what has to hold for the
/// system the loop is on to be the one it takes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Claim {
    pub owner: OwnerExpr,
    pub effect: ClaimEffect,
    /// The loop's own guards, this branch's `limit`, and the negation of
    /// every earlier branch of the same `if` chain.
    pub trigger: Trigger,
    /// The positive `has_star_flag` conjuncts of `trigger`, which the index
    /// is keyed by.
    pub required_flags: Vec<String>,
    pub event: String,
    /// Position in claim order, which is the order the on_actions fire.
    pub order: usize,
}

/// The far end of a bypass a day-one event spawns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PartnerExpr {
    /// Nothing links the spawn to another system.
    None,
    /// The partner is whichever system the game picked.
    Random,
    /// The partner is the system whose facts hold this guard.
    Guarded {
        trigger: Trigger,
        required_flags: Vec<String>,
    },
}

impl PartnerExpr {
    /// A scope stands for a partner only where its guard names star flags;
    /// a system picked by distance, or by nothing, is whichever one it was.
    fn of(site: &Site) -> Self {
        let Site::Guarded { guards, .. } = site else {
            return Self::Random;
        };
        let trigger = Trigger::All(guards.clone());
        let mut required_flags = Vec::new();
        star_flags(&trigger, &mut required_flags);
        if required_flags.is_empty() {
            return Self::Random;
        }
        Self::Guarded {
            trigger,
            required_flags,
        }
    }
}

/// One bypass a day-one event spawns, and what has to hold for the system
/// it lands on to be the one it lands on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Placement {
    pub kind: BypassKind,
    pub partner: PartnerExpr,
    pub trigger: Trigger,
    /// The positive `has_star_flag` conjuncts of `trigger`; empty where the
    /// spawn lands on a system nothing here names.
    pub required_flags: Vec<String>,
    /// The spawn's loop runs on every system its guard fits, not one of them.
    pub every: bool,
    /// The spawn lands on the system its loop is on, rather than on one a
    /// scope this reader cannot follow moved it to.
    pub sited: bool,
    pub event: String,
    pub order: usize,
}

#[derive(Debug, Default)]
pub struct Placements {
    ordered: Vec<Placement>,
    by_flag: HashMap<String, Vec<usize>>,
    /// Placements on a system no guard picks out: counted, never drawn.
    random: Vec<usize>,
}

impl Placements {
    fn new(ordered: Vec<Placement>) -> Self {
        let mut by_flag: HashMap<String, Vec<usize>> = HashMap::new();
        let mut random = Vec::new();
        for placement in &ordered {
            if placement.required_flags.is_empty() {
                random.push(placement.order);
            }
            for flag in &placement.required_flags {
                by_flag
                    .entry(flag.clone())
                    .or_default()
                    .push(placement.order);
            }
        }
        Self {
            ordered,
            by_flag,
            random,
        }
    }

    pub fn all(&self) -> &[Placement] {
        &self.ordered
    }

    pub fn is_empty(&self) -> bool {
        self.ordered.is_empty()
    }

    /// The placements a system carrying `flags` could possibly meet.
    pub fn for_flags<'p>(
        &'p self,
        flags: &BTreeSet<String>,
    ) -> impl Iterator<Item = &'p Placement> {
        let mut picked: BTreeSet<usize> = BTreeSet::new();
        for flag in flags {
            if let Some(found) = self.by_flag.get(flag) {
                picked.extend(found.iter().copied());
            }
        }
        picked.into_iter().map(move |at| &self.ordered[at])
    }

    /// The placements that land wherever the game likes.
    pub fn random(&self) -> impl Iterator<Item = &Placement> {
        self.random.iter().map(move |&at| &self.ordered[at])
    }
}

#[derive(Debug, Default)]
pub struct Claims {
    ordered: Vec<Claim>,
    by_flag: HashMap<String, Vec<usize>>,
    /// Claims whose guard names no star flag: every system must try them.
    unindexed: Vec<usize>,
    placements: Placements,
}

impl Claims {
    fn new(ordered: Vec<Claim>, placements: Placements) -> Self {
        let mut by_flag: HashMap<String, Vec<usize>> = HashMap::new();
        let mut unindexed = Vec::new();
        for claim in &ordered {
            if claim.required_flags.is_empty() {
                unindexed.push(claim.order);
            }
            for flag in &claim.required_flags {
                by_flag.entry(flag.clone()).or_default().push(claim.order);
            }
        }
        Self {
            ordered,
            by_flag,
            unindexed,
            placements,
        }
    }

    pub fn all(&self) -> &[Claim] {
        &self.ordered
    }

    /// The bypasses the same walk found the day-one events spawning.
    pub fn placements(&self) -> &Placements {
        &self.placements
    }

    pub fn is_empty(&self) -> bool {
        self.ordered.is_empty()
    }

    /// The claims a system carrying `flags` could possibly meet, in claim
    /// order. A claim whose guard names no star flag is always among them.
    pub fn for_flags<'c>(&'c self, flags: &BTreeSet<String>) -> impl Iterator<Item = &'c Claim> {
        let mut picked: BTreeSet<usize> = self.unindexed.iter().copied().collect();
        for flag in flags {
            if let Some(found) = self.by_flag.get(flag) {
                picked.extend(found.iter().copied());
            }
        }
        picked.into_iter().map(move |at| &self.ordered[at])
    }
}

/// Walk the game-start event forest and collect its claims.
pub(crate) fn build(index: &ScriptIndex, layout: &Layout) -> Claims {
    let mut seen: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<(String, usize, u32)> = VecDeque::new();
    for id in seeds(index, layout) {
        if seen.insert(id.clone()) {
            queue.push_back((id, 0, 0));
        }
    }
    let mut build = Build {
        index,
        claims: Vec::new(),
        placements: Vec::new(),
        saved: HashMap::new(),
    };
    while let Some((id, depth, delay)) = queue.pop_front() {
        let Some(location) = index.event(&id) else {
            continue;
        };
        let Some(parsed) = index.parsed(&location.file) else {
            continue;
        };
        let Some(event) = parsed.at(location.offset) else {
            continue;
        };
        let src: &[u8] = &parsed.src;
        for block in bodies(event, src) {
            build.body(
                block,
                &State {
                    src,
                    event: &id,
                    guards: Vec::new(),
                    scope_token: None,
                    expand: true,
                    scopes: Scopes::default(),
                },
            );
        }
        if depth == MAX_DEPTH {
            continue;
        }
        for (next, days) in edges(event, src) {
            let delay = delay + days;
            if delay <= DAY_ONE_DAYS && seen.insert(next.clone()) {
                queue.push_back((next, depth + 1, delay));
            }
        }
    }
    Claims::new(build.claims, Placements::new(build.placements))
}

/// Every event an on_action of the game's first tick fires, in the order it
/// lists them.
fn seeds(index: &ScriptIndex, layout: &Layout) -> Vec<String> {
    let mut found = Vec::new();
    for file in layout.files_in("common/on_actions") {
        let Some(parsed) = index.parsed(&file) else {
            continue;
        };
        let src: &[u8] = &parsed.src;
        for node in parsed.root.children() {
            let Some(key) = node.key_str(src) else {
                continue;
            };
            if key.starts_with("on_game_start") || key.contains("galaxy_generation") {
                found.extend(script::list_items(node, "events", src));
            }
        }
    }
    found
}

/// The blocks of an event that run when it fires.
fn bodies<'n>(event: &'n Node, src: &'n [u8]) -> Vec<&'n Node> {
    event
        .find_all("immediate", src)
        .chain(event.find_all("after", src))
        .collect()
}

/// The events this one fires, each with the delay it fires them after.
fn edges(event: &Node, src: &[u8]) -> Vec<(String, u32)> {
    let mut found = Vec::new();
    for block in bodies(event, src) {
        calls(block, src, &mut found);
    }
    found
}

fn calls(node: &Node, src: &[u8], out: &mut Vec<(String, u32)>) {
    for child in node.children() {
        if let Some(key) = child.key_str(src)
            && is_event_call(key)
            && let Some(id) = child.find("id", src).and_then(|n| n.scalar_str(src))
        {
            out.push((id.to_owned(), days(child, src)));
        }
        calls(child, src, out);
    }
}

fn is_event_call(key: &str) -> bool {
    key == "event" || key.ends_with("_event")
}

/// A `days = { min max }` range fires at its earliest.
fn days(node: &Node, src: &[u8]) -> u32 {
    let Some(days) = node.find("days", src) else {
        return 0;
    };
    let text = days
        .scalar_str(src)
        .or_else(|| days.find("min", src)?.scalar_str(src));
    text.and_then(|t| t.parse().ok()).unwrap_or(0)
}

/// A body scope runs over every system in the galaxy.
pub(crate) fn is_system_loop(key: &str) -> bool {
    let Some(scope) = key
        .strip_prefix("every_")
        .or_else(|| key.strip_prefix("random_"))
        .or_else(|| key.strip_prefix("any_"))
    else {
        return false;
    };
    scope == "system" || scope == "galaxy_system"
}

struct Build<'a> {
    index: &'a ScriptIndex,
    claims: Vec<Claim>,
    placements: Vec<Placement>,
    /// The system scope each `save_event_target_as` of the walk so far named.
    saved: HashMap<String, Site>,
}

/// Which system a statement runs on: the guard that picks it out, or
/// nothing this reader can name. `every` is the innermost system loop's: an
/// `every_system` runs on each system its guard fits, a `random_system` on
/// one of them.
#[derive(Debug, Clone)]
enum Site {
    Unknown { every: bool },
    Guarded { guards: Vec<Trigger>, every: bool },
}

impl Default for Site {
    fn default() -> Self {
        Self::Unknown { every: false }
    }
}

impl Site {
    /// The same system, under one more branch of guards.
    fn and(&self, more: &[Trigger]) -> Self {
        match self {
            Self::Unknown { .. } => self.clone(),
            Self::Guarded { guards, every } => Self::Guarded {
                guards: guards.iter().chain(more).cloned().collect(),
                every: *every,
            },
        }
    }

    /// The system a scope this reader cannot follow runs on: no longer this
    /// one, and it will not guess.
    fn lost(&self) -> Self {
        Self::Unknown {
            every: self.every(),
        }
    }

    fn every(&self) -> bool {
        match self {
            Self::Unknown { every } | Self::Guarded { every, .. } => *every,
        }
    }
}

#[derive(Clone)]
struct State<'s> {
    src: &'s [u8],
    event: &'s str,
    /// What holds for the system of the innermost enclosing loop.
    guards: Vec<Trigger>,
    /// The token an enclosing `event_target:X = { … }` or country scope
    /// names, which `prev` and its like resolve to.
    scope_token: Option<String>,
    /// A scripted effect's body is expanded at the caller's level only.
    expand: bool,
    /// The system a bypass spawned here lands on, and the one `prev` names.
    scopes: Scopes<Site>,
}

impl<'a> Build<'a> {
    fn body<'s>(&mut self, node: &Node, state: &State<'s>)
    where
        'a: 's,
    {
        // The spawn a `link_wormholes` of this body speaks for.
        let mut last: Option<usize> = None;
        // The branches of one `if` chain already ruled out here.
        let mut prior: Vec<Trigger> = Vec::new();
        for child in node.children() {
            let Some(key) = child.key_str(state.src) else {
                self.body(child, state);
                continue;
            };
            match key {
                "limit" | "trigger" => continue,
                "if" | "else_if" => {
                    let limit = Self::limit(child, state.src);
                    let mut guards = state.guards.clone();
                    guards.extend(prior.iter().cloned());
                    guards.push(limit.clone());
                    let branch: Vec<Trigger> =
                        prior.iter().cloned().chain([limit.clone()]).collect();
                    self.body(
                        child,
                        &State {
                            guards,
                            scopes: state.scopes.refined(state.scopes.here().and(&branch)),
                            ..state.clone()
                        },
                    );
                    prior.push(Trigger::Not(Box::new(limit)));
                    continue;
                }
                "else" => {
                    let mut guards = state.guards.clone();
                    guards.append(&mut prior);
                    let site = state.scopes.here().and(&guards[state.guards.len()..]);
                    self.body(
                        child,
                        &State {
                            guards,
                            scopes: state.scopes.refined(site),
                            ..state.clone()
                        },
                    );
                    continue;
                }
                _ => prior.clear(),
            }
            // Only the innermost loop's guards describe the system its body
            // runs on, so a nested loop starts a scope of its own.
            if is_system_loop(key) {
                let guards: Vec<Trigger> = child
                    .find_all("limit", state.src)
                    .map(|limit| Trigger::compile(limit, state.src))
                    .collect();
                self.body(
                    child,
                    &State {
                        scopes: state.scopes.entered(Site::Guarded {
                            guards: guards.clone(),
                            every: key.starts_with("every_"),
                        }),
                        guards,
                        ..state.clone()
                    },
                );
                continue;
            }
            match key {
                "set_owner" => {
                    self.claim(child, ClaimEffect::SetOwner, state);
                    continue;
                }
                "create_starbase" => {
                    if let Some(owner) = child.find("owner", state.src) {
                        self.claim(owner, ClaimEffect::Starbase, state);
                    }
                    continue;
                }
                "save_event_target_as" | "save_global_event_target_as" => {
                    if let Some(token) = child.scalar_str(state.src)
                        && matches!(state.scopes.here(), Site::Guarded { .. })
                    {
                        self.saved
                            .insert(token.to_owned(), state.scopes.here().clone());
                    }
                    continue;
                }
                "spawn_natural_wormhole" => {
                    let bypass_type = child
                        .find("bypass_type", state.src)
                        .and_then(|n| n.scalar_str(state.src));
                    let kind = BypassKind::of_wormhole(bypass_type);
                    let wormhole = kind.is_wormhole();
                    let at = self.place(kind, state);
                    if wormhole {
                        last = Some(at);
                    }
                    continue;
                }
                "link_wormholes" => {
                    if let Some(at) = last.take() {
                        let partner = self.partner(child, state);
                        self.placements[at].partner = partner;
                    }
                    continue;
                }
                "spawn_megastructure" => {
                    if let Some(kind) = child
                        .find("type", state.src)
                        .and_then(|n| n.scalar_str(state.src))
                        .and_then(BypassKind::of_megastructure)
                    {
                        self.place(kind, state);
                    }
                    continue;
                }
                _ => {}
            }
            if let Some(token) = key.strip_prefix("event_target:") {
                self.body(
                    child,
                    &State {
                        scopes: state.scopes.entered(
                            self.saved
                                .get(token)
                                .cloned()
                                .unwrap_or_else(|| state.scopes.here().lost()),
                        ),
                        scope_token: Some(token.to_owned()),
                        ..state.clone()
                    },
                );
                continue;
            }
            if is_country_scope(key) {
                let scope_token = self
                    .country_token(child, state.src)
                    .or_else(|| state.scope_token.clone());
                self.body(
                    child,
                    &State {
                        scopes: state.scopes.entered(state.scopes.here().lost()),
                        scope_token,
                        ..state.clone()
                    },
                );
                continue;
            }
            if state.expand
                && is_call(child, state.src)
                && let Some(def) = self.index.effect(key)
            {
                self.body(
                    &def.node,
                    &State {
                        src: &def.src,
                        expand: false,
                        ..state.clone()
                    },
                );
                continue;
            }
            if child.scalar_span().is_none() {
                // Naming the enclosing system for a scope nobody can follow
                // would draw a bypass where there is none.
                self.body(
                    child,
                    &State {
                        scopes: state.scopes.descend(key, || state.scopes.here().lost()),
                        ..state.clone()
                    },
                );
            }
        }
    }

    /// The far end a `link_wormholes` names, for the spawn it follows.
    fn partner(&self, link: &Node, state: &State<'_>) -> PartnerExpr {
        let value = link.scalar_str(state.src).unwrap_or_default();
        let site = match value.strip_prefix("event_target:") {
            Some(token) => self
                .saved
                .get(token)
                .cloned()
                .unwrap_or_else(|| state.scopes.here().lost()),
            None if value == "prev" => state.scopes.outer().clone(),
            None => state.scopes.here().lost(),
        };
        PartnerExpr::of(&site)
    }

    /// One bypass, on whichever system the scope it is spawned in picks out.
    fn place(&mut self, kind: BypassKind, state: &State<'_>) -> usize {
        let guards = match state.scopes.here() {
            Site::Guarded { guards, .. } => guards.clone(),
            Site::Unknown { .. } => Vec::new(),
        };
        let trigger = Trigger::All(guards);
        let mut required_flags = Vec::new();
        star_flags(&trigger, &mut required_flags);
        self.placements.push(Placement {
            partner: PartnerExpr::None,
            kind,
            trigger,
            required_flags,
            every: state.scopes.here().every(),
            sited: matches!(state.scopes.here(), Site::Guarded { .. }),
            event: state.event.to_owned(),
            order: self.placements.len(),
        });
        self.placements.len() - 1
    }

    fn claim(&mut self, node: &Node, effect: ClaimEffect, state: &State<'_>) {
        let Site::Guarded { guards, .. } = state.scopes.here() else {
            return;
        };
        let trigger = Trigger::All(guards.clone());
        let mut required_flags = Vec::new();
        star_flags(&trigger, &mut required_flags);
        self.claims.push(Claim {
            owner: owner_expr(node, state.src, state.scope_token.as_deref()),
            effect,
            trigger,
            required_flags,
            event: state.event.to_owned(),
            order: self.claims.len(),
        });
    }

    /// The token a `random_country = { limit = { has_country_flag = F } … }`
    /// scope is, through the country that flag names.
    fn country_token(&self, node: &Node, src: &[u8]) -> Option<String> {
        let flag = node
            .find("limit", src)?
            .find("has_country_flag", src)?
            .scalar_str(src)?;
        let country = self.index.country_of_flag(flag)?;
        country.saves_targets.first().cloned()
    }

    /// A branch with no `limit` of its own holds unconditionally.
    fn limit(node: &Node, src: &[u8]) -> Trigger {
        match node.find("limit", src) {
            Some(limit) => Trigger::compile(limit, src),
            None => Trigger::All(Vec::new()),
        }
    }
}

/// The flags a guard insists on: a conjunct of an `AND`, never one under a
/// negation or an alternative, which a system may pass without them.
pub(crate) fn star_flags(trigger: &Trigger, out: &mut Vec<String>) {
    match trigger {
        Trigger::StarFlag(flag) => {
            if !out.contains(flag) {
                out.push(flag.clone());
            }
        }
        Trigger::All(items) => {
            for item in items {
                star_flags(item, out);
            }
        }
        _ => {}
    }
}

fn owner_expr(node: &Node, src: &[u8], scope: Option<&str>) -> OwnerExpr {
    let Some(value) = node.scalar_str(src) else {
        return OwnerExpr::Unresolved("{ … }".to_owned());
    };
    if let Some(token) = value.strip_prefix("event_target:") {
        return OwnerExpr::Token(token.to_owned());
    }
    let named = value.to_ascii_lowercase();
    if !matches!(named.as_str(), "prev" | "root" | "this" | "from") {
        return OwnerExpr::Unresolved(value.to_owned());
    }
    match scope {
        Some(token) => OwnerExpr::Token(token.to_owned()),
        None => OwnerExpr::Scope(named),
    }
}
