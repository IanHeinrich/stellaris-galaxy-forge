use std::sync::Arc;

use super::Session;
use crate::format::save::ring_world::RingWorldTypes;
use crate::ops::SystemRadii;
use crate::projections::galaxy::{GalaxyGraph, StarClasses, draw_scenario_stars};

impl Session {
    /// How the geometry ops size a system.
    pub fn radii(&self) -> SystemRadii {
        self.radii
    }

    /// Size systems by `radii` from the next op on, as the loaded install's defines give them.
    pub fn set_radii(&mut self, radii: SystemRadii) {
        self.radii = radii;
    }

    /// What the loaded install says of stars.
    pub fn star_classes(&self) -> &Arc<StarClasses> {
        &self.stars
    }

    /// Take `classes` as the install's word on stars: which bodies are stars, and the star
    /// each scenario system is drawn as. Details built from other star bodies are dropped,
    /// and the next [`Self::details`] builds them again.
    pub fn set_star_classes(&mut self, classes: StarClasses) {
        if *self.stars == classes {
            return;
        }
        if self.stars.bodies != classes.bodies {
            self.details.take();
        }
        self.stars = Arc::new(classes);
        self.draw_stars();
    }

    /// Which megastructure types the loaded install makes ring worlds of.
    pub fn ring_world_types(&self) -> &RingWorldTypes {
        &self.ring_world_types
    }

    /// Take `types` as the install's word on which megastructure types make up a ring world,
    /// from the next op on.
    pub fn set_ring_world_types(&mut self, types: RingWorldTypes) {
        self.ring_world_types = Arc::new(types);
    }

    /// Give the systems of a document whose layouts are rolled the star their initializer
    /// draws, which an op that rewrote a system leaves unset.
    pub(super) fn draw_stars(&mut self) {
        draw_rolled_stars(self.rolls_stars(), &mut self.graph, &self.stars);
    }

    /// Whether the document's systems are rolled from their initializers, stars included.
    pub(super) fn rolls_stars(&self) -> bool {
        self.format().capabilities(&self.doc).rolled_layout
    }
}

/// [`Session::draw_stars`] on the fields an undo or redo leaves free while it holds the op.
pub(super) fn draw_rolled_stars(rolled: bool, graph: &mut GalaxyGraph, stars: &StarClasses) {
    if rolled {
        draw_scenario_stars(&mut graph.systems, stars);
    }
}
