//! What the graph says about where a system stands: that it exists and that the
//! destination is a place. Both formats' move writers start here and differ only in the
//! bytes they then splice. A save's height writer starts here too.

use crate::emit::coord;
use crate::ops::rules::{each_once, named};
use crate::ops::{Op, OpError, SystemHeight, SystemMove};
use crate::projections::galaxy::GalaxyGraph;

/// How far from the centre a system in a save may stand, as a share of the galaxy's radius.
/// The game puts some systems past the radius itself, so a system out there breaks nothing.
pub const GALAXY_REACH: f64 = 1.5;

/// Refuse a system at `to` farther from the centre than [`GALAXY_REACH`] times the galaxy's
/// radius, when the save records one. A system moving `from` a point already past that may
/// still move, so long as it goes no further out.
pub(crate) fn check_reach(
    graph: &GalaxyGraph,
    to: (f64, f64),
    from: Option<(f64, f64)>,
) -> Result<(), OpError> {
    let radius = graph.galaxy_radius;
    if radius <= 0.0 {
        return Ok(());
    }
    let limit = radius * GALAXY_REACH;
    let held = from.map_or(limit, |(x, y)| x.hypot(y).max(limit));
    let (x, y) = to;
    if x.hypot(y) > held {
        return Err(OpError::OutsideGalaxy {
            x,
            y,
            radius,
            limit,
        });
    }
    Ok(())
}

/// Where a system stands and where it is going, with the name a description calls it by.
pub(crate) struct Move {
    pub id: u32,
    pub name: String,
    pub from: (f64, f64),
    pub to: (f64, f64),
}

impl Move {
    /// `Moved <name> #<id> from (x, y) to (x, y)`, which both formats open with.
    pub fn describe(&self) -> String {
        format!(
            "Moved {} from ({}, {}) to ({}, {})",
            self.name,
            coord(self.from.0),
            coord(self.from.1),
            coord(self.to.0),
            coord(self.to.1)
        )
    }

    pub fn inverse(&self) -> Op {
        Op::MoveSystem {
            system: self.id,
            x: self.from.0,
            y: self.from.1,
        }
    }
}

/// What the graph says about moving `id` to (x, y): that it exists and that the
/// destination is a place.
pub(crate) fn decide_move(graph: &GalaxyGraph, id: u32, x: f64, y: f64) -> Result<Move, OpError> {
    if !x.is_finite() || !y.is_finite() {
        return Err(OpError::NotFinite);
    }
    let system = graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
    Ok(Move {
        id,
        name: named(graph, id),
        from: (system.x, system.y),
        to: (x, y),
    })
}

/// What the graph says about moving `moves` as one: every system exists, is listed once
/// and is going somewhere real. Returns the moves that put them back, in the order given.
/// Shared by both formats' bulk-move writers.
pub(crate) fn decide_moves(
    graph: &GalaxyGraph,
    moves: &[SystemMove],
) -> Result<Vec<SystemMove>, OpError> {
    each_once(moves, |m| m.system)?;
    let mut origin = Vec::with_capacity(moves.len());
    for m in moves {
        if !m.x.is_finite() || !m.y.is_finite() {
            return Err(OpError::NotFinite);
        }
        let system = graph
            .systems
            .get(&m.system)
            .ok_or(OpError::UnknownSystem(m.system))?;
        origin.push(SystemMove {
            system: m.system,
            x: system.x,
            y: system.y,
        });
    }
    Ok(origin)
}

/// What the graph says about setting `heights` as one: every system exists, is listed once
/// and is given a finite height or none. Returns the heights that put them back, in the
/// order given.
pub(crate) fn decide_heights(
    graph: &GalaxyGraph,
    heights: &[SystemHeight],
) -> Result<Vec<SystemHeight>, OpError> {
    each_once(heights, |h| h.system)?;
    heights
        .iter()
        .map(|h| {
            if h.height.is_some_and(|height| !height.is_finite()) {
                return Err(OpError::NotFinite);
            }
            let system = graph
                .systems
                .get(&h.system)
                .ok_or(OpError::UnknownSystem(h.system))?;
            Ok(SystemHeight {
                system: h.system,
                height: system.height,
            })
        })
        .collect()
}
