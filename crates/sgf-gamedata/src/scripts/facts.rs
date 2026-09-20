//! What a scenario's systems are true of before the day-one events run:
//! each system's star flags and whether it already has a starbase, and the
//! galaxy-wide sets a claim's conditions are judged against.
//!
//! Every initializer runs before day one, so the global flags and the saved
//! event targets are one union over the whole scenario, order-free.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::GameData;
use crate::scripts::chain::{self, Chain};
use crate::scripts::view::ScenarioSystem;

/// One system at the end of galaxy generation.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct SystemFacts {
    /// The initializer's own `flags` list, the `set_star_flag`s its chain
    /// runs, and those the scenario statement's own effect runs.
    pub star_flags: BTreeSet<String>,
    pub has_starbase: bool,
}

impl SystemFacts {
    /// This system beside the galaxy, as the trigger evaluator reads it.
    pub fn view<'a>(&'a self, galaxy: &'a ScenarioFacts) -> FactsView<'a> {
        FactsView {
            star_flags: &self.star_flags,
            global_flags: &galaxy.global_flags,
            has_starbase: self.has_starbase,
            saved_targets: &galaxy.saved_targets,
        }
    }
}

/// Everything a claim's `limit` can be judged by: the system's own facts and
/// the galaxy's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FactsView<'a> {
    pub star_flags: &'a BTreeSet<String>,
    pub global_flags: &'a BTreeSet<String>,
    pub has_starbase: bool,
    /// Every `event_target:` any chain in the scenario saved.
    pub saved_targets: &'a BTreeSet<String>,
}

/// Every scenario system's facts, the galaxy-wide unions, and the chains
/// they were read from: one per initializer key, shared with the owner pass.
#[derive(Debug, Default)]
pub struct ScenarioFacts {
    systems: BTreeMap<u32, SystemFacts>,
    global_flags: BTreeSet<String>,
    saved_targets: BTreeSet<String>,
    chains: HashMap<String, Chain>,
    effects: BTreeMap<u32, Chain>,
}

impl ScenarioFacts {
    pub fn system(&self, system: u32) -> Option<&SystemFacts> {
        self.systems.get(&system)
    }

    /// The flags every initializer in the scenario set globally.
    pub fn global_flags(&self) -> &BTreeSet<String> {
        &self.global_flags
    }

    /// Every `event_target:` the scenario's chains saved.
    pub fn saved_targets(&self) -> &BTreeSet<String> {
        &self.saved_targets
    }

    /// The chain walked for an initializer key, walked once per scenario.
    pub fn chain(&self, initializer: &str) -> Option<&Chain> {
        self.chains.get(initializer)
    }

    /// The chain walked for a system statement's own `effect = { … }`.
    pub fn effect(&self, system: u32) -> Option<&Chain> {
        self.effects.get(&system)
    }

    pub fn view(&self, system: u32) -> Option<FactsView<'_>> {
        self.system(system).map(|facts| facts.view(self))
    }
}

/// Read every system's facts, walking each initializer once however many
/// systems name it.
pub fn scenario_facts(gd: &GameData, systems: &[ScenarioSystem<'_>]) -> ScenarioFacts {
    let mut chains: HashMap<String, Chain> = HashMap::new();
    let mut effects: BTreeMap<u32, Chain> = BTreeMap::new();
    for system in systems {
        if let Some(key) = system.initializer
            && !chains.contains_key(key)
        {
            chains.insert(
                key.to_owned(),
                chain::walk(&gd.scripts, &gd.initializers, key),
            );
        }
        if let Some(text) = system.effect.filter(|t| !t.trim().is_empty()) {
            effects
                .entry(system.id)
                .or_insert_with(|| chain::walk_effect(&gd.scripts, text));
        }
    }

    let mut global_flags = BTreeSet::new();
    let mut saved_targets = BTreeSet::new();
    for chain in chains.values().chain(effects.values()) {
        global_flags.extend(chain.global_flags.iter().cloned());
        saved_targets.extend(chain.saved_targets.iter().map(|(token, _)| token.clone()));
    }

    let mut facts: BTreeMap<u32, SystemFacts> = BTreeMap::new();
    for system in systems {
        let entry = facts.entry(system.id).or_default();
        let own = system.initializer.and_then(|key| chains.get(key));
        for chain in own.into_iter().chain(effects.get(&system.id)) {
            entry.star_flags.extend(chain.star_flags.iter().cloned());
            entry.has_starbase |= chain.has_starbase;
        }
    }

    ScenarioFacts {
        systems: facts,
        global_flags,
        saved_targets,
        chains,
        effects,
    }
}
