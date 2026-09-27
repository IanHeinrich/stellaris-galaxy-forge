//! Where a system's planets and moons stand about their parents, and how close two of them
//! may stand before they count as one place.
//!
//! Each format reads its bodies into [`Body`] frames; a move or a new parent is decided
//! here, over the frame, and the format then writes the points that changed.

use crate::ops::{INNER_MARGIN, MIN_INNER_RADIUS, OpError};

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

/// How far the furthest body of the frame reaches, an event-placed body at `orbit` zero or
/// less set aside (see [`reaches_for_the_rule`]). A caller measuring a body its own op is
/// moving calls [`reach`] on it directly instead, which this exclusion does not touch.
pub fn system_reach(bodies: &[Body]) -> f64 {
    bodies
        .iter()
        .filter(|b| reaches_for_the_rule(bodies, b))
        .map(|b| reach(bodies, b))
        .fold(0.0, f64::max)
}

/// Body `id`, refused when the frame does not list it or lists it first, as its primary.
pub fn movable(bodies: &[Body], system: u32, id: u32) -> Result<&Body, OpError> {
    let body = find(bodies, id).ok_or(OpError::NotABody { planet: id, system })?;
    if bodies.first().is_some_and(|primary| primary.id == id) {
        return Err(OpError::PrimaryBody(id));
    }
    Ok(body)
}

/// Refuse `parent` as body `id`'s new one: a body outside the frame, the body itself or one
/// of its moons, a moon, the primary, or the parent it has. A body with moons may not
/// become a moon.
pub fn check_parent(
    bodies: &[Body],
    system: u32,
    id: u32,
    parent: Option<u32>,
) -> Result<(), OpError> {
    let body = movable(bodies, system, id)?;
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
        } else if host.parent.is_some() {
            Some(format!(
                "planet {parent} is a moon, and a moon cannot have moons"
            ))
        } else if bodies.first().is_some_and(|primary| primary.id == parent) {
            Some(format!(
                "planet {parent} is the system's primary body: to make planet {id} a planet, give it no parent"
            ))
        } else {
            None
        };
        if let Some(reason) = reason {
            return Err(OpError::InvalidParent { reason });
        }
        if bodies.iter().any(|b| b.parent == Some(id)) {
            return Err(OpError::HasMoons(id));
        }
    }
    if body.parent == parent {
        return Err(OpError::ParentUnchanged(id));
    }
    Ok(())
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

/// The `inner_radius` a move of body `id` from `before` to `after` grows the system's
/// `current` one to: the least the new frame allows, when body `id` or a body under it now
/// reaches past both the current radius less its margin and every body of `before`. `None`
/// when the radius stays; it never shrinks. A reach within the stored-orbit slack of the old
/// one is no further: a body moved round its ring lands where its drawn radius says, which
/// can sit that far from the point the game wrote.
pub fn grown_inner_radius(before: &[Body], after: &[Body], id: u32, current: f64) -> Option<f64> {
    let mut moved = descendants(after, id);
    moved.push(id);
    let reach = moved
        .iter()
        .filter_map(|&m| find(after, m))
        .map(|b| reach(after, b))
        .fold(0.0, f64::max);
    let grows = reach > system_reach(before) + STORED_ORBIT_SLACK && reach + INNER_MARGIN > current;
    grows.then(|| MIN_INNER_RADIUS.max(reach + INNER_MARGIN))
}
