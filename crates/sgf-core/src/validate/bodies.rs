//! Two bodies of one system standing at the same radius and angle about their parent, so
//! the game draws one on top of the other. The validator's own graph carries no positions,
//! so this reads the resolved layouts the save details keep, reusing the geometry
//! [`crate::ops::rules::bodies`] gives the ops rather than re-deriving angles.

use crate::format::save::details::RawSystemDetails;
use crate::ops::rules::bodies::{self, BELT_SCATTER, Body, OVERLAP_TOLERANCE};

use super::{Issue, IssueCode};

/// The overlap findings among `details`' bodies, one [`Issue`] per pair that stands too
/// close, unless both orbit the centre within [`BELT_SCATTER`] of the same belt's radius.
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
    let mut issues = Vec::new();
    for (i, a) in frame.iter().enumerate() {
        for b in &frame[i + 1..] {
            if a.parent != b.parent {
                continue;
            }
            let Some(centre) = bodies::centre(&frame, a) else {
                continue;
            };
            let ra = bodies::drawn_radius(a.at, centre, Some(a.orbit));
            let rb = bodies::drawn_radius(b.at, centre, Some(b.orbit));
            if ra <= 0.0 || rb <= 0.0 || (ra - rb).abs() > OVERLAP_TOLERANCE {
                continue;
            }
            let angle_a = bodies::angle_about(centre, a.at);
            let angle_b = bodies::angle_about(centre, b.at);
            if angle_delta(angle_a, angle_b) > OVERLAP_TOLERANCE {
                continue;
            }
            if a.parent.is_none()
                && details.belts.iter().any(|belt| {
                    scattered(ra, belt.inner_radius) && scattered(rb, belt.inner_radius)
                })
            {
                continue;
            }
            let (lo, lo_radius, lo_angle, hi) = if a.id < b.id {
                (a.id, ra, angle_a, b.id)
            } else {
                (b.id, rb, angle_b, a.id)
            };
            issues.push(Issue::new(
                IssueCode::BodiesOverlap,
                format!(
                    "Planets #{lo} and #{hi} of system #{system} stand in the same place, orbit {lo_radius:.2} at {lo_angle:.1}\u{b0}"
                ),
                vec![system],
            ));
        }
    }
    issues
}

/// The angle between `a` and `b`, in `[0, 180]`: the short way round the circle.
fn angle_delta(a: f64, b: f64) -> f64 {
    let diff = (a - b).abs() % 360.0;
    diff.min(360.0 - diff)
}

/// Whether `radius` lies within [`BELT_SCATTER`] of a belt's own radius.
fn scattered(radius: f64, belt: f64) -> bool {
    (radius - belt).abs() <= BELT_SCATTER
}
