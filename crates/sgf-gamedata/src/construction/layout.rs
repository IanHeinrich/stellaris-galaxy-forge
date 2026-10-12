//! What finishing a megastructure does to the shape of its system, read from the install:
//! the rows and planets it spawns, what it removes, and the flags it sets on the system and
//! on the body it stands at.
//!
//! The walk runs the type's build chain from the first stage, as [`super::read`] does, with
//! the structure's row standing at its body. Each row a stage spawns becomes a section, and
//! each section is then taken to the stage the [`Plan`] chooses for it. Unlike the effects
//! [`super::Construction`] keeps, a layout is run rather than recorded: an `if` is judged
//! against the flags set so far, so a ring world's habitable sections are named in the order
//! they are finished, as the game names them.
//!
//! Angles are game angles, which run from save angle 180 ([`Orbit::save_angle`]).

use std::collections::{BTreeMap, BTreeSet};

use sgf_core::cst::Node;

use super::{EVENT_KEYS, HOOKS, MAX_DEPTH};
use crate::GameData;
use crate::condition::Condition;
use crate::install::script::{Def, find_deep, whole, written};
use crate::registries::megastructures::MegastructureDef;

/// The scripted effect the game ruins a megastructure row with, run in the row's scope.
const RUIN_EFFECT: &str = "set_ruined_megastructure";
/// The suffix of a ruined type's key.
const RUINED: &str = "_ruined";
/// Effects that change nothing an added structure writes.
const SILENT: [&str; 6] = [
    "limit",
    "custom_tooltip",
    "tooltip",
    "set_surveyed",
    "set_all_comms_surveyed",
    "clear_blockers",
];
/// Effects on a planet that leave nothing behind when the same `every_system_planet`
/// removes it.
const CLEARING_NOOPS: [&str; 1] = ["clear_consecration_effect"];
/// What a block written where a number belongs shows as in the unfollowed list.
const BLOCK: &str = "{ … }";
/// The keys of `spawn_megastructure` the walk reads.
const ROW_KEYS: [&str; 9] = [
    "type",
    "orbit_angle",
    "orbit_distance",
    "name",
    "owner",
    "graphical_culture",
    "planet",
    "coords_from",
    "init_effect",
];
/// The keys of `spawn_planet` the walk reads.
const PLANET_KEYS: [&str; 10] = [
    "class",
    "location",
    "orbit_location",
    "orbit_angle",
    "orbit_angle_offset",
    "orbit_distance",
    "orbit_distance_offset",
    "size",
    "has_ring",
    "init_effect",
];

/// The stage a section is taken to.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum SectionStage {
    /// The row stays as it was spawned: a ring world's frame quadrant.
    #[default]
    Spawned,
    /// Every stage that upgrades the row is built in turn: a finished quadrant.
    Built,
    /// The type's ruin stands in the row's place.
    Ruined,
    /// The type's ruin stands in its place and is then built as [`Self::Built`] builds.
    Restored,
    /// The row is ruined by the game's `set_ruined_megastructure`: a damaged quadrant.
    Damaged,
}

/// What a layout is walked for.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Plan {
    /// The structure stands at a star.
    pub on_star: bool,
    /// The stage each section is taken to, in the order its row was spawned. A section past
    /// the end stays as spawned.
    pub sections: Vec<SectionStage>,
}

/// What finishing a type leaves in its system.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SystemLayout {
    /// The structure's own row, when the last stage leaves it standing.
    pub row: Option<LaidRow>,
    /// Each row the structure spawned, in spawn order.
    pub sections: Vec<Section>,
    /// Each planet spawned, in spawn order.
    pub planets: Vec<LaidPlanet>,
    /// The system flags set and not removed again, in the order they were set.
    pub system_flags: Vec<String>,
    /// The planet flags set on the body the structure stands at.
    pub host_flags: Vec<LaidFlag>,
    /// Every planet that is not a star is removed.
    pub cleared: bool,
    /// Every asteroid belt is removed.
    pub belts_cleared: bool,
    /// What the walk read and does not lay out, as the script says it.
    pub unfollowed: Vec<String>,
}

/// A row the structure spawned.
#[derive(Debug, Clone, PartialEq)]
pub struct Section {
    /// Where the row was spawned.
    pub at: Orbit,
    /// The row standing there at the end, `None` when a stage removed it.
    pub row: Option<LaidRow>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LaidRow {
    pub kind: String,
    pub at: Orbit,
    /// The name key, such as `NAME_Ring_Section_A`.
    pub name: Option<String>,
    /// The variable of the name that the system's name fills in, such as
    /// `prevprev.GetName`.
    pub system_name: Option<String>,
    /// The row takes the structure's owner.
    pub owned: bool,
    /// The row takes the structure's graphical culture.
    pub cultured: bool,
    /// The row's `planet` is the body the structure stands at.
    pub on_host: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LaidPlanet {
    pub class: String,
    /// The spawn's `size`, or the class's when the class has one size; `None` when the game
    /// rolls it.
    pub size: Option<u32>,
    pub at: Orbit,
    /// The section whose stage spawned it, by index in [`SystemLayout::sections`].
    pub section: Option<usize>,
    pub name: Option<LaidName>,
    pub model: Option<LaidModel>,
    /// Its planet flags, `set_carrier_flag`'s among them.
    pub flags: Vec<LaidFlag>,
    /// `trigger_megastructure_icon = yes`.
    pub megastructure_icon: bool,
}

/// A point in polar game coordinates, round the system's centre or round the body the
/// structure stands at.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Orbit {
    pub around: Around,
    /// Game degrees, from 0 up to 360.
    pub angle: f64,
    pub distance: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Around {
    Centre,
    /// The body the structure stands at, which the planet orbits as a moon.
    Host,
}

impl Orbit {
    fn new(around: Around, angle: f64, distance: f64) -> Self {
        Self {
            around,
            angle: angle.rem_euclid(360.0),
            distance,
        }
    }

    /// The angle as the save has it, `atan2(y, x)` of the point in degrees from 0 up to 360:
    /// game angle 0 is save angle 180.
    pub fn save_angle(&self) -> f64 {
        (self.angle + 180.0).rem_euclid(360.0)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LaidName {
    pub key: String,
    /// What the name's `variable_string` fills in, as its `\[…]` names them, such as
    /// `prev.solar_system.GetName`.
    pub variables: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LaidModel {
    /// The model without a culture prefix.
    pub entity: String,
    /// The model takes the structure's graphical culture as its prefix.
    pub cultured: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LaidFlag {
    pub flag: String,
    /// `flag@scope`: the id of what the scope names follows the flag's name.
    pub id_of: Option<IdOf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdOf {
    /// A planet of the layout, by index in [`SystemLayout::planets`].
    Planet(usize),
    Owner,
}

/// What finishing type `key` leaves in its system when the sections are taken to `plan`'s
/// stages; `None` when the install has no such type.
pub fn lay_out(gd: &GameData, key: &str, plan: &Plan) -> Option<SystemLayout> {
    let chain = chain(gd, key)?;
    let mut state = State {
        gd,
        on_star: plan.on_star,
        rows: vec![Row {
            laid: LaidRow {
                kind: chain[0].key.clone(),
                at: Orbit::new(Around::Host, 0.0, 0.0),
                name: None,
                system_name: None,
                owned: true,
                cultured: true,
                on_host: true,
            },
            standing: true,
        }],
        sections: Vec::new(),
        section: None,
        planets: Vec::new(),
        system_flags: Vec::new(),
        host_flags: Vec::new(),
        targets: BTreeMap::new(),
        written_flags: BTreeSet::new(),
        cleared: false,
        belts_cleared: false,
        unfollowed: Vec::new(),
    };
    for (at, stage) in chain.iter().enumerate() {
        if !state.rows[0].standing {
            let left: Vec<&str> = chain[at..].iter().map(|s| s.key.as_str()).collect();
            let removed = &chain[at - 1].key;
            state.note(format!(
                "{}: built over a row {removed} removed",
                left.join(", ")
            ));
            break;
        }
        state.rows[0].laid.kind = stage.key.clone();
        state.stage(stage, 0);
    }
    let mut next = 0;
    while next < state.sections.len() {
        state.section = Some(next);
        let stage = plan.sections.get(next).copied().unwrap_or_default();
        state.take(state.sections[next].0, stage);
        next += 1;
    }
    Some(state.finish())
}

/// The chain of `key` from the registry, the type's own stage last, each once.
fn chain<'g>(gd: &'g GameData, key: &str) -> Option<Vec<&'g MegastructureDef>> {
    let mut stages = vec![gd.megastructures.get(key)?];
    while let Some(below) = stages.last().and_then(|stage| stage.upgrade_from.first()) {
        match gd.megastructures.get(below) {
            Some(def) if !stages.iter().any(|seen| seen.key == def.key) => stages.push(def),
            _ => break,
        }
    }
    stages.reverse();
    Some(stages)
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Scope {
    System,
    Owner,
    /// A row, by index in `State::rows`.
    Row(usize),
    /// The body the structure stands at.
    Host,
    /// A planet the walk spawned, by index in `State::planets`.
    Planet(usize),
    /// A scope that holds nothing, such as the planet of a row spawned at no body. What runs
    /// there does nothing.
    Nothing,
}

struct Row {
    laid: LaidRow,
    standing: bool,
}

struct State<'g> {
    gd: &'g GameData,
    on_star: bool,
    /// The structure's own row first, then each spawned one.
    rows: Vec<Row>,
    /// Each spawned row by index in `rows`, with where it was spawned.
    sections: Vec<(usize, Orbit)>,
    /// The section being taken to its stage.
    section: Option<usize>,
    planets: Vec<LaidPlanet>,
    system_flags: Vec<String>,
    host_flags: Vec<LaidFlag>,
    /// Each saved event target, lowercased, with whether it is global.
    targets: BTreeMap<String, (Scope, bool)>,
    /// The system flags a script the walk has reached sets or removes. A flag outside them
    /// may stand in the save already, so the walk cannot judge it.
    written_flags: BTreeSet<String>,
    cleared: bool,
    belts_cleared: bool,
    unfollowed: Vec<String>,
}

impl<'g> State<'g> {
    /// Run `stage`'s own hooks with row `row` as the structure built.
    fn stage(&mut self, stage: &'g MegastructureDef, row: usize) {
        let Some(script) = stage.construction.script.as_ref() else {
            self.note(format!("{}: no definition to walk", stage.key));
            return;
        };
        self.begin(&script.0);
        for hook in HOOKS {
            if let Some(block) = script.0.node.find(hook, &script.0.src) {
                Walk::new(&script.0, stage.key.clone(), Scope::System, row).block(self, block);
            }
        }
    }

    fn take(&mut self, row: usize, stage: SectionStage) {
        match stage {
            SectionStage::Spawned => {}
            SectionStage::Built => self.build(row),
            SectionStage::Ruined => {
                self.ruin(row);
            }
            SectionStage::Restored => {
                if self.ruin(row) {
                    self.build(row);
                }
            }
            SectionStage::Damaged => self.damage(row),
        }
    }

    /// Build each stage that upgrades the row in turn, while the row stands.
    fn build(&mut self, row: usize) {
        let gd = self.gd;
        let mut seen: Vec<String> = Vec::new();
        while self.rows[row].standing {
            let kind = self.rows[row].laid.kind.clone();
            if seen.contains(&kind) {
                break;
            }
            let upgrades: Vec<&MegastructureDef> = gd
                .megastructures
                .iter()
                .filter(|def| def.upgrade_from.contains(&kind))
                .collect();
            let [stage] = upgrades[..] else {
                if upgrades.len() > 1 {
                    let keys: Vec<&str> = upgrades.iter().map(|def| def.key.as_str()).collect();
                    self.note(format!("{kind}: built over by {}", keys.join(", ")));
                } else if seen.is_empty() {
                    self.note(format!("{kind}: no stage builds over it"));
                }
                break;
            };
            seen.push(kind);
            self.stage(stage, row);
            if self.rows[row].standing {
                self.rows[row].laid.kind = stage.key.clone();
            }
        }
    }

    /// Put the row's ruin in its place, `false` when its type has none.
    ///
    /// The game spawns ruins from system initializers, never from a construction, so nothing
    /// in the files says where a ruin stands. The rule here: a `_ruined` type with no
    /// `upgrade_from` stands where a row of its working type stands, its working type being
    /// one whose key is the ruin's with `_ruined` taken off, or that followed by `_` and more
    /// (`ring_world_ruined` at a `ring_world_2` frame point). The ruin has no name and no
    /// culture of its own.
    fn ruin(&mut self, row: usize) -> bool {
        let kind = self.rows[row].laid.kind.clone();
        let ruin = self
            .gd
            .megastructures
            .iter()
            .filter(|def| def.upgrade_from.is_empty())
            .filter_map(|def| {
                let stem = def.key.strip_suffix(RUINED)?;
                let rest = kind.strip_prefix(stem)?;
                (rest.is_empty() || rest.starts_with('_')).then_some((stem.len(), &def.key))
            })
            .max_by_key(|(stem, _)| *stem)
            .map(|(_, key)| key.clone());
        let Some(ruin) = ruin else {
            self.note(format!("{kind}: no ruined type stands in its place"));
            return false;
        };
        let laid = &mut self.rows[row].laid;
        laid.kind = ruin;
        laid.name = None;
        laid.cultured = false;
        true
    }

    fn damage(&mut self, row: usize) {
        let gd = self.gd;
        let Some(effect) = gd.scripts.effect(RUIN_EFFECT) else {
            self.note(format!("{RUIN_EFFECT}: the install does not define it"));
            return;
        };
        self.begin(effect);
        Walk::new(effect, RUIN_EFFECT.to_owned(), Scope::Row(row), row).block(self, &effect.node);
        if self.rows[row].standing {
            let kind = self.rows[row].laid.kind.clone();
            self.note(format!("{RUIN_EFFECT}: leaves a {kind} row as it is"));
        }
    }

    /// Start a walk of `def`: event targets saved by an earlier one are gone, global ones
    /// aside.
    fn begin(&mut self, def: &Def) {
        self.targets.retain(|_, (_, global)| *global);
        self.learn_flags(def);
    }

    fn learn_flags(&mut self, def: &Def) {
        for key in ["set_star_flag", "remove_star_flag"] {
            let mut found = Vec::new();
            find_deep(&def.node, key, &def.src, &mut found);
            self.written_flags.extend(
                found
                    .iter()
                    .filter_map(|node| node.scalar_str(&def.src))
                    .map(str::to_owned),
            );
        }
    }

    fn position(&self, scope: Scope) -> Option<Orbit> {
        match scope {
            Scope::Row(row) => Some(self.rows[row].laid.at),
            Scope::Planet(planet) => Some(self.planets[planet].at),
            Scope::Host => Some(Orbit::new(Around::Host, 0.0, 0.0)),
            _ => None,
        }
    }

    fn cultured(&self, scope: Scope) -> bool {
        match scope {
            Scope::Owner => true,
            Scope::Row(row) => self.rows[row].laid.cultured,
            _ => false,
        }
    }

    fn note(&mut self, line: String) {
        if !self.unfollowed.contains(&line) {
            self.unfollowed.push(line);
        }
    }

    fn finish(self) -> SystemLayout {
        let standing = |row: &Row| row.standing.then(|| row.laid.clone());
        SystemLayout {
            row: standing(&self.rows[0]),
            sections: self
                .sections
                .iter()
                .map(|&(row, at)| Section {
                    at,
                    row: standing(&self.rows[row]),
                })
                .collect(),
            planets: self.planets,
            system_flags: self.system_flags,
            host_flags: self.host_flags,
            cleared: self.cleared,
            belts_cleared: self.belts_cleared,
            unfollowed: self.unfollowed,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Flow {
    Go,
    /// `break = yes`: the rest of the hook does not run.
    Break,
}

#[derive(Clone)]
struct Walk<'d> {
    def: &'d Def,
    params: Vec<(String, String)>,
    /// The scopes entered, `this` last and `prev` before it.
    stack: Vec<Scope>,
    /// `root`, `from` and `fromfrom`.
    frame: [Scope; 3],
    depth: usize,
    /// The stage or effect the walk is in, for what it lists as unfollowed.
    origin: String,
}

impl<'d> Walk<'d> {
    /// A walk of `def` standing in `this`, with row `row` as the structure built.
    fn new(def: &'d Def, origin: String, this: Scope, row: usize) -> Self {
        Self {
            def,
            params: Vec::new(),
            stack: vec![this],
            frame: [Scope::System, Scope::Owner, Scope::Row(row)],
            depth: 0,
            origin,
        }
    }

    fn this(&self) -> Scope {
        *self.stack.last().expect("a walk stands in a scope")
    }

    fn within(&self, scope: Scope) -> Self {
        let mut walk = self.clone();
        walk.stack.push(scope);
        walk
    }

    fn src(&self) -> &'d [u8] {
        &self.def.src
    }

    fn block(&self, st: &mut State<'d>, node: &Node) -> Flow {
        let src = self.src();
        let mut taken = false;
        for child in node.children() {
            let Some(key) = child.key_str(src) else {
                continue;
            };
            let key = self.substitute(key);
            let value = child.scalar_str(src).map(|v| self.substitute(v));
            let flow = match key.as_str() {
                _ if SILENT.contains(&key.as_str()) => Flow::Go,
                "if" => {
                    taken = false;
                    self.branch(st, child, &mut taken)
                }
                "else_if" => self.branch(st, child, &mut taken),
                "else" if taken => Flow::Go,
                "else" => {
                    taken = true;
                    self.block(st, child)
                }
                "hidden_effect" | "AND" => self.block(st, child),
                "break" if value.as_deref() == Some("yes") => Flow::Break,
                "save_event_target_as" | "save_global_event_target_as" => {
                    self.save_target(st, &key, value);
                    Flow::Go
                }
                _ if matches!(self.this(), Scope::Owner | Scope::Nothing) => Flow::Go,
                "spawn_megastructure" => {
                    self.spawn_row(st, child);
                    Flow::Go
                }
                "spawn_planet" => {
                    self.spawn_planet(st, child);
                    Flow::Go
                }
                "every_system_planet" => {
                    self.every_planet(st, child);
                    Flow::Go
                }
                "random_system_planet" if self.picks_ruin_body(st, child) => {
                    self.within(Scope::Host).block(st, child);
                    Flow::Go
                }
                _ => {
                    self.effect(st, &key, value, child);
                    Flow::Go
                }
            };
            if flow == Flow::Break {
                return Flow::Break;
            }
        }
        Flow::Go
    }

    /// An `if` or `else_if`, run when no earlier branch of its chain was and its `limit`
    /// holds. A limit the walk cannot judge runs neither it nor the rest of the chain.
    fn branch(&self, st: &mut State<'d>, node: &Node, taken: &mut bool) -> Flow {
        if *taken {
            return Flow::Go;
        }
        let holds = match node.find("limit", self.src()) {
            Some(limit) => self.all(st, limit),
            None => Some(true),
        };
        match holds {
            Some(true) => {
                *taken = true;
                self.block(st, node)
            }
            Some(false) => Flow::Go,
            None => {
                *taken = true;
                self.unjudged(st, node);
                Flow::Go
            }
        }
    }

    fn unjudged(&self, st: &mut State<'d>, node: &Node) {
        let src = self.src();
        let keys: Vec<&str> = node
            .find("limit", src)
            .map(|limit| {
                limit
                    .children()
                    .iter()
                    .filter_map(|c| c.key_str(src))
                    .collect()
            })
            .unwrap_or_default();
        self.note(st, &format!("a branch behind {}", keys.join(", ")));
    }

    fn effect(&self, st: &mut State<'d>, key: &str, value: Option<String>, node: &Node) {
        let this = self.this();
        match key {
            "remove_megastructure" => match value.as_deref().and_then(|v| self.scope_of(st, v)) {
                Some(Scope::Row(row)) => st.rows[row].standing = false,
                _ => self.note(st, "remove_megastructure of no row the walk knows"),
            },
            "set_asteroid_belt" => match self.numbers(node, ["radius"]) {
                Ok([Some(0.0)]) => st.belts_cleared = true,
                Ok(_) => self.note(st, "set_asteroid_belt that adds a belt"),
                Err(written) => self.note(st, &format!("set_asteroid_belt with {written}")),
            },
            "set_star_flag" | "remove_star_flag" if this == Scope::System => {
                let Some(flag) = value else {
                    return self.note(st, &format!("{key} with no plain value"));
                };
                st.written_flags.insert(flag.clone());
                if key == "set_star_flag" {
                    if !st.system_flags.contains(&flag) {
                        st.system_flags.push(flag);
                    }
                } else {
                    st.system_flags.retain(|f| *f != flag);
                }
            }
            "set_planet_flag" | "set_carrier_flag" | "remove_planet_flag" => {
                self.planet_flag(st, key, value);
            }
            "set_name" => self.name(st, node),
            "set_planet_entity" => self.model(st, node),
            "trigger_megastructure_icon" => match this {
                Scope::Planet(planet) => {
                    st.planets[planet].megastructure_icon = value.as_deref() == Some("yes");
                }
                _ => self.note(st, &format!("{key} on {}", self.scope_name())),
            },
            "set_graphical_culture" => match this {
                Scope::Row(row) => match value.as_deref().and_then(|v| self.scope_of(st, v)) {
                    Some(to) => {
                        let cultured = st.cultured(to);
                        st.rows[row].laid.cultured = cultured;
                    }
                    None => self.note(
                        st,
                        &format!("{key} = {}", value.as_deref().unwrap_or(BLOCK)),
                    ),
                },
                _ => self.note(st, &format!("{key} on {}", self.scope_name())),
            },
            _ if EVENT_KEYS.contains(&key) => {
                self.note(st, &format!("{key} on {}", self.scope_name()))
            }
            _ => {
                if let Some(scope) = self.scope_of(st, key) {
                    if node.scalar_span().is_none() {
                        self.enter(st, scope, node);
                    }
                    return;
                }
                match st.gd.scripts.effect(key) {
                    Some(effect) if self.depth < MAX_DEPTH => {
                        st.learn_flags(effect);
                        let mut inner = self.clone();
                        inner.params = self.arguments(node);
                        inner.def = effect;
                        inner.depth += 1;
                        inner.block(st, &effect.node);
                    }
                    _ => self.note(st, &format!("{key} on {}", self.scope_name())),
                }
            }
        }
    }

    /// Run a block that moves to `scope`, when its own `limit` holds. Of an owner's block
    /// only the event targets it saves are kept.
    fn enter(&self, st: &mut State<'d>, scope: Scope, node: &Node) {
        if scope == Scope::Owner {
            let owner = self.within(scope);
            let src = self.src();
            for child in node.children() {
                if let Some(key @ ("save_event_target_as" | "save_global_event_target_as")) =
                    child.key_str(src)
                {
                    let name = child.scalar_str(src).map(|v| self.substitute(v));
                    owner.save_target(st, key, name);
                }
            }
            return;
        }
        if scope == Scope::Nothing {
            return;
        }
        let walk = self.within(scope);
        if let Some(limit) = node.find("limit", self.src()) {
            match walk.all(st, limit) {
                Some(true) => {}
                Some(false) => return,
                None => return walk.unjudged(st, node),
            }
        }
        walk.block(st, node);
    }

    fn spawn_row(&self, st: &mut State<'d>, node: &Node) {
        self.unread(st, "spawn_megastructure", node, &ROW_KEYS);
        let Some(kind) = self.field(node, "type") else {
            return self.note(st, "spawn_megastructure with no type");
        };
        let spawn = format!("spawn_megastructure of {kind}");
        let [angle, distance] = match self.numbers(node, ["orbit_angle", "orbit_distance"]) {
            Ok(numbers) => numbers,
            Err(written) => return self.note(st, &format!("{spawn} with {written}")),
        };
        let at = match self.field(node, "coords_from") {
            Some(from) => {
                if angle.is_some() || distance.is_some() {
                    self.note(st, &format!("{spawn}: an orbit beside coords_from"));
                }
                match self.scope_of(st, &from).and_then(|s| st.position(s)) {
                    Some(at) => at,
                    None => return self.note(st, &format!("{spawn} at {from}")),
                }
            }
            None => Orbit::new(
                Around::Centre,
                angle.unwrap_or(0.0),
                distance.unwrap_or(0.0),
            ),
        };
        // `planet = star` links nothing: every row the game spawns with it holds no planet in
        // the save.
        let on_host = match self.written(node, "planet") {
            Some(planet) if planet == "star" => false,
            Some(planet) if self.scope_of(st, &planet) == Some(Scope::Host) => true,
            Some(planet) => {
                self.note(st, &format!("{spawn} with planet = {planet}"));
                false
            }
            None => false,
        };
        let owned = self.resolved(st, node, "owner", &spawn) == Some(Scope::Owner);
        let cultured = self
            .resolved(st, node, "graphical_culture", &spawn)
            .is_some_and(|s| st.cultured(s));
        let row = st.rows.len();
        st.rows.push(Row {
            laid: LaidRow {
                kind,
                at,
                name: self.field(node, "name"),
                system_name: None,
                owned,
                cultured,
                on_host,
            },
            standing: true,
        });
        st.sections.push((row, at));
        if let Some(init) = node.find("init_effect", self.src()) {
            self.within(Scope::Row(row)).block(st, init);
        }
    }

    fn spawn_planet(&self, st: &mut State<'d>, node: &Node) {
        self.unread(st, "spawn_planet", node, &PLANET_KEYS);
        let Some(class) = self.field(node, "class") else {
            return self.note(st, "spawn_planet with no class");
        };
        let spawn = format!("spawn_planet of {class}");
        let numbers = self.numbers(
            node,
            [
                "orbit_angle",
                "orbit_angle_offset",
                "orbit_distance",
                "orbit_distance_offset",
                "size",
            ],
        );
        let [angle, angle_offset, distance, distance_offset, size] = match numbers {
            Ok(numbers) => numbers,
            Err(written) => return self.note(st, &format!("{spawn} with {written}")),
        };
        let location = self
            .field(node, "location")
            .and_then(|l| self.scope_of(st, &l));
        let orbits = self.field(node, "orbit_location").as_deref() == Some("yes");
        let at = match (location, orbits) {
            // Round its location the offsets are from game angle 0 and from the location
            // itself: every habitat in a 4.5 save stands 135 degrees round, whatever its
            // host's own angle.
            (Some(Scope::Host), true) => {
                for (pair, both) in [
                    (
                        "orbit_angle and orbit_angle_offset",
                        angle.zip(angle_offset),
                    ),
                    (
                        "orbit_distance and orbit_distance_offset",
                        distance.zip(distance_offset),
                    ),
                ] {
                    if both.is_some() {
                        self.note(st, &format!("{spawn} with both {pair} round its location"));
                    }
                }
                Some(Orbit::new(
                    Around::Host,
                    angle.or(angle_offset).unwrap_or(0.0),
                    distance.or(distance_offset).unwrap_or(0.0),
                ))
            }
            (Some(location), false) => st
                .position(location)
                .filter(|base| base.around == Around::Centre)
                .map(|base| {
                    Orbit::new(
                        Around::Centre,
                        angle.unwrap_or(base.angle + angle_offset.unwrap_or(0.0)),
                        distance.unwrap_or(base.distance + distance_offset.unwrap_or(0.0)),
                    )
                }),
            _ => None,
        };
        let Some(at) = at else {
            return self.note(st, &format!("{spawn} at a place the walk cannot set"));
        };
        if self.field(node, "has_ring").as_deref() == Some("yes") {
            self.note(st, &format!("{spawn} with a ring"));
        }
        let size = size.map(whole).or_else(|| {
            let fixed = st.gd.planet_classes.get(&class)?.planet_size?;
            (fixed.min == fixed.max).then(|| whole(fixed.min))
        });
        let planet = st.planets.len();
        st.planets.push(LaidPlanet {
            class,
            size,
            at,
            section: st.section,
            name: None,
            model: None,
            flags: Vec::new(),
            megastructure_icon: false,
        });
        if let Some(init) = node.find("init_effect", self.src()) {
            self.within(Scope::Planet(planet)).block(st, init);
        }
    }

    /// `every_system_planet`: kept only when it removes every planet that is not a star.
    fn every_planet(&self, st: &mut State<'d>, node: &Node) {
        let src = self.src();
        let removes = node.children().iter().any(|child| {
            child.key_str(src) == Some("remove_planet") && child.scalar_str(src) == Some("yes")
        });
        let limit = node.find("limit", src).map(|l| Condition::compile(l, src));
        match limit {
            Some(Condition::All(items)) if removes && items == [Condition::Star(false)] => {
                st.cleared = true;
                for child in node.children() {
                    if let Some(key) = child.key_str(src)
                        && key != "remove_planet"
                        && !SILENT.contains(&key)
                        && !CLEARING_NOOPS.contains(&key)
                    {
                        self.note(st, &format!("every_system_planet's {key}"));
                    }
                }
            }
            _ if removes => self.note(
                st,
                "every_system_planet removing planets the walk cannot tell",
            ),
            _ => self.note(st, "every_system_planet"),
        }
    }

    fn planet_flag(&self, st: &mut State<'d>, key: &str, value: Option<String>) {
        let Some(value) = value else {
            return self.note(st, &format!("{key} with no plain value"));
        };
        let (flag, id_of) = match value.split_once('@') {
            Some((flag, scope)) => match self.scope_of(st, scope) {
                Some(Scope::Planet(planet)) => (flag, Some(IdOf::Planet(planet))),
                Some(Scope::Owner) => (flag, Some(IdOf::Owner)),
                _ => return self.note(st, &format!("{key} = {value}")),
            },
            None => (value.as_str(), None),
        };
        let flag = LaidFlag {
            flag: flag.to_owned(),
            id_of,
        };
        let flags = match self.this() {
            Scope::Planet(planet) => &mut st.planets[planet].flags,
            Scope::Host => &mut st.host_flags,
            _ => return self.note(st, &format!("{key} on {}", self.scope_name())),
        };
        if key == "remove_planet_flag" {
            flags.retain(|f| f.flag != flag.flag);
        } else if !flags.contains(&flag) {
            flags.push(flag);
        }
    }

    fn name(&self, st: &mut State<'d>, node: &Node) {
        let name = match node.scalar_str(self.src()) {
            Some(key) => Some(LaidName {
                key: self.substitute(key),
                variables: Vec::new(),
            }),
            None => self.field(node, "key").map(|key| LaidName {
                key,
                variables: self
                    .field(node, "variable_string")
                    .map(|text| bracketed(&text))
                    .unwrap_or_default(),
            }),
        };
        let Some(name) = name else {
            return self.note(st, "set_name with no key");
        };
        match self.this() {
            Scope::Planet(planet) => st.planets[planet].name = Some(name),
            Scope::Row(row) => {
                let system_name = match &name.variables[..] {
                    [] => None,
                    [variable] if self.names_system(st, variable) => Some(variable.clone()),
                    _ => {
                        let variables = name.variables.join(", ");
                        return self.note(st, &format!("set_name on a row with {variables}"));
                    }
                };
                let laid = &mut st.rows[row].laid;
                laid.name = Some(name.key);
                laid.system_name = system_name;
            }
            _ => self.note(st, &format!("set_name on {}", self.scope_name())),
        }
    }

    /// Whether name variable `variable`, such as `prevprev.GetName`, is the name of the
    /// system.
    fn names_system(&self, st: &State<'d>, variable: &str) -> bool {
        variable
            .strip_suffix(".GetName")
            .and_then(|scope| self.scope_of(st, scope))
            == Some(Scope::System)
    }

    /// Whether `random_system_planet` block `node` picks the body the structure stands at:
    /// a stage that restores a ruin picks the ruin's body by the one planet flag its limit
    /// tests, which the ruin's spawn set there. Mods test it as a carrier flag.
    fn picks_ruin_body(&self, st: &State<'d>, node: &Node) -> bool {
        let src = self.src();
        let restores = st
            .gd
            .megastructures
            .get(&self.origin)
            .is_some_and(|def| def.upgrade_from.iter().any(|from| from.ends_with(RUINED)));
        let flagged = node.find("limit", src).is_some_and(|limit| {
            matches!(
                limit.children(),
                [test] if matches!(test.key_str(src), Some("has_planet_flag" | "has_carrier_flag"))
            )
        });
        restores && flagged && self.this() == Scope::System && self.frame[2] == Scope::Row(0)
    }

    fn model(&self, st: &mut State<'d>, node: &Node) {
        let Some(entity) = self.field(node, "entity") else {
            return self.note(st, "set_planet_entity with no entity");
        };
        let cultured = self
            .resolved(st, node, "graphical_culture", "set_planet_entity")
            .is_some_and(|scope| st.cultured(scope));
        match self.this() {
            Scope::Planet(planet) => {
                st.planets[planet].model = Some(LaidModel { entity, cultured });
            }
            _ => self.note(st, &format!("set_planet_entity on {}", self.scope_name())),
        }
    }

    /// Every child of `node` but the conditions holds, in three-valued logic.
    fn all(&self, st: &State<'d>, node: &Node) -> Option<bool> {
        settle(node.children().iter().map(|c| self.test(st, c)), false)
    }

    fn any(&self, st: &State<'d>, node: &Node) -> Option<bool> {
        settle(node.children().iter().map(|c| self.test(st, c)), true)
    }

    /// One condition, judged where the walk stands; `None` when the walk cannot tell.
    fn test(&self, st: &State<'d>, node: &Node) -> Option<bool> {
        let key = self.substitute(node.key_str(self.src())?);
        let value = node.scalar_str(self.src()).map(|v| self.substitute(v));
        let yes = || match value.as_deref() {
            Some("yes") => Some(true),
            Some("no") => Some(false),
            _ => None,
        };
        match key.as_str() {
            "AND" => self.all(st, node),
            "OR" => self.any(st, node),
            "NOT" | "NOR" => self.any(st, node).map(|holds| !holds),
            "NAND" => self.all(st, node).map(|holds| !holds),
            "always" => yes(),
            "is_star" => match self.this() {
                Scope::Host => Some(st.on_star == yes()?),
                Scope::Planet(_) => Some(!yes()?),
                _ => None,
            },
            "has_star_flag" => {
                let flag = value?;
                st.written_flags
                    .contains(&flag)
                    .then(|| st.system_flags.contains(&flag))
            }
            "is_megastructure_type" => match self.this() {
                Scope::Row(row) => Some(st.rows[row].laid.kind == value?),
                _ => None,
            },
            _ => match self.scope_of(st, &key) {
                Some(scope) if value.is_none() && scope != Scope::Owner => {
                    self.within(scope).all(st, node)
                }
                _ => None,
            },
        }
    }

    /// The scope a key such as `fromfrom.planet`, `prev` or `event_target:name` leads to;
    /// `None` when it is no scope this walk knows.
    fn scope_of(&self, st: &State<'d>, key: &str) -> Option<Scope> {
        let mut links = key.split('.').map(str::to_ascii_lowercase);
        let first = links.next()?;
        let back = |n: usize| self.stack.len().checked_sub(n + 1).map(|at| self.stack[at]);
        let mut scope = match first.as_str() {
            "root" => self.frame[0],
            "from" => self.frame[1],
            "fromfrom" => self.frame[2],
            "this" => self.this(),
            "prev" => back(1)?,
            "prevprev" => back(2)?,
            "solar_system" => Scope::System,
            _ => st.targets.get(first.strip_prefix("event_target:")?)?.0,
        };
        let mut at_root = first == "root";
        for link in links {
            scope = match (link.as_str(), scope) {
                ("from", _) if at_root => self.frame[1],
                ("fromfrom", _) if at_root => self.frame[2],
                ("planet", Scope::Row(row)) if st.rows[row].laid.on_host => Scope::Host,
                ("planet", Scope::Row(_)) => Scope::Nothing,
                ("owner", Scope::Row(row)) if st.rows[row].laid.owned => Scope::Owner,
                ("owner", Scope::Row(_)) => Scope::Nothing,
                ("solar_system", _) => Scope::System,
                _ => return None,
            };
            at_root = false;
        }
        Some(scope)
    }

    fn scope_name(&self) -> &'static str {
        match self.this() {
            Scope::System => "the system",
            Scope::Owner => "the owner",
            Scope::Row(_) => "a row",
            Scope::Host => "its body",
            Scope::Planet(_) => "a spawned planet",
            Scope::Nothing => "nothing",
        }
    }

    /// List each key of a spawn block the walk does not read.
    fn unread(&self, st: &mut State<'d>, spawn: &str, node: &Node, read: &[&str]) {
        for child in node.children() {
            if let Some(key) = child.key_str(self.src())
                && !read.contains(&key)
            {
                self.note(st, &format!("{spawn}'s {key}"));
            }
        }
    }

    fn field(&self, node: &Node, name: &str) -> Option<String> {
        let value = node.find(name, self.src())?.scalar_str(self.src())?;
        Some(self.substitute(value))
    }

    /// What `name` is written as in `node`, a block shown as [`BLOCK`]; `None` when absent.
    fn written(&self, node: &Node, name: &str) -> Option<String> {
        node.find(name, self.src())?;
        Some(
            self.def
                .written_in(node, name)
                .map_or_else(|| BLOCK.to_owned(), |v| self.substitute(&v)),
        )
    }

    /// The numbers `names` of `node`, each `None` when absent; `Err` with what is written
    /// when one is present but is no number, such as a range, a script value, an
    /// `@variable` no file defines or a parameter left unfilled.
    fn numbers<const N: usize>(
        &self,
        node: &Node,
        names: [&str; N],
    ) -> Result<[Option<f64>; N], String> {
        let mut out = [None; N];
        for (slot, name) in out.iter_mut().zip(names) {
            let Some(written) = self.written(node, name) else {
                continue;
            };
            match self.def.number_of(&written) {
                Some(n) => *slot = Some(n),
                None => return Err(format!("{name} = {written}")),
            }
        }
        Ok(out)
    }

    /// The scope `name` of `node` names, noting one that is written but leads nowhere the
    /// walk knows.
    fn resolved(&self, st: &mut State<'d>, node: &Node, name: &str, what: &str) -> Option<Scope> {
        let written = self.written(node, name)?;
        let scope = self.scope_of(st, &written);
        if scope.is_none() {
            self.note(st, &format!("{what} with {name} = {written}"));
        }
        scope
    }

    fn save_target(&self, st: &mut State<'d>, key: &str, name: Option<String>) {
        match name {
            Some(name) => {
                let global = key == "save_global_event_target_as";
                st.targets
                    .insert(name.to_ascii_lowercase(), (self.this(), global));
            }
            None => self.note(st, &format!("{key} with no plain value")),
        }
    }

    fn note(&self, st: &mut State<'d>, what: &str) {
        st.note(format!("{}: {what}", self.origin));
    }

    fn arguments(&self, call: &Node) -> Vec<(String, String)> {
        let src = self.src();
        let args = call.children();
        (0..args.len())
            .filter_map(|at| {
                let name = args[at].key_str(src)?;
                let value = written(args, at, src)?;
                Some((name.to_owned(), self.substitute(&value)))
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

/// Kleene logic over `items`: `deciding` (`false` for all, `true` for any) settles it
/// outright; otherwise an unknown item leaves it unknown.
fn settle(items: impl Iterator<Item = Option<bool>>, deciding: bool) -> Option<bool> {
    let mut unknown = false;
    for item in items {
        match item {
            Some(holds) if holds == deciding => return Some(deciding),
            Some(_) => {}
            None => unknown = true,
        }
    }
    (!unknown).then_some(!deciding)
}

/// The names a `variable_string` fills in: what stands between each `[` and its `]`.
fn bracketed(text: &str) -> Vec<String> {
    text.split('[')
        .skip(1)
        .filter_map(|part| part.split_once(']').map(|(name, _)| name.to_owned()))
        .collect()
}
