//! A save planet's class: `planet_class` in its `planets.planet` entity, written as the game's
//! `change_pc` writes it. That effect also drops `entity_name`, so the planet takes its new
//! class's model; it leaves `binary_flags` and everything else alone. The game recomputes
//! the colony's habitability itself. `entity` picks one of the class's numbered models, and
//! an index the new class has no model for goes back to 0.

use crate::format::save::read_spec::bodies;
use crate::format::save::write::move_planet::is_star_class;
use crate::format::save::{check_version, planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::{Form, check_text, quoted};
use crate::ops::{ClassChange, Op, OpError, Plan, PlanetClassRule, PlanetLook, Planned};
use crate::projections::read;
use crate::session::Session;

pub(crate) fn plan_set(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    from: &PlanetClassRule,
    to: &PlanetClassRule,
    look: Option<&PlanetLook>,
) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    check_text("a planet class", &to.class, Form::Bare)?;
    let (node, src) = planet_entity(&s.doc, id)?;
    let system = planet_system(&node, src, id)?;
    let class = read::text(&node, keys::PLANET_CLASS, src);
    let primary = bodies(&s.doc, system)?.first() == Some(&id);
    if primary || is_star_class(&class) {
        return Err(OpError::StarPlanetClass(id));
    }
    if from.class != class {
        return Err(OpError::PlanetClassMismatch {
            planet: id,
            class,
            from: from.class.clone(),
        });
    }
    if to.class == class {
        return Err(OpError::PlanetClassUnchanged(id, class));
    }
    for rule in [from, to] {
        if rule.change == ClassChange::Never || is_star_class(&rule.class) {
            return Err(OpError::FixedPlanetClass(rule.class.clone()));
        }
    }
    if read::scalar(&node, keys::COLONY, src).is_some()
        && let Some(rule) = [from, to]
            .into_iter()
            .find(|r| r.change != ClassChange::Any)
    {
        return Err(OpError::ColonyPlanetClass {
            planet: id,
            class: rule.class.clone(),
        });
    }

    let held = PlanetLook {
        entity: read::scalar_u32(&node, keys::ENTITY, src),
        entity_name: read::scalar(&node, keys::ENTITY_NAME, src).map(str::to_owned),
    };
    let wanted = look.cloned().unwrap_or(PlanetLook {
        entity: held.entity.map(|e| if e < to.models { e } else { 0 }),
        entity_name: None,
    });
    let edit = plan.edit_planet(&s.doc, id, system)?;
    edit.set_scalar(&[keys::PLANET_CLASS], quoted(&to.class))?;
    if let Some(entity) = wanted.entity.filter(|&e| held.entity != Some(e)) {
        edit.set_scalar(&[keys::ENTITY], entity.to_string())?;
    }
    let written = edit
        .entity()?
        .find(keys::ENTITY_NAME, &edit.buf)
        .map(|n| n.span());
    match (written, wanted.entity_name.as_deref()) {
        (Some(span), None) => edit.remove_statement(span),
        (Some(_), Some(name)) if held.entity_name.as_deref() != Some(name) => {
            edit.set_scalar(&[keys::ENTITY_NAME], quoted(name))?;
        }
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
        _ => {}
    }
    Ok(Planned {
        description: format!("Set the class of planet #{id} from {class} to {}", to.class),
        inverse: Op::SetPlanetClass {
            planet: id,
            from: to.clone(),
            to: from.clone(),
            look: Some(held),
        },
    })
}
