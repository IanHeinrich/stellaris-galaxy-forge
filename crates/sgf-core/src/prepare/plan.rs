//! The choices checked against the map, and the geometry the draws read from it.

use std::collections::{BTreeMap, BTreeSet};

use super::seats::une_seat_target;
use super::{CLEAR_JUMPS, RANDOM_START_DISTANCE};
use super::{Drawn, PrepareChoice, PrepareError, PrepareRow, RowChoice, RowSystems};
use crate::format::scenario::ScenarioProfile;
use crate::format::scenario::fe_zone::{self, FeZone, Site};
use crate::format::scenario::header_counts::{MOST_FALLEN_EMPIRES, is_seat};
use crate::ops::rules::fe_zone as rules;
use crate::projections::galaxy::{GalaxyGraph, SystemNode};
use crate::rng::{GOLDEN, Rng, mix};
use crate::session::Session;

/// The draws one seed feeds beside Plain system's, each from its own stream, so that one
/// draw does not move when another changes.
#[derive(Debug, Clone, Copy)]
pub(super) enum Stream {
    Seats = 1,
    Zones,
    Starts,
}

impl Stream {
    pub(super) fn seed(self, seed: u64) -> u64 {
        mix(seed ^ (self as u64).wrapping_mul(GOLDEN))
    }

    /// `items` in an order this stream of `seed` draws, by Fisher and Yates' shuffle.
    pub(super) fn shuffle<T>(self, seed: u64, items: &mut [T]) {
        let mut rng = Rng::new(self.seed(seed));
        for i in (1..items.len()).rev() {
            let j = (rng.next_u64() % (i as u64 + 1)) as usize;
            items.swap(i, j);
        }
    }
}

/// The choices checked against the map, and what [`build`], [`kept_clear`] and [`drawn`] all
/// read from them.
pub(super) struct Plan<'a> {
    pub(super) graph: &'a GalaxyGraph,
    pub(super) profile: ScenarioProfile,
    pub(super) chosen: BTreeMap<PrepareRow, PrepareChoice>,
    pub(super) systems: BTreeMap<PrepareRow, &'a [u32]>,
    pub(super) seed: u64,
    /// The Sol that Pre-FTL Earth or UNE seat writes, when one of them is chosen.
    pub(super) sol: Option<&'a SystemNode>,
    /// The new seats and zones.
    pub(super) drawn: Drawn,
    /// The systems that hold a seat once the batch applies.
    pub(super) seats: BTreeSet<u32>,
    /// The systems within [`CLEAR_JUMPS`] lanes of one of `seats`, `seats` left out.
    pub(super) near_seats: BTreeSet<u32>,
}

impl<'a> Plan<'a> {
    pub(super) fn new(
        session: &'a Session,
        rows: &'a [RowSystems],
        choices: &[RowChoice],
        seed: u64,
    ) -> Result<Self, PrepareError> {
        let chosen = checked(choices)?;
        let profile = super::profile(session);
        let graph = session.graph();
        let systems = by_row(rows);
        let sols = nodes(graph, &systems, PrepareRow::Sol);
        let sol = match chosen.get(&PrepareRow::Sol) {
            Some(PrepareChoice::PreFtlEarth) => sols
                .iter()
                .find(|node| is_seat(node))
                .or(sols.first())
                .copied(),
            Some(PrepareChoice::UneSeat) => une_seat_target(profile, graph, &sols)?,
            _ => None,
        };
        let mut plan = Self {
            graph,
            profile,
            chosen,
            systems,
            seed,
            sol,
            drawn: Drawn::default(),
            seats: BTreeSet::new(),
            near_seats: BTreeSet::new(),
        };
        if plan.chosen(PrepareRow::FallenEmpires) == PrepareChoice::RandomZones
            && !profile.states_zones()
        {
            return Err(PrepareError::RandomZonesOnPlain);
        }
        if plan.chosen(PrepareRow::EmpireSeats) == PrepareChoice::RandomSeats {
            (plan.drawn.seats, plan.drawn.seat_floor) = plan.draw_seats()?;
        }
        plan.seats = plan.seats_after();
        if plan.chosen(PrepareRow::FallenEmpires) == PrepareChoice::RandomZones {
            plan.drawn.zones = plan.draw_zones();
        }
        let near = graph.within_jumps(&plan.seats, CLEAR_JUMPS);
        plan.near_seats = near.difference(&plan.seats).copied().collect();
        Ok(plan)
    }

    /// The choice for `row`: Keep when the choices leave it out.
    pub(super) fn chosen(&self, row: PrepareRow) -> PrepareChoice {
        self.chosen
            .get(&row)
            .copied()
            .unwrap_or(PrepareChoice::Keep)
    }

    /// The Sol UNE seat seats, which no Empire seats choice takes the seat from.
    pub(super) fn reseated(&self) -> Option<u32> {
        match self.chosen(PrepareRow::Sol) {
            PrepareChoice::UneSeat => self.sol.map(|node| node.id),
            _ => None,
        }
    }

    /// Whether `system` stands in none of the rows its initializer or a fallen empire places a
    /// system in.
    pub(super) fn in_no_row(&self, system: u32) -> bool {
        !KEPT_FROM_SEATS
            .into_iter()
            .chain([PrepareRow::OrdinarySystems])
            .any(|row| in_row(&self.systems, row).contains(&system))
    }

    /// New random zones: the zones Paint a Galaxy would place by itself once the old ones
    /// go, in an order the seed gives, each kept whose ring stands clear of every zone kept
    /// before it and whose centre stands [`RANDOM_START_DISTANCE`] from every seat, up to the
    /// fallen empires the mod can seat. The zones inside the rim are taken first, then at
    /// most [`MOST_RIM_ZONES`] on it. A zone is on the rim when its centre stands at least
    /// [`RIM_SHARE`] of the way out to the galaxy's edge in its direction, so an outlying
    /// cluster moves the rim only on its own side. Each is a fallback of random kind.
    pub(super) fn draw_zones(&self) -> Vec<(u32, FeZone)> {
        let going: BTreeSet<u32> = in_row(&self.systems, PrepareRow::FallenEmpires)
            .iter()
            .copied()
            .collect();
        let sites: Vec<Site<'_>> = rules::sites(self.graph)
            .into_iter()
            .map(|site| Site {
                zone: site.zone.filter(|_| !going.contains(&site.id)),
                ..site
            })
            .collect();
        let mut candidates = rules::candidates(&sites);
        Stream::Zones.shuffle(self.seed, &mut candidates);
        let seats: Vec<(f64, f64)> = self
            .seats
            .iter()
            .filter_map(|id| self.graph.systems.get(id))
            .map(|s| (s.x, s.y))
            .collect();
        let placed: Vec<(u32, FeZone, (f64, f64), bool)> = candidates
            .into_iter()
            .filter_map(|(id, zone)| {
                let anchor = self.graph.systems.get(&id)?;
                let centre = fe_zone::centre((anchor.x, anchor.y), &zone);
                let on_rim = fe_zone::distance(centre, (0.0, 0.0))
                    >= RIM_SHARE * edge_distance(self.graph, centre);
                Some((id, zone, centre, on_rim))
            })
            .collect();
        let mut centres: Vec<(f64, f64)> = Vec::new();
        let mut zones = Vec::new();
        for (rim_pass, most) in [
            (false, MOST_FALLEN_EMPIRES as usize),
            (true, MOST_RIM_ZONES),
        ] {
            let mut taken = 0;
            for (id, zone, centre, on_rim) in &placed {
                if zones.len() == MOST_FALLEN_EMPIRES as usize || taken == most {
                    break;
                }
                let clear = *on_rim == rim_pass
                    && !centres.iter().any(|&c| fe_zone::overlaps(c, *centre))
                    && seats
                        .iter()
                        .all(|&seat| fe_zone::distance(*centre, seat) >= RANDOM_START_DISTANCE);
                if clear {
                    taken += 1;
                    centres.push(*centre);
                    zones.push((
                        *id,
                        FeZone {
                            fallback: true,
                            ..zone.clone()
                        },
                    ));
                }
            }
        }
        zones
    }
}

/// How far out a new zone's centre stands on the rim, as a share of the distance to the
/// galaxy's edge in its direction.
const RIM_SHARE: f64 = 0.75;
/// How far either side of a direction from the galaxy's centre, in degrees, the systems lie
/// whose farthest marks the edge in that direction.
const EDGE_WEDGE_DEGREES: f64 = 15.0;
/// The most new zones New random zones puts on the rim.
const MOST_RIM_ZONES: usize = 2;

/// The rows whose systems New random seats leaves alone when they are kept.
pub(super) const KEPT_FROM_SEATS: [PrepareRow; 10] = [
    PrepareRow::HomeStarts,
    PrepareRow::Sol,
    PrepareRow::HomeNeighbours,
    PrepareRow::OriginAndEvent,
    PrepareRow::FallenEmpires,
    PrepareRow::MarauderClans,
    PrepareRow::Guardians,
    PrepareRow::Enclaves,
    PrepareRow::Primitives,
    PrepareRow::SpecialSystems,
];

/// The distance from the galaxy's centre of the farthest system within
/// [`EDGE_WEDGE_DEGREES`] of the direction of `at`.
fn edge_distance(graph: &GalaxyGraph, at: (f64, f64)) -> f64 {
    let bearing = at.1.atan2(at.0);
    let wedge = EDGE_WEDGE_DEGREES.to_radians();
    graph
        .systems
        .values()
        .filter(|s| {
            let turn = s.y.atan2(s.x) - bearing;
            turn.sin().atan2(turn.cos()).abs() <= wedge
        })
        .map(|s| s.x.hypot(s.y))
        .fold(0.0, f64::max)
}

pub(super) fn by_row(rows: &[RowSystems]) -> BTreeMap<PrepareRow, &[u32]> {
    rows.iter()
        .map(|row| (row.row, row.systems.as_slice()))
        .collect()
}

pub(super) fn in_row<'a>(systems: &BTreeMap<PrepareRow, &'a [u32]>, row: PrepareRow) -> &'a [u32] {
    systems.get(&row).copied().unwrap_or_default()
}

pub(super) fn nodes<'g>(
    graph: &'g GalaxyGraph,
    systems: &BTreeMap<PrepareRow, &[u32]>,
    row: PrepareRow,
) -> Vec<&'g SystemNode> {
    let ids = in_row(systems, row);
    ids.iter().filter_map(|id| graph.systems.get(id)).collect()
}

/// `choices` by row, each offered by its row and given once.
fn checked(choices: &[RowChoice]) -> Result<BTreeMap<PrepareRow, PrepareChoice>, PrepareError> {
    let mut chosen = BTreeMap::new();
    for &RowChoice { row, choice } in choices {
        if !row.choices().contains(&choice) {
            return Err(PrepareError::Unoffered { row, choice });
        }
        if chosen.insert(row, choice).is_some() {
            return Err(PrepareError::RowTwice(row));
        }
    }
    Ok(chosen)
}
