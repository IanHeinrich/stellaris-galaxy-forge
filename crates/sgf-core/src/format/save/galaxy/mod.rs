//! Reading a save's galaxy: every `galactic_object` entity plus the top-level `nebula`,
//! `bypasses`, `natural_wormholes`, `waystation_networks`, `galaxy_radius` and `galaxy`
//! sections.
//!
//! Built once at load by [`GalaxyGraph::build`]. One system is re-extracted after an op
//! through [`GalaxyGraph::refresh_system`], and the nebulae with their membership through
//! [`GalaxyGraph::refresh_nebulae`]; both run the same extraction as the build, so ops
//! need no incremental bookkeeping.

mod bypasses;
mod countries;
mod nebulae;
pub(super) mod starbases;
mod systems;
mod waylines;

use std::collections::HashMap;

use crate::cst::Node;
use crate::document::Document;
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
    /// without empires has neither and passes empty maps.
    pub fn build(
        index: &Index,
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
            let node = systems::extract(id, &node, src, sector_owner, starbase_owner)?;
            order.push(node.id);
            systems.insert(node.id, node);
        }

        let nebulae = nebulae::extract(index, src)?;
        let ids: Vec<u32> = systems.keys().copied().collect();

        let bypasses = bypasses::extract(index, src, &systems)?;
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

        let galaxy = Galaxy::build(index, src, &sector_owner, &starbase_owner)?;

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
        let key = id.to_string();
        let entity = if node.key_str(src) == Some(key.as_str()) {
            node
        } else {
            node.find(&key, src)
                .ok_or_else(|| ProjectionError::EntityField {
                    section: keys::GALACTIC_OBJECT,
                    id: u64::from(id),
                    reason: "entity not found in the parsed node".to_owned(),
                })?
        };
        let nebula = self.systems.get(&id).and_then(|s| s.nebula);
        let mut refreshed =
            systems::extract(id, entity, src, &self.sector_owner, &self.starbase_owner)?;
        refreshed.nebula = nebula;
        if self.systems.insert(id, refreshed).is_none() {
            self.order.push(id);
        }
        Ok(())
    }

    /// Re-extract every nebula from the document's current bytes and reassign each
    /// system's membership. Returns the systems whose `nebula` changed.
    pub fn refresh_nebulae(&mut self, doc: &Document) -> Result<Vec<u32>, ProjectionError> {
        self.nebulae = nebulae::extract_current(doc)?;
        Ok(self.assign_nebulae())
    }
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
