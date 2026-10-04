//! Whether a body may move or take a new parent, and where it then stands, decided over a
//! save system's [`Body`] frame; the format then writes the points that changed. The
//! measuring is [`crate::projections::geometry`]'s.

use crate::ops::OpError;
pub use crate::projections::geometry::{
    BELT_SCATTER, Body, MOON_RING_FIRST, MOON_RING_STEP, OVERLAP_TOLERANCE, Overlap,
    STORED_ORBIT_SLACK, SystemRadii, angle_about, centre, descendants, drawn_radius, find,
    moved_reach, normalised, overlaps, point, reach, system_reach,
};

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
