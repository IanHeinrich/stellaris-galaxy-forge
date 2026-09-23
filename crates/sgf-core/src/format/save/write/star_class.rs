//! A save system's star: `star_class` in its `galactic_object` entity and the
//! `planet_class` of each star body in `planets.planet`. Which bodies are stars and what
//! they become is the caller's to say from the install; only what differs is rewritten.

use std::collections::BTreeSet;

use crate::keys;
use crate::ops::rules::quoted;
use crate::ops::{Op, OpError, Plan, Planned, StarBody};
use crate::projections::read;
use crate::session::Session;

pub(crate) fn plan_set(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    class: &str,
    bodies: &[StarBody],
) -> Result<Planned, OpError> {
    let system = s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
    check_class(class, OpError::EmptyStarClass)?;
    if bodies.is_empty() {
        return Err(OpError::NoStarBodies);
    }
    let edit = plan.edit(&s.doc, id)?;
    let entity = edit.entity()?;
    let listed: Vec<u32> = entity
        .find_all(keys::PLANET, &edit.buf)
        .filter_map(|n| n.scalar_str(&edit.buf)?.parse().ok())
        .collect();
    let old_class = read::text(entity, keys::STAR_CLASS, &edit.buf);
    let mut seen = BTreeSet::new();
    for body in bodies {
        if !seen.insert(body.planet) {
            return Err(OpError::DuplicatePlanet(body.planet));
        }
        if !listed.contains(&body.planet) {
            return Err(OpError::NotABody {
                planet: body.planet,
                system: id,
            });
        }
        check_class(&body.class, OpError::EmptyPlanetClass(body.planet))?;
    }
    if old_class != class {
        edit.set_scalar(&[keys::STAR_CLASS], quoted(class))?;
    }

    let mut old_bodies = Vec::with_capacity(bodies.len());
    for body in bodies {
        let edit = plan.edit_planet(&s.doc, body.planet, id)?;
        let old = read::text(edit.entity()?, keys::PLANET_CLASS, &edit.buf);
        if old != body.class {
            edit.set_scalar(&[keys::PLANET_CLASS], quoted(&body.class))?;
        }
        old_bodies.push(StarBody {
            planet: body.planet,
            class: old,
        });
    }
    let unchanged = old_bodies
        .iter()
        .zip(bodies)
        .all(|(o, n)| o.class == n.class);
    if old_class == class && unchanged {
        return Err(OpError::StarClassUnchanged(id, old_class));
    }
    Ok(Planned {
        description: format!(
            "Set the star class of {} (#{id}) from {old_class} to {class}",
            system.display_name()
        ),
        inverse: Op::SetStarClass {
            id,
            class: old_class,
            bodies: old_bodies,
        },
    })
}

/// A class is written between quotes with no escaping, as a name is; `empty` is the
/// refusal for none at all.
fn check_class(class: &str, empty: OpError) -> Result<(), OpError> {
    if class.is_empty() {
        return Err(empty);
    }
    if class.contains(['"', '\\', '\n', '\r']) {
        return Err(OpError::InvalidClass(class.to_owned()));
    }
    Ok(())
}
