//! Two bodies of one system standing at the same radius and angle about their parent, so
//! the game draws one on top of the other. The validator's own graph carries no positions,
//! so this reads the resolved layouts the save details keep, reusing the geometry
//! [`crate::projections::geometry`] gives the ops rather than re-deriving angles.

use crate::format::save::details::RawSystemDetails;
use crate::projections::geometry::{self, Body, Overlap};

use super::{Issue, IssueCode};

/// The overlap findings among `details`' bodies, one [`Issue`] per pair
/// [`geometry::overlaps`] finds.
pub(crate) fn overlaps(system: u32, details: &RawSystemDetails) -> Vec<Issue> {
    let frame: Vec<Body> = details
        .planets
        .iter()
        .filter_map(|p| {
            Some(Body {
                id: p.id,
                parent: p.parent,
                at: p.at?,
                orbit: p.orbit.unwrap_or(0.0),
            })
        })
        .collect();
    let belts: Vec<f64> = details.belts.iter().map(|belt| belt.inner_radius).collect();
    geometry::overlaps(&frame, &belts)
        .into_iter()
        .map(|Overlap { lo, hi, radius, angle }| {
            Issue::new(
                IssueCode::BodiesOverlap,
                format!(
                    "Planets #{lo} and #{hi} of system #{system} stand in the same place, orbit {radius:.2} at {angle:.1}\u{b0}"
                ),
                vec![system],
            )
        })
        .collect()
}
