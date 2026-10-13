//! The seats: the ones that stay, New random seats, UNE seat, and the home system effect
//! that follows them.

use std::collections::{BTreeSet, HashMap};

use super::plan::{KEPT_FROM_SEATS, Plan, Stream, in_row, nodes};
use super::{PlainDraw, PrepareChoice, PrepareError, PrepareRow, RANDOM_START_DISTANCE};
use super::{initializer, plain_system};
use crate::format::scenario::fe_zone;
use crate::format::scenario::header_counts::{SeatCounts, is_seat};
use crate::format::scenario::{ScenarioProfile, is_seat_initializer};
use crate::ops::Op;
use crate::projections::galaxy::{GalaxyGraph, PaintSpawnKind, SpawnScript, SystemNode};
use crate::rng::unit;

/// How far the spacing between new seats comes down each time they do not fit.
const SEAT_SPACING_STEP: f64 = 5.0;
/// The least spacing new seats are drawn at before the draw is refused.
const LEAST_SEAT_SPACING: f64 = 20.0;

impl<'a> Plan<'a> {
    /// The seats Empire seats takes away, in file order.
    pub(super) fn old_seats(&self) -> Vec<&'a SystemNode> {
        let reseated = self.reseated();
        let mut old = nodes(self.graph, &self.systems, PrepareRow::EmpireSeats);
        old.retain(|node| Some(node.id) != reseated);
        old
    }

    /// The systems that hold a seat once the chosen rows apply: Empire seats None takes
    /// theirs away, New random seats moves them to the systems it draws, Pre-FTL Earth takes
    /// its Sol's away, and UNE seat gives its Sol one.
    pub(super) fn seats_after(&self) -> BTreeSet<u32> {
        let mut seats: BTreeSet<u32> = self
            .graph
            .systems
            .values()
            .filter(|s| is_seat(s))
            .map(|s| s.id)
            .collect();
        let unseat = |seats: &mut BTreeSet<u32>, node: &SystemNode| {
            if self.profile.unseated(node).is_some() {
                seats.remove(&node.id);
            }
        };
        match self.chosen(PrepareRow::EmpireSeats) {
            PrepareChoice::None => {
                for node in nodes(self.graph, &self.systems, PrepareRow::EmpireSeats) {
                    unseat(&mut seats, node);
                }
            }
            PrepareChoice::RandomSeats => {
                for node in self.old_seats() {
                    unseat(&mut seats, node);
                }
                seats.extend(&self.drawn.seats);
            }
            _ => {}
        }
        match (self.chosen.get(&PrepareRow::Sol), self.sol) {
            (Some(PrepareChoice::PreFtlEarth), Some(sol)) => unseat(&mut seats, sol),
            (Some(PrepareChoice::UneSeat), Some(sol)) => {
                seats.insert(sol.id);
            }
            _ => {}
        }
        seats
    }

    /// The systems New random seats may seat, in file order: those in the largest part of
    /// the map hyperlanes join, that hold no seat now, that no kept row holds, and that stand
    /// clear of every fallen empire zone that stays.
    pub(super) fn seat_candidates(&self) -> Vec<(u32, (f64, f64))> {
        let graph = self.graph;
        let kept: BTreeSet<u32> = KEPT_FROM_SEATS
            .into_iter()
            .filter(|&row| self.chosen(row) == PrepareChoice::Keep)
            .flat_map(|row| in_row(&self.systems, row).iter().copied())
            .collect();
        let zones_going: BTreeSet<u32> = match self.chosen(PrepareRow::FallenEmpires) {
            PrepareChoice::Keep => BTreeSet::new(),
            _ => in_row(&self.systems, PrepareRow::FallenEmpires)
                .iter()
                .copied()
                .collect(),
        };
        let staying: Vec<(u32, (f64, f64))> = graph
            .systems
            .values()
            .filter(|s| !zones_going.contains(&s.id))
            .filter_map(|s| {
                let zone = s.fe_zone.as_ref()?;
                Some((s.id, fe_zone::centre((s.x, s.y), zone)))
            })
            .collect();
        let joined = largest_by_lanes(graph);
        graph
            .order
            .iter()
            .filter_map(|id| graph.systems.get(id))
            .filter(|s| {
                joined.contains(&s.id)
                    && !is_seat(s)
                    && !kept.contains(&s.id)
                    && self.sol.is_none_or(|sol| sol.id != s.id)
                    && s.spawn_modifiers.is_empty()
                    && staying.iter().all(|&(anchor, centre)| {
                        anchor != s.id
                            && fe_zone::distance(centre, (s.x, s.y)) >= RANDOM_START_DISTANCE
                    })
            })
            .map(|s| (s.id, (s.x, s.y)))
            .collect()
    }

    /// New random seats: as many as Empire seats takes away, drawn over the candidates in an
    /// order the seed gives, each at least the spacing from every seat that stays and every
    /// seat drawn before it. The
    /// spacing starts at [`RANDOM_START_DISTANCE`] and comes down [`SEAT_SPACING_STEP`] at a
    /// time until they fit; it is returned when it came down.
    pub(super) fn draw_seats(&self) -> Result<(Vec<u32>, Option<f64>), PrepareError> {
        let wanted = self.old_seats().len();
        if wanted == 0 {
            return Err(PrepareError::NoSeatsToDraw);
        }
        let mut candidates = self.seat_candidates();
        Stream::Seats.shuffle(self.seed, &mut candidates);
        let staying: Vec<(f64, f64)> = self
            .seats_after()
            .iter()
            .filter_map(|id| self.graph.systems.get(id))
            .map(|s| (s.x, s.y))
            .collect();
        let mut floor = RANDOM_START_DISTANCE;
        loop {
            let seats = spaced(&candidates, &staying, wanted, floor);
            if seats.len() == wanted {
                return Ok((seats, (floor < RANDOM_START_DISTANCE).then_some(floor)));
            }
            if floor - SEAT_SPACING_STEP < LEAST_SEAT_SPACING {
                return Err(PrepareError::SeatsDoNotFit {
                    wanted,
                    fit: seats.len(),
                });
            }
            floor -= SEAT_SPACING_STEP;
        }
    }

    /// The members that seat the new seats: each a generic start the seed draws, then the
    /// script or weight of the old seat drawn in its place.
    pub(super) fn new_seats(&self) -> Vec<Op> {
        let mut ops = Vec::new();
        for (&id, old) in self.drawn.seats.iter().zip(self.old_seats()) {
            let Some(node) = self.graph.systems.get(&id) else {
                continue;
            };
            let start = drawn_start(self.profile, id, self.seed);
            ops.extend(initializer(node, Some(start)));
            ops.extend(self.profile.seated(id, old));
        }
        ops
    }

    /// What a home start or a Sol becomes when it is made ordinary: a generic start on a
    /// system that still holds a seat once the batch applies, else a plain system.
    pub(super) fn start(
        &self,
        node: &SystemNode,
        draw: &PlainDraw,
    ) -> Result<String, PrepareError> {
        match self.seats.contains(&node.id) {
            true => Ok(self.profile.generic_start(node.id).to_owned()),
            false => plain_system(self.profile, node.id, draw),
        }
    }
}

/// Up to `count` of `candidates`, taken in their order, each at least `floor` from every
/// position of `staying` and every candidate taken before it.
fn spaced(
    candidates: &[(u32, (f64, f64))],
    staying: &[(f64, f64)],
    count: usize,
    floor: f64,
) -> Vec<u32> {
    let mut taken: Vec<(u32, (f64, f64))> = Vec::with_capacity(count);
    for &(id, at) in candidates {
        if taken.len() == count {
            break;
        }
        let clear = staying
            .iter()
            .chain(taken.iter().map(|(_, other)| other))
            .all(|&other| fe_zone::distance(at, other) >= floor);
        if clear {
            taken.push((id, at));
        }
    }
    taken.into_iter().map(|(id, _)| id).collect()
}

/// The systems of the largest part of the map that hyperlanes join, lower ids first on a tie.
fn largest_by_lanes(graph: &GalaxyGraph) -> BTreeSet<u32> {
    graph
        .lane_components()
        .into_iter()
        .next()
        .filter(|part| part.len() > 1)
        .map(BTreeSet::from_iter)
        .unwrap_or_default()
}

/// The one Sol UNE seat seats. Several Sols are refused, and so is a Sol seat another
/// system already holds.
pub(super) fn une_seat_target<'g>(
    profile: ScenarioProfile,
    graph: &'g GalaxyGraph,
    sols: &[&'g SystemNode],
) -> Result<Option<&'g SystemNode>, PrepareError> {
    sol_seat(profile)?;
    let node = match sols {
        [] => return Ok(None),
        [node] => *node,
        _ => {
            return Err(PrepareError::SeveralSols(
                sols.iter().map(|n| n.id).collect(),
            ));
        }
    };
    let held = graph
        .order
        .iter()
        .filter_map(|id| graph.systems.get(id))
        .find(|s| s.id != node.id && holds_sol_seat(s));
    match held {
        Some(held) => Err(PrepareError::SolSeatTaken(held.id)),
        None => Ok(Some(node)),
    }
}

/// The op that makes `node` the Sol seat, keeping its Sol initializer; none when it holds
/// one already, whoever's marker it carries.
pub(super) fn une_seat(
    profile: ScenarioProfile,
    node: &SystemNode,
) -> Result<Option<Op>, PrepareError> {
    let seat = sol_seat(profile)?;
    Ok((!holds_sol_seat(node)).then_some(Op::SetSpawnScript {
        system: node.id,
        script: Some(seat),
    }))
}

fn holds_sol_seat(node: &SystemNode) -> bool {
    matches!(
        node.spawn_script,
        Some(SpawnScript::PaintAGalaxy {
            kind: PaintSpawnKind::Sol,
            ..
        })
    )
}

/// The seats the map holds once `ops` apply, the reserved ones and the player's among them.
pub(super) fn seat_counts_after(graph: &GalaxyGraph, ops: &[Op]) -> SeatCounts {
    let mut scripts = HashMap::new();
    let mut weights = HashMap::new();
    for op in ops {
        match op {
            Op::SetSpawnScript { system, script } => {
                scripts.insert(*system, script.clone());
            }
            Op::SetSpawnWeight { system, base } => {
                weights.insert(*system, *base);
            }
            _ => {}
        }
    }
    let mut seats: u32 = 0;
    let mut held = Vec::new();
    for system in graph.systems.values() {
        let script = scripts.get(&system.id).unwrap_or(&system.spawn_script);
        let weight = weights
            .get(&system.id)
            .copied()
            .unwrap_or(system.spawn_weight);
        if script.is_some() || weight.is_some_and(|w| w > 0.0) {
            seats += 1;
            held.extend(script.as_ref());
        }
    }
    SeatCounts::from_scripts(seats, held)
}

/// The initializer a new random seat `system` gets: one of the dialect's generic starts,
/// drawn from `seed`.
fn drawn_start(profile: ScenarioProfile, system: u32, seed: u64) -> String {
    profile
        .generic_start_at(unit(Stream::Starts.seed(seed), system))
        .to_owned()
}

/// The seat UNE seat writes, refused where the dialect has none.
fn sol_seat(profile: ScenarioProfile) -> Result<SpawnScript, PrepareError> {
    profile.sol_seat().ok_or(PrepareError::UneSeatOnPlain)
}

/// The members that leave the home system effect on exactly the systems that end the batch as
/// a seat on one of the game's ordinary systems, on a profile that writes the effect itself:
/// every system, whether the batch touches it or not.
pub(super) fn home_systems(plan: &Plan<'_>, ops: &[Op]) -> Vec<Op> {
    if !plan.profile.writes_home_system() {
        return Vec::new();
    }
    let written: HashMap<u32, &str> = ops
        .iter()
        .filter_map(|op| match op {
            Op::SetInitializer {
                system,
                initializer,
            } => Some((*system, initializer.as_deref().unwrap_or_default())),
            _ => None,
        })
        .collect();
    let graph = plan.graph;
    graph
        .order
        .iter()
        .filter_map(|id| graph.systems.get(id))
        .filter_map(|node| {
            let system = node.id;
            let initializer = written.get(&system).copied().unwrap_or(&node.initializer);
            let home = plan.seats.contains(&system) && is_seat_initializer(initializer);
            (home != node.home_system).then_some(Op::SetHomeSystem { system, home })
        })
        .collect()
}
