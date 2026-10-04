//! Fallen empire zones: the `set_star_flag`s in a system's `effect` block that Paint a
//! Galaxy seats a fallen empire by.

use super::flags::rewrite_flags;
use crate::format::scenario::fe_zone::{FeZone, flags, is_zone_flag};
use crate::ops::rules::fe_zone::decide_set;
use crate::ops::rules::labelled;
use crate::ops::{Op, OpError, Plan, Planned};
use crate::projections::galaxy::SystemNode;
use crate::session::Session;

pub(super) fn set_zone(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    zone: Option<&FeZone>,
) -> Result<Planned, OpError> {
    let (description, previous) = write_zone(plan, s, id, zone)?;
    Ok(Planned {
        description,
        inverse: Op::SetFeZone {
            system: id,
            zone: previous.1,
        },
    })
}

/// Write one system's zone, returning what to call the change and the entry that puts
/// it back.
fn write_zone(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    zone: Option<&FeZone>,
) -> Result<(String, (u32, Option<FeZone>)), OpError> {
    decide_set(&s.graph, id, zone)?;
    let system = s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
    let previous = system.fe_zone.clone();
    let description = describe(system, zone);
    let edit = plan.edit(&s.doc, id)?;
    let new_flags = zone.map(flags).unwrap_or_default();
    rewrite_flags(edit, |flag, _| is_zone_flag(flag), &new_flags)?;
    Ok((description, (id, previous)))
}

fn describe(system: &SystemNode, zone: Option<&FeZone>) -> String {
    let label = labelled(&system.name.key, system.name.literal, system.id);
    match (system.fe_zone.is_some(), zone.is_some()) {
        (false, true) => format!("Added fallen empire zone to {label}"),
        (true, false) => format!("Removed fallen empire zone from {label}"),
        (_, _) => format!("Changed fallen empire zone of {label}"),
    }
}
