//! Where a system's planets and moons stand about their parents, and how close two of them
//! may stand before they count as one place.
//!
//! Each format reads its bodies into [`Body`] frames; a move or a new parent is decided
//! here, over the frame, and the format then writes the points that changed.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::ops::OpError;

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

/// Refuse a radius that is not a number above zero, `what` naming what it measures.
pub(crate) fn check_radius(radius: f64, what: &str) -> Result<(), OpError> {
    if !radius.is_finite() {
        return Err(OpError::NotFinite);
    }
    if radius <= 0.0 {
        return Err(OpError::InvalidRadius {
            radius,
            reason: format!("{what} must be greater than zero"),
        });
    }
    Ok(())
}

/// Refuse a body's placement that is not a radius above zero at a finite angle.
pub(crate) fn check_placement(radius: f64, angle: f64) -> Result<(), OpError> {
    check_radius(radius, "a body's orbit")?;
    if !angle.is_finite() {
        return Err(OpError::NotFinite);
    }
    Ok(())
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

/// Body `id`, refused when the frame does not list it or it stands at the system's centre,
/// with no orbit about its parent to move along.
pub fn movable(bodies: &[Body], system: u32, id: u32) -> Result<&Body, OpError> {
    let body = find(bodies, id).ok_or(OpError::NotABody { planet: id, system })?;
    let about = centre(bodies, body).unwrap_or((0.0, 0.0));
    if drawn_radius(body.at, about, Some(body.orbit)) <= STORED_ORBIT_SLACK {
        return Err(OpError::AtCentre(id));
    }
    Ok(body)
}

/// Refuse `parent` as body `id`'s new one: a body outside the frame, the body itself or one
/// of its moons, a body `is_moon` says holds the moon bit, a body at the system's centre,
/// or the parent it has. The primary orbits nothing, a body with moons may become a
/// planet of a `star` but not a moon, and only a star parent may be the primary. A body
/// whose parent stands at the centre already orbits the centre.
pub fn check_parent(
    bodies: &[Body],
    system: u32,
    id: u32,
    parent: Option<u32>,
    star: bool,
    is_moon: impl Fn(u32) -> bool,
) -> Result<(), OpError> {
    let body = movable(bodies, system, id)?;
    let is_primary = |id| bodies.first().is_some_and(|primary| primary.id == id);
    if is_primary(id) {
        return Err(OpError::InvalidParent {
            reason: format!("planet {id} is the system's primary body, which orbits no other body"),
        });
    }
    if let Some(parent) = parent {
        let host = find(bodies, parent).ok_or(OpError::NotABody {
            planet: parent,
            system,
        })?;
        let reason = if parent == id {
            Some(format!("planet {id} cannot orbit itself"))
        } else if descendants(bodies, id).contains(&parent) {
            Some(format!(
                "planet {parent} is one of planet {id}'s moons, so it cannot be its parent"
            ))
        } else if host.parent.is_some() && is_moon(parent) {
            Some(format!(
                "planet {parent} is a moon, and a moon cannot have moons"
            ))
        } else if !star && is_primary(parent) {
            Some(format!(
                "planet {parent} is the system's primary body: to make planet {id} a planet, give it no parent"
            ))
        } else if stands_at_centre(host) {
            Some(format!(
                "planet {parent} stands at the system's centre: to make planet {id} orbit it, give it no parent"
            ))
        } else {
            None
        };
        if let Some(reason) = reason {
            return Err(OpError::InvalidParent { reason });
        }
        if !star && bodies.iter().any(|b| b.parent == Some(id)) {
            return Err(OpError::HasMoons(id));
        }
    }
    let orbits_centre =
        |parent: Option<u32>| parent.is_none_or(|p| find(bodies, p).is_some_and(stands_at_centre));
    if body.parent == parent || (orbits_centre(body.parent) && orbits_centre(parent)) {
        return Err(OpError::ParentUnchanged(id));
    }
    Ok(())
}

fn stands_at_centre(body: &Body) -> bool {
    body.at.0.hypot(body.at.1) <= STORED_ORBIT_SLACK
}

/// The frame with body `id` a moon of `parent`, or a planet, `radius` from its new centre
/// at `angle` degrees, and every body under it moved by the same step. Its `orbit` becomes
/// the radius, unless it keeps its parent and the radius is the one it is drawn at, so a
/// move along its ring keeps the orbit the game stored. A moon whose parent the frame lacks
/// is refused.
pub fn placed(
    bodies: &[Body],
    id: u32,
    parent: Option<u32>,
    radius: f64,
    angle: f64,
) -> Result<Vec<Body>, OpError> {
    let body = *find(bodies, id).ok_or(OpError::UnknownPlanet(id))?;
    let centre = match parent {
        None => (0.0, 0.0),
        Some(parent) => {
            find(bodies, parent)
                .ok_or(OpError::ParentMissing { body: id, parent })?
                .at
        }
    };
    let drawn = drawn_radius(body.at, centre, Some(body.orbit));
    let along = parent == body.parent && (drawn - radius).abs() <= STORED_ORBIT_SLACK;
    let moved = Body {
        parent,
        orbit: if along { body.orbit } else { radius },
        ..body
    };
    let at = point(centre, radius, normalised(angle));
    let step = (at.0 - body.at.0, at.1 - body.at.1);
    let under = descendants(bodies, id);
    Ok(bodies
        .iter()
        .map(|b| match b.id {
            _ if b.id == id => Body { at, ..moved },
            other if under.contains(&other) => Body {
                at: (b.at.0 + step.0, b.at.1 + step.1),
                ..*b
            },
            _ => *b,
        })
        .collect())
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
