//! `RenameSaveSystem`, for the systems [`super::add_system`] wrote since the file was
//! opened: the name in the system's entry, and in its star's, planets' and moons', which
//! carry it as the text of their `NAME` or `PARENT` variable, or as the whole name of a
//! star named by its class. A body with a fixed name of its own keeps it. The old name goes
//! back to the pool of unused star or black hole names as [`super::remove_system`]
//! returns one, and the new one leaves its pool as an add takes one.

use std::ops::Range;

use crate::cst::Node;
use crate::format::save::added::Table;
use crate::format::save::write::add_system::{NAME_VAR, PARENT_VAR};
use crate::format::save::write::name_pool::{self, SYSTEM_POOLS};
use crate::format::save::write::remove_system::{bodies, check_added};
use crate::keys;
use crate::ops::rules::{check_name, quoted};
use crate::ops::{Op, OpError, Plan, Planned};
use crate::session::Session;

/// The variables a body's name carries its system's name in.
const SYSTEM_VARS: [&str; 2] = [NAME_VAR, PARENT_VAR];

pub(crate) fn plan_rename(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    name: &str,
) -> Result<Planned, OpError> {
    check_added(s, id)?;
    check_name(name)?;
    let system = s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
    let old = system.name.key.clone();
    if old == name {
        return Err(OpError::NameUnchanged(id, old));
    }
    rename_entries(plan, s, id, &old, name)?;
    swap_name(plan, s, id, &old, name)?;
    Ok(Planned {
        description: format!("Renamed {old} (#{id}) to {name}"),
        inverse: Op::RenameSaveSystem {
            system: id,
            name: old,
        },
    })
}

/// Write `new` for `old` in system `id`'s name and in each of its bodies' names.
fn rename_entries(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    old: &str,
    new: &str,
) -> Result<(), OpError> {
    let edit = plan.edit(&s.doc, id)?;
    let key = edit
        .entity()?
        .find(keys::NAME, &edit.buf)
        .and_then(|name| name.find(keys::KEY, &edit.buf))
        .and_then(Node::scalar_span)
        .ok_or_else(|| edit.parse_error(0, "the system's name has no key"))?;
    edit.splices.push((key.range(), quoted(new).into_bytes()));
    for (i, planet) in bodies(&s.doc, id)?.into_iter().enumerate() {
        let edit = plan.edit_planet(&s.doc, planet, id)?;
        let mut splices = Vec::new();
        if let Some(name) = edit.entity()?.find(keys::NAME, &edit.buf) {
            if i == 0 {
                splices.extend(plain_name(name, &edit.buf, old));
            }
            system_names(name, &edit.buf, old, &mut splices);
        }
        let text = quoted(new).into_bytes();
        edit.splices
            .extend(splices.into_iter().map(|range| (range, text.clone())));
    }
    Ok(())
}

/// The `key` of `name` when it is `old` alone, as a star named by its class holds it.
fn plain_name(name: &Node, src: &[u8], old: &str) -> Option<Range<usize>> {
    if name.find(keys::LITERAL, src).is_some() || name.find(keys::VARIABLES, src).is_some() {
        return None;
    }
    let key = name.find(keys::KEY, src)?;
    if key.scalar_str(src) != Some(old) {
        return None;
    }
    key.scalar_span().map(|span| span.range())
}

/// The `key` of every name inside `name` that stands for the system as `old`: a plain
/// name that is the value of a `NAME` or `PARENT` variable, at any depth, as a moon names
/// its planet and the planet its system.
fn system_names(name: &Node, src: &[u8], old: &str, out: &mut Vec<Range<usize>>) {
    let Some(variables) = name.find(keys::VARIABLES, src) else {
        return;
    };
    for variable in variables.children() {
        let Some(value) = variable.find(keys::VALUE, src) else {
            continue;
        };
        let of_system = variable
            .find(keys::KEY, src)
            .and_then(|key| key.scalar_str(src))
            .is_some_and(|key| SYSTEM_VARS.contains(&key));
        let plain =
            value.find(keys::LITERAL, src).is_none() && value.find(keys::VARIABLES, src).is_none();
        let key = value.find(keys::KEY, src);
        if let Some(span) = key.and_then(Node::scalar_span)
            && of_system
            && plain
            && key.and_then(|key| key.scalar_str(src)) == Some(old)
        {
            out.push(span.range());
        }
        system_names(value, src, old, out);
    }
}

/// Put `old` back in the pool of unused star or black hole names system `id`'s add took
/// it from when no other added system holds it, and take `new` out of whichever pool
/// holds it.
pub(crate) fn swap_name(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    old: &str,
    new: &str,
) -> Result<(), OpError> {
    let staying = s
        .doc
        .added()
        .entries(Table::System)
        .filter(|&(other, _)| other != id)
        .filter(|(other, _)| {
            s.graph
                .systems
                .get(other)
                .is_some_and(|o| o.name.key == old)
        })
        .count();
    name_pool::swap(plan, &s.doc, SYSTEM_POOLS, (old, new), staying)
}
