//! Bulk ops over several systems or lanes at once: `MoveSystems`, `AddLanePairs`,
//! `RemoveLanePairs`, `IsolateSystems`, `SetLaneLengths`, `NormaliseLaneLengths`.
//!
//! An entity's splices must not overlap, so the pairs of an op are grouped per system
//! before any text is planned: one insertion per entity, one removal per entity, and
//! each undirected lane's lengths rewritten once.

use std::collections::{BTreeMap, BTreeSet};

use crate::format::save::write::lanes::{
    insert_entries, length_form, moved_length, pairs, remove_entries, wayline_note,
};
use crate::format::save::write::move_system::splice_coordinate;
use crate::format::save::write::nebula::{plan_membership, restoring};
use crate::ops::rules::each_once;
use crate::ops::rules::lanes::{
    Touching, check_length, check_new_lane, decide_isolate, decide_remove_pairs, touching_lanes,
    undirected,
};
use crate::ops::rules::nebula::describe_membership;
use crate::ops::rules::systems::decide_moves;
use crate::ops::{LaneLength, LanePair, Op, OpError, Plan, Planned, SystemMove, replace_lengths};
use crate::plural;
use crate::projections::galaxy::lane_length;
use crate::session::Session;

pub(crate) fn plan_move_many(
    plan: &mut Plan,
    s: &Session,
    moves: &[SystemMove],
) -> Result<Planned, OpError> {
    let (origin, updated) = move_systems(plan, s, moves)?;
    let (membership, had) = plan_membership(plan, s, moves)?;
    let description = format!(
        "Moved {}; updated {}{}",
        plural(moves.len(), "system"),
        plural(updated, "lane length"),
        describe_membership(&s.graph, &membership, true)
    );
    Ok(Planned {
        inverse: restoring(Op::MoveSystems { moves: origin }, had, &description),
        description,
    })
}

/// Rewrite each system's coordinate and the length of every lane touching one of them.
/// Returns the moves that put them back and the number of lengths rewritten.
pub(crate) fn move_systems(
    plan: &mut Plan,
    s: &Session,
    moves: &[SystemMove],
) -> Result<(Vec<SystemMove>, usize), OpError> {
    let origin = decide_moves(&s.graph, moves)?;
    let destination: BTreeMap<u32, (f64, f64)> = moves.iter().map(|m| (m.id, (m.x, m.y))).collect();
    for m in moves {
        splice_coordinate(plan.edit(&s.doc, m.id)?, m.x, m.y)?;
    }

    let position = |id: u32| {
        destination.get(&id).copied().unwrap_or_else(|| {
            let system = &s.graph.systems[&id];
            (system.x, system.y)
        })
    };
    let mut updated = 0;
    for (a, b, _) in touching_lanes(&s.graph, moves.iter().map(|m| m.id)) {
        if a == b || !s.graph.systems.contains_key(&b) {
            continue;
        }
        let text = moved_length(position(a), position(b));
        updated += replace_lengths(plan.edit(&s.doc, a)?, b, text)?;
        updated += replace_lengths(plan.edit(&s.doc, b)?, a, text)?;
    }
    Ok((origin, updated))
}

pub(crate) fn plan_add_pairs(
    plan: &mut Plan,
    s: &Session,
    lanes: &[LanePair],
) -> Result<Planned, OpError> {
    if lanes.is_empty() {
        return Err(OpError::NoEntries);
    }
    let mut seen = BTreeSet::new();
    let mut entries: BTreeMap<u32, Vec<(u32, u32, bool)>> = BTreeMap::new();
    for lane in lanes {
        let length = check_new_lane(&s.graph, lane.a, lane.b)?;
        if !seen.insert(undirected(lane.a, lane.b)) {
            return Err(OpError::DuplicateLane(lane.a, lane.b));
        }
        entries
            .entry(lane.a)
            .or_default()
            .push((lane.b, length, lane.bridge));
        entries
            .entry(lane.b)
            .or_default()
            .push((lane.a, length, lane.bridge));
    }
    for (id, entries) in &entries {
        insert_entries(plan.edit(&s.doc, *id)?, entries)?;
    }
    Ok(Planned {
        description: format!("Added {}", plural(lanes.len(), "lane")),
        inverse: Op::RemoveLanePairs {
            lanes: lanes.iter().map(|l| (l.a, l.b)).collect(),
        },
    })
}

pub(crate) fn plan_remove_pairs(
    plan: &mut Plan,
    s: &Session,
    lanes: &[(u32, u32)],
) -> Result<Planned, OpError> {
    let restore = decide_remove_pairs(&s.graph, lanes)?;
    remove_grouped(plan, s, lanes.iter().copied())?;
    Ok(Planned {
        description: format!(
            "Removed {}{}",
            plural(lanes.len(), "lane"),
            wayline_note(&s.graph, lanes)
        ),
        inverse: Op::AddLanePairs { lanes: restore },
    })
}

pub(crate) fn plan_isolate_many(
    plan: &mut Plan,
    s: &Session,
    ids: &[u32],
) -> Result<Planned, OpError> {
    let (lanes, _) = isolate(plan, s, ids)?;
    let cut = pairs(&lanes);
    let restore: Vec<LanePair> = lanes
        .iter()
        .filter(|&&(a, b, _)| a != b && s.graph.systems.contains_key(&b))
        .map(|&(a, b, bridge)| LanePair { a, b, bridge })
        .collect();
    Ok(Planned {
        description: format!(
            "Isolated {}; removed {}{}",
            plural(ids.len(), "system"),
            plural(restore.len(), "lane"),
            wayline_note(&s.graph, &cut)
        ),
        inverse: Op::AddLanePairs { lanes: restore },
    })
}

/// Delete every lane touching one of `ids`, on both ends. Returns those lanes in
/// projection order and how many entries were deleted.
pub(crate) fn isolate(
    plan: &mut Plan,
    s: &Session,
    ids: &[u32],
) -> Result<(Vec<Touching>, usize), OpError> {
    let lanes = decide_isolate(&s.graph, ids)?;
    let removed = remove_grouped(plan, s, lanes.iter().map(|&(a, b, _)| (a, b)))?;
    Ok((lanes, removed))
}

pub(crate) fn plan_set_lengths(
    plan: &mut Plan,
    s: &Session,
    lanes: &[LaneLength],
) -> Result<Planned, OpError> {
    let (restore, _) = set_lengths(plan, s, lanes)?;
    Ok(Planned {
        description: format!("Set {}", plural(lanes.len(), "lane length")),
        inverse: Op::SetLaneLengths { lanes: restore },
    })
}

/// Rewrite each lane's length on both ends, refusing a lane whose ends disagree. Returns
/// the lengths that put them back and how many entries were rewritten.
pub(crate) fn set_lengths(
    plan: &mut Plan,
    s: &Session,
    lanes: &[LaneLength],
) -> Result<(Vec<LaneLength>, usize), OpError> {
    if lanes.is_empty() {
        return Err(OpError::NoEntries);
    }
    let mut seen = BTreeSet::new();
    let mut restore = Vec::with_capacity(lanes.len());
    let mut updated = 0;
    for lane in lanes {
        check_length(lane.length)?;
        let old = agreed_length(s, lane.a, lane.b)?;
        if !seen.insert(undirected(lane.a, lane.b)) {
            return Err(OpError::DuplicateLane(lane.a, lane.b));
        }
        restore.push(LaneLength {
            a: lane.a,
            b: lane.b,
            length: old,
        });
        let text = length_form(lane.length);
        updated += replace_lengths(plan.edit(&s.doc, lane.a)?, lane.b, text)?;
        if lane.b != lane.a {
            updated += replace_lengths(plan.edit(&s.doc, lane.b)?, lane.a, text)?;
        }
    }
    Ok((restore, updated))
}

/// Rewrite every stale lane touching one of `systems` to `floor(distance)`, on both ends.
pub(crate) fn plan_normalise_lengths(
    plan: &mut Plan,
    s: &Session,
    systems: &[u32],
) -> Result<Planned, OpError> {
    each_once(systems, |&id| id)?;
    if let Some(&id) = systems.iter().find(|id| !s.graph.systems.contains_key(id)) {
        return Err(OpError::UnknownSystem(id));
    }
    let mut normalised = Vec::new();
    for (a, b, _) in touching_lanes(&s.graph, systems.iter().copied()) {
        let Some(there) = s.graph.systems.get(&b).filter(|_| a != b) else {
            continue;
        };
        // A lane whose entries disagree has no one length an inverse could put back.
        let Ok(old) = agreed_length(s, a, b) else {
            continue;
        };
        let length = lane_length(s.graph.systems[&a].position(), there.position());
        if old != length {
            normalised.push(LaneLength { a, b, length });
        }
    }
    if normalised.is_empty() {
        return Err(OpError::AlreadyNormal);
    }
    let (restore, _) = set_lengths(plan, s, &normalised)?;
    Ok(Planned {
        description: format!("Normalised {}", plural(restore.len(), "lane length")),
        inverse: Op::SetLaneLengths { lanes: restore },
    })
}

/// The one length every entry of lane `a`-`b` holds, on both ends, which is what a single
/// length put back restores; refused when the entries disagree.
pub(crate) fn agreed_length(s: &Session, a: u32, b: u32) -> Result<f64, OpError> {
    let entries = |x: u32, y: u32| {
        s.graph
            .systems
            .get(&x)
            .into_iter()
            .flat_map(|system| &system.lanes)
            .filter(move |lane| lane.to == y)
            .map(|lane| lane.length)
    };
    let mut lengths = entries(a, b).chain(entries(b, a));
    let first = lengths.next().ok_or(OpError::NoSuchLane(a, b))?;
    match lengths.all(|length| length == first) {
        true => Ok(first),
        false => Err(OpError::LaneEndsDisagree(a, b)),
    }
}

/// Delete the entries of each lane on both ends, one removal per system. Returns how
/// many entries were deleted.
fn remove_grouped(
    plan: &mut Plan,
    s: &Session,
    lanes: impl Iterator<Item = (u32, u32)>,
) -> Result<usize, OpError> {
    let mut targets: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
    for (a, b) in lanes {
        targets.entry(a).or_default().push(b);
        if b != a {
            targets.entry(b).or_default().push(a);
        }
    }
    let mut removed = 0;
    for (id, targets) in &targets {
        if s.graph.systems.contains_key(id) {
            removed += remove_entries(plan.edit(&s.doc, *id)?, targets)?;
        }
    }
    Ok(removed)
}
