//! A save system's star: `star_class` in its `galactic_object` entity and the
//! `planet_class` of each star body in `planets.planet`. Which bodies are stars and what
//! they become is the caller's to say from the install; only what differs is rewritten.

use std::collections::BTreeSet;

use crate::emit::quoted;
use crate::format::save::galaxy::bodies::planet_ids;
use crate::keys;
use crate::ops::rules::named;
use crate::ops::rules::{Form, check_text};
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
    if !s.graph.systems.contains_key(&id) {
        return Err(OpError::UnknownSystem(id));
    }
    check_text("a star class", class, Form::Bare)?;
    if bodies.is_empty() {
        return Err(OpError::NoStarBodies);
    }
    let edit = plan.edit(&s.doc, id)?;
    let entity = edit.entity()?;
    let listed = planet_ids(entity, &edit.buf);
    let old_class = read::text(entity, keys::STAR_CLASS, &edit.buf);
    let mut seen = BTreeSet::new();
    for body in bodies {
        if !seen.insert(body.body) {
            return Err(OpError::DuplicatePlanet(body.body));
        }
        if !listed.contains(&body.body) {
            return Err(OpError::NotABody {
                body: body.body,
                system: id,
            });
        }
        check_text("a planet class", &body.class, Form::Bare).map_err(|error| OpError::OnBody {
            body: body.body,
            error: Box::new(error),
        })?;
    }
    if old_class != class {
        edit.set_scalar(&[keys::STAR_CLASS], quoted(class))?;
    }

    let mut old_bodies = Vec::with_capacity(bodies.len());
    for body in bodies {
        let edit = plan.edit_planet(&s.doc, body.body, id)?;
        let old = read::text(edit.entity()?, keys::PLANET_CLASS, &edit.buf);
        if old != body.class {
            edit.set_scalar(&[keys::PLANET_CLASS], quoted(&body.class))?;
        }
        old_bodies.push(StarBody {
            body: body.body,
            class: old,
        });
    }
    let unchanged = old_bodies
        .iter()
        .zip(bodies)
        .all(|(o, n)| o.class == n.class);
    if old_class == class && unchanged {
        return Err(OpError::unchanged(
            format!("system {id}"),
            format!("is already {old_class} with those star bodies"),
        ));
    }
    Ok(Planned {
        description: format!(
            "Set the star class of {} from {old_class} to {class}",
            named(&s.graph, id)
        ),
        inverse: Op::SetStarClass {
            system: id,
            class: old_class,
            bodies: old_bodies,
        },
    })
}
