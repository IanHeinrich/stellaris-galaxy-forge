use std::sync::Arc;

use super::Session;
use crate::ops::SystemRadii;
use crate::projections::galaxy::{GalaxyGraph, StarClasses, draw_scenario_stars};
use crate::views::DocumentKind;

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

    /// Give a scenario's systems the star their initializer draws, which an op that
    /// rewrote a system leaves unset.
    pub(super) fn draw_stars(&mut self) {
        draw_scenario_stars_of(self.doc.kind(), &mut self.graph, &self.stars);
    }
}

/// [`Session::draw_stars`] on the fields an undo or redo leaves free while it holds the op.
pub(super) fn draw_scenario_stars_of(
    kind: DocumentKind,
    graph: &mut GalaxyGraph,
    stars: &StarClasses,
) {
    if kind == DocumentKind::Scenario {
        draw_scenario_stars(&mut graph.systems, stars);
    }
}
