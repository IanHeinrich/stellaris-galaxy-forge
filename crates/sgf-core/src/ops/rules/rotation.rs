//! What the graph says about turning a selection of systems about a point: where each lands
//! as the file will hold it, and which nebulae turn with them.

use crate::emit::{coord, rounded};
use crate::ops::rules::each_once;
use crate::ops::{Op, OpError, SystemMove};
use crate::projections::galaxy::GalaxyGraph;
use crate::{plural, plural_of};

/// The sign that turns a positive angle clockwise as the galaxy map shows it: the map
/// mirrors the file's x axis, so the turn in the file's coordinates goes the other way.
const CLOCKWISE_AS_SHOWN: f64 = -1.0;

/// How far outside a hull's edge a point may lie and still count as on it.
const ON_EDGE: f64 = 1e-6;

/// A turn [`decide`] planned: the systems' new positions, then each nebula's new centre.
pub(crate) struct Rotation {
    degrees: f64,
    moves: Vec<SystemMove>,
    nebulae: Vec<(usize, f64, f64)>,
}

impl Rotation {
    /// "Rotated 6 systems and 1 nebula by 45°", the angle read as the map's drag shows it.
    pub fn describe(&self) -> String {
        let systems = plural(self.moves.len(), "system");
        let what = match self.nebulae.len() {
            0 => systems,
            n => format!("{systems} and {}", plural_of(n, "nebula", "nebulae")),
        };
        format!("Rotated {what} by {}°", angle(shown(self.degrees)))
    }

    /// The ops that write the turn, in order: one [`Op::MoveSystems`], then an
    /// [`Op::MoveNebula`] per nebula, which a save then gives the members its radius covers
    /// at the systems' new positions.
    pub fn ops(self) -> Vec<Op> {
        let mut ops = vec![Op::MoveSystems { moves: self.moves }];
        ops.extend((self.nebulae.into_iter()).map(|(index, x, y)| Op::MoveNebula { index, x, y }));
        ops
    }
}

/// What the graph says about turning `systems` by `degrees` about `pivot`: each is listed
/// once and exists, the turn is finite, and something moves once rounded as the file
/// writes it. With `nebulae`, each nebula whose centre lies in or on the convex hull of the
/// systems where they stand turns too.
pub(crate) fn decide(
    graph: &GalaxyGraph,
    systems: &[u32],
    pivot: (f64, f64),
    degrees: f64,
    nebulae: bool,
) -> Result<Rotation, OpError> {
    each_once(systems, |&id| id)?;
    if !pivot.0.is_finite() || !pivot.1.is_finite() || !degrees.is_finite() {
        return Err(OpError::NotFinite);
    }
    let at = systems
        .iter()
        .map(|&id| {
            let system = graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
            Ok((system.x, system.y))
        })
        .collect::<Result<Vec<_>, OpError>>()?;
    let turned = |p: (f64, f64)| {
        let (x, y) = turn(p, pivot, degrees);
        (rounded(x), rounded(y))
    };
    let moves: Vec<SystemMove> = (systems.iter().zip(&at))
        .map(|(&system, &p)| {
            let (x, y) = turned(p);
            SystemMove { system, x, y }
        })
        .collect();
    let hull = convex_hull(&at);
    let carried: Vec<(usize, f64, f64)> = match nebulae {
        false => Vec::new(),
        true => (graph.nebulae.iter().enumerate())
            .filter(|(_, n)| in_convex_hull((n.x, n.y), &hull))
            .map(|(index, n)| {
                let (x, y) = turned((n.x, n.y));
                (index, x, y)
            })
            .collect(),
    };
    let still = (moves.iter().zip(&at)).all(|(m, &p)| (m.x, m.y) == p)
        && (carried.iter()).all(|&(index, x, y)| {
            let n = &graph.nebulae[index];
            (x, y) == (n.x, n.y)
        });
    if still {
        return Err(OpError::unchanged(
            format!("a turn of {}°", angle(degrees)),
            format!(
                "about ({}, {}) leaves {} where they stand",
                coord(pivot.0),
                coord(pivot.1),
                plural(systems.len(), "system")
            ),
        ));
    }
    Ok(Rotation {
        degrees,
        moves,
        nebulae: carried,
    })
}

/// `p` turned about `pivot` by `degrees`, positive clockwise as the map shows it. The
/// arithmetic follows the app's preview step for step, so the two land on the same digits.
fn turn(p: (f64, f64), pivot: (f64, f64), degrees: f64) -> (f64, f64) {
    let t = (CLOCKWISE_AS_SHOWN * degrees / 180.0) * std::f64::consts::PI;
    let (sin, cos) = t.sin_cos();
    let (dx, dy) = (p.0 - pivot.0, p.1 - pivot.1);
    (pivot.0 + dx * cos - dy * sin, pivot.1 + dx * sin + dy * cos)
}

/// `degrees` as the map's drag reads it, above -180 and up to 180, so a half turn is 180.
fn shown(degrees: f64) -> f64 {
    180.0 - (180.0 - degrees).rem_euclid(360.0)
}

/// `45`, `12.5`, `-90`: to two decimals at most.
fn angle(degrees: f64) -> String {
    let text = format!("{degrees:.2}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text == "-0" { "0" } else { text }.to_owned()
}

fn cross(o: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0)
}

/// The convex hull of `points`, anticlockwise, without collinear points: one point or two
/// when that is all they span.
fn convex_hull(points: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
    sorted.dedup();
    if sorted.len() < 3 {
        return sorted;
    }
    let chain = |points: &mut dyn Iterator<Item = (f64, f64)>| {
        let mut chain: Vec<(f64, f64)> = Vec::new();
        for p in points {
            while chain.len() >= 2
                && cross(chain[chain.len() - 2], chain[chain.len() - 1], p) <= 0.0
            {
                chain.pop();
            }
            chain.push(p);
        }
        chain.pop();
        chain
    };
    let mut hull = chain(&mut sorted.iter().copied());
    hull.extend(chain(&mut sorted.iter().rev().copied()));
    hull
}

/// Whether `p` lies inside or on `hull`, as [`convex_hull`] returns it; a two-point hull is
/// a segment.
fn in_convex_hull(p: (f64, f64), hull: &[(f64, f64)]) -> bool {
    match *hull {
        [] => false,
        [a] => a == p,
        [a, b] => {
            let along = (p.0 - a.0) * (b.0 - a.0) + (p.1 - a.1) * (b.1 - a.1);
            let length2 = (b.0 - a.0).powi(2) + (b.1 - a.1).powi(2);
            cross(a, b, p).abs() <= ON_EDGE && along >= 0.0 && along <= length2
        }
        _ => (0..hull.len()).all(|i| cross(hull[i], hull[(i + 1) % hull.len()], p) >= -ON_EDGE),
    }
}
