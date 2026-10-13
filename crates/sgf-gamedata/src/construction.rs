//! What a megastructure type's construction adds to its system and owner, read from the
//! install, and replayed against a save system to say what an added row of the type should
//! bring with it.
//!
//! A type's build chain is every stage from the first, following the first of each
//! `upgrade_from`, up to the type itself. Each stage's `on_build_start` and
//! `on_build_complete` are walked in turn, through the scripted effects they call with their
//! parameters and the events they fire, one event deep. These effects are kept: a timed
//! modifier added or removed, a deposit added or removed, an owner variable changed, a
//! planet flag set or removed, and a planet's class or size changed. They are kept on the
//! scope they run in: the system, the body the structure is built at, every system planet
//! passing a `limit`, or the owner. Anything else a construction does, such as a planet's
//! model, an event chain or a country modifier, is not written, and a kept effect the walk
//! cannot place is listed as unfollowed rather than guessed. Of the class and size changes,
//! only those of the structure's own body are written, and only when the caller asks.
//!
//! What a finished structure does to the shape of its system, the rows and planets it
//! spawns and the ones it removes, is read by [`layout`] from each stage's own definition,
//! kept as [`Construction::script`].

pub mod habitat;
pub mod layout;
mod replay;
pub mod ring_world;

pub use replay::Built;

use std::borrow::Cow;
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sgf_core::cst::Node;
use ts_rs::TS;

use crate::condition::Condition;
use crate::install::script::{Def, Names};
use crate::install::walk::{self, Branch, Flow, Script, Statement, Visitor};
use crate::scripts::ScriptIndex;

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
    /// The type's own definition, which [`layout::lay_out`] walks.
    pub script: Option<StageScript>,
}

/// A megastructure type's definition as the install has it.
#[derive(Debug, Clone)]
pub struct StageScript(Def);

impl PartialEq for StageScript {
    fn eq(&self, other: &Self) -> bool {
        self.0.file == other.0.file && self.0.node == other.0.node
    }
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
    /// It would change a planet's class or size.
    pub reshapes: bool,
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
    /// `change_pc`: the planet becomes this class.
    ChangeClass(String),
    /// `set_planet_size`.
    SetSize(u32),
}

impl Effect {
    /// Whether the editor writes what this effect leaves.
    fn written(&self) -> bool {
        !matches!(self, Self::SetFlag(_) | Self::RemoveFlag(_))
    }

    fn reshapes(&self) -> bool {
        matches!(self, Self::ChangeClass(_) | Self::SetSize(_))
    }
}

/// The class and size a type's build chain leaves the planet it is built at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, rename = "MegastructurePlanetChange")]
pub struct PlanetChange {
    /// The class it becomes; `None` when the chain leaves the class alone.
    pub class: Option<String>,
    /// The size it becomes; `None` when the chain leaves the size alone.
    pub size: Option<u32>,
}

/// The walk cannot tell what a build chain does to the class or size of its planet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnsurePlanetChange;

/// Where a line of [`Construction::summary`] lands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SummaryOn {
    System,
    /// The body the structure is built at.
    Body,
    /// Every planet of the system that passes a condition.
    Planets,
    Owner,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SummaryKind {
    Modifier,
    Deposit,
}

/// One modifier or deposit the construction leaves, as the editor writes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SummaryLine {
    pub on: SummaryOn,
    pub kind: SummaryKind,
    pub key: String,
    /// A deposit, or a modifier with no end date.
    pub permanent: bool,
    /// It lands only on the bodies that pass a condition, or only when the structure has an
    /// owner.
    pub conditional: bool,
}

impl Target {
    fn summary_on(&self) -> SummaryOn {
        match self {
            Self::System => SummaryOn::System,
            Self::Owner => SummaryOn::Owner,
            Self::Host(_) => SummaryOn::Body,
            Self::Planets(_) => SummaryOn::Planets,
        }
    }

    fn unconditional(&self) -> bool {
        match self {
            Self::System | Self::Owner => true,
            Self::Host(guard) | Self::Planets(guard) => always(guard),
        }
    }
}

/// Whether `condition` holds for any body, as the walk's empty guards build it.
fn always(condition: &Condition) -> bool {
    match condition {
        Condition::Always(holds) => *holds,
        Condition::All(items) => items.iter().all(always),
        Condition::Not(inner) => matches!(&**inner, Condition::Any(items) if items.is_empty()),
        _ => false,
    }
}

impl Construction {
    /// The timed modifiers and deposits the chain adds, in the order it adds them, each once.
    /// An add a later step removes from the same place is left out, and so are the removals
    /// themselves, the owner variables and the flags.
    pub fn summary(&self) -> Vec<SummaryLine> {
        let mut lines: Vec<(SummaryLine, &Target)> = Vec::new();
        for step in &self.steps {
            let (kind, key, days, adds) = match &step.effect {
                Effect::AddModifier { modifier, days } => {
                    (SummaryKind::Modifier, modifier, *days, true)
                }
                Effect::RemoveModifier(modifier) => (SummaryKind::Modifier, modifier, 0, false),
                Effect::AddDeposit(deposit) => (SummaryKind::Deposit, deposit, -1, true),
                Effect::RemoveDeposit(deposit) => (SummaryKind::Deposit, deposit, 0, false),
                _ => continue,
            };
            if !adds {
                lines.retain(|(line, on)| {
                    !(line.kind == kind && line.key == *key && **on == step.on)
                });
                continue;
            }
            let line = SummaryLine {
                on: step.on.summary_on(),
                kind,
                key: key.clone(),
                permanent: days < 0,
                conditional: step.owned || !step.on.unconditional(),
            };
            match lines
                .iter_mut()
                .find(|(seen, on)| seen.kind == kind && seen.key == *key && **on == step.on)
            {
                Some((seen, _)) => *seen = line,
                None => lines.push((line, &step.on)),
            }
        }
        lines.into_iter().map(|(line, _)| line).collect()
    }
}

impl Construction {
    /// The class and size the chain leaves the planet the structure is built at, the last of
    /// each it sets; `None` when it changes neither. A change the walk could not place, and
    /// one on the structure's own planet that runs only on a condition or with an owner,
    /// cannot be told. A change to the system's other planets is not counted.
    pub fn planet_change(&self) -> Result<Option<PlanetChange>, UnsurePlanetChange> {
        if self.unfollowed.iter().any(|line| line.reshapes) {
            return Err(UnsurePlanetChange);
        }
        let mut change = PlanetChange {
            class: None,
            size: None,
        };
        for step in self.steps.iter().filter(|step| step.effect.reshapes()) {
            match &step.on {
                Target::Host(guard) if always(guard) && !step.owned => {}
                Target::Planets(_) => continue,
                _ => return Err(UnsurePlanetChange),
            }
            match &step.effect {
                Effect::ChangeClass(class) => change.class = Some(class.clone()),
                Effect::SetSize(size) => change.size = Some(*size),
                _ => {}
            }
        }
        Ok((change.class.is_some() || change.size.is_some()).then_some(change))
    }
}

/// The scope a walk stands in.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Scope {
    System,
    Owner,
    Megastructure,
    Host(Condition),
    Planets(Condition),
    /// Any other scope, by the key that reached it.
    Other(String),
}

impl Scope {
    fn name(&self) -> String {
        match self {
            Self::System => "the system".to_owned(),
            Self::Owner => "the owner".to_owned(),
            Self::Megastructure => "the megastructure".to_owned(),
            Self::Host(_) => "its body".to_owned(),
            Self::Planets(_) => "the system's planets".to_owned(),
            Self::Other(key) => key.clone(),
        }
    }
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
    let mut out = Construction {
        script: defs.get(key).cloned().map(StageScript),
        ..Construction::default()
    };
    for stage in chain(defs, key) {
        for hook in HOOKS {
            for record in record(stage, hook, scripts, MAX_EVENTS) {
                match record {
                    Record::Effect(met) => keep(met, &mut out),
                    Record::Note {
                        what,
                        owned,
                        reshapes,
                    } => note(what, owned, reshapes, &mut out),
                }
            }
        }
    }
    out
}

/// What the walk meets running hook `hook` of `def`, in the order it meets it, following
/// the events it fires `events` deep.
pub(crate) fn record(def: &Def, hook: &str, scripts: &ScriptIndex, events: usize) -> Vec<Record> {
    let mut recorder = Recorder {
        scripts,
        events,
        records: Vec::new(),
    };
    if let Some(block) = def.node.find(hook, &def.src) {
        let at = At {
            scope: Scope::System,
            frame: [
                Scope::System,
                Scope::Owner,
                Scope::Megastructure,
                Scope::Other("fromfromfrom".to_owned()),
            ],
            doubt: None,
            owned: false,
            owner: false,
            events: 0,
            origin: def.node.key_str(&def.src).unwrap_or_default().to_owned(),
        };
        walk::block(&mut recorder, &Script::of_def(def), &at, block);
    }
    recorder.records
}

/// One thing the walk met.
#[derive(Debug, Clone)]
pub(crate) enum Record {
    Effect(Met),
    /// What the walk cannot read or follow, said as the script says it.
    Note {
        what: String,
        /// It would run only when the structure has an owner.
        owned: bool,
        /// It would change a planet's class or size.
        reshapes: bool,
    },
}

/// An effect the walk read, and where it stood.
#[derive(Debug, Clone)]
pub(crate) struct Met {
    pub effect: Effect,
    pub scope: Scope,
    /// Why it may not run, when a condition the walk cannot judge guards it.
    pub doubt: Option<String>,
    /// It runs only when the structure has an owner.
    pub owned: bool,
    /// It stands in the owner's scope, or a scope reached from there.
    pub owner: bool,
    /// The stage or event it is in.
    pub origin: String,
}

/// Keep `met`'s effect where it stood, or list why it cannot be.
fn keep(met: Met, out: &mut Construction) {
    let Met {
        effect,
        scope,
        doubt,
        owned,
        origin,
        ..
    } = met;
    let target = match (&scope, &effect) {
        (Scope::Owner, Effect::ChangeVariable { .. }) => Target::Owner,
        (Scope::Owner | Scope::Megastructure | Scope::Other(_), _)
        | (_, Effect::ChangeVariable { .. }) => {
            if effect.written() {
                let what = format!("{effect:?} on {}", scope.name());
                note(walk::line(&origin, &what), owned, effect.reshapes(), out);
            }
            return;
        }
        (Scope::System, Effect::SetFlag(_) | Effect::RemoveFlag(_)) => return,
        (Scope::System, effect) if effect.reshapes() => {
            let what = format!("{effect:?} on the system");
            note(walk::line(&origin, &what), owned, true, out);
            return;
        }
        (Scope::System, _) => Target::System,
        (Scope::Host(guard), _) => Target::Host(guard.clone()),
        (Scope::Planets(guard), _) => Target::Planets(guard.clone()),
    };
    if let Some(doubt) = doubt {
        if effect.written() {
            let what = format!("{effect:?} {doubt}");
            note(walk::line(&origin, &what), owned, effect.reshapes(), out);
        }
        return;
    }
    let owned = owned || target == Target::Owner;
    out.steps.push(Step {
        on: target,
        effect,
        owned,
    });
}

/// List `what` as unfollowed once, owned only when every path to it is, and marked when any
/// would change a planet's class or size.
fn note(what: String, owned: bool, reshapes: bool, out: &mut Construction) {
    match out.unfollowed.iter_mut().find(|line| line.what == what) {
        Some(line) => {
            line.owned &= owned;
            line.reshapes |= reshapes;
        }
        None => out.unfollowed.push(Unfollowed {
            what,
            owned,
            reshapes,
        }),
    }
}

/// The walk that records each effect it meets, with where it stands.
struct Recorder<'a> {
    scripts: &'a ScriptIndex,
    /// How many events deep the walk follows.
    events: usize,
    records: Vec<Record>,
}

/// Where the recorded walk stands.
#[derive(Clone)]
struct At {
    scope: Scope,
    /// `root`, `from`, `fromfrom` and `fromfromfrom` where the walk stands.
    frame: [Scope; 4],
    /// Why the effects here may not run, when a condition the walk cannot judge guards them.
    doubt: Option<String>,
    /// The effects here run only when the structure has an owner: they stand in the
    /// owner's scope, or behind a guard asking that it exists.
    owned: bool,
    /// The effects here stand in the owner's scope, or one reached from it.
    owner: bool,
    events: usize,
    /// The stage or event the walk is in, for what it lists as unfollowed.
    origin: String,
}

impl Visitor for Recorder<'_> {
    type At = At;
    /// The `limit` of each earlier branch of the chain.
    type Chain = Vec<Condition>;

    /// An `if` or `else_if` runs when its `limit` holds and no earlier branch's did; an
    /// `else` when none did.
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
                    .map_or(Condition::Always(true), |limit| {
                        Condition::in_walk(limit, script)
                    });
                let guard = Condition::All(vec![not_earlier, limit.clone()]);
                walk::block(self, script, &at.guarded(guard), node);
                earlier.push(limit);
            }
            Branch::Else => {
                walk::block(self, script, &at.guarded(not_earlier), node);
                earlier.clear();
            }
        }
        Flow::Go
    }

    fn statement(&mut self, script: &Script<'_>, at: &At, statement: Statement<'_>) -> Flow {
        let Statement { key, value, node } = statement;
        let value = value.map(str::to_owned);
        match key {
            "limit" | "custom_tooltip" | "tooltip" => {}
            "hidden_effect" | "AND" => {
                walk::block(self, script, at, node);
            }
            "add_modifier" => {
                let effect = match value {
                    Some(modifier) => Some(Effect::AddModifier { modifier, days: -1 }),
                    None => timed(script, node),
                };
                match effect {
                    Some(effect) => self.keep(at, effect),
                    None => self.unfollowed(at, "add_modifier with no modifier or days"),
                }
            }
            "remove_modifier" => self.keep_named(at, value, Effect::RemoveModifier, key),
            "add_deposit" => self.keep_named(at, value, Effect::AddDeposit, key),
            "remove_deposit" => self.keep_named(at, value, Effect::RemoveDeposit, key),
            "set_planet_flag" => self.keep_named(at, value, Effect::SetFlag, key),
            "remove_planet_flag" => self.keep_named(at, value, Effect::RemoveFlag, key),
            "change_pc" => self.class_change(script, at, node, value),
            "set_planet_size" => match value.and_then(|v| script.number_of(&v)).and_then(size) {
                Some(size) => self.keep(at, Effect::SetSize(size)),
                None => self.note(at, "set_planet_size with a value that is not a size", true),
            },
            "change_variable" | "subtract_variable" => match variable(script, key, node) {
                Some(effect) => self.keep(at, effect),
                None => self.unfollowed(at, &format!("{key} with a value that is not a number")),
            },
            "fire_on_action" => self.unfollowed(at, "fire_on_action"),
            _ if EVENT_KEYS.contains(&key) => self.event(script, at, node),
            _ => {
                if let Some(scope) = at.scope_of(key) {
                    if node.scalar_span().is_none() {
                        walk::block(self, script, &at.entering(scope, node, script), node);
                    }
                    return Flow::Go;
                }
                let scripts = self.scripts;
                if !walk::follow(self, scripts, script, at, key, node)
                    && node.scalar_span().is_none()
                {
                    let other = at.entering(Scope::Other(key.to_owned()), node, script);
                    walk::block(self, script, &other, node);
                }
            }
        }
        Flow::Go
    }
}

impl Recorder<'_> {
    /// Follow an event `node` fires, as deep as the walk follows events.
    fn event(&mut self, script: &Script<'_>, at: &At, node: &Node) {
        let id = node
            .find("id", script.src())
            .and_then(|id| script.value(id))
            .or_else(|| script.value(node));
        let Some(id) = id.map(Cow::into_owned) else {
            return;
        };
        if at.events >= self.events {
            self.unfollowed(at, &format!("event {id}, fired from an event"));
            return;
        }
        let Some(found) = self.scripts.event(&id) else {
            self.unfollowed(
                at,
                &format!("event {id}, which the install does not define"),
            );
            return;
        };
        let Some(parsed) = self.scripts.parsed(&found.file) else {
            return;
        };
        let Some(event) = parsed.at(found.offset) else {
            return;
        };
        let mut inner = at.clone();
        inner.frame = [
            at.scope.clone(),
            at.frame[0].clone(),
            at.frame[1].clone(),
            at.frame[2].clone(),
        ];
        inner.events += 1;
        inner.origin = id;
        let names = Names::of_file(
            parsed.root.children(),
            &parsed.src,
            script.names().globals(),
        );
        let text = Script::of_file(&parsed.src, names);
        if let Some(trigger) = event.find("trigger", &parsed.src) {
            inner.scope = inner.frame[0].clone();
            inner = inner.guarded(Condition::in_walk(trigger, &text));
        }
        for block in EVENT_BLOCKS {
            if let Some(effects) = event.find(block, &parsed.src) {
                walk::block(self, &text, &inner, effects);
            }
        }
    }

    /// `change_pc = class`, or the block form with its `class`. The block form that keeps the
    /// planet's model with `inherit_entity = yes` is unfollowed.
    fn class_change(&mut self, script: &Script<'_>, at: &At, node: &Node, value: Option<String>) {
        let class = match value {
            Some(class) => Some(class),
            None if script.field(node, "inherit_entity").as_deref() == Some("yes") => {
                self.note(at, "change_pc keeping the planet's model", true);
                return;
            }
            None => script.field(node, "class"),
        };
        match class.filter(|c| !c.is_empty() && !c.contains('$')) {
            Some(class) => self.keep(at, Effect::ChangeClass(class)),
            None => self.note(at, "change_pc with no plain class", true),
        }
    }

    fn keep_named(
        &mut self,
        at: &At,
        value: Option<String>,
        make: fn(String) -> Effect,
        key: &str,
    ) {
        match value.filter(|v| !v.is_empty() && !v.contains('$')) {
            Some(value) => self.keep(at, make(value)),
            None => self.unfollowed(at, &format!("{key} with no plain value")),
        }
    }

    fn keep(&mut self, at: &At, effect: Effect) {
        self.records.push(Record::Effect(Met {
            effect,
            scope: at.scope.clone(),
            doubt: at.doubt.clone(),
            owned: at.owned,
            owner: at.owner,
            origin: at.origin.clone(),
        }));
    }

    fn unfollowed(&mut self, at: &At, what: &str) {
        self.note(at, what, false);
    }

    fn note(&mut self, at: &At, what: &str, reshapes: bool) {
        self.records.push(Record::Note {
            what: walk::line(&at.origin, what),
            owned: at.owned,
            reshapes,
        });
    }
}

impl At {
    /// The walk with `condition` guarding what follows: folded into a body scope's
    /// condition, marking what follows as owned when it only asks that the owner exists,
    /// and otherwise a doubt.
    fn guarded(&self, condition: Condition) -> Self {
        let condition = self.resolved(condition);
        let mut at = self.clone();
        match &mut at.scope {
            Scope::Host(guard) | Scope::Planets(guard) => {
                *guard = Condition::All(vec![guard.clone(), condition]);
            }
            _ => match asks_owner(&condition) {
                Some(owned) => at.owned |= owned,
                None if at.doubt.is_some() => {}
                None => {
                    let mut keys = Vec::new();
                    leaf_keys(&condition, &mut keys);
                    let doubt = format!(
                        "behind a condition on {}: {}",
                        self.scope.name(),
                        keys.join(", ")
                    );
                    at.doubt = Some(doubt);
                }
            },
        }
        at
    }

    /// `condition` with each `exists` answered that names a scope of the walk: the system,
    /// the structure and the planet it is built at always exist, and one that is the owner
    /// becomes `exists = from`, which [`asks_owner`] and a body read as the structure having
    /// an owner.
    fn resolved(&self, condition: Condition) -> Condition {
        match condition {
            Condition::Exists(scope) => match self.scope_of(&scope.to_ascii_lowercase()) {
                Some(Scope::Owner) => Condition::Exists(OWNER_EXISTS.to_owned()),
                Some(Scope::System | Scope::Megastructure | Scope::Host(_)) => {
                    Condition::Always(true)
                }
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
    fn entering(&self, scope: Scope, node: &Node, script: &Script<'_>) -> Self {
        let mut at = self.clone();
        if scope == Scope::Owner {
            at.owned = true;
            at.owner = true;
        }
        at.scope = scope;
        match node.find("limit", script.src()) {
            Some(limit) => at.guarded(Condition::in_walk(limit, script)),
            None => at,
        }
    }
}

fn timed(script: &Script<'_>, node: &Node) -> Option<Effect> {
    let modifier = script.field(node, "modifier")?;
    let days = match node.find("days", script.src()) {
        Some(_) => {
            let days = script.number(node, "days")?;
            if days.fract() != 0.0 || days < f64::from(i32::MIN) || days > f64::from(i32::MAX) {
                return None;
            }
            days as i32
        }
        None => -1,
    };
    Some(Effect::AddModifier { modifier, days })
}

fn variable(script: &Script<'_>, key: &str, node: &Node) -> Option<Effect> {
    let variable = script.field(node, "which")?;
    let value = script.number(node, "value")?;
    let by = if key == "subtract_variable" {
        -value
    } else {
        value
    };
    Some(Effect::ChangeVariable { variable, by })
}

/// `value` as a planet size: a whole number from 1.
fn size(value: f64) -> Option<u32> {
    (value >= 1.0 && value.fract() == 0.0 && value <= f64::from(u32::MAX)).then_some(value as u32)
}

/// What a [`At::resolved`] guard asks: `Some(true)` that the owner exists and nothing
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
