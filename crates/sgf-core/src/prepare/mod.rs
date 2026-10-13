//! Preparing a scenario for a new game: the rows a scenario's systems sort into, the
//! choices each row offers, the presets, and the one batch that writes a set of choices.
//!
//! The rows and choices say what the new game gets, not how a dialect writes it. Which
//! systems stand in each row is the install's to say (`sgf_gamedata::prepare`); the
//! document's [`ScenarioProfile`] says how each choice is written.

mod plan;
mod seats;
mod types;

use std::collections::{BTreeMap, BTreeSet, HashMap};

pub use crate::format::scenario::profile::of as profile;
pub use types::{
    CLEAR_JUMPS, Drawn, PlainDraw, PrepareChoice, PrepareError, PrepareOptions, PreparePreset,
    PrepareRow, Preview, RANDOM_START_DISTANCE, RowChoice, RowSystems, WeightedLayout,
};

use crate::format::scenario::ScenarioProfile;
use crate::format::scenario::header_counts::fallen_count;
use crate::format::scenario::marauder::{self, MarauderRole};
use crate::keys::scenario as keys;
use crate::ops::Op;
use crate::projections::galaxy::{BypassLink, Galaxy, GalaxyGraph, SystemNode};
use crate::session::Session;
use crate::{as_u32, plural};
use plan::{Plan, nodes};
use seats::{home_systems, seat_counts_after, une_seat};

/// The game's Sol with Earth and pre-FTL humans on it.
const PRE_FTL_SOL: &str = "pre_ftl_init_sol";

/// The one batch that writes `choices` over `rows`, one member per change; `None` when they
/// change nothing. A row left out of `choices` is kept. Members follow [`PrepareRow::ALL`],
/// each row's systems in the order `rows` lists them. Under `options`, the systems
/// [`kept_clear`] names get Plain system: in place of the member that would empty one, and
/// after the rows for one no row writes. What New random seats and New random zones write is
/// what [`drawn`] draws from the same seed.
pub fn build(
    session: &Session,
    rows: &[RowSystems],
    choices: &[RowChoice],
    draw: &PlainDraw,
    options: &PrepareOptions,
) -> Result<Option<Op>, PrepareError> {
    let plan = Plan::new(session, rows, choices, options.seed)?;
    batch(&plan, draw, options).map(|(op, _)| op)
}

/// What `choices` over `rows` would do under `options`, from one check of them against the
/// map: [`build`]'s batch, how many systems it changes, the systems [`kept_clear`] names when
/// the option is on, the systems the batch cuts off, and what [`drawn`] draws. Refused where
/// [`build`] refuses.
pub fn preview(
    session: &Session,
    rows: Vec<RowSystems>,
    choices: &[RowChoice],
    draw: &PlainDraw,
    options: &PrepareOptions,
) -> Result<Preview, PrepareError> {
    let plan = Plan::new(session, &rows, choices, options.seed)?;
    let (op, kept_clear) = batch(&plan, draw, options)?;
    let (profile, drawn) = (plan.profile, plan.drawn);
    let changes = op.as_ref().map_or(0, |op| changed(session, op));
    let cut_off = op.as_ref().map_or_else(Vec::new, |op| cut_off(session, op));
    Ok(Preview {
        profile,
        rows,
        op,
        changes,
        kept_clear,
        cut_off,
        drawn,
    })
}

/// The batch `plan` writes, with the systems keeping the space around seats clear gave a plain
/// system when `options` keep it.
fn batch(
    plan: &Plan<'_>,
    draw: &PlainDraw,
    options: &PrepareOptions,
) -> Result<(Option<Op>, Vec<u32>), PrepareError> {
    let mut ops = row_ops(plan, draw)?;
    let kept = match options.clear_around_seats {
        true => keep_clear(plan, &mut ops, draw)?,
        false => Vec::new(),
    };
    if ops.is_empty() {
        return Ok((None, kept));
    }
    ops.extend(home_systems(plan, &ops));
    let changed = changed_in(plan.graph, &ops);
    ops.extend(header_counts(plan, &ops));
    let batch = Op::Batch {
        description: format!("Prepared {} for a new game", plural(changed, "system")),
        ops,
    };
    Ok((Some(batch), kept))
}

/// The systems [`build`] gives Plain system when it keeps the space around seats clear:
/// every system the game would roll once the batch applies, because its row leaves it with
/// no initializer or takes its initializer away, that lies within [`CLEAR_JUMPS`] lanes of a
/// system holding a seat then, and that is not a plain system already. Wormholes are not
/// jumps. The seats are the ones [`drawn`] draws under `options`. Refused where [`build`]
/// refuses. Sorted.
pub fn kept_clear(
    session: &Session,
    rows: &[RowSystems],
    choices: &[RowChoice],
    draw: &PlainDraw,
    options: &PrepareOptions,
) -> Result<Vec<u32>, PrepareError> {
    let plan = Plan::new(session, rows, choices, options.seed)?;
    let mut ops = row_ops(&plan, draw)?;
    keep_clear(&plan, &mut ops, draw)
}

/// The seats and zones `choices` draw under `options`, as [`build`] writes them. Refused where
/// [`build`] refuses.
pub fn drawn(
    session: &Session,
    rows: &[RowSystems],
    choices: &[RowChoice],
    options: &PrepareOptions,
) -> Result<Drawn, PrepareError> {
    Plan::new(session, rows, choices, options.seed).map(|plan| plan.drawn)
}

/// The members the rows' choices write, in [`PrepareRow::ALL`] order. A new seat's
/// initializer is the one its seat writes, whatever row it stands in.
fn row_ops(plan: &Plan<'_>, draw: &PlainDraw) -> Result<Vec<Op>, PrepareError> {
    use PrepareChoice::{GameDecides, GameNames, GenericStart, Keep, Plain, PreFtlEarth, UneSeat};
    let Plan {
        graph,
        profile,
        sol,
        ..
    } = *plan;
    let reseated = plan.reseated();
    let new_seats: BTreeSet<u32> = plan.drawn.seats.iter().copied().collect();
    let mut seated = 0;
    let mut unseated = BTreeSet::new();
    let mut ops = Vec::new();
    for row in PrepareRow::ALL {
        let Some(&choice) = plan.chosen.get(&row) else {
            continue;
        };
        let mut nodes = nodes(graph, &plan.systems, row);
        if row == PrepareRow::OrdinarySystems {
            nodes.extend(
                unseated
                    .iter()
                    .filter(|&&id| plan.in_no_row(id))
                    .filter_map(|id| graph.systems.get(id)),
            );
        }
        match (row, choice) {
            (_, Keep) => {}
            (PrepareRow::WormholePairs, _) => ops.extend(profile.unpaired(&nodes)),
            (PrepareRow::EmpireSeats, _) => {
                for node in nodes.iter().filter(|n| reseated != Some(n.id)) {
                    if let Some(op) = profile.unseated(node) {
                        unseated.insert(node.id);
                        ops.push(op);
                    }
                }
                ops.extend(plan.new_seats());
                seated = ops.len();
            }
            (PrepareRow::FallenEmpires, _) => {
                for node in nodes {
                    ops.extend(without_fallen_empire(profile, node, draw)?);
                }
                ops.extend(plan.drawn.zones.iter().map(|(system, zone)| Op::SetFeZone {
                    system: *system,
                    zone: Some(zone.clone()),
                }));
            }
            (_, GameNames) => {
                ops.extend(nodes.into_iter().filter_map(game_names));
            }
            (PrepareRow::Sol, GameDecides) => {
                for node in nodes {
                    match plan.seats.contains(&node.id) {
                        true => {
                            let start = profile.generic_start(node.id).to_owned();
                            ops.extend(initializer(node, Some(start)));
                            ops.extend(profile.without_sol_seat(node));
                        }
                        false => ops.extend(game_decides(node)),
                    }
                }
            }
            (_, GameDecides) => {
                ops.extend(nodes.into_iter().filter_map(game_decides));
            }
            (_, GenericStart | Plain | PreFtlEarth | UneSeat) => {
                for node in nodes {
                    let target = sol.is_some_and(|sol| sol.id == node.id);
                    match choice {
                        PreFtlEarth if target => {
                            ops.extend(initializer(node, Some(PRE_FTL_SOL.to_owned())));
                            if !unseated.contains(&node.id) {
                                ops.extend(profile.unseated(node));
                            }
                        }
                        UneSeat if target => ops.extend(une_seat(profile, node)?),
                        UneSeat => {}
                        Plain if row != PrepareRow::Sol => {
                            let plain = plain_system(profile, node.id, draw)?;
                            ops.extend(initializer(node, Some(plain)));
                        }
                        _ => ops.extend(initializer(node, Some(plan.start(node, draw)?))),
                    }
                }
            }
            (_, PrepareChoice::None | PrepareChoice::RandomSeats | PrepareChoice::RandomZones) => {}
        }
    }
    let mut at = 0;
    ops.retain(|op| {
        at += 1;
        at <= seated
            || !matches!(op, Op::SetInitializer { system, .. } if new_seats.contains(system))
    });
    Ok(ops)
}

/// Give every system near a seat that the game would roll once `ops` apply a plain system:
/// the member that takes its initializer away becomes one that writes a plain system, and
/// one that held a plain system keeps it. A system no member writes gets its plain system
/// after them. Returns the systems this changes, sorted.
fn keep_clear(
    plan: &Plan<'_>,
    ops: &mut Vec<Op>,
    draw: &PlainDraw,
) -> Result<Vec<u32>, PrepareError> {
    let written: HashMap<u32, usize> = ops
        .iter()
        .enumerate()
        .filter_map(|(i, op)| match op {
            Op::SetInitializer { system, .. } => Some((*system, i)),
            _ => None,
        })
        .collect();
    let mut kept = Vec::new();
    let mut dropped = Vec::new();
    let mut added = Vec::new();
    for &id in &plan.near_seats {
        let Some(node) = plan.graph.systems.get(&id) else {
            continue;
        };
        let at = written.get(&id).copied();
        let rolled = match at {
            Some(i) => matches!(
                ops[i],
                Op::SetInitializer {
                    initializer: None,
                    ..
                }
            ),
            None => node.initializer.is_empty(),
        };
        if !rolled {
            continue;
        }
        if is_plain(plan.profile, &node.initializer, draw) {
            dropped.extend(at);
            continue;
        }
        let plain = plain_system(plan.profile, id, draw)?;
        let op = Op::SetInitializer {
            system: id,
            initializer: Some(plain),
        };
        match at {
            Some(i) => ops[i] = op,
            None => added.push(op),
        }
        kept.push(id);
    }
    dropped.sort_unstable();
    for i in dropped.into_iter().rev() {
        ops.remove(i);
    }
    ops.extend(added);
    Ok(kept)
}

/// The systems connected to the rest of the map before `batch` and not after it, read as
/// the validator's component count reads connections: lanes and wormholes. Only a
/// wormhole pair the batch takes out cuts anything off. Sorted.
pub fn cut_off(session: &Session, batch: &Op) -> Vec<u32> {
    let members = match batch {
        Op::Batch { ops, .. } => ops.as_slice(),
        op => std::slice::from_ref(op),
    };
    let unpaired: BTreeSet<u32> = members
        .iter()
        .flat_map(|op| match op {
            Op::SetWormholePair { a, b, pair: None } => vec![*a, *b],
            Op::SetWormholeEnds { entries } => entries
                .iter()
                .filter(|(_, pair)| pair.is_none())
                .map(|&(id, _)| id)
                .collect(),
            _ => Vec::new(),
        })
        .collect();
    if unpaired.is_empty() {
        return Vec::new();
    }
    let mut graph = GalaxyGraph::from_galaxy(Galaxy::clone(session.graph()));
    graph.bypasses.retain(|link| match *link {
        BypassLink::Wormhole { a, b } => !unpaired.contains(&a) && !unpaired.contains(&b),
        _ => true,
    });
    let after = graph.components();
    graph.separated_systems(&after)
}

/// The fallen empire zones and the marauder clans the map holds once `ops` apply.
struct Counted {
    zones: u32,
    clans: u32,
}

impl Counted {
    fn after(graph: &GalaxyGraph, ops: &[Op]) -> Self {
        let mut zoned = BTreeMap::new();
        let mut roles = BTreeMap::new();
        for op in ops {
            match op {
                Op::SetFeZone { system, zone } => {
                    zoned.insert(*system, zone.is_some());
                }
                Op::SetInitializer {
                    system,
                    initializer,
                } => {
                    roles.insert(*system, initializer.as_deref().and_then(marauder::role));
                }
                _ => {}
            }
        }
        let systems = graph.systems.values();
        let zones = systems
            .clone()
            .filter(|s| zoned.get(&s.id).copied().unwrap_or(s.fe_zone.is_some()))
            .count();
        let clans: BTreeSet<u8> = systems
            .filter_map(|s| match roles.get(&s.id).copied().unwrap_or(s.marauder) {
                Some(MarauderRole::Home(clan)) => Some(clan),
                _ => None,
            })
            .collect();
        Self {
            zones: as_u32(zones),
            clans: as_u32(clans.len()),
        }
    }
}

/// The header keys that bring the fallen empire and marauder counts down to what the map
/// holds once `ops` apply, for each of the two the ops change. A default above what is
/// left comes down to it and one below stays; a max follows the map exactly where the
/// dialect sizes it by the map, and comes down to it elsewhere. Only Paint a Galaxy states
/// fallen empire zones. When the game rolls the marauder clans, their max opens to the
/// clans the game knows and their default stays, down to that many, so the in-game setting
/// decides how many spawn. Under New random seats the empire default comes down to the seats
/// any empire may take among the seats drawn, as the kinds move with them. Keys the header
/// lacks or does not state as a whole number are left alone.
fn header_counts(plan: &Plan<'_>, ops: &[Op]) -> Option<Op> {
    let Plan { profile, graph, .. } = *plan;
    let was = Counted::after(graph, &[]);
    let now = Counted::after(graph, ops);
    let held = |key| graph.header_count(key);
    let clamp = |key: &'static str, to: u32| held(key).filter(|&n| n > to).map(|_| (key, to));
    let max = |key: &'static str, to: u32| {
        let capped = |n: u32| match profile.exact_maxes() {
            true => to,
            false => n.min(to),
        };
        held(key)
            .filter(|&n| capped(n) != n)
            .map(|n| (key, capped(n)))
    };
    let mut entries = Vec::new();
    if now.zones != was.zones {
        let fallen = fallen_count(now.zones);
        entries.extend([
            max(keys::FALLEN_EMPIRE_MAX, fallen),
            clamp(keys::FALLEN_EMPIRE_DEFAULT, fallen),
        ]);
    }
    if plan.chosen(PrepareRow::MarauderClans) == PrepareChoice::GameDecides {
        let known = u32::from(marauder::CLANS);
        entries.extend([
            clamp(keys::MARAUDER_EMPIRE_DEFAULT, known),
            held(keys::MARAUDER_EMPIRE_MAX)
                .filter(|&n| n != known)
                .map(|_| (keys::MARAUDER_EMPIRE_MAX, known)),
        ]);
    } else if now.clans != was.clans {
        entries.extend([
            clamp(keys::MARAUDER_EMPIRE_DEFAULT, now.clans),
            max(keys::MARAUDER_EMPIRE_MAX, now.clans),
        ]);
    }
    if plan.chosen(PrepareRow::EmpireSeats) == PrepareChoice::RandomSeats {
        let seats = seat_counts_after(graph, ops);
        entries.push(clamp(keys::NUM_EMPIRE_DEFAULT, seats.safe()));
    }
    let entries: Vec<(String, String)> = entries
        .into_iter()
        .flatten()
        .map(|(key, n)| (key.to_owned(), n.to_string()))
        .collect();
    (!entries.is_empty()).then_some(Op::SetHeaderKeys { entries })
}

/// The op that gives `node` the initializer `to`, or none, when it holds another.
fn initializer(node: &SystemNode, to: Option<String>) -> Option<Op> {
    let held = Some(node.initializer.as_str()).filter(|i| !i.is_empty());
    (held != to.as_deref()).then_some(Op::SetInitializer {
        system: node.id,
        initializer: to,
    })
}

/// The initializer Plain system writes on `system`: the dialect's own plain layout, or one
/// drawn from the install's.
fn plain_system(
    profile: ScenarioProfile,
    system: u32,
    draw: &PlainDraw,
) -> Result<String, PrepareError> {
    match profile.plain_layout() {
        Some(layout) => Ok(layout.to_owned()),
        None => draw.pick(system).map(str::to_owned),
    }
}

/// Whether `initializer` is a plain layout already: one the draw holds, or the dialect's
/// own. Keeping such a system clear of the roll needs no redraw.
fn is_plain(profile: ScenarioProfile, initializer: &str, draw: &PlainDraw) -> bool {
    draw.layouts.iter().any(|l| l.key == initializer) || profile.plain_layout() == Some(initializer)
}

/// The ops that take a fallen empire away: its zone where the dialect states one, else its
/// initializer, which Plain system replaces.
fn without_fallen_empire(
    profile: ScenarioProfile,
    node: &SystemNode,
    draw: &PlainDraw,
) -> Result<Vec<Op>, PrepareError> {
    if let Some(ops) = profile.without_zone(node) {
        return Ok(ops);
    }
    let to = plain_system(profile, node.id, draw)?;
    Ok(initializer(node, Some(to)).into_iter().collect())
}

/// The op that leaves `node` for the game to roll.
fn game_decides(node: &SystemNode) -> Option<Op> {
    initializer(node, None)
}

/// The op that leaves `node` for the game to name.
fn game_names(node: &SystemNode) -> Option<Op> {
    (!node.name.key.is_empty()).then(|| Op::RenameSystem {
        system: node.id,
        name: String::new(),
    })
}

/// How many systems a batch [`build`] made changes, as its description counts them.
pub fn changed(session: &Session, batch: &Op) -> usize {
    match batch {
        Op::Batch { ops, .. } => changed_in(session.graph(), ops),
        _ => 0,
    }
}

fn changed_in(graph: &GalaxyGraph, ops: &[Op]) -> usize {
    let systems: BTreeSet<u32> = ops.iter().flat_map(|op| systems_of(graph, op)).collect();
    systems.len()
}

/// The systems one of [`build`]'s ops writes, read from `graph` as it stands before them.
fn systems_of(graph: &GalaxyGraph, op: &Op) -> Vec<u32> {
    match *op {
        Op::SetInitializer { system, .. }
        | Op::SetSpawnScript { system, .. }
        | Op::SetSpawnWeight { system, .. }
        | Op::SetFeZone { system, .. }
        | Op::SetHomeSystem { system, .. }
        | Op::RenameSystem { system, .. } => vec![system],
        Op::SetFeLinks { anchor, .. } => {
            let id = graph.systems.get(&anchor).and_then(|a| a.fe_link.id);
            let linking = graph
                .systems
                .values()
                .filter(|other| id.is_some_and(|id| other.fe_link.to.contains(&id)))
                .map(|other| other.id);
            std::iter::once(anchor).chain(linking).collect()
        }
        Op::SetWormholePair { a, b, .. } => vec![a, b],
        Op::SetWormholeEnds { ref entries } => entries.iter().map(|&(id, _)| id).collect(),
        _ => Vec::new(),
    }
}
