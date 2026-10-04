//! A save planet's class: `planet_class` in its `planets.planet` entity, written as the game's
//! `change_pc` writes it. That effect also drops `entity_name`, so the planet takes its new
//! class's model; it leaves `binary_flags` and everything else alone. The game recomputes
//! the colony's habitability itself. `entity` picks one of the class's numbered models, and
//! an index the new class has no model for goes back to 0.

use crate::NULL_ID;
use crate::emit::quoted;
use crate::entity::facts::planet::is_star_class;
use crate::format::save::write::planet_entity::write_entity_name;
use crate::format::save::write::planet_entry::PlanetEntry;
use crate::keys;
use crate::ops::rules::{Form, check_text};
use crate::ops::{ClassChange, Op, OpError, Plan, PlanetClassRule, PlanetLook, Planned, StarEdit};
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
    check_text("a planet class", &to.class, Form::Bare)?;
    let PlanetEntry { node, src, system } = PlanetEntry::open_unless_star(s, id, StarEdit::Class)?;
    let class = read::text(&node, keys::PLANET_CLASS, src);
    if from.class != class {
        return Err(OpError::PlanetClassMismatch {
            body: id,
            class,
            from: from.class.clone(),
        });
    }
    if to.class == class {
        return Err(OpError::unchanged(
            format!("planet {id}"),
            format!("is already {class}"),
        ));
    }
    for rule in [from, to] {
        if rule.change == ClassChange::Never || is_star_class(&rule.class) {
            return Err(OpError::FixedPlanetClass(rule.class.clone()));
        }
    }
    if node.find(keys::MEGASTRUCTURE, src).is_some() {
        return Err(OpError::MegastructureClass(id));
    }
    let colonised = read::scalar_u32(&node, keys::COLONY, src).is_some_and(|c| c != NULL_ID);
    if colonised
        && let Some(rule) = [from, to]
            .into_iter()
            .find(|r| r.change != ClassChange::Any)
    {
        return Err(OpError::ColonyPlanetClass {
            body: id,
            class: rule.class.clone(),
        });
    }

    let held = PlanetLook {
        entity: read::scalar_u32(&node, keys::ENTITY, src),
        entity_name: read::scalar(&node, keys::ENTITY_NAME, src).map(str::to_owned),
    };
    let wanted = match look {
        Some(look) => {
            if let Some(name) = &look.entity_name {
                check_text("a planet model", name, Form::Bare)?;
            }
            look.clone()
        }
        None => PlanetLook {
            entity: held.entity.map(|e| if e < to.models { e } else { 0 }),
            entity_name: None,
        },
    };
    let entity = wanted.entity.filter(|&e| held.entity != Some(e));
    if let Some(entity) = entity.filter(|&e| look.is_some() && e >= to.models) {
        return Err(OpError::PlanetModelIndex {
            body: id,
            entity,
            class: to.class.clone(),
            models: to.models,
        });
    }
    let edit = plan.edit_planet(&s.doc, id, system)?;
    edit.set_scalar(&[keys::PLANET_CLASS], quoted(&to.class))?;
    if let Some(entity) = entity {
        edit.set_scalar(&[keys::ENTITY], entity.to_string())?;
    }
    if held.entity_name != wanted.entity_name {
        write_entity_name(edit, wanted.entity_name.as_deref())?;
    }
    Ok(Planned {
        description: format!("Set the class of planet #{id} from {class} to {}", to.class),
        inverse: Op::SetBodyClass {
            body: id,
            from: to.clone(),
            to: from.clone(),
            look: Some(held),
        },
    })
}
