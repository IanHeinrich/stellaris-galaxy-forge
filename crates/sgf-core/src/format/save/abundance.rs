//! The Resource Abundance a save's galaxy was set up with, which scales the deposits a
//! body added to it rolls.

use crate::session::Session;

impl Session {
    /// The setup screen's Resource Abundance multiplier as saved: `0` for 0x, `0.25` for
    /// 0.25x. `None` for a scenario, or a save that does not write it.
    pub fn resource_abundance(&self) -> Option<f64> {
        self.graph.setup.as_ref()?.resource_abundance
    }
}
