//! Scripted ownership and per-system scripts: what a `static_galaxy_scenario`
//! document's systems are given to at generation, and which scripts in loaded
//! game data have anything to say about one system.
//!
//! Guards (`if`, `limit`) are read as if they were true, and an owner set
//! through a scope (`prev`, `from`, `this`, `root`) is left unresolved.

pub mod bypasses;
pub mod chain;
pub mod claims;
pub mod facts;
pub mod identity;
pub mod index;
pub mod init_bypasses;
pub mod owners;
pub(crate) mod scan;
pub(crate) mod scope;
pub mod system;
pub mod trigger;
pub mod view;

pub use index::{CreatedCountry, Prescripted, RefSite, ScriptIndex, SiteKind};
pub use view::{
    BypassKind, BypassSource, OwnerIdentity, OwnerTier, ROW_KIND_ORDER, ROW_LIMIT, ReferenceVia,
    SITE_LIMIT, ScenarioBypass, ScenarioBypasses, ScenarioOwners, ScenarioSystem, ScriptRef,
    ScriptRow, ScriptRowKind, ScriptSite, ScriptTiming, SystemColony, SystemOwner, SystemOwnerView,
    SystemScripts, TERRITORY_BASE, Territory, UnresolvedOwner,
};

use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use sgf_core::session::Session;

use crate::GameData;

impl<'a> ScenarioSystem<'a> {
    /// A system naming `initializer`, where the empty string means "random", which has none.
    pub const fn new(id: u32, initializer: &'a str, effect: Option<&'a str>) -> Self {
        Self {
            id,
            initializer: Self::initializer_of(initializer),
            effect,
        }
    }

    /// A scenario system's initializer key; the empty string means "random", which has none.
    pub const fn initializer_of(key: &str) -> Option<&str> {
        if key.is_empty() { None } else { Some(key) }
    }

    /// Every system of `session` as the scripts see it, with the digest of what the
    /// territories are computed from, for a cache to be keyed on.
    pub fn of_session<T>(session: &Session, f: impl FnOnce(&[ScenarioSystem<'_>], u64) -> T) -> T {
        let effects = session.scenario_system_effects();
        let by_system: HashMap<u32, &str> = effects
            .iter()
            .map(|(id, text, _)| (*id, text.as_str()))
            .collect();
        let systems: Vec<ScenarioSystem<'_>> = session
            .graph
            .systems
            .values()
            .map(|s| ScenarioSystem::new(s.id, &s.initializer, by_system.get(&s.id).copied()))
            .collect();
        f(&systems, digest(&systems))
    }
}

/// What the territories are computed from: every system's id, initializer and effect.
fn digest(systems: &[ScenarioSystem<'_>]) -> u64 {
    let mut hasher = DefaultHasher::new();
    systems.len().hash(&mut hasher);
    for system in systems {
        system.id.hash(&mut hasher);
        system.initializer.hash(&mut hasher);
        system.effect.hash(&mut hasher);
    }
    hasher.finish()
}

impl GameData {
    /// The territories the scenario's systems describe: the initializer each
    /// system names and the `effect` its statement carries.
    pub fn scenario_owners(&self, systems: &[ScenarioSystem<'_>]) -> ScenarioOwners {
        owners::scenario_owners(self, systems)
    }

    /// The bypasses the scenario's systems carry before the player's first
    /// frame: their initializers' own, and the day-one events' placements.
    pub fn scenario_bypasses(&self, systems: &[ScenarioSystem<'_>]) -> ScenarioBypasses {
        bypasses::scenario_bypasses(self, systems)
    }

    /// One system's Scripts section. `scenario_effect` is the system
    /// statement's own `effect = { … }` text and the line it starts on.
    pub fn system_scripts(
        &self,
        system: u32,
        initializer: Option<&str>,
        scenario_effect: Option<(String, u32)>,
    ) -> SystemScripts {
        system::system_scripts(self, system, initializer, scenario_effect)
    }
}
