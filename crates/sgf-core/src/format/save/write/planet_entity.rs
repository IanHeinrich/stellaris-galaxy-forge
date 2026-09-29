//! A save planet's model: `entity_name="<entity>"` on the line after its `entity=N`, the
//! index of its class's random variant, which stays. The game draws the named model on any
//! class, whatever bit 2 of `binary_flags` says. That bit marks a model an initializer set,
//! so a model is written without it, as `set_planet_entity` writes one, and goes with the
//! model it marked.

use crate::emit::quoted;
use crate::emit::system::ENTITY_NAME_FLAG;
use crate::format::save::read_spec::bodies;
use crate::format::save::write::bodies::set_flag;
use crate::format::save::write::move_planet::is_star_class;
use crate::format::save::{check_version, planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::{Form, check_text};
use crate::ops::{Edit, Op, OpError, Plan, Planned};
use crate::projections::read;
use crate::session::Session;

pub(crate) fn plan_set(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    entity: Option<&str>,
) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    if let Some(entity) = entity {
        check_text("a planet model", entity, Form::Bare)?;
    }
    let (node, src) = planet_entity(&s.doc, id)?;
    let system = planet_system(&node, src, id)?;
    let primary = bodies(&s.doc, system)?.first() == Some(&id);
    if primary || is_star_class(&read::text(&node, keys::PLANET_CLASS, src)) {
        return Err(OpError::StarModel(id));
    }
    let held = read::scalar(&node, keys::ENTITY_NAME, src).map(str::to_owned);
    if held.as_deref() == entity {
        return Err(OpError::ModelUnchanged {
            planet: id,
            state: match entity {
                Some(entity) => format!("already has the model {entity}"),
                None => "has no model of its own".to_owned(),
            },
        });
    }

    let edit = plan.edit_planet(&s.doc, id, system)?;
    write_entity_name(edit, entity)?;
    let description = match entity {
        Some(entity) => format!("Gave planet #{id} the model {entity}"),
        None => {
            set_flag(edit, ENTITY_NAME_FLAG, false)?;
            let old = held.as_deref().unwrap_or_default();
            format!("Took the model {old} off planet #{id}")
        }
    };
    Ok(Planned {
        description,
        inverse: Op::SetPlanetEntity {
            planet: id,
            entity: held,
        },
    })
}

/// Makes the planet's `entity_name` read `name`: replaced where it is written, put after the
/// `entity=` line where it is not, and removed for `None`.
pub(crate) fn write_entity_name(edit: &mut Edit, name: Option<&str>) -> Result<(), OpError> {
    let written = edit
        .entity()?
        .find(keys::ENTITY_NAME, &edit.buf)
        .map(|n| n.span());
    match (written, name) {
        (Some(span), None) => edit.remove_statement(span),
        (Some(_), Some(name)) => edit.set_scalar(&[keys::ENTITY_NAME], quoted(name))?,
        (None, Some(name)) => {
            let anchor = edit
                .entity()?
                .find(keys::ENTITY, &edit.buf)
                .map(|n| n.span())
                .ok_or_else(|| edit.parse_error(0, format!("missing {}", keys::ENTITY)))?;
            edit.insert_after(
                anchor.end,
                &format!("{}={}", keys::ENTITY_NAME, quoted(name)),
            );
        }
        (None, None) => {}
    }
    Ok(())
}
