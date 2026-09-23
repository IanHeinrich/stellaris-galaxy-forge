//! A save planet's size: `planet_size` in its `planets.planet` entity, star bodies
//! included. The size is written as given; the game is the judge of what a class allows.

use crate::cst;
use crate::keys;
use crate::ops::{Op, OpError, Plan, Planned};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::scan::Value;
use crate::session::Session;

pub(crate) fn plan_set(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    size: u32,
) -> Result<Planned, OpError> {
    let system = system_of(s, id)?;
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

/// The system planet `id` sits in, from its `coordinate.origin`.
fn system_of(s: &Session, id: u32) -> Result<u32, OpError> {
    let entity = s
        .doc
        .inner_index(keys::PLANETS)?
        .and_then(|index| index.entity(keys::PLANET, u64::from(id)))
        .filter(|e| matches!(e.value, Value::Block { .. }))
        .ok_or(OpError::UnknownPlanet(id))?;
    let buf = s.doc.current(Anchor::Original(entity.stmt))?;
    let parse_error = |offset: usize, reason: String| OpError::PlanetParse {
        planet: id,
        offset,
        reason,
    };
    let root = cst::parse(buf, 0).map_err(|e| parse_error(e.offset, e.reason.to_owned()))?;
    let node = root
        .children()
        .first()
        .ok_or_else(|| parse_error(0, "empty statement".to_owned()))?;
    read::origin(node, buf).ok_or_else(|| {
        parse_error(
            node.span().start,
            format!("missing {}.{}", keys::COORDINATE, keys::ORIGIN),
        )
    })
}
