use std::sync::Arc;

use super::Session;
use crate::format::save::details::{DetailsProjection, DetailsResolver};
use crate::projections::galaxy::ProjectionError;
use crate::validate::Issue;
use crate::views::details::SystemDetails;

impl Session {
    /// Per-system planets, deposits, starbase and fleets, built on first call.
    pub fn details(&self) -> Result<Arc<DetailsProjection>, ProjectionError> {
        if let Some(details) = self.details.get() {
            return Ok(Arc::clone(details));
        }
        let built = Arc::new(DetailsProjection::build(
            &self.doc,
            &self.graph,
            Arc::clone(&self.stars),
        )?);
        Ok(Arc::clone(self.details.get_or_init(|| built)))
    }

    /// Save body `id` and its moons as the details of a system that lists only them, for a
    /// body its system's details don't list (see [`DetailsProjection::unlisted_body`]);
    /// `None` for a document with no details sections or no such planet.
    pub fn unlisted_body(
        &self,
        id: u32,
        system: u32,
        resolver: &dyn DetailsResolver,
        with_game_data: bool,
    ) -> Result<Option<SystemDetails>, ProjectionError> {
        if !self.format().has_details(&self.doc) {
            return Ok(None);
        }
        DetailsProjection::unlisted_body(
            &self.doc,
            id,
            system,
            &self.stars,
            resolver,
            with_game_data,
        )
    }

    /// The details projection if it has already been built, never building it.
    pub fn built_details(&self) -> Option<Arc<DetailsProjection>> {
        self.details.get().map(Arc::clone)
    }

    /// Build the details projection if it is not built yet, so that later calls are cheap,
    /// and return the issues now that a finding reading the details (an overlap) can show.
    pub fn warm_details(&mut self) -> Result<Vec<Issue>, ProjectionError> {
        if self.format().has_details(&self.doc) {
            self.details()?;
        }
        Ok(self.validate())
    }
}
