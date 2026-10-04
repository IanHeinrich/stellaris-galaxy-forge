//! A save planet's model: `entity_name="<entity>"` on the line after its `entity=N`, the
//! index of its class's random variant, which stays. The game draws the named model on any
//! class, whatever bit 2 of `binary_flags` says. That bit marks a model an initializer set,
//! so a model is written without it, as `set_planet_entity` writes one, and goes with the
//! model it marked.

use crate::emit::quoted;
use crate::emit::system::ENTITY_NAME_FLAG;
use crate::format::save::write::place::{self, insert_key};
use crate::format::save::write::planet_entry::{PlanetEntry, set_flag};
use crate::keys;
use crate::ops::rules::{Form, check_text};
use crate::ops::{Edit, Op, OpError, Plan, Planned, StarEdit};
use crate::projections::read;
use crate::session::Session;

pub(crate) fn plan_set(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    entity: Option<&str>,
) -> Result<Planned, OpError> {
    if let Some(entity) = entity {
        check_text("a planet model", entity, Form::Bare)?;
    }
    let PlanetEntry { node, src, system } = PlanetEntry::open_unless_star(s, id, StarEdit::Model)?;
    let held = read::scalar(&node, keys::ENTITY_NAME, src).map(str::to_owned);
    if held.as_deref() == entity {
        let state = match entity {
            Some(entity) => format!("already has the model {entity}"),
            None => "has no model of its own".to_owned(),
        };
        return Err(OpError::unchanged(format!("planet {id}"), state));
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
        inverse: Op::SetBodyModel {
            body: id,
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
            let text = format!("{}={}", keys::ENTITY_NAME, quoted(name));
            insert_key(edit, &[], &place::planet::ENTITY_NAME, |_| text)?;
        }
        (None, None) => {}
    }
    Ok(())
}
