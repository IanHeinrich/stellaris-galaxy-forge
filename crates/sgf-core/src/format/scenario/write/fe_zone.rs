//! Fallen empire zones: the `set_star_flag`s in a system's `effect` block that Paint a
//! Galaxy seats a fallen empire by.

use super::flags::rewrite_flags;
use crate::format::scenario::fe_zone::{FeZone, flags, is_zone_flag};
use crate::ops::rules::fe_zone::{decide_set, label};
use crate::ops::rules::{bulk_description, each_once};
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
            id,
            zone: previous.1,
        },
    })
}

pub(super) fn set_zones(
    plan: &mut Plan,
    s: &Session,
    entries: &[(u32, Option<FeZone>)],
) -> Result<Planned, OpError> {
    each_once(entries, |&(id, _)| id)?;
    let mut one = String::new();
    let mut previous = Vec::with_capacity(entries.len());
    for (id, zone) in entries {
        let (description, was) = write_zone(plan, s, *id, zone.as_ref())?;
        one = description;
        previous.push(was);
    }
    Ok(Planned {
        description: bulk_description(entries.len(), one, "Set the fallen empire zone of"),
        inverse: Op::SetFeZones { entries: previous },
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
    let label = label(system);
    match (system.fe_zone.is_some(), zone.is_some()) {
        (false, true) => format!("Add fallen empire zone to {label}"),
        (true, false) => format!("Remove fallen empire zone from {label}"),
        (_, _) => format!("Change fallen empire zone of {label}"),
    }
}
