//! Custom connections: the `painted_galaxy_fe_custom_connection` star flags in a
//! system's `effect` block that Paint a Galaxy lays a fallen empire's hyperlanes by.
//! A system's connection flags come out whole and go back in at the end of the block,
//! in the shape its statements are written in; every other statement of the block
//! stays byte for byte.

use std::collections::BTreeSet;

use super::fe_zone::{append, block, statement};
use super::spawn::insert_after;
use crate::format::scenario::fe_link::{self, FeLinkFlags, MOST_IDS, flags, is_link_flag};
use crate::keys::scenario as keys;
use crate::ops::rules::fe_zone::label;
use crate::ops::{Op, OpError, Plan, Planned};
use crate::projections::galaxy::SystemNode;
use crate::session::Session;

pub(super) fn set_links(
    plan: &mut Plan,
    s: &Session,
    anchor: u32,
    linked: &[u32],
) -> Result<Planned, OpError> {
    let system = s
        .graph
        .systems
        .get(&anchor)
        .ok_or(OpError::UnknownSystem(anchor))?;
    if system.fe_zone.is_none() {
        return Err(OpError::FeLinkNoZone(anchor));
    }
    let mut wanted: BTreeSet<u32> = BTreeSet::new();
    for &id in linked {
        if id == anchor {
            return Err(OpError::FeLinkSelf(id));
        }
        if !s.graph.systems.contains_key(&id) {
            return Err(OpError::UnknownSystem(id));
        }
        wanted.insert(id);
    }
    // The mod stops at the first id an anchor carries, so an anchor keeps the one it has.
    let id = match (system.fe_link.id, wanted.is_empty()) {
        (Some(n), _) => Some(n),
        (None, true) => None,
        (None, false) => Some(fe_link::next_free_id(&s.graph).ok_or(OpError::FeLinkIdsExhausted)?),
    };
    let description = if wanted.is_empty() {
        format!(
            "Let the mod link the fallen empire zone at {} to its nearest systems",
            label(system)
        )
    } else {
        format!(
            "Link {} to the fallen empire zone at {}",
            count(wanted.len()),
            label(system)
        )
    };
    let mut by_id: Vec<&SystemNode> = s.graph.systems.values().collect();
    by_id.sort_unstable_by_key(|other| other.id);
    let mut previous = Vec::new();
    for other in by_id {
        let mut link = other.fe_link.clone();
        if other.id == anchor {
            link.custom = !wanted.is_empty();
            link.id = id.filter(|_| !wanted.is_empty());
        }
        if let Some(n) = id {
            link.to.retain(|&m| m != n);
            if wanted.contains(&other.id) {
                link.to.push(n);
                link.to.sort_unstable();
            }
        }
        if link != other.fe_link {
            previous.push((other.id, other.fe_link.clone()));
            write_flags(plan, s, other.id, &link)?;
        }
    }
    Ok(Planned {
        description,
        inverse: Op::SetFeLinkFlags { entries: previous },
    })
}

pub(super) fn set_flags(
    plan: &mut Plan,
    s: &Session,
    entries: &[(u32, FeLinkFlags)],
) -> Result<Planned, OpError> {
    if entries.is_empty() {
        return Err(OpError::Empty);
    }
    let mut seen = BTreeSet::new();
    for (id, link) in entries {
        if !seen.insert(*id) {
            return Err(OpError::DuplicateSystem(*id));
        }
        if let Some(n) = link
            .id
            .into_iter()
            .chain(link.to.iter().copied())
            .find(|&n| n >= MOST_IDS)
        {
            return Err(OpError::FeLinkIdOutOfRange(n, MOST_IDS));
        }
    }
    let mut previous = Vec::with_capacity(entries.len());
    for (id, link) in entries {
        let system = s.graph.systems.get(id).ok_or(OpError::UnknownSystem(*id))?;
        previous.push((*id, system.fe_link.clone()));
        write_flags(plan, s, *id, link)?;
    }
    Ok(Planned {
        description: format!(
            "Set the fallen empire connections of {}",
            count(entries.len())
        ),
        inverse: Op::SetFeLinkFlags { entries: previous },
    })
}

/// Take every connection flag off `id` and write `link`'s at the end of the block,
/// writing the block when the system has none and removing it when nothing else stood
/// in it.
fn write_flags(plan: &mut Plan, s: &Session, id: u32, link: &FeLinkFlags) -> Result<(), OpError> {
    let edit = plan.edit(&s.doc, id)?;
    let flags = flags(link);
    let Some(block) = block(edit, is_link_flag)? else {
        if !flags.is_empty() {
            let statements: Vec<String> = flags.iter().map(|f| statement(f)).collect();
            let text = format!("{} = {{ {} }}", keys::EFFECT, statements.join(" "));
            let last = edit
                .entity()?
                .children()
                .last()
                .ok_or_else(|| edit.parse_error(0, "empty system"))?
                .span()
                .end;
            insert_after(edit, last, &text);
        }
        return Ok(());
    };
    if flags.is_empty() && block.zone_flags.len() == block.children {
        edit.remove_statement(block.statement);
        return Ok(());
    }
    for span in &block.zone_flags {
        edit.remove_statement(*span);
    }
    for flag in flags {
        append(edit, &block, &statement(&flag));
    }
    Ok(())
}

fn count(systems: usize) -> String {
    if systems == 1 {
        "1 system".to_owned()
    } else {
        format!("{systems} systems")
    }
}
