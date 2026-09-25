//! `common/deposits`: orbital resource deposits and planetary features and
//! blockers, keyed the same way the save's `deposit` entities are.

use sgf_core::cst::Node;

use crate::GameData;
use crate::deposit_roll::DepositRoll;
use crate::install::script::{self, Def};
use crate::registries::deposit_categories::DepositCategory;
use crate::registries::registry::{FromDef, Registry};

pub type Deposits = Registry<DepositDef>;

#[derive(Debug, Clone, PartialEq)]
pub struct DepositDef {
    pub key: String,
    pub icon: Option<String>,
    pub category: Option<String>,
    pub produces: Vec<(String, f64)>,
    /// `is_for_colonizable = yes`: a random roll gives it to bodies that can be colonised,
    /// and otherwise to those that cannot. The game reads a missing key as `no`.
    pub is_for_colonizable: bool,
    /// The station class that works it from orbit; `none` or absent for one the colony works.
    pub station: Option<String>,
    /// Every `planet_modifier` line, then the lines of each `triggered_planet_modifier`
    /// with no `potential`: what the deposit does to the planet it sits on.
    pub planet_modifier: Vec<(String, f64)>,
    /// The `triggered_planet_modifier`s that apply once the owner has a technology.
    pub side_effects: Vec<SideEffect>,
    /// `resources = { cost = { … } }`: what clearing a blocker costs.
    pub cost: Vec<(String, f64)>,
    /// Days to clear a blocker.
    pub time: Option<f64>,
    /// The technologies clearing a blocker needs.
    pub prerequisites: Vec<String>,
    /// What the random roll for a new body reads.
    pub roll: DepositRoll,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SideEffect {
    pub tech: String,
    pub modifiers: Vec<(String, f64)>,
}

impl DepositDef {
    /// Worked by an orbital station rather than by the colony.
    pub fn orbital(&self) -> bool {
        self.station
            .as_deref()
            .is_some_and(|station| station != "none")
    }

    /// The file under `gfx/interface/icons/deposits/`, without `.dds`.
    pub fn texture_icon(&self) -> &str {
        self.icon.as_deref().unwrap_or(&self.key)
    }
}

impl GameData {
    /// The `deposit_categories` entry `deposit` names.
    pub fn deposit_category(&self, deposit: &DepositDef) -> Option<&DepositCategory> {
        self.deposit_categories.get(deposit.category.as_deref()?)
    }

    /// A deposit whose category says `blocker = yes`.
    pub fn is_blocker(&self, deposit: &str) -> bool {
        self.deposits
            .get(deposit)
            .and_then(|d| self.deposit_category(d))
            .is_some_and(|category| category.blocker)
    }
}

impl FromDef for DepositDef {
    const DIR: &'static str = "common/deposits";

    fn read(key: String, def: &Def) -> Self {
        let src = &def.src;
        let resources = def.node.find("resources", src);
        // Orbital deposits nest `category` under `resources`; planetary features
        // and blockers, which have no `resources` block, write it at top level.
        let category = def.scalar("category").map(str::to_owned).or_else(|| {
            resources
                .and_then(|r| r.find("category", src)?.scalar_str(src))
                .map(str::to_owned)
        });
        let numbers_in = |key: &str| {
            resources
                .and_then(|r| r.find(key, src))
                .map(|block| def.numbers(block))
                .unwrap_or_default()
        };
        let (always, side_effects) = triggered(def);
        Self {
            icon: def.scalar("icon").map(str::to_owned),
            category,
            produces: numbers_in("produces"),
            is_for_colonizable: def.flag("is_for_colonizable"),
            station: def.scalar("station").map(str::to_owned),
            planet_modifier: def
                .node
                .find_all("planet_modifier", src)
                .flat_map(|block| def.numbers(block))
                .chain(always)
                .collect(),
            side_effects,
            cost: numbers_in("cost"),
            time: def.number("time"),
            prerequisites: script::list_items(&def.node, "prerequisites", src),
            roll: DepositRoll::read(def),
            key,
        }
    }
}

/// The `triggered_planet_modifier`s the planet page shows: one with no `potential` always
/// applies, and one gated on a technology is a side effect. The others hang on civics,
/// origins or buildings. Where a technology has a regular and a gestalt branch, only the
/// regular empire's lines are kept.
fn triggered(def: &Def) -> (Vec<(String, f64)>, Vec<SideEffect>) {
    let src = &def.src;
    let mut always = Vec::new();
    let mut gated: Vec<(SideEffect, bool)> = Vec::new();
    for block in def.node.find_all("triggered_planet_modifier", src) {
        let lines = triggered_lines(def, block);
        let Some(potential) = block.find("potential", src) else {
            always.extend(lines);
            continue;
        };
        let mut techs = Vec::new();
        script::find_deep(potential, "has_technology", src, &mut techs);
        let Some(tech) = techs.first().and_then(|t| t.scalar_str(src)) else {
            continue;
        };
        let side = SideEffect {
            tech: tech.to_owned(),
            modifiers: lines,
        };
        gated.push((side, asks_for_gestalt(potential, src)));
    }
    let has_regular = |tech: &str| gated.iter().any(|(s, gestalt)| !gestalt && s.tech == tech);
    let side_effects = gated
        .iter()
        .filter(|(side, gestalt)| !gestalt || !has_regular(&side.tech))
        .map(|(side, _)| side.clone())
        .collect();
    (always, side_effects)
}

/// A triggered block's lines, written directly in it or in a nested `modifier = { … }`.
fn triggered_lines(def: &Def, block: &Node) -> Vec<(String, f64)> {
    let mut lines = def.numbers(block);
    lines.retain(|(key, _)| key != "mult" && key != "multiplier");
    lines.extend(
        block
            .find_all("modifier", &def.src)
            .flat_map(|modifier| def.numbers(modifier)),
    );
    lines
}

/// Whether a trigger asks for a gestalt empire outside any `NOT` or `NOR`: `is_gestalt`,
/// `is_machine_empire` or `is_hive_empire = yes`, `is_regular_empire = no`, a machine or hive
/// `has_authority`, or `has_ethic = ethic_gestalt_consciousness`.
fn asks_for_gestalt(node: &Node, src: &[u8]) -> bool {
    node.children()
        .iter()
        .any(|child| match (child.key_str(src), child.scalar_str(src)) {
            (Some("NOT" | "NOR"), _) => false,
            (Some("is_gestalt" | "is_machine_empire" | "is_hive_empire"), Some(v)) => v == "yes",
            (Some("is_regular_empire"), Some(v)) => v == "no",
            (Some("has_authority"), Some(v)) => {
                matches!(v, "auth_machine_intelligence" | "auth_hive_mind")
            }
            (Some("has_ethic"), Some(v)) => v == "ethic_gestalt_consciousness",
            _ => asks_for_gestalt(child, src),
        })
}
