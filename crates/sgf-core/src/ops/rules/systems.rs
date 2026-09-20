//! What the graph says about where a system stands: that it exists and that the
//! destination is a place. Both formats' move writers start here and differ only in the
//! bytes they then splice.

use std::collections::BTreeSet;

use crate::emit::coord;
use crate::ops::{Op, OpError, SystemMove};
use crate::projections::galaxy::GalaxyGraph;

/// Where a system stands and where it is going, with the name a description calls it by.
pub(crate) struct Move {
    pub id: u32,
    pub name: String,
    pub from: (f64, f64),
    pub to: (f64, f64),
}

impl Move {
    /// `Moved <name> (#<id>) from (x, y) to (x, y)`, which both formats open with.
    pub fn describe(&self) -> String {
        format!(
            "Moved {} (#{}) from ({}, {}) to ({}, {})",
            self.name,
            self.id,
            coord(self.from.0),
            coord(self.from.1),
            coord(self.to.0),
            coord(self.to.1)
        )
    }

    pub fn inverse(&self) -> Op {
        Op::MoveSystem {
            id: self.id,
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
        name: system.display_name(),
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
    let mut seen = BTreeSet::new();
    let mut origin = Vec::with_capacity(moves.len());
    for m in moves {
        if !m.x.is_finite() || !m.y.is_finite() {
            return Err(OpError::NotFinite);
        }
        let system = graph
            .systems
            .get(&m.id)
            .ok_or(OpError::UnknownSystem(m.id))?;
        if !seen.insert(m.id) {
            return Err(OpError::DuplicateSystem(m.id));
        }
        origin.push(SystemMove {
            id: m.id,
            x: system.x,
            y: system.y,
        });
    }
    Ok(origin)
}
