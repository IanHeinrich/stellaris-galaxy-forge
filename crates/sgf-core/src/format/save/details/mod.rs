//! Per-system facts for the zoom-in map tier: planets, orbital deposits, the starbase,
//! the fleets present, megastructures and dig sites, projected from the `planets`,
//! `deposit`, `colony`, `starbase_mgr`, `ships`, `ship_design`, `fleet`, `country`,
//! `megastructures`, `archaeological_sites` and `galactic_object` sections.
//!
//! Built lazily (see `Session::details`) because it parses about half the file. The raw
//! projection keeps save keys (`d_energy_5`, `pc_continental`); [`DetailsProjection::resolve`]
//! turns them into resources and habitability through a [`DetailsResolver`], so game data
//! can plug in later without rebuilding.

mod extract;
mod resolve;

use std::collections::{HashMap, HashSet};

use crate::document::Document;
use crate::projections::galaxy::{GalaxyGraph, ProjectionError};
use crate::projections::read;
use crate::validate::{self, Issue};

pub use extract::{
    ArchaeologySite, FleetSummary, MegastructureSummary, RawPlanet, RawStarbase, RawSystemDetails,
    ShipSizeCount,
};
pub use resolve::{
    BodyLayout, Bounds, DepositCount, DetailsResolver, FleetPresence, HeuristicResolver,
    PlanetSummary, ResourceAmount, StarbaseSummary, SystemDetails,
};

#[derive(Debug, Clone)]
pub struct DetailsProjection {
    by_system: HashMap<u32, RawSystemDetails>,
    /// [`validate::bodies::overlaps`] of each system, cached so `validate` never resolves
    /// every system again on an edit; kept up to date by [`Self::refresh_planets`] and
    /// [`Self::refresh_systems`].
    overlaps: HashMap<u32, Vec<Issue>>,
}

impl DetailsProjection {
    /// Project every system in `graph`, and its planets, from the bytes now standing for
    /// each entry.
    pub fn build(doc: &Document, graph: &GalaxyGraph) -> Result<Self, ProjectionError> {
        let src = doc.original();
        let index = doc.index();
        let countries = extract::countries(&read::countries(index, src)?);
        let deposit_kind = extract::deposit_kinds(doc)?;
        let colony_pops = extract::colony_pops(index, src)?;
        let ship_sizes = extract::ship_sizes(index, src)?;

        let mut by_system: HashMap<u32, RawSystemDetails> = graph
            .systems
            .keys()
            .map(|&id| (id, RawSystemDetails::default()))
            .collect();
        let planet_system =
            extract::planets(doc, &countries, &deposit_kind, &colony_pops, &mut by_system)?;
        extract::megastructures(index, src, &mut by_system)?;
        extract::sites(doc, &planet_system, &mut by_system)?;
        extract::present(doc, graph, &countries, &ship_sizes, &mut by_system)?;
        let overlaps = by_system
            .iter()
            .map(|(&id, raw)| (id, validate::bodies::overlaps(id, raw)))
            .collect();
        Ok(Self {
            by_system,
            overlaps,
        })
    }

    /// Read again the name, class, size, parent, modifiers, anomaly and placement of each of
    /// `planets`, as (planet, system), from the bytes now standing for it, then the overlap
    /// findings of every system touched.
    pub fn refresh_planets(
        &mut self,
        doc: &Document,
        planets: impl IntoIterator<Item = (u32, u32)>,
    ) -> Result<(), ProjectionError> {
        let mut touched = HashSet::new();
        for (id, system) in planets {
            touched.insert(system);
            let Some(planet) = self
                .by_system
                .get_mut(&system)
                .and_then(|d| d.planets.iter_mut().find(|p| p.id == id))
            else {
                continue;
            };
            if let Some((facts, modifiers, placement)) = extract::planet_facts(doc, id)? {
                planet.name = facts.name;
                planet.name_key = facts.name_key;
                planet.class = facts.class;
                planet.size = facts.size;
                planet.moon = facts.moon_of.is_some();
                planet.parent = facts.moon_of;
                planet.permanent_modifiers = modifiers;
                planet.anomaly = facts.anomaly;
                planet.orbit = placement.orbit;
                planet.at = placement.at;
                planet.ring = placement.ring;
            }
        }
        for system in touched {
            self.refresh_overlaps(system);
        }
        Ok(())
    }

    /// Read again the belts and `inner_radius` of each of the systems `ids` from the bytes
    /// now standing for its entry, then its overlap findings.
    pub fn refresh_systems(
        &mut self,
        doc: &Document,
        ids: impl IntoIterator<Item = u32>,
    ) -> Result<(), ProjectionError> {
        for id in ids {
            if let Some(details) = self.by_system.get_mut(&id) {
                extract::refresh_geometry(doc, id, details)?;
            }
            self.refresh_overlaps(id);
        }
        Ok(())
    }

    /// Recompute `system`'s cached overlap findings from its details as they now stand.
    fn refresh_overlaps(&mut self, system: u32) {
        if let Some(raw) = self.by_system.get(&system) {
            let issues = validate::bodies::overlaps(system, raw);
            self.overlaps.insert(system, issues);
        }
    }

    /// Every cached overlap finding, of every system: [`crate::session::Session::validate`]
    /// appends these once the details are built.
    pub fn overlap_issues(&self) -> Vec<Issue> {
        self.overlaps.values().flatten().cloned().collect()
    }

    /// The system's details with each planet's deposits summed into resources by
    /// `resolver`, and the system's resources the sum of those rows.
    pub fn resolve(
        &self,
        id: u32,
        resolver: &dyn DetailsResolver,
        with_game_data: bool,
    ) -> Option<SystemDetails> {
        let raw = self.by_system.get(&id)?;
        Some(resolve::resolve(id, raw, resolver, with_game_data))
    }

    pub fn raw(&self, id: u32) -> Option<&RawSystemDetails> {
        self.by_system.get(&id)
    }

    /// Systems projected, whether or not anything was found in them.
    pub fn len(&self) -> usize {
        self.by_system.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_system.is_empty()
    }
}
