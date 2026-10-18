//! What the graph says about where a system stands: that it exists and that the
//! destination is a place. Both formats' move and swap writers start here and differ only
//! in the bytes they then splice. A save's height writer starts here too.

use std::collections::BTreeMap;

use crate::emit::coord;
use crate::ops::rules::{each_once, named};
use crate::ops::{Op, OpError, SystemHeight, SystemMove};
use crate::projections::galaxy::GalaxyGraph;

/// How far from the centre a new system in a save may be placed, as a share of the galaxy's
/// radius. A move has no such limit: the game takes systems far past the radius.
pub const GALAXY_REACH: f64 = 1.5;

/// Refuse a new system at (x, y) farther from the centre than [`GALAXY_REACH`] times the
/// galaxy's radius, when the save records one.
pub(crate) fn check_reach(graph: &GalaxyGraph, x: f64, y: f64) -> Result<(), OpError> {
    let radius = graph.galaxy_radius;
    if radius <= 0.0 {
        return Ok(());
    }
    let limit = radius * GALAXY_REACH;
    if x.hypot(y) > limit {
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

/// Two systems trading places, each going to the spot the other stands at.
pub(crate) struct Swap {
    pub system: u32,
    pub with: u32,
    /// `system` to `with`'s spot and `with` to `system`'s.
    pub moves: [SystemMove; 2],
    names: [String; 2],
}

impl Swap {
    /// `Swapped <name> #<id> and <name> #<id>`, which both formats open with.
    pub fn describe(&self) -> String {
        format!("Swapped {} and {}", self.names[0], self.names[1])
    }

    pub fn inverse(&self) -> Op {
        Op::SwapSystems {
            system: self.system,
            with: self.with,
        }
    }

    /// The other of the two for each, which a lane naming one of them names afterwards.
    pub fn renamed(&self) -> BTreeMap<u32, u32> {
        BTreeMap::from([(self.system, self.with), (self.with, self.system)])
    }
}

/// What the graph says about swapping `system` and `with`: that they are two systems and
/// both exist. Shared by both formats' swap writers.
pub(crate) fn decide_swap(graph: &GalaxyGraph, system: u32, with: u32) -> Result<Swap, OpError> {
    each_once(&[system, with], |&id| id)?;
    let spot = |id: u32| {
        let node = graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
        Ok::<_, OpError>((node.x, node.y))
    };
    let (a, b) = (spot(system)?, spot(with)?);
    Ok(Swap {
        system,
        with,
        moves: [
            SystemMove {
                system,
                x: b.0,
                y: b.1,
            },
            SystemMove {
                system: with,
                x: a.0,
                y: a.1,
            },
        ],
        names: [named(graph, system), named(graph, with)],
    })
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
