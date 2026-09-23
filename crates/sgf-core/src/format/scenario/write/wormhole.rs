//! Wormhole pairs: the `painted_galaxy_wormhole_<n>` star flag both ends of a pair carry
//! in their `effect` block, with `empire_cluster` beside it.

use super::flags::rewrite_flags;
use crate::format::scenario::paint::{EMPIRE_CLUSTER, WORMHOLE_FLAG_PREFIX, is_wormhole_flag};
use crate::ops::rules::each_once;
use crate::ops::rules::fe_zone::label;
use crate::ops::{Op, OpError, Plan, Planned};
use crate::plural;
use crate::session::Session;

pub(super) fn set_pair(
    plan: &mut Plan,
    s: &Session,
    a: u32,
    b: u32,
    pair: Option<u32>,
) -> Result<Planned, OpError> {
    if a == b {
        return Err(OpError::WormholeSelf(a));
    }
    let end = |id: u32| s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id));
    let (first, second) = (end(a)?, end(b)?);
    if let Some(n) = pair
        && s.graph
            .systems
            .values()
            .any(|other| other.id != a && other.id != b && other.wormhole_pair == Some(n))
    {
        return Err(OpError::WormholePairInUse(n));
    }
    let previous = vec![(a, first.wormhole_pair), (b, second.wormhole_pair)];
    let description = match pair {
        Some(n) => format!(
            "Join {} and {} as wormhole pair {n}",
            label(first),
            label(second)
        ),
        None => format!(
            "Remove the wormhole pair from {} and {}",
            label(first),
            label(second)
        ),
    };
    for id in [a, b] {
        write_end(plan, s, id, pair)?;
    }
    Ok(Planned {
        description,
        inverse: inverse(previous),
    })
}

pub(super) fn set_ends(
    plan: &mut Plan,
    s: &Session,
    entries: &[(u32, Option<u32>)],
) -> Result<Planned, OpError> {
    each_once(entries, |&(id, _)| id)?;
    let mut previous = Vec::with_capacity(entries.len());
    for (id, pair) in entries {
        let system = s.graph.systems.get(id).ok_or(OpError::UnknownSystem(*id))?;
        previous.push((*id, system.wormhole_pair));
        write_end(plan, s, *id, *pair)?;
    }
    Ok(Planned {
        description: format!(
            "Set the wormhole pair of {}",
            plural(entries.len(), "system")
        ),
        inverse: inverse(previous),
    })
}

/// The op that puts both ends back: one pair when both held the same number, else each
/// end on its own.
fn inverse(previous: Vec<(u32, Option<u32>)>) -> Op {
    match previous[..] {
        [(a, pair), (b, other)] if pair == other => Op::SetWormholePair { a, b, pair },
        _ => Op::SetWormholeEnds { entries: previous },
    }
}

/// Take every wormhole flag off `id`, with the `empire_cluster` standing right after
/// each, and write the pair's two flags at the end of the block.
fn write_end(plan: &mut Plan, s: &Session, id: u32, pair: Option<u32>) -> Result<(), OpError> {
    let edit = plan.edit(&s.doc, id)?;
    let new_flags: Vec<String> = pair
        .into_iter()
        .flat_map(|n| [flag(n), EMPIRE_CLUSTER.to_owned()])
        .collect();
    rewrite_flags(edit, paired, &new_flags)
}

/// A wormhole flag, or the `empire_cluster` written right after one.
fn paired(flag: &str, before: Option<&str>) -> bool {
    is_wormhole_flag(flag) || (flag == EMPIRE_CLUSTER && before.is_some_and(is_wormhole_flag))
}

fn flag(pair: u32) -> String {
    format!("{WORMHOLE_FLAG_PREFIX}{pair}")
}
