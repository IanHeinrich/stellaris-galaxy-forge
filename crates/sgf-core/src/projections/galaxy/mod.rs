//! The galaxy graph: systems, hyperlanes, nebulae and bypasses, whichever document they
//! were read from.
//!
//! The types here are what the map, the ops and the validator work in; reading a document
//! into them belongs to its format (`format::save::galaxy` for a `.sav`,
//! `format::scenario` for a scenario script).

mod bypasses;
mod countries;
mod nebulae;
mod spawn;
mod systems;
mod waylines;

use std::collections::{HashMap, HashSet};
use std::ops::{Deref, DerefMut};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cst::CstError;
use crate::projections::name::NameTemplate;
use crate::views::DocumentKind;

pub use bypasses::BypassLink;
pub use countries::{CountryNode, FlagRef};
pub use nebulae::Nebula;
pub(crate) use nebulae::nearest_prospective;
pub use spawn::{
    PaintSpawnKind, SpawnModifier, SpawnReservation, SpawnReservationPreset, SpawnScript,
};
pub use systems::{Lane, SystemNode, lane_length};
pub(crate) use waylines::bypass_between;
pub use waylines::{Wayline, Waystation};

#[derive(Debug, thiserror::Error)]
pub enum ProjectionError {
    #[error("{section}: {source}")]
    Section {
        section: &'static str,
        #[source]
        source: CstError,
    },
    #[error("{section} {id}: {source}")]
    Entity {
        section: &'static str,
        id: u64,
        #[source]
        source: CstError,
    },
    #[error("{section} {id}: {reason}")]
    EntityField {
        section: &'static str,
        id: u64,
        reason: String,
    },
    #[error("{section}: {reason}")]
    SectionField {
        section: &'static str,
        reason: String,
    },
}

/// One header key as it currently reads, for the app's header list.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HeaderField {
    /// As written; a key such as `supports_shape` may repeat.
    pub key: String,
    /// The raw text right of `=`, scalar or block, exactly as the file holds it.
    pub value: String,
    /// The 1-based line the statement starts on in the file as opened.
    pub line: u32,
}

/// The galaxy as any document holding one describes it: where the systems are, what
/// connects them and what clouds them. Nothing here is particular to a `.sav`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Galaxy {
    pub systems: HashMap<u32, SystemNode>,
    /// System ids in file order.
    pub order: Vec<u32>,
    pub nebulae: Vec<Nebula>,
    pub bypasses: Vec<BypassLink>,
    /// The waystations the document holds, sorted by network then system; they change
    /// only at load, since nothing here writes one.
    pub waystations: Vec<Waystation>,
    /// The waylines [`Waystation`]s currently run, derived from the connections between
    /// them and so recomputed whenever the lanes change.
    pub waylines: Vec<Wayline>,
    pub galaxy_radius: f64,
    pub core_radius: f64,
    /// A scenario's header keys as they currently read, in file order; empty for a save.
    pub header: Vec<HeaderField>,
    /// Which document the galaxy was read from, for the checks that apply to one kind.
    pub kind: DocumentKind,
    /// A scenario header's `num_empires.max` and `num_empire_default`, where it states
    /// them; always `None` for a save.
    pub num_empires_max: Option<u32>,
    pub num_empire_default: Option<u32>,
}

/// A save's galaxy: the plain values plus the state only a `.sav` carries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GalaxyGraph {
    galaxy: Galaxy,
    pub countries: Vec<CountryNode>,
    /// Connected components (undirected, over lanes) counted at build.
    pub baseline_components: usize,
    /// System id → index of the component it belonged to at build (`components()` order).
    pub baseline_component: HashMap<u32, usize>,
    /// Sector id → owning country id, from the top-level `sectors` section. Used to resolve
    /// `SystemNode::owner` at build and in `refresh_system`.
    pub(crate) sector_owner: HashMap<u32, u32>,
    /// Starbase id → the country running it (`starbases::starbase_owners`); a system with
    /// no sector owner belongs to whoever runs its first starbase.
    pub(crate) starbase_owner: HashMap<u32, u32>,
}

/// A name key as the UI shows it until real localisation exists: key prefix dropped,
/// underscores as spaces.
pub fn display_name(key: &str) -> String {
    let stripped = ["NAME_", "STAR_NAME_", "SPEC_"]
        .iter()
        .find_map(|prefix| key.strip_prefix(prefix))
        .unwrap_or(key);
    stripped.replace('_', " ").trim().to_owned()
}

/// A name as the UI shows it until real localisation exists: a literal name as written,
/// any other key through [`display_name`].
pub fn display_template(name: &NameTemplate) -> String {
    if name.literal {
        name.key.clone()
    } else {
        display_name(&name.key)
    }
}

impl Galaxy {
    /// The lane from `a` to `b` as listed on `a`.
    pub fn lane(&self, a: u32, b: u32) -> Option<&Lane> {
        self.systems.get(&a)?.lanes.iter().find(|l| l.to == b)
    }

    /// Replace the nebulae and derive each one's members from its radius, as a document
    /// that stores no member lists needs. Returns the systems whose membership changed.
    pub fn set_nebulae_by_radius(&mut self, mut nebulae: Vec<Nebula>) -> Vec<u32> {
        nebulae::fill_by_radius(&mut nebulae, &self.systems);
        self.nebulae = nebulae;
        self.assign_nebulae()
    }

    /// Point each system at the nebula listing it. Returns the systems whose membership
    /// changed, ascending.
    pub(crate) fn assign_nebulae(&mut self) -> Vec<u32> {
        nebulae::assign(&mut self.systems, &self.nebulae)
    }

    /// Re-measure the lanes of `ids` and of their neighbours against [`lane_length`], and
    /// derive the waylines again from the connections the edit leaves; run once those
    /// systems hold their new positions, because staleness depends on both ends.
    pub fn refresh_stale(&mut self, ids: &[u32]) {
        systems::mark_stale(&mut self.systems, ids);
        let waylines = waylines::compute(self);
        self.waylines = waylines;
    }

    /// Connected components over lanes (undirected); each sorted by id, largest first.
    pub fn components(&self) -> Vec<Vec<u32>> {
        let mut adjacent: HashMap<u32, Vec<u32>> = HashMap::with_capacity(self.systems.len());
        for system in self.systems.values() {
            adjacent.entry(system.id).or_default();
            for lane in &system.lanes {
                if self.systems.contains_key(&lane.to) {
                    adjacent.entry(system.id).or_default().push(lane.to);
                    adjacent.entry(lane.to).or_default().push(system.id);
                }
            }
        }
        let mut seen = HashSet::with_capacity(self.systems.len());
        let mut components = Vec::new();
        let mut ids: Vec<u32> = self.systems.keys().copied().collect();
        ids.sort_unstable();
        for start in ids {
            if !seen.insert(start) {
                continue;
            }
            let mut component = vec![start];
            let mut stack = vec![start];
            while let Some(id) = stack.pop() {
                for &next in adjacent.get(&id).map(Vec::as_slice).unwrap_or(&[]) {
                    if seen.insert(next) {
                        component.push(next);
                        stack.push(next);
                    }
                }
            }
            component.sort_unstable();
            components.push(component);
        }
        components.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a[0].cmp(&b[0])));
        components
    }
}

impl GalaxyGraph {
    /// The graph a format projected, with the components as they stand counted as the
    /// baseline the validator measures later separations against.
    pub(crate) fn new(
        galaxy: Galaxy,
        countries: Vec<CountryNode>,
        sector_owner: HashMap<u32, u32>,
        starbase_owner: HashMap<u32, u32>,
    ) -> Self {
        let mut graph = Self {
            galaxy,
            countries,
            baseline_components: 0,
            baseline_component: HashMap::new(),
            sector_owner,
            starbase_owner,
        };
        let components = graph.components();
        graph.baseline_components = components.len();
        graph.baseline_component = membership(&components);
        graph
    }

    /// Wrap a galaxy from a document that carries no empires.
    pub fn from_galaxy(galaxy: Galaxy) -> Self {
        Self::new(galaxy, Vec::new(), HashMap::new(), HashMap::new())
    }

    /// Systems no longer connected to the bulk of the component they were in at build:
    /// for each baseline component, the current component holding most of its members is
    /// its home; members anywhere else are separated. Sorted by id. O(V+E).
    pub fn separated_systems(&self, components: &[Vec<u32>]) -> Vec<u32> {
        let current = membership(components);
        // Per baseline component, how many members each current component holds.
        let mut counts: HashMap<(usize, usize), usize> = HashMap::new();
        for (id, &baseline) in &self.baseline_component {
            if let Some(&now) = current.get(id) {
                *counts.entry((baseline, now)).or_default() += 1;
            }
        }
        // Home = the current component with the most members; ties go to the one that sorts
        // first in `components` (largest, then smallest id), which is deterministic.
        let mut home: HashMap<usize, (usize, usize)> = HashMap::new();
        let mut keys: Vec<_> = counts.keys().copied().collect();
        keys.sort_unstable();
        for (baseline, now) in keys {
            let n = counts[&(baseline, now)];
            let best = home.entry(baseline).or_insert((now, n));
            if n > best.1 {
                *best = (now, n);
            }
        }
        let mut separated: Vec<u32> = self
            .baseline_component
            .iter()
            .filter(|(id, baseline)| {
                current
                    .get(id)
                    .is_some_and(|now| home.get(baseline).is_some_and(|h| h.0 != *now))
            })
            .map(|(&id, _)| id)
            .collect();
        separated.sort_unstable();
        separated
    }
}

impl Deref for GalaxyGraph {
    type Target = Galaxy;

    fn deref(&self) -> &Self::Target {
        &self.galaxy
    }
}

impl DerefMut for GalaxyGraph {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.galaxy
    }
}

/// System id → index of its component in `components`.
fn membership(components: &[Vec<u32>]) -> HashMap<u32, usize> {
    components
        .iter()
        .enumerate()
        .flat_map(|(i, c)| c.iter().map(move |&id| (id, i)))
        .collect()
}
