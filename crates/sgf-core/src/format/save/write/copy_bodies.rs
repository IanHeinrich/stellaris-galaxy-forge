//! Copying save planets as specs and pasting them as new bodies. A copy is the physical
//! planet only, read back as the [`NewBody`] that writes it with its moons placed about it:
//! no colony, owner, station, anomaly or dig site goes with it. A paste is one
//! [`Op::AddBody`] per copy, built from the specs alone, so it can go into another save.

use crate::cst::Node;
use crate::format::save::read_spec::belts;
use crate::format::save::write::add_body::{placement, spec_of};
use crate::format::save::write::bodies::{Stored, frame};
use crate::format::save::write::move_planet::normalised_set;
use crate::format::save::write::planet_entry::{is_star, role};
use crate::format::save::write::remove_planet::check_planet;
use crate::format::save::{check_version, planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::named;
use crate::ops::{NewBody, NewMoon, Op, OpError, StarEdit};
use crate::projections::geometry::system_reach;
use crate::session::Session;
use crate::views::{DocumentKind, OrbitPlacement};

/// The bodies of `bodies` as specs, each planet with its moons: see
/// [`Session::copy_bodies`].
pub(crate) fn copy(s: &Session, bodies: &[u32]) -> Result<Vec<NewBody>, OpError> {
    supported(s, "copying planets")?;
    let bodies = normalised_set(s, bodies);
    if bodies.is_empty() {
        return Err(OpError::NoEntries);
    }
    bodies.into_iter().map(|body| copy_one(s, body)).collect()
}

fn copy_one(s: &Session, body: u32) -> Result<NewBody, OpError> {
    let (node, src) = planet_entity(&s.doc, body)?;
    let system = planet_system(&node, src, body)?;
    let stored = frame(s, system)?;
    if star(s, &stored, body)? {
        return Err(OpError::StarRefused {
            body,
            edit: StarEdit::Copy,
        });
    }
    copyable(s, body, &node, src)?;
    let mut spec = spec_of(&s.doc, &node, src, None);
    for moon in stored.iter().filter(|b| b.body.parent == Some(body)) {
        let id = moon.body.id;
        if stored.iter().any(|b| b.body.parent == Some(id)) {
            return Err(OpError::MoonsNotAllowed("a moon"));
        }
        let (node, src) = planet_entity(&s.doc, id)?;
        copyable(s, id, &node, src)?;
        spec.moons.push(NewMoon {
            spec: spec_of(&s.doc, &node, src, None),
            at: placement(&stored, &moon.body, Some(body)),
        });
    }
    Ok(spec)
}

/// The op that pastes `copies` into system `system`: see [`Session::paste_bodies_op`].
pub(crate) fn paste_op(
    s: &Session,
    system: u32,
    copies: &[NewBody],
    at: Option<OrbitPlacement>,
) -> Result<Op, OpError> {
    supported(s, "AddBody")?;
    if copies.is_empty() {
        return Err(OpError::NoEntries);
    }
    if !s.graph.systems.contains_key(&system) {
        return Err(OpError::UnknownSystem(system));
    }
    let planets = copies.iter().map(|copy| NewBody {
        moon_of: None,
        ..copy.clone()
    });
    let mut first = at.map(|at| at.radius);
    let mut reach = match at {
        Some(_) => 0.0,
        None => outer_reach(s, system)?,
    };
    let angle = at.map_or(0.0, |at| at.angle);
    let mut ops: Vec<Op> = Vec::with_capacity(copies.len());
    for spec in planets {
        let extent = spec
            .moons
            .iter()
            .map(|moon| moon.at.radius)
            .fold(0.0, f64::max);
        let radius = first
            .take()
            .unwrap_or_else(|| (reach + s.radii().inner_offset + extent).ceil());
        reach = radius + extent;
        let at = OrbitPlacement { radius, angle };
        ops.push(Op::AddBody { system, spec, at });
    }
    if ops.len() == 1 {
        return Ok(ops.remove(0));
    }
    Ok(Op::Batch {
        description: format!(
            "Pasted {} planets into {}",
            ops.len(),
            named(&s.graph, system)
        ),
        ops,
    })
}

/// How far from its centre system `system`'s bodies and belts reach.
fn outer_reach(s: &Session, system: u32) -> Result<f64, OpError> {
    let bodies: Vec<_> = frame(s, system)?.into_iter().map(|b| b.body).collect();
    let belt_radii: Vec<f64> = belts(&s.doc, system)?
        .iter()
        .map(|belt| belt.inner_radius)
        .collect();
    Ok(system_reach(&bodies, &belt_radii))
}

/// Refuse `op` on a document other than a save, and on a save before Stellaris 4.0.
fn supported(s: &Session, op: &'static str) -> Result<(), OpError> {
    match s.kind() {
        DocumentKind::Save => check_version(&s.doc),
        kind => Err(OpError::Unsupported { op, kind }),
    }
}

/// Whether body `id` is a star: the system's primary or a body of a star's class.
fn star(s: &Session, stored: &[Stored], id: u32) -> Result<bool, OpError> {
    let (node, src) = planet_entity(&s.doc, id)?;
    let primary = stored.first().is_some_and(|b| b.body.id == id);
    Ok(is_star(role(&node, src, primary, s.star_classes())))
}

/// Refuse a body a copy leaves out: a ring world segment, a megastructure on or around it,
/// and a habitat, whose flags name the megastructure it is.
fn copyable(s: &Session, body: u32, node: &Node, src: &[u8]) -> Result<(), OpError> {
    check_planet(s, body, node, src, |_| OpError::MegastructurePlanet(body))?;
    let built = node
        .find(keys::FLAGS, src)
        .and_then(|flags| flags.find(keys::MEGASTRUCTURE, src));
    match built {
        Some(_) => Err(OpError::MegastructurePlanet(body)),
        None => Ok(()),
    }
}
