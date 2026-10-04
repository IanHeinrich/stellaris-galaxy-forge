//! Where a system's bodies stand about their parents, measured: points and angles, the
//! radius a body is drawn at, how far a system reaches and how close two bodies may stand
//! before they count as one place. The op decisions in [`crate::ops::rules::bodies`] and the
//! read side share it.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::emit::coord;

/// How the game sizes a system about what it holds: `NGameplay`'s `SYSTEM_MIN_INNER_RADIUS`,
/// `SYSTEM_INNER_RADIUS_OFFSET` and `SYSTEM_OUTER_RADIUS_OFFSET`, which mods can override.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemRadii {
    /// The smallest `inner_radius` a system has.
    pub min_inner: f64,
    /// How far past its outermost body a system's `inner_radius` lies.
    pub inner_offset: f64,
    /// How far past its `inner_radius` a system's `outer_radius` lies.
    pub outer_offset: f64,
}

impl SystemRadii {
    /// The values vanilla Stellaris defines.
    pub const VANILLA: Self = Self {
        min_inner: 150.0,
        inner_offset: 30.0,
        outer_offset: 100.0,
    };

    /// The `inner_radius` of a system whose furthest body reaches `reach`.
    pub fn inner_about(self, reach: f64) -> f64 {
        self.min_inner.max(reach + self.inner_offset)
    }

    /// The least a system's `inner_radius` may be set to: how far its bodies and belts
    /// `reach`, not below the smallest radius, or its `current` one when that is lower.
    pub fn inner_floor(self, reach: f64, current: f64) -> f64 {
        current.min(self.min_inner.max(reach))
    }

    /// The `outer_radius` of a system whose `inner_radius` is `inner`.
    pub fn outer(self, inner: f64) -> f64 {
        inner + self.outer_offset
    }

    /// The `inner_radius` something now reaching `reach` grows the system's `current` one to,
    /// when that is past the current radius, or past both the current radius less its offset
    /// and the `reached` the system reached before. `None` when the radius stays; it never
    /// shrinks. A reach within the stored-orbit slack of the old one is no further: a body
    /// moved round its ring lands where its drawn radius says, which can sit that far from the
    /// point the game wrote. Some game-written belts lie past the inner radius, so something
    /// put outside the radius but inside such a belt grows it too.
    pub fn grown(self, reach: f64, reached: f64, current: f64) -> Option<f64> {
        let further = reach > reached + STORED_ORBIT_SLACK && reach + self.inner_offset > current;
        (further || reach > current).then(|| self.inner_about(reach))
    }
}

impl Default for SystemRadii {
    fn default() -> Self {
        Self::VANILLA
    }
}

/// The orbit of a planet's first moon, the one the game writes for most moons.
pub const MOON_RING_FIRST: f64 = 15.0;

/// How much further out each moon ring after the first lies.
pub const MOON_RING_STEP: f64 = 5.0;

/// How near, in units of radius and in degrees, two bodies about one parent stand before
/// they overlap.
pub const OVERLAP_TOLERANCE: f64 = 0.5;

/// How far from its belt's radius an asteroid of that belt may lie: the game scatters them,
/// so two asteroids of one belt that stand together do not overlap.
pub const BELT_SCATTER: f64 = 10.0;

/// How far a body's point may stray from its stored `orbit` for the stored value to be
/// drawn: the rounding of a point written to five decimals, not a body placed elsewhere.
pub const STORED_ORBIT_SLACK: f64 = 0.01;

/// One body of a system, in the order the system lists them: the first is its primary.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Body {
    pub id: u32,
    /// The body it is a moon of, named even when the system no longer holds it.
    pub parent: Option<u32>,
    /// Relative to the system's centre.
    pub at: (f64, f64),
    /// The radius it stores about its parent.
    pub orbit: f64,
}

/// Where a body `radius` from `centre` at `angle` degrees stands.
pub fn point((cx, cy): (f64, f64), radius: f64, angle: f64) -> (f64, f64) {
    let angle = angle.to_radians();
    (cx + radius * angle.cos(), cy + radius * angle.sin())
}

/// The angle in degrees, in [0, 360), at which `at` stands about `centre`.
pub fn angle_about((cx, cy): (f64, f64), (x, y): (f64, f64)) -> f64 {
    normalised((y - cy).atan2(x - cx).to_degrees())
}

/// `angle` in [0, 360).
pub fn normalised(angle: f64) -> f64 {
    angle.rem_euclid(360.0) + 0.0
}

/// The radius a body at `at` is drawn at about `centre`: its stored `orbit` when that is
/// its distance give or take the rounding of its point, else the distance. Some bodies
/// store an `orbit` of 0 or less while they sit out from their parent.
pub fn drawn_radius(at: (f64, f64), centre: (f64, f64), stored: Option<f64>) -> f64 {
    let distance = (at.0 - centre.0).hypot(at.1 - centre.1);
    match stored {
        Some(stored) if (distance - stored).abs() <= STORED_ORBIT_SLACK => stored,
        _ => distance,
    }
}

/// Body `id` of the frame.
pub fn find(bodies: &[Body], id: u32) -> Option<&Body> {
    bodies.iter().find(|b| b.id == id)
}

/// The point `body` orbits: its parent's, or the system's centre for a planet; `None` for
/// a moon whose parent the frame lacks.
pub fn centre(bodies: &[Body], body: &Body) -> Option<(f64, f64)> {
    match body.parent {
        None => Some((0.0, 0.0)),
        Some(parent) => find(bodies, parent).map(|p| p.at),
    }
}

/// Every body whose chain of parents leads to `id`, in frame order.
pub fn descendants(bodies: &[Body], id: u32) -> Vec<u32> {
    let under = |body: &Body| {
        let mut parent = body.parent;
        for _ in 0..bodies.len() {
            match parent {
                Some(p) if p == id => return true,
                Some(p) => parent = find(bodies, p).and_then(|b| b.parent),
                None => return false,
            }
        }
        false
    };
    bodies
        .iter()
        .filter(|b| b.id != id && under(b))
        .map(|b| b.id)
        .collect()
}

/// How far from the system's centre `body` reaches: its drawn radius, plus for a moon its
/// parent's distance from the centre.
pub fn reach(bodies: &[Body], body: &Body) -> f64 {
    match centre(bodies, body) {
        Some(c) => c.0.hypot(c.1) + drawn_radius(body.at, c, Some(body.orbit)),
        None => body.at.0.hypot(body.at.1),
    }
}

/// Whether `body` counts toward the system's reach: the primary always does, and so does
/// any other body whose stored `orbit` reads above zero. An event-placed body (a
/// `pc_astral_scar`, say) can carry `orbit=0` while it stands far from its point at event
/// time; that is not a place a player put it, and not what the generator's rule cares
/// about. A body with no `orbit` at all still counts, since a caller can only reach this
/// with one it read from the bytes.
fn reaches_for_the_rule(bodies: &[Body], body: &Body) -> bool {
    bodies.first().is_some_and(|primary| primary.id == body.id) || body.orbit > 0.0
}

/// How far the furthest body of the frame or belt of `belts` reaches, a belt reaching its
/// radius and an event-placed body at `orbit` zero or less set aside (see
/// [`reaches_for_the_rule`]). A caller measuring a body its own op is moving calls [`reach`]
/// on it directly instead, which this exclusion does not touch.
pub fn system_reach(bodies: &[Body], belts: &[f64]) -> f64 {
    bodies
        .iter()
        .filter(|b| reaches_for_the_rule(bodies, b))
        .map(|b| reach(bodies, b))
        .chain(belts.iter().copied())
        .fold(0.0, f64::max)
}

/// How far body `id` of `after`, or the furthest body under it, reaches.
pub fn moved_reach(after: &[Body], id: u32) -> f64 {
    let mut moved = descendants(after, id);
    moved.push(id);
    moved
        .iter()
        .filter_map(|&m| find(after, m))
        .map(|b| reach(after, b))
        .fold(0.0, f64::max)
}

/// Two bodies of one frame standing in one place: the lower id first, with its radius and
/// angle about their parent.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Overlap {
    pub lo: u32,
    pub hi: u32,
    pub radius: f64,
    pub angle: f64,
}

/// Every pair of the frame about one parent within [`OVERLAP_TOLERANCE`] in both drawn
/// radius and angle, unless both orbit the centre within [`BELT_SCATTER`] of one of the
/// `belts`' radii. A body drawn at radius zero or less overlaps nothing.
pub fn overlaps(frame: &[Body], belts: &[f64]) -> Vec<Overlap> {
    let mut found = Vec::new();
    for (i, a) in frame.iter().enumerate() {
        for b in &frame[i + 1..] {
            if a.parent != b.parent {
                continue;
            }
            let Some(centre) = centre(frame, a) else {
                continue;
            };
            let ra = drawn_radius(a.at, centre, Some(a.orbit));
            let rb = drawn_radius(b.at, centre, Some(b.orbit));
            if ra <= 0.0 || rb <= 0.0 || (ra - rb).abs() > OVERLAP_TOLERANCE {
                continue;
            }
            let angle_a = angle_about(centre, a.at);
            let angle_b = angle_about(centre, b.at);
            if angle_delta(angle_a, angle_b) > OVERLAP_TOLERANCE {
                continue;
            }
            let scattered = |radius: f64, belt: f64| (radius - belt).abs() <= BELT_SCATTER;
            if a.parent.is_none()
                && belts
                    .iter()
                    .any(|&belt| scattered(ra, belt) && scattered(rb, belt))
            {
                continue;
            }
            found.push(if a.id < b.id {
                Overlap {
                    lo: a.id,
                    hi: b.id,
                    radius: ra,
                    angle: angle_a,
                }
            } else {
                Overlap {
                    lo: b.id,
                    hi: a.id,
                    radius: rb,
                    angle: angle_b,
                }
            });
        }
    }
    found
}

/// The angle between `a` and `b`, in `[0, 180]`: the short way round the circle.
fn angle_delta(a: f64, b: f64) -> f64 {
    let diff = (a - b).abs() % 360.0;
    diff.min(360.0 - diff)
}

/// The angle, in degrees, at which a body written at `at` stands `radius` from `centre`.
/// The angle measured from the written coordinates can miss them in the last decimal, so
/// the nearest hundredth of a degree, which the generator writes, is taken instead
/// whenever it gives the same coordinates.
pub(crate) fn written_angle(centre: (f64, f64), at: (f64, f64), radius: f64) -> f64 {
    let measured = angle_about(centre, at);
    let hundredth = (measured * 100.0).round() / 100.0;
    let written = (coord(at.0), coord(at.1));
    [hundredth, normalised(hundredth)]
        .into_iter()
        .find(|&angle| {
            let (x, y) = point(centre, radius, angle);
            (coord(x), coord(y)) == written
        })
        .unwrap_or(measured)
}
