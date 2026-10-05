//! Preparing a scenario for a new game: the rows a scenario's systems sort into, the
//! choices each row offers, the presets, and the one batch that writes a set of choices.
//!
//! The rows and choices say what the new game gets, not how a dialect writes it. Which
//! systems stand in each row is the install's to say (`sgf_gamedata::prepare`); the
//! document's [`ScenarioProfile`] says how each choice is written.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::export::ScenarioProfile;
use crate::format::scenario::header_counts::fallen_count;
use crate::format::scenario::is_painted;
use crate::format::scenario::marauder::{self, MarauderRole};
use crate::keys::scenario as keys;
use crate::ops::Op;
use crate::projections::galaxy::{GalaxyGraph, SystemNode};
use crate::session::Session;
use crate::{as_u32, plural};

/// One row of the panel. Each system stands in exactly one of the initializer rows, Home
/// starts to Ordinary systems, unless it is a seat or a fallen empire's; Empire seats,
/// Fallen empires, Wormhole pairs and System names cut across them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum PrepareRow {
    /// Seat scripts and spawn weights.
    EmpireSeats,
    /// Seats whose initializer is not a generic empire start.
    HomeStarts,
    /// The systems a home start places beside it, guaranteed colonies among them.
    HomeNeighbours,
    /// Origin and nomad homes away from a seat, and systems only an event places.
    OriginAndEvent,
    /// Paint a Galaxy fallen empire zones, and the systems a fallen empire's initializer
    /// makes.
    FallenEmpires,
    MarauderClans,
    Guardians,
    Enclaves,
    Primitives,
    /// The other one-off starts, and initializers the install does not know.
    SpecialSystems,
    /// The ordinary starts the game rolls at random, and systems with no initializer.
    OrdinarySystems,
    WormholePairs,
    SystemNames,
}

/// What a row asks of the new game. [`Self::Keep`] is every row's first choice, and
/// every row's choice under [`PreparePreset::Faithful`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum PrepareChoice {
    /// As the scenario has it.
    Keep,
    /// A seat gets one of the game's random empire starts.
    GenericStart,
    /// An ordinary star in place of the initializer.
    Plain,
    /// No initializer: the game rolls the system.
    GameDecides,
    /// The seats, zones or pairs go.
    None,
    /// No name: the game names the system.
    GameNames,
}

/// A set of choices for every row. Custom is the app's name for any other set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum PreparePreset {
    /// Every row kept: the scenario as it opened.
    Faithful,
    /// The map and its features kept, and what old empires and events made turned into
    /// plain systems.
    FreshStart,
    /// Seats, home starts, home neighbours and fallen empire zones kept; every other row
    /// left to the game, and wormhole pairs taken out.
    BareShell,
}

/// One row's choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RowChoice {
    pub row: PrepareRow,
    pub choice: PrepareChoice,
}

/// The systems standing in one row, in file order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RowSystems {
    pub row: PrepareRow,
    pub systems: Vec<u32>,
}

/// The layouts Plain system draws from on a plain scenario, each with its weight, and the
/// seed that makes the draw the same every time. A Paint a Galaxy map uses the mod's random
/// list instead and needs none.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PlainDraw {
    pub layouts: Vec<WeightedLayout>,
    pub seed: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WeightedLayout {
    pub key: String,
    pub weight: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PrepareError {
    #[error("{} offers no {}", .row.as_str(), .choice.as_str())]
    Unoffered {
        row: PrepareRow,
        choice: PrepareChoice,
    },
    #[error("{} is chosen twice", .0.as_str())]
    RowTwice(PrepareRow),
    #[error("no plain layout to draw a plain system from")]
    NoPlainLayouts,
}

impl PrepareRow {
    pub const ALL: [Self; 13] = [
        Self::EmpireSeats,
        Self::HomeStarts,
        Self::HomeNeighbours,
        Self::OriginAndEvent,
        Self::FallenEmpires,
        Self::MarauderClans,
        Self::Guardians,
        Self::Enclaves,
        Self::Primitives,
        Self::SpecialSystems,
        Self::OrdinarySystems,
        Self::WormholePairs,
        Self::SystemNames,
    ];

    /// The choices the row offers, [`PrepareChoice::Keep`] first.
    pub const fn choices(self) -> &'static [PrepareChoice] {
        use PrepareChoice::{GameDecides, GameNames, GenericStart, Keep, None, Plain};
        match self {
            Self::EmpireSeats | Self::FallenEmpires | Self::WormholePairs => &[Keep, None],
            Self::HomeStarts => &[Keep, GenericStart],
            Self::HomeNeighbours
            | Self::OriginAndEvent
            | Self::MarauderClans
            | Self::Guardians
            | Self::Enclaves
            | Self::Primitives
            | Self::SpecialSystems => &[Keep, Plain, GameDecides],
            Self::OrdinarySystems => &[Keep, GameDecides],
            Self::SystemNames => &[Keep, GameNames],
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::EmpireSeats => "empire_seats",
            Self::HomeStarts => "home_starts",
            Self::HomeNeighbours => "home_neighbours",
            Self::OriginAndEvent => "origin_and_event",
            Self::FallenEmpires => "fallen_empires",
            Self::MarauderClans => "marauder_clans",
            Self::Guardians => "guardians",
            Self::Enclaves => "enclaves",
            Self::Primitives => "primitives",
            Self::SpecialSystems => "special_systems",
            Self::OrdinarySystems => "ordinary_systems",
            Self::WormholePairs => "wormhole_pairs",
            Self::SystemNames => "system_names",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|row| row.as_str() == text)
    }
}

impl PrepareChoice {
    pub const ALL: [Self; 6] = [
        Self::Keep,
        Self::GenericStart,
        Self::Plain,
        Self::GameDecides,
        Self::None,
        Self::GameNames,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Keep => "keep",
            Self::GenericStart => "generic_start",
            Self::Plain => "plain",
            Self::GameDecides => "game_decides",
            Self::None => "none",
            Self::GameNames => "game_names",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|choice| choice.as_str() == text)
    }
}

impl PreparePreset {
    pub const ALL: [Self; 3] = [Self::Faithful, Self::FreshStart, Self::BareShell];

    pub const fn choice(self, row: PrepareRow) -> PrepareChoice {
        use PrepareChoice::{GameDecides, GenericStart, Keep, None, Plain};
        match (self, row) {
            (Self::Faithful, _) => Keep,
            (Self::FreshStart, PrepareRow::HomeStarts) => GenericStart,
            (Self::FreshStart, PrepareRow::OriginAndEvent) => Plain,
            (Self::FreshStart, _) => Keep,
            (
                Self::BareShell,
                PrepareRow::EmpireSeats
                | PrepareRow::HomeStarts
                | PrepareRow::HomeNeighbours
                | PrepareRow::FallenEmpires
                | PrepareRow::SystemNames,
            ) => Keep,
            (Self::BareShell, PrepareRow::WormholePairs) => None,
            (Self::BareShell, _) => GameDecides,
        }
    }

    /// The preset's choice for every row, in [`PrepareRow::ALL`] order.
    pub fn choices(self) -> Vec<RowChoice> {
        PrepareRow::ALL
            .into_iter()
            .map(|row| RowChoice {
                row,
                choice: self.choice(row),
            })
            .collect()
    }
}

impl PlainDraw {
    /// The layout system `system` gets: a weighted draw that depends on the seed and the
    /// system alone, so one system's draw does not move when another's changes.
    fn pick(&self, system: u32) -> Result<&str, PrepareError> {
        let layouts: Vec<&WeightedLayout> =
            self.layouts.iter().filter(|l| l.weight > 0.0).collect();
        let total: f64 = layouts.iter().map(|l| l.weight).sum();
        let last = layouts.last().ok_or(PrepareError::NoPlainLayouts)?;
        let mut at = unit(self.seed, system) * total;
        for layout in &layouts {
            if at < layout.weight {
                return Ok(&layout.key);
            }
            at -= layout.weight;
        }
        Ok(&last.key)
    }
}

/// A number in `[0, 1)` from `seed` and `system`, by SplitMix64's mix.
fn unit(seed: u64, system: u32) -> f64 {
    let mut z = (seed ^ u64::from(system).wrapping_mul(0x9E37_79B9_7F4A_7C15))
        .wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    (z >> 11) as f64 / (1u64 << 53) as f64
}

/// The dialect an open scenario is written in: Paint a Galaxy's once the file carries its
/// names or Forge's header for it, as the app reads it on open.
pub fn profile(session: &Session) -> ScenarioProfile {
    match is_painted(session.doc().original()) {
        true => ScenarioProfile::PaintAGalaxy,
        false => ScenarioProfile::Plain,
    }
}

/// The one batch that writes `choices` over `rows`, one member per change; `None` when they
/// change nothing. A row left out of `choices` is kept. Members follow [`PrepareRow::ALL`],
/// each row's systems in the order `rows` lists them.
pub fn build(
    session: &Session,
    rows: &[RowSystems],
    choices: &[RowChoice],
    draw: &PlainDraw,
) -> Result<Option<Op>, PrepareError> {
    use PrepareChoice::{GameDecides, GameNames, GenericStart, Keep, Plain};
    let chosen = checked(choices)?;
    let profile = profile(session);
    let graph = session.graph();
    let systems: BTreeMap<PrepareRow, &[u32]> = rows
        .iter()
        .map(|row| (row.row, row.systems.as_slice()))
        .collect();
    let mut ops = Vec::new();
    for row in PrepareRow::ALL {
        let Some(&choice) = chosen.get(&row) else {
            continue;
        };
        let ids = systems.get(&row).copied().unwrap_or_default();
        let nodes: Vec<&SystemNode> = ids.iter().filter_map(|id| graph.systems.get(id)).collect();
        match (row, choice) {
            (_, Keep) => {}
            (PrepareRow::WormholePairs, _) => ops.extend(dialect::unpaired(profile, &nodes)),
            (PrepareRow::EmpireSeats, _) => {
                ops.extend(nodes.iter().filter_map(|n| dialect::unseated(profile, n)));
            }
            (PrepareRow::FallenEmpires, _) => {
                for node in nodes {
                    ops.extend(dialect::without_fallen_empire(profile, node, draw)?);
                }
            }
            (_, GameNames) => {
                ops.extend(nodes.iter().filter_map(|n| dialect::game_names(profile, n)));
            }
            (_, GameDecides) => {
                ops.extend(
                    nodes
                        .iter()
                        .filter_map(|n| dialect::game_decides(profile, n)),
                );
            }
            (_, GenericStart) => {
                for node in nodes {
                    let start = dialect::generic_start(profile, node.id);
                    ops.extend(initializer(node, Some(start)));
                }
            }
            (_, Plain) => {
                for node in nodes {
                    let plain = dialect::plain_system(profile, node.id, draw)?;
                    ops.extend(initializer(node, Some(plain)));
                }
            }
            (_, PrepareChoice::None) => {}
        }
    }
    if ops.is_empty() {
        return Ok(None);
    }
    let changed = changed_in(graph, &ops);
    ops.extend(header_counts(profile, graph, &ops));
    Ok(Some(Op::Batch {
        description: format!("Prepared {} for a new game", plural(changed, "system")),
        ops,
    }))
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
/// fallen empire zones. Keys the header lacks or does not state as a whole number are left
/// alone.
fn header_counts(profile: ScenarioProfile, graph: &GalaxyGraph, ops: &[Op]) -> Option<Op> {
    let was = Counted::after(graph, &[]);
    let now = Counted::after(graph, ops);
    let held = |key| graph.header_count(key);
    let clamp = |key: &'static str, to: u32| held(key).filter(|&n| n > to).map(|_| (key, to));
    let max = |key: &'static str, to: u32| {
        let capped = |n: u32| match dialect::exact_maxes(profile) {
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
    if now.clans != was.clans {
        entries.extend([
            clamp(keys::MARAUDER_EMPIRE_DEFAULT, now.clans),
            max(keys::MARAUDER_EMPIRE_MAX, now.clans),
        ]);
    }
    let entries: Vec<(String, String)> = entries
        .into_iter()
        .flatten()
        .map(|(key, n)| (key.to_owned(), n.to_string()))
        .collect();
    (!entries.is_empty()).then_some(Op::SetHeaderKeys { entries })
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

/// The op that gives `node` the initializer `to`, or none, when it holds another.
fn initializer(node: &SystemNode, to: Option<String>) -> Option<Op> {
    let held = Some(node.initializer.as_str()).filter(|i| !i.is_empty());
    (held != to.as_deref()).then_some(Op::SetInitializer {
        system: node.id,
        initializer: to,
    })
}

/// Every question whose answer depends on the dialect the scenario is written in, one
/// function each. A new profile adds one arm to each and touches nothing else.
mod dialect {
    use std::collections::BTreeMap;

    use super::{PlainDraw, PrepareError, initializer};
    use crate::export::ScenarioProfile;
    use crate::format::scenario::paint::{self, RL_BASIC};
    use crate::ops::Op;
    use crate::projections::galaxy::SystemNode;

    /// The initializer Plain system writes on `system`.
    pub(super) fn plain_system(
        profile: ScenarioProfile,
        system: u32,
        draw: &PlainDraw,
    ) -> Result<String, PrepareError> {
        match profile {
            ScenarioProfile::Plain => draw.pick(system).map(str::to_owned),
            ScenarioProfile::PaintAGalaxy => Ok(RL_BASIC.to_owned()),
        }
    }

    /// The initializer Generic start writes on seat `system`: one of the game's six random
    /// empire starts, which Paint a Galaxy also gives a seat.
    pub(super) fn generic_start(profile: ScenarioProfile, system: u32) -> String {
        match profile {
            ScenarioProfile::Plain | ScenarioProfile::PaintAGalaxy => {
                paint::basic_initializer(system).to_owned()
            }
        }
    }

    /// The op that leaves `node` for the game to roll.
    pub(super) fn game_decides(profile: ScenarioProfile, node: &SystemNode) -> Option<Op> {
        match profile {
            ScenarioProfile::Plain | ScenarioProfile::PaintAGalaxy => initializer(node, None),
        }
    }

    /// The op that leaves `node` for the game to name.
    pub(super) fn game_names(profile: ScenarioProfile, node: &SystemNode) -> Option<Op> {
        match profile {
            ScenarioProfile::Plain | ScenarioProfile::PaintAGalaxy => (!node.name.key.is_empty())
                .then(|| Op::RenameSystem {
                    system: node.id,
                    name: String::new(),
                }),
        }
    }

    /// The op that takes a seat away: a plain file states a weight, and Paint a Galaxy a
    /// script, taken whole, or a weight.
    pub(super) fn unseated(profile: ScenarioProfile, node: &SystemNode) -> Option<Op> {
        let system = node.id;
        let weight = node
            .spawn_weight
            .map(|_| Op::SetSpawnWeight { system, base: None });
        match profile {
            ScenarioProfile::Plain => weight,
            ScenarioProfile::PaintAGalaxy => match node.spawn_script {
                Some(_) => Some(Op::SetSpawnScript {
                    system,
                    script: None,
                }),
                None => weight,
            },
        }
    }

    /// The ops that take a fallen empire away. A plain file states one by its initializer,
    /// which Plain system replaces. Paint a Galaxy states a zone, which goes after the
    /// custom connections into it; a fallen empire's initializer there is replaced too.
    pub(super) fn without_fallen_empire(
        profile: ScenarioProfile,
        node: &SystemNode,
        draw: &PlainDraw,
    ) -> Result<Vec<Op>, PrepareError> {
        let plain = || -> Result<Vec<Op>, PrepareError> {
            let to = plain_system(profile, node.id, draw)?;
            Ok(initializer(node, Some(to)).into_iter().collect())
        };
        match profile {
            ScenarioProfile::Plain => plain(),
            ScenarioProfile::PaintAGalaxy if node.fe_zone.is_none() => plain(),
            ScenarioProfile::PaintAGalaxy => {
                let links = node.fe_link.custom || node.fe_link.id.is_some();
                let unlinked = links.then(|| Op::SetFeLinks {
                    anchor: node.id,
                    linked: Vec::new(),
                });
                let zone = Op::SetFeZone {
                    system: node.id,
                    zone: None,
                };
                Ok(unlinked.into_iter().chain([zone]).collect())
            }
        }
    }

    /// Whether the header's maxes equal what the map holds, as Paint a Galaxy sizes them
    /// and the Issues tab checks, rather than only staying within it.
    pub(super) fn exact_maxes(profile: ScenarioProfile) -> bool {
        match profile {
            ScenarioProfile::Plain => false,
            ScenarioProfile::PaintAGalaxy => true,
        }
    }

    /// One op per pair number the systems carry: both ends of a pair unpaired together, and
    /// a number on one system or on three taken off each. A plain file states no pairs.
    pub(super) fn unpaired(profile: ScenarioProfile, nodes: &[&SystemNode]) -> Vec<Op> {
        match profile {
            ScenarioProfile::Plain => Vec::new(),
            ScenarioProfile::PaintAGalaxy => {
                let mut ends: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
                for node in nodes {
                    if let Some(pair) = node.wormhole_pair {
                        ends.entry(pair).or_default().push(node.id);
                    }
                }
                ends.into_values()
                    .map(|ids| match ids[..] {
                        [a, b] => Op::SetWormholePair { a, b, pair: None },
                        _ => Op::SetWormholeEnds {
                            entries: ids.into_iter().map(|id| (id, None)).collect(),
                        },
                    })
                    .collect()
            }
        }
    }
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
