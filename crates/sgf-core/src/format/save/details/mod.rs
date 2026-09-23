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

use std::collections::HashMap;

use crate::document::Document;
use crate::projections::galaxy::{GalaxyGraph, ProjectionError};
use crate::projections::read;

pub use extract::{
    ArchaeologySite, FleetSummary, MegastructureSummary, RawPlanet, RawStarbase, RawSystemDetails,
    ShipSizeCount,
};
pub use resolve::{
    DepositCount, DetailsResolver, FleetPresence, HeuristicResolver, PlanetSummary, ResourceAmount,
    StarbaseSummary, SystemDetails,
};

#[derive(Debug, Clone)]
pub struct DetailsProjection {
    by_system: HashMap<u32, RawSystemDetails>,
}

impl DetailsProjection {
    /// Project every system in `graph` from the document's original bytes, and its
    /// planets from the bytes now standing for them, whose classes an op may have rewritten.
    pub fn build(doc: &Document, graph: &GalaxyGraph) -> Result<Self, ProjectionError> {
        let src = doc.original();
        let index = doc.index();
        let countries = extract::countries(&read::countries(index, src)?);
        let deposit_kind = extract::deposit_kinds(index, src)?;
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
        Ok(Self { by_system })
    }

    /// Read again the class and size of each of `planets`, as (planet, system), from the
    /// bytes now standing for it, leaving everything else as it was projected.
    pub fn refresh_planets(
        &mut self,
        doc: &Document,
        planets: impl IntoIterator<Item = (u32, u32)>,
    ) -> Result<(), ProjectionError> {
        for (id, system) in planets {
            let Some(planet) = self
                .by_system
                .get_mut(&system)
                .and_then(|d| d.planets.iter_mut().find(|p| p.id == id))
            else {
                continue;
            };
            if let Some(facts) = extract::planet_facts(doc, id)? {
                planet.class = facts.class;
                planet.size = facts.size;
            }
        }
        Ok(())
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
