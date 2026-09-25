//! A save planet's size: `planet_size` in its `planets.planet` entity, star bodies
//! included. The size is written as given; the game is the judge of what a class allows.

use crate::format::save::{planet_entity, planet_system};
use crate::keys;
use crate::ops::{Op, OpError, Plan, Planned};
use crate::projections::read;
use crate::session::Session;

pub(crate) fn plan_set(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    size: u32,
) -> Result<Planned, OpError> {
    let (node, src) = planet_entity(&s.doc, id)?;
    let system = planet_system(&node, src, id)?;
    if size == 0 {
        return Err(OpError::ZeroPlanetSize);
    }
    let edit = plan.edit_planet(&s.doc, id, system)?;
    let entity = edit.entity()?;
    let old = read::text(entity, keys::PLANET_SIZE, &edit.buf);
    let old: u32 = old.parse().map_err(|_| OpError::PlanetParse {
        planet: id,
        offset: entity.span().start,
        reason: format!("{} {old:?} is not a size", keys::PLANET_SIZE),
    })?;
    if old == size {
        return Err(OpError::PlanetSizeUnchanged(id, old));
    }
    edit.set_scalar(&[keys::PLANET_SIZE], size.to_string())?;
    Ok(Planned {
        description: format!("Set the size of planet #{id} from {old} to {size}"),
        inverse: Op::SetPlanetSize { id, size: old },
    })
}
