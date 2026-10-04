//! A save body's ring: the ring bit of `binary_flags` in its `planets.planet` entity. The
//! bit is written whatever the body's class; the game is the judge of what a class draws.

use crate::emit::system::RING_FLAG;
use crate::format::save::write::planet_entry::{PlanetEntry, set_flag};
use crate::keys;
use crate::ops::{Op, OpError, Plan, Planned};
use crate::projections::read;
use crate::session::Session;

pub(crate) fn plan_set(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    ring: bool,
) -> Result<Planned, OpError> {
    let PlanetEntry { node, src, system } = PlanetEntry::open(s, id)?;
    let held = read::scalar_u32(&node, keys::BINARY_FLAGS, src).is_some_and(|f| f & RING_FLAG != 0);
    if held == ring {
        let state = if ring {
            "already has a ring"
        } else {
            "has no ring"
        };
        return Err(OpError::RingUnchanged { planet: id, state });
    }
    set_flag(plan.edit_planet(&s.doc, id, system)?, RING_FLAG, ring)?;
    let description = match ring {
        true => format!("Gave planet #{id} a ring"),
        false => format!("Took the ring off planet #{id}"),
    };
    Ok(Planned {
        description,
        inverse: Op::SetBodyRing {
            body: id,
            ring: held,
        },
    })
}
