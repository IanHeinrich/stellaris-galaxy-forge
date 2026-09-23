//! What the graph says about a lane: whether a pair can be linked, which lanes a removal
//! or an isolation cuts, and what counts as a length. Both formats' lane writers start
//! here.

use std::collections::BTreeSet;

use crate::emit::coord;
use crate::ops::rules::each_once;
use crate::ops::{LanePair, OpError, projected_lane};
use crate::projections::galaxy::{GalaxyGraph, lane_length};

/// Largest `length` an op will write; far beyond any galaxy, and well inside `u32`.
const MAX_LENGTH: f64 = 1_000_000.0;

/// One lane of a selection: the end inside it, the other end, and whether it is a bridge.
pub(crate) type Touching = (u32, u32, bool);

/// A set length must be finite, non-negative and within [`MAX_LENGTH`].
pub(crate) fn check_length(length: f64) -> Result<(), OpError> {
    if !length.is_finite() {
        return Err(OpError::NotFinite);
    }
    if length < 0.0 {
        return Err(OpError::InvalidLength {
            length,
            reason: "length must be >= 0".to_owned(),
        });
    }
    if length > MAX_LENGTH {
        return Err(OpError::InvalidLength {
            length,
            reason: format!("length must be <= {}", coord(MAX_LENGTH)),
        });
    }
    Ok(())
}

/// What the graph says about connecting `a` to `b`: that they are two systems it holds
/// and are not linked already. Returns the generator-form length, which only a save
/// writes. Shared by both formats' add ops.
pub(crate) fn check_new_lane(graph: &GalaxyGraph, a: u32, b: u32) -> Result<u32, OpError> {
    if a == b {
        return Err(OpError::SelfLane(a));
    }
    let sa = graph.systems.get(&a).ok_or(OpError::UnknownSystem(a))?;
    let sb = graph.systems.get(&b).ok_or(OpError::UnknownSystem(b))?;
    if projected_lane(graph, a, b).is_some() {
        return Err(OpError::LaneExists(a, b));
    }
    Ok(lane_length(sa, sb) as u32)
}

/// What the graph says about removing `pairs`: each is a lane it lists, and none twice.
/// Returns the lanes an add op could put back, which leaves out one whose end the graph
/// does not hold. Shared by both formats' removal writers.
pub(crate) fn decide_remove_pairs(
    graph: &GalaxyGraph,
    pairs: &[(u32, u32)],
) -> Result<Vec<LanePair>, OpError> {
    if pairs.is_empty() {
        return Err(OpError::Empty);
    }
    let mut seen = BTreeSet::new();
    let mut restore = Vec::with_capacity(pairs.len());
    for &(a, b) in pairs {
        let lane = projected_lane(graph, a, b).ok_or(OpError::NoSuchLane(a, b))?;
        if !seen.insert(undirected(a, b)) {
            return Err(OpError::DuplicateLane(a, b));
        }
        if [a, b].iter().all(|id| graph.systems.contains_key(id)) {
            restore.push(LanePair {
                a,
                b,
                bridge: lane.bridge,
            });
        }
    }
    Ok(restore)
}

/// What the graph says isolating `ids` cuts: every lane with an end among them, each
/// undirected lane once, in projection order. Shared by both formats' isolate writers.
pub(crate) fn decide_isolate(graph: &GalaxyGraph, ids: &[u32]) -> Result<Vec<Touching>, OpError> {
    each_once(ids, |&id| id)?;
    if let Some(&id) = ids.iter().find(|id| !graph.systems.contains_key(id)) {
        return Err(OpError::UnknownSystem(id));
    }
    let lanes = touching_lanes(graph, ids.iter().copied());
    if lanes.is_empty() {
        return Err(OpError::NoLanes(ids[0]));
    }
    Ok(lanes)
}

/// Every lane with at least one end in `ids`, each undirected lane once, in the order
/// the projection lists them.
pub(crate) fn touching_lanes(graph: &GalaxyGraph, ids: impl Iterator<Item = u32>) -> Vec<Touching> {
    let mut seen = BTreeSet::new();
    let mut lanes = Vec::new();
    for id in ids {
        for lane in &graph.systems[&id].lanes {
            if seen.insert(undirected(id, lane.to)) {
                lanes.push((id, lane.to, lane.bridge));
            }
        }
    }
    lanes
}

pub(crate) fn undirected(a: u32, b: u32) -> (u32, u32) {
    (a.min(b), a.max(b))
}
