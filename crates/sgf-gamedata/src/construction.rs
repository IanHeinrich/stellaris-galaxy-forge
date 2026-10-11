//! What a megastructure type's construction adds to its system and owner, read from the
//! install, and replayed against a save system to say what an added row of the type should
//! bring with it.
//!
//! A type's build chain is every stage from the first, following the first of each
//! `upgrade_from`, up to the type itself. Each stage's `on_build_start` and
//! `on_build_complete` are walked in turn, through the scripted effects they call with their
//! parameters and the events they fire, one event deep. Four kinds of effect are kept: a
//! timed modifier added or removed, a deposit added or removed, and an owner variable
//! changed. They are kept on the scope they run in: the system, the body the structure is
//! built at, every system planet passing a `limit`, or the owner. Anything else a
//! construction does, such as a flag, a planet's class or model, an event chain or a country
//! modifier, is not written, and a kept effect the walk cannot place is listed as
//! unfollowed rather than guessed.

use std::collections::BTreeMap;

use sgf_core::cst::Node;
use sgf_core::format::save::site::{ConstructionSite, SiteBody};
use sgf_core::ops::{
    ConstructionDeposit, ConstructionModifier, MegastructureConstruction, ModifierHost,
    VariableRaise,
};

use crate::GameData;
use crate::condition::{Condition, Subject};
use crate::install::script::Def;
use crate::registries::scripted_triggers::ScriptedTriggers;
use crate::scripts::ScriptIndex;

/// How deep scripted effects calling scripted effects are followed.
const MAX_DEPTH: usize = 8;
/// How many events deep the walk follows, from the type's own hooks.
const MAX_EVENTS: usize = 1;
/// The hooks of a stage that run as it is built, in the order they run.
const HOOKS: [&str; 2] = ["on_build_start", "on_build_complete"];
/// The keys that fire an event in the scope they stand in.
const EVENT_KEYS: [&str; 6] = [
    "country_event",
    "planet_event",
    "ship_event",
    "fleet_event",
    "pop_event",
    "event",
];
/// The blocks an event runs when it fires.
const EVENT_BLOCKS: [&str; 2] = ["immediate", "after"];
/// The `exists` a resolved guard asks when it asks that the structure has an owner.
const OWNER_EXISTS: &str = "from";

/// A type's build chain as the effects it keeps, in the order they run.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Construction {
    pub steps: Vec<Step>,
    /// Each kept effect the walk could not place.
    pub unfollowed: Vec<Unfollowed>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Step {
    pub on: Target,
    pub effect: Effect,
    /// The step runs only when the structure has an owner.
    pub owned: bool,
}

/// A kept effect the walk could not place, said as the script says it.
#[derive(Debug, Clone, PartialEq)]
pub struct Unfollowed {
    pub what: String,
    /// It would run only when the structure has an owner.
    pub owned: bool,
}

/// Where a step runs.
#[derive(Debug, Clone, PartialEq)]
pub enum Target {
    System,
    Owner,
    /// The body the structure is built at, when the condition holds for it.
    Host(Condition),
    /// Every body of the system for which the condition holds.
    Planets(Condition),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    AddModifier {
        modifier: String,
        days: i32,
    },
    RemoveModifier(String),
    AddDeposit(String),
    RemoveDeposit(String),
    /// `change_variable`, or `subtract_variable` as a negative change.
    ChangeVariable {
        variable: String,
        by: f64,
    },
    SetFlag(String),
    RemoveFlag(String),
}

impl Effect {
    /// Whether the editor writes what this effect leaves.
    fn written(&self) -> bool {
        !matches!(self, Self::SetFlag(_) | Self::RemoveFlag(_))
    }
}

/// The scope a walk stands in.
#[derive(Debug, Clone, PartialEq)]
enum Scope {
    System,
    Owner,
    Megastructure,
    Host(Condition),
    Planets(Condition),
    /// Any other scope, by the key that reached it.
    Other(String),
}

/// The chain of `key`, the type's own stage last, each once.
fn chain<'d>(defs: &'d BTreeMap<String, Def>, key: &str) -> Vec<&'d Def> {
    let mut stages = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let mut next = Some(key.to_owned());
    while let Some(stage) = next.take() {
        if seen.contains(&stage) {
            break;
        }
        let Some(def) = defs.get(&stage) else {
            break;
        };
        seen.push(stage);
        stages.push(def);
        next = first_upgrade(def);
    }
    stages.reverse();
    stages
}

fn first_upgrade(def: &Def) -> Option<String> {
    crate::install::script::list_items(&def.node, "upgrade_from", &def.src)
        .into_iter()
        .next()
}

/// What the build chain of type `key` keeps, as `scripts` resolve the effects and events
/// it calls.
pub(crate) fn read(defs: &BTreeMap<String, Def>, key: &str, scripts: &ScriptIndex) -> Construction {
    let mut out = Construction::default();
    for stage in chain(defs, key) {
        for hook in HOOKS {
            if let Some(block) = stage.node.find(hook, &stage.src) {
                let walk = Walk {
                    scripts,
                    params: Vec::new(),
                    scope: Scope::System,
                    frame: [
                        Scope::System,
                        Scope::Owner,
                        Scope::Megastructure,
                        Scope::Other("fromfromfrom".to_owned()),
                    ],
                    doubt: None,
                    owned: false,
                    depth: 0,
                    events: 0,
                    origin: stage
                        .node
                        .key_str(&stage.src)
                        .unwrap_or_default()
                        .to_owned(),
                };
                walk.block(block, &stage.src, &mut out);
            }
        }
    }
    out
}

#[derive(Clone)]
struct Walk<'a> {
    scripts: &'a ScriptIndex,
    params: Vec<(String, String)>,
    scope: Scope,
    /// `root`, `from`, `fromfrom` and `fromfromfrom` where the walk stands.
    frame: [Scope; 4],
    /// Why the effects here may not run, when a condition the walk cannot judge guards them.
    doubt: Option<String>,
    /// The effects here run only when the structure has an owner: they stand in the
    /// owner's scope, or behind a guard asking that it exists.
    owned: bool,
    depth: usize,
    events: usize,
    /// The stage or event the walk is in, for what it lists as unfollowed.
    origin: String,
}

impl Walk<'_> {
    fn block(&self, block: &Node, src: &[u8], out: &mut Construction) {
        let mut earlier: Vec<Condition> = Vec::new();
        for child in block.children() {
            let Some(key) = child.key_str(src) else {
                continue;
            };
            let key = self.substitute(key);
            let value = child.scalar_str(src).map(|v| self.substitute(v));
            match key.as_str() {
                "limit" | "custom_tooltip" | "tooltip" => {}
                "if" => {
                    earlier.clear();
                    self.branch(child, src, &mut earlier, out);
                }
                "else_if" => self.branch(child, src, &mut earlier, out),
                "else" => {
                    let not_earlier = Condition::Not(Box::new(Condition::Any(earlier.clone())));
                    self.guarded(not_earlier).block(child, src, out);
                    earlier.clear();
                }
                "hidden_effect" | "AND" => self.block(child, src, out),
                "add_modifier" => {
                    let effect = match value {
                        Some(modifier) => Some(Effect::AddModifier { modifier, days: -1 }),
                        None => self.timed(child, src),
                    };
                    match effect {
                        Some(effect) => self.keep(effect, out),
                        None => self.unfollowed("add_modifier with no modifier or days", out),
                    }
                }
                "remove_modifier" => self.keep_named(value, Effect::RemoveModifier, &key, out),
                "add_deposit" => self.keep_named(value, Effect::AddDeposit, &key, out),
                "remove_deposit" => self.keep_named(value, Effect::RemoveDeposit, &key, out),
                "set_planet_flag" => self.keep_named(value, Effect::SetFlag, &key, out),
                "remove_planet_flag" => self.keep_named(value, Effect::RemoveFlag, &key, out),
                "change_variable" | "subtract_variable" => match self.variable(&key, child, src) {
                    Some(effect) => self.keep(effect, out),
                    None => {
                        self.unfollowed(&format!("{key} with a value that is not a number"), out)
                    }
                },
                "fire_on_action" => self.unfollowed("fire_on_action", out),
                _ if EVENT_KEYS.contains(&key.as_str()) => self.event(child, src, out),
                _ => {
                    if let Some(scope) = self.scope_of(&key) {
                        if child.scalar_span().is_none() {
                            self.entering(scope, child, src).block(child, src, out);
                        }
                        continue;
                    }
                    match self.scripts.effect(&key) {
                        Some(effect) if self.depth < MAX_DEPTH => {
                            let mut inner = self.clone();
                            inner.params = self.arguments(child, src);
                            inner.depth += 1;
                            inner.block(&effect.node, &effect.src, out);
                        }
                        _ if child.scalar_span().is_none() => {
                            let other = Scope::Other(key.clone());
                            self.entering(other, child, src).block(child, src, out);
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    /// An `if` or `else_if`: its effects run when its `limit` holds and no earlier branch's
    /// did.
    fn branch(
        &self,
        node: &Node,
        src: &[u8],
        earlier: &mut Vec<Condition>,
        out: &mut Construction,
    ) {
        let limit = node
            .find("limit", src)
            .map_or(Condition::Always(true), |limit| {
                Condition::compile(limit, src)
            });
        let guard = Condition::All(vec![
            Condition::Not(Box::new(Condition::Any(earlier.clone()))),
            limit.clone(),
        ]);
        self.guarded(guard).block(node, src, out);
        earlier.push(limit);
    }

    /// The walk with `condition` guarding what follows: folded into a body scope's
    /// condition, marking what follows as owned when it only asks that the owner exists,
    /// and otherwise a doubt.
    fn guarded(&self, condition: Condition) -> Self {
        let condition = self.resolved(condition);
        let mut walk = self.clone();
        match &mut walk.scope {
            Scope::Host(guard) | Scope::Planets(guard) => {
                *guard = Condition::All(vec![guard.clone(), condition]);
            }
            _ => match asks_owner(&condition) {
                Some(owned) => walk.owned |= owned,
                None if walk.doubt.is_some() => {}
                None => {
                    let mut keys = Vec::new();
                    leaf_keys(&condition, &mut keys);
                    let doubt = format!(
                        "behind a condition on {}: {}",
                        self.scope_name(),
                        keys.join(", ")
                    );
                    walk.doubt = Some(doubt);
                }
            },
        }
        walk
    }

    /// `condition` with each `exists` answered that names a scope of the walk: the system
    /// and the structure always exist, and one that is the owner becomes `exists = from`,
    /// which [`asks_owner`] and a body read as the structure having an owner.
    fn resolved(&self, condition: Condition) -> Condition {
        match condition {
            Condition::Exists(scope) => match self.scope_of(&scope.to_ascii_lowercase()) {
                Some(Scope::Owner) => Condition::Exists(OWNER_EXISTS.to_owned()),
                Some(Scope::System | Scope::Megastructure) => Condition::Always(true),
                _ => Condition::Exists(scope),
            },
            Condition::Not(inner) => Condition::Not(Box::new(self.resolved(*inner))),
            Condition::All(items) => {
                Condition::All(items.into_iter().map(|c| self.resolved(c)).collect())
            }
            Condition::Any(items) => {
                Condition::Any(items.into_iter().map(|c| self.resolved(c)).collect())
            }
            other => other,
        }
    }

    fn scope_name(&self) -> String {
        match &self.scope {
            Scope::System => "the system".to_owned(),
            Scope::Owner => "the owner".to_owned(),
            Scope::Megastructure => "the megastructure".to_owned(),
            Scope::Host(_) => "its body".to_owned(),
            Scope::Planets(_) => "the system's planets".to_owned(),
            Scope::Other(key) => key.clone(),
        }
    }

    /// The scope a key such as `from`, `fromfrom.planet` or `every_system_planet` leads to,
    /// `None` when it is no scope this walk knows.
    fn scope_of(&self, key: &str) -> Option<Scope> {
        let mut scope = self.scope.clone();
        for (i, link) in key.split('.').enumerate() {
            scope = match (link, &scope) {
                ("root", _) if i == 0 => self.frame[0].clone(),
                ("from", _) if i == 0 => self.frame[1].clone(),
                ("fromfrom", _) if i == 0 => self.frame[2].clone(),
                ("fromfromfrom", _) if i == 0 => self.frame[3].clone(),
                ("this", _) if i == 0 => scope,
                ("planet", Scope::Megastructure) => Scope::Host(Condition::Always(true)),
                ("owner", Scope::Megastructure) => Scope::Owner,
                (
                    "solar_system",
                    Scope::System | Scope::Megastructure | Scope::Host(_) | Scope::Planets(_),
                ) => Scope::System,
                ("every_system_planet", Scope::System) => Scope::Planets(Condition::Always(true)),
                _ if key.contains('.') || i > 0 => Scope::Other(key.to_owned()),
                _ => return None,
            };
        }
        Some(scope)
    }

    /// The walk inside a block that moves to `scope`, its own `limit` folded in.
    fn entering(&self, scope: Scope, node: &Node, src: &[u8]) -> Self {
        let mut walk = self.clone();
        walk.owned |= scope == Scope::Owner;
        walk.scope = scope;
        match node.find("limit", src) {
            Some(limit) => walk.guarded(Condition::compile(limit, src)),
            None => walk,
        }
    }

    /// Follow an event `node` fires, one level deep.
    fn event(&self, node: &Node, src: &[u8], out: &mut Construction) {
        let id = node
            .find("id", src)
            .and_then(|id| id.scalar_str(src))
            .or_else(|| node.scalar_str(src))
            .map(|id| self.substitute(id));
        let Some(id) = id else {
            return;
        };
        if self.events >= MAX_EVENTS {
            self.unfollowed(&format!("event {id}, fired from an event"), out);
            return;
        }
        let Some(found) = self.scripts.event(&id) else {
            self.unfollowed(
                &format!("event {id}, which the install does not define"),
                out,
            );
            return;
        };
        let Some(parsed) = self.scripts.parsed(&found.file) else {
            return;
        };
        let Some(event) = parsed.at(found.offset) else {
            return;
        };
        let mut walk = self.clone();
        walk.frame = [
            self.scope.clone(),
            self.frame[0].clone(),
            self.frame[1].clone(),
            self.frame[2].clone(),
        ];
        walk.events += 1;
        walk.depth = 0;
        walk.params = Vec::new();
        walk.origin = id.clone();
        if let Some(trigger) = event.find("trigger", &parsed.src) {
            walk = walk.guarded_event(Condition::compile(trigger, &parsed.src));
        }
        for block in EVENT_BLOCKS {
            if let Some(effects) = event.find(block, &parsed.src) {
                walk.block(effects, &parsed.src, out);
            }
        }
    }

    /// An event's `trigger` is judged in the scope it fires in, as a guard.
    fn guarded_event(self, trigger: Condition) -> Self {
        let mut walk = self;
        walk.scope = walk.frame[0].clone();
        walk.guarded(trigger)
    }

    fn timed(&self, node: &Node, src: &[u8]) -> Option<Effect> {
        let field = |name: &str| {
            node.find(name, src)?
                .scalar_str(src)
                .map(|v| self.substitute(v))
        };
        let modifier = field("modifier")?;
        let days = match field("days") {
            Some(days) => days.parse().ok()?,
            None => -1,
        };
        Some(Effect::AddModifier { modifier, days })
    }

    fn variable(&self, key: &str, node: &Node, src: &[u8]) -> Option<Effect> {
        let field = |name: &str| {
            node.find(name, src)?
                .scalar_str(src)
                .map(|v| self.substitute(v))
        };
        let variable = field("which")?;
        let value: f64 = field("value")?.parse().ok()?;
        let by = if key == "subtract_variable" {
            -value
        } else {
            value
        };
        Some(Effect::ChangeVariable { variable, by })
    }

    fn keep_named(
        &self,
        value: Option<String>,
        make: fn(String) -> Effect,
        key: &str,
        out: &mut Construction,
    ) {
        match value.filter(|v| !v.is_empty() && !v.contains('$')) {
            Some(value) => self.keep(make(value), out),
            None => self.unfollowed(&format!("{key} with no plain value"), out),
        }
    }

    /// Keep `effect` where the walk stands, or list why it cannot be.
    fn keep(&self, effect: Effect, out: &mut Construction) {
        let target = match (&self.scope, &effect) {
            (Scope::Owner, Effect::ChangeVariable { .. }) => Target::Owner,
            (Scope::Owner | Scope::Megastructure | Scope::Other(_), _)
            | (_, Effect::ChangeVariable { .. }) => {
                if effect.written() {
                    self.unfollowed(&format!("{effect:?} on {}", self.scope_name()), out);
                }
                return;
            }
            (Scope::System, Effect::SetFlag(_) | Effect::RemoveFlag(_)) => return,
            (Scope::System, _) => Target::System,
            (Scope::Host(guard), _) => Target::Host(guard.clone()),
            (Scope::Planets(guard), _) => Target::Planets(guard.clone()),
        };
        if let Some(doubt) = &self.doubt {
            if effect.written() {
                self.unfollowed(&format!("{effect:?} {doubt}"), out);
            }
            return;
        }
        let owned = self.owned || target == Target::Owner;
        out.steps.push(Step {
            on: target,
            effect,
            owned,
        });
    }

    /// List `what` as unfollowed once, owned only when every path to it is.
    fn unfollowed(&self, what: &str, out: &mut Construction) {
        let what = format!("{}: {what}", self.origin);
        match out.unfollowed.iter_mut().find(|line| line.what == what) {
            Some(line) => line.owned &= self.owned,
            None => out.unfollowed.push(Unfollowed {
                what,
                owned: self.owned,
            }),
        }
    }

    fn arguments(&self, call: &Node, src: &[u8]) -> Vec<(String, String)> {
        call.children()
            .iter()
            .filter_map(|arg| {
                let name = arg.key_str(src)?;
                let value = arg.scalar_str(src)?;
                Some((name.to_owned(), self.substitute(value)))
            })
            .collect()
    }

    fn substitute(&self, text: &str) -> String {
        let mut out = text.to_owned();
        for (name, value) in &self.params {
            out = out.replace(&format!("${name}$"), value);
        }
        out
    }
}

/// What a [`Walk::resolved`] guard asks: `Some(true)` that the owner exists and nothing
/// else, `Some(false)` nothing, `None` something more.
fn asks_owner(condition: &Condition) -> Option<bool> {
    match condition {
        Condition::Always(true) => Some(false),
        Condition::Exists(scope) if scope == OWNER_EXISTS => Some(true),
        Condition::All(items) => items
            .iter()
            .try_fold(false, |owned, item| Some(owned | asks_owner(item)?)),
        Condition::Not(inner) if matches!(&**inner, Condition::Any(items) if items.is_empty()) => {
            Some(false)
        }
        _ => None,
    }
}

fn leaf_keys(condition: &Condition, out: &mut Vec<String>) {
    match condition {
        Condition::All(items) | Condition::Any(items) => {
            items.iter().for_each(|item| leaf_keys(item, out));
        }
        Condition::Not(inner) => leaf_keys(inner, out),
        Condition::Always(_) => {}
        leaf => {
            let key = leaf.key().to_owned();
            if !out.contains(&key) {
                out.push(key);
            }
        }
    }
}

/// What an added row of a type brings with it in one save system, and what of its
/// construction is not written there.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Built {
    pub construction: MegastructureConstruction,
    /// Each effect the replay could not tell applies, or where.
    pub unsure: Vec<String>,
    /// Each effect that applies but that the editor does not write: a modifier or deposit
    /// the construction removes, a deposit on the system, an owner variable lowered.
    pub unwritten: Vec<String>,
}

/// One body as a step's condition judges it, as the replay has left it so far.
struct Body<'a> {
    site: &'a SiteBody,
    class: Option<&'a crate::registries::planet_classes::PlanetClassDef>,
    deposits: Vec<String>,
    modifiers: Vec<String>,
    flags: Vec<String>,
    gd: &'a GameData,
    /// The structure has an owner.
    owned: bool,
}

impl Subject for Body<'_> {
    fn leaf(&self, leaf: &Condition) -> Option<bool> {
        let class = self.class;
        match leaf {
            Condition::PlanetClass(key) => Some(&self.site.class == key),
            Condition::Star(want) => Some(self.site.star == *want),
            Condition::Moon(want) => Some(self.site.moon == *want),
            Condition::Asteroid(want) => Some(class?.asteroid == *want),
            Condition::Colonizable(want) => Some(class?.colonizable == *want),
            Condition::HasDeposit(key) => Some(self.deposits.contains(key)),
            Condition::HasModifier(key) => Some(self.modifiers.contains(key)),
            Condition::PlanetFlag(key) => Some(self.flags.contains(key)),
            Condition::DepositFor(station) => Some(self.deposits.iter().any(|kind| {
                self.gd
                    .deposits
                    .get(kind)
                    .is_some_and(|d| d.station.as_deref() == Some(station))
            })),
            Condition::Exists(scope) if scope == OWNER_EXISTS => Some(self.owned),
            Condition::Call(name, want) => {
                let holds = match name.as_str() {
                    "is_astral_scar" => class?.astral_scar,
                    "is_artificial" => class?.artificial,
                    "is_ringworld" => class?.ringworld,
                    "is_colony" | "has_owner" => self.site.colony,
                    _ => return None,
                };
                Some(holds == *want)
            }
            _ => None,
        }
    }

    fn triggers(&self) -> Option<&ScriptedTriggers> {
        Some(&self.gd.scripted_triggers)
    }
}

impl Construction {
    /// Replay the chain against `site`, the structure built at body `host` (none for one at
    /// a point of its own) and owned when `has_owner`: the timed modifiers, deposits and
    /// owner variables it leaves that the system did not have, and what else it would
    /// change that is not written.
    pub fn replay(
        &self,
        gd: &GameData,
        site: &ConstructionSite,
        host: Option<u32>,
        has_owner: bool,
    ) -> Built {
        let mut unwritten: Vec<String> = Vec::new();
        let mut unsure: Vec<String> = self
            .unfollowed
            .iter()
            .filter(|unfollowed| has_owner || !unfollowed.owned)
            .map(|unfollowed| unfollowed.what.clone())
            .collect();
        let mut bodies: Vec<Body<'_>> = site
            .bodies
            .iter()
            .map(|body| Body {
                site: body,
                class: gd.planet_classes.get(&body.class),
                deposits: body.deposits.clone(),
                modifiers: body.modifiers.clone(),
                flags: body.flags.clone(),
                gd,
                owned: has_owner,
            })
            .collect();
        let mut system_modifiers = site.modifiers.clone();
        let mut variables: BTreeMap<String, f64> = BTreeMap::new();
        let mut days: BTreeMap<(ModifierHost, String), i32> = BTreeMap::new();

        for step in self.steps.iter().filter(|step| has_owner || !step.owned) {
            match &step.on {
                Target::Owner => {
                    if let Effect::ChangeVariable { variable, by } = &step.effect {
                        *variables.entry(variable.clone()).or_default() += by;
                    }
                }
                Target::System => {
                    apply_modifier(
                        &mut system_modifiers,
                        &step.effect,
                        ModifierHost::System,
                        &mut days,
                    );
                    if matches!(
                        step.effect,
                        Effect::AddDeposit(_) | Effect::RemoveDeposit(_)
                    ) {
                        note(&mut unwritten, format!("{:?} on the system", step.effect));
                    }
                }
                Target::Host(guard) | Target::Planets(guard) => {
                    let only = match &step.on {
                        Target::Host(_) => match host {
                            Some(host) => Some(host),
                            None => continue,
                        },
                        _ => None,
                    };
                    for body in &mut bodies {
                        if only.is_some_and(|host| host != body.site.id) {
                            continue;
                        }
                        match guard.evaluate(&*body) {
                            Some(true) => apply(body, &step.effect, &mut days),
                            Some(false) => {}
                            None => {
                                let mut keys = std::collections::BTreeSet::new();
                                guard.unknown_keys(&*body, &mut keys);
                                note(
                                    &mut unsure,
                                    format!(
                                        "{:?} on planet {}: cannot judge {}",
                                        step.effect,
                                        body.site.id,
                                        keys.into_iter().collect::<Vec<_>>().join(", ")
                                    ),
                                );
                            }
                        }
                    }
                }
            }
        }

        let mut built = MegastructureConstruction::default();
        added_modifiers(
            &site.modifiers,
            &system_modifiers,
            ModifierHost::System,
            &days,
            &mut built,
            &mut unwritten,
        );
        for body in &bodies {
            let host = ModifierHost::Body { body: body.site.id };
            added_modifiers(
                &body.site.modifiers,
                &body.modifiers,
                host,
                &days,
                &mut built,
                &mut unwritten,
            );
            let (gained, lost) = multiset_diff(&body.site.deposits, &body.deposits);
            for kind in gained {
                built.deposits.push(ConstructionDeposit {
                    body: body.site.id,
                    kind,
                });
            }
            for kind in lost {
                note(
                    &mut unwritten,
                    format!("removes deposit {kind} from planet {}", body.site.id),
                );
            }
        }
        for (variable, by) in variables {
            if by > 0.0 && by.fract() == 0.0 && by <= f64::from(u32::MAX) {
                built.variables.push(VariableRaise {
                    variable,
                    by: by as u32,
                });
            } else if by != 0.0 {
                note(
                    &mut unwritten,
                    format!("changes owner variable {variable} by {by}"),
                );
            }
        }
        Built {
            construction: built,
            unsure,
            unwritten,
        }
    }
}

fn note(lines: &mut Vec<String>, line: String) {
    if !lines.contains(&line) {
        lines.push(line);
    }
}

fn apply(body: &mut Body<'_>, effect: &Effect, days: &mut BTreeMap<(ModifierHost, String), i32>) {
    let host = ModifierHost::Body { body: body.site.id };
    apply_modifier(&mut body.modifiers, effect, host, days);
    match effect {
        Effect::AddDeposit(kind) => body.deposits.push(kind.clone()),
        Effect::RemoveDeposit(kind) => {
            if let Some(at) = body.deposits.iter().position(|d| d == kind) {
                body.deposits.remove(at);
            }
        }
        Effect::SetFlag(flag) if !body.flags.contains(flag) => body.flags.push(flag.clone()),
        Effect::RemoveFlag(flag) => body.flags.retain(|f| f != flag),
        _ => {}
    }
}

fn apply_modifier(
    modifiers: &mut Vec<String>,
    effect: &Effect,
    host: ModifierHost,
    days: &mut BTreeMap<(ModifierHost, String), i32>,
) {
    match effect {
        Effect::AddModifier {
            modifier,
            days: lasts,
        } => {
            if !modifiers.contains(modifier) {
                modifiers.push(modifier.clone());
            }
            days.insert((host, modifier.clone()), *lasts);
        }
        Effect::RemoveModifier(modifier) => modifiers.retain(|m| m != modifier),
        _ => {}
    }
}

fn added_modifiers(
    before: &[String],
    after: &[String],
    host: ModifierHost,
    days: &BTreeMap<(ModifierHost, String), i32>,
    built: &mut MegastructureConstruction,
    unwritten: &mut Vec<String>,
) {
    for modifier in after.iter().filter(|m| !before.contains(m)) {
        built.modifiers.push(ConstructionModifier {
            on: host,
            modifier: modifier.clone(),
            days: days.get(&(host, modifier.clone())).copied().unwrap_or(-1),
        });
    }
    for modifier in before.iter().filter(|m| !after.contains(m)) {
        let on = match host {
            ModifierHost::System => "the system".to_owned(),
            ModifierHost::Body { body } => format!("planet {body}"),
        };
        note(unwritten, format!("removes modifier {modifier} from {on}"));
    }
}

/// What `after` has that `before` has not, and the other way round, counting repeats.
fn multiset_diff(before: &[String], after: &[String]) -> (Vec<String>, Vec<String>) {
    let mut lost: Vec<String> = before.to_vec();
    let mut gained = Vec::new();
    for item in after {
        match lost.iter().position(|b| b == item) {
            Some(at) => {
                lost.remove(at);
            }
            None => gained.push(item.clone()),
        }
    }
    (gained, lost)
}
