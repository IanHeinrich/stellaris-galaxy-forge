//! Reading a save's galaxy: every `galactic_object` entity plus the top-level `nebula`,
//! `bypasses`, `natural_wormholes`, `waystation_networks`, `galaxy_radius`, `galaxy` and
//! `flags` sections.
//!
//! Built once at load by [`GalaxyGraph::build`]. One system is re-extracted after an op
//! through [`GalaxyGraph::refresh_system`], the nebulae with their membership through
//! [`GalaxyGraph::refresh_nebulae`], the L-Gate through [`GalaxyGraph::refresh_lgate`] and
//! one country through [`GalaxyGraph::refresh_country`]; all run the same extraction as
//! the build, so ops need no incremental bookkeeping.

mod bodies;
mod bypasses;
mod countries;
pub(crate) mod lgate;
mod nebulae;
pub(super) mod starbases;
mod systems;
mod waylines;

use std::collections::HashMap;

use crate::cst::Node;
use crate::document::Document;
use crate::format::save::planet_statement;
use crate::projections::galaxy::{Galaxy, GalaxyGraph, GameSetup, ProjectionError};
use crate::projections::read;
use crate::scan::{Index, Section, Value};
use crate::views::DocumentKind;
use crate::{NULL_ID, keys};

impl Galaxy {
    /// Project the galaxy from indexed bytes; `src` is what `index` was scanned over, so
    /// a document with edits must pass its current bytes and index, not the originals.
    ///
    /// `sector_owner` and `starbase_owner` resolve each system's owner; a document
    /// without empires has neither and passes empty maps. `planets`, the inner index of
    /// the `planets` section over the same `src`, gives each system its bodies.
    pub fn build(
        index: &Index,
        planets: Option<&Index>,
        src: &[u8],
        sector_owner: &HashMap<u32, u32>,
        starbase_owner: &HashMap<u32, u32>,
    ) -> Result<Self, ProjectionError> {
        let mut systems = HashMap::new();
        let mut order = Vec::new();
        let mut starbase_system: HashMap<u32, u32> = HashMap::new();
        for entity in index.entities(keys::GALACTIC_OBJECT) {
            let Some(node) = read::entity_node(entity, src, keys::GALACTIC_OBJECT)? else {
                continue;
            };
            let id = u32::try_from(entity.id).map_err(|_| ProjectionError::EntityField {
                section: keys::GALACTIC_OBJECT,
                id: entity.id,
                reason: "id does not fit in u32".to_owned(),
            })?;
            for starbase in read::ids(&node, keys::STARBASES, src) {
                if starbase != NULL_ID {
                    starbase_system.entry(starbase).or_insert(id);
                }
            }
            let mut system = systems::extract(id, &node, src, sector_owner, starbase_owner)?;
            system.bodies = Some(
                bodies::planet_ids(&node, src)
                    .into_iter()
                    .filter_map(|planet| planets.and_then(|p| bodies::planet(p, planet)))
                    .map(|entity| bodies::body(entity.stmt.slice(src)))
                    .collect(),
            );
            order.push(system.id);
            systems.insert(system.id, system);
        }

        let nebulae = nebulae::extract(index, src)?;
        let ids: Vec<u32> = systems.keys().copied().collect();

        let bypasses = bypasses::extract(index, src, &systems)?;
        let lgate = lgate::extract(index, src, &bypasses)?;
        let galaxy_radius = index
            .section(keys::GALAXY_RADIUS)
            .map(|s| scalar_f64(s, src))
            .transpose()?
            .unwrap_or(0.0);
        let galaxy_node = index
            .section(keys::GALAXY)
            .map(|section| read::section_node(keys::GALAXY, section, src))
            .transpose()?;
        let core_radius = galaxy_node
            .as_ref()
            .and_then(|n| n.find(keys::CORE_RADIUS, src))
            .and_then(|n| n.scalar_str(src))
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0);
        let setup = galaxy_node.as_ref().map(|n| game_setup(n, src));
        let player_country = index
            .section(keys::PLAYER)
            .map(|section| read::section_node(keys::PLAYER, section, src))
            .transpose()?
            .as_ref()
            .and_then(|n| n.children().first())
            .and_then(|entry| read::scalar_u32(entry, keys::COUNTRY, src));

        let mut galaxy = Self {
            systems,
            order,
            nebulae,
            bypasses,
            waystations: waylines::extract(index, src, &starbase_system)?,
            // Derived from the waystations and the lanes by the refresh below.
            waylines: Vec::new(),
            galaxy_radius,
            core_radius,
            header: Vec::new(),
            kind: DocumentKind::Save,
            setup,
            player_country,
            lgate,
        };
        galaxy.assign_nebulae();
        galaxy.refresh_stale(&ids);
        Ok(galaxy)
    }
}

impl GalaxyGraph {
    /// Project the galaxy from the document's original bytes.
    ///
    /// Built at load, before any edit: the overlay is ignored. After an op, the op
    /// refreshes the systems it touched with [`GalaxyGraph::refresh_system`].
    pub fn build(doc: &Document) -> Result<Self, ProjectionError> {
        let src = doc.original();
        let index = doc.index();

        let raw_countries = read::countries(index, src)?;
        let fleet_owner = starbases::fleet_owners(&raw_countries);
        let sector_owner = systems::sector_owners(index, src)?;
        let starbase_owner = starbases::starbase_owners(doc, &fleet_owner)?;
        let (mut countries, capitals) = countries::extract(raw_countries);

        let planets = doc.inner_index(keys::PLANETS)?;
        let galaxy = Galaxy::build(index, planets, src, &sector_owner, &starbase_owner)?;

        let wanted = capitals
            .values()
            .copied()
            .filter(|&c| c != NULL_ID)
            .collect();
        let colony_system = countries::colony_systems(doc, &wanted)?;
        let mut owned: HashMap<u32, u32> = HashMap::new();
        for owner in galaxy.systems.values().filter_map(|s| s.owner) {
            *owned.entry(owner).or_default() += 1;
        }
        for country in &mut countries {
            country.capital_system = capitals
                .get(&country.id)
                .and_then(|colony| colony_system.get(colony).copied());
            country.system_count = owned.get(&country.id).copied().unwrap_or(0);
        }

        Ok(Self::new(galaxy, countries, sector_owner, starbase_owner))
    }

    /// Re-extract one system from `node`, the CST of its `galactic_object` entity as
    /// returned by `cst::parse` (or the `<id>=` node itself), and replace it in `systems`.
    pub fn refresh_system(
        &mut self,
        id: u32,
        node: &Node,
        src: &[u8],
    ) -> Result<(), ProjectionError> {
        let entity = system_entity(id, node, src)?;
        let mut refreshed =
            systems::extract(id, entity, src, &self.sector_owner, &self.starbase_owner)?;
        if let Some(previous) = self.systems.get_mut(&id) {
            refreshed.nebula = previous.nebula;
            refreshed.bodies = previous.bodies.take();
        }
        if self.systems.insert(id, refreshed).is_none() {
            self.order.push(id);
        }
        Ok(())
    }

    /// Re-read system `id`'s bodies from `node`, its `galactic_object` entity as it now
    /// stands (parsed as for [`GalaxyGraph::refresh_system`]), and each planet as `doc`
    /// now holds it.
    pub(crate) fn refresh_bodies(
        &mut self,
        id: u32,
        node: &Node,
        src: &[u8],
        doc: &Document,
    ) -> Result<(), ProjectionError> {
        let entity = system_entity(id, node, src)?;
        let mut read = Vec::new();
        for planet in bodies::planet_ids(entity, src) {
            let Some(anchor) = planet_statement(doc, planet)? else {
                continue;
            };
            let bytes = doc
                .current(anchor)
                .map_err(|e| ProjectionError::EntityField {
                    section: keys::PLANETS,
                    id: u64::from(planet),
                    reason: e.to_string(),
                })?;
            read.push(bodies::body(bytes));
        }
        if let Some(system) = self.systems.get_mut(&id) {
            system.bodies = Some(read);
        }
        Ok(())
    }

    /// Forget system `id`, which the document no longer holds: an undo took back the op
    /// that added it.
    pub(crate) fn drop_system(&mut self, id: u32) {
        if self.systems.remove(&id).is_some() {
            self.order.retain(|&held| held != id);
        }
    }

    /// Re-extract every nebula from the document's current bytes and reassign each
    /// system's membership. Returns the systems whose `nebula` changed.
    pub fn refresh_nebulae(&mut self, doc: &Document) -> Result<Vec<u32>, ProjectionError> {
        self.nebulae = nebulae::extract_current(doc)?;
        Ok(self.assign_nebulae())
    }

    /// Re-read the L-Gate from `flags`, the `flags=` block as it now stands. A galaxy with
    /// no L-Gate keeps none, whatever the flags say.
    pub fn refresh_lgate(&mut self, flags: &Node, src: &[u8]) {
        if self.lgate.is_some() {
            self.lgate = Some(lgate::read_flags(flags, src));
        }
    }

    /// Re-read country `id` from `node`, its `<id>=` entity node as it now stands.
    pub fn refresh_country(&mut self, id: u32, node: &Node, src: &[u8]) {
        countries::refresh(&mut self.countries, read::country(id, node, src));
    }
}

/// System `id`'s `<id>=` node: `node` itself, or the one it holds as `cst::parse` returns it.
fn system_entity<'n>(id: u32, node: &'n Node, src: &[u8]) -> Result<&'n Node, ProjectionError> {
    let key = id.to_string();
    if node.key_str(src) == Some(key.as_str()) {
        return Ok(node);
    }
    node.find(&key, src)
        .ok_or_else(|| ProjectionError::EntityField {
            section: keys::GALACTIC_OBJECT,
            id: u64::from(id),
            reason: "entity not found in the parsed node".to_owned(),
        })
}

/// The setup screen off `node`, the parsed top-level `galaxy` block: strings empty and
/// numbers `0` (`1.0` for a fraction) where the save omits a key.
fn game_setup(node: &Node, src: &[u8]) -> GameSetup {
    let string = |key| {
        node.find(key, src)
            .and_then(|n| n.scalar_str(src))
            .unwrap_or_default()
            .to_owned()
    };
    let count = |key| {
        node.find(key, src)
            .and_then(|n| n.scalar_str(src))
            .and_then(|s| s.parse().ok())
            .unwrap_or(0)
    };
    let fraction = |key| {
        node.find(key, src)
            .and_then(|n| n.scalar_str(src))
            .and_then(|s| s.parse().ok())
            .unwrap_or(1.0)
    };
    GameSetup {
        template: string(keys::TEMPLATE),
        shape: string(keys::SHAPE),
        num_empires: count(keys::NUM_EMPIRES),
        num_advanced_empires: count(keys::NUM_ADVANCED_EMPIRES),
        num_fallen_empires: count(keys::NUM_FALLEN_EMPIRES),
        num_marauder_empires: count(keys::NUM_MARAUDER_EMPIRES),
        num_nomad_empires: count(keys::NUM_NOMAD_EMPIRES),
        num_gateways: count(keys::NUM_GATEWAYS),
        num_wormhole_pairs: count(keys::NUM_WORMHOLE_PAIRS),
        num_hyperlanes: fraction(keys::NUM_HYPERLANES),
        primitive: fraction(keys::PRIMITIVE),
        habitability: fraction(keys::HABITABILITY),
    }
}

fn scalar_f64(section: &Section, src: &[u8]) -> Result<f64, ProjectionError> {
    let Value::Scalar(span) = section.value else {
        return Err(ProjectionError::SectionField {
            section: keys::GALAXY_RADIUS,
            reason: "expected a scalar".to_owned(),
        });
    };
    std::str::from_utf8(span.slice(src))
        .ok()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| ProjectionError::SectionField {
            section: keys::GALAXY_RADIUS,
            reason: "not a number".to_owned(),
        })
}
