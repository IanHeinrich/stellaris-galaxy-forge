//! The Resource Abundance a save's galaxy was set up with, which scales the deposits a
//! body added to it rolls.

use crate::keys;
use crate::projections::read;
use crate::session::Session;

impl Session {
    /// `galaxy.resource_abundance`, the setup screen's multiplier as saved: `0` for 0x,
    /// `0.25` for 0.25x. `None` for a scenario, or a save that does not write it.
    pub fn resource_abundance(&self) -> Option<f64> {
        let src = self.doc.original();
        let section = self.doc.index().section(keys::GALAXY)?;
        let galaxy = read::section_node(keys::GALAXY, section, src).ok()?;
        read::scalar(&galaxy, keys::RESOURCE_ABUNDANCE, src)?
            .parse()
            .ok()
    }
}
