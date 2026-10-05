//! Preparing a scenario for a new game: the rows a scenario's systems sort into, the
//! choices each row offers, the presets, and the one batch that writes a set of choices.
//!
//! The rows and choices say what the new game gets, not how a dialect writes it. Which
//! systems stand in each row is the install's to say (`sgf_gamedata::prepare`); the
//! document's [`ScenarioProfile`] says how each choice is written.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::export::ScenarioProfile;
use crate::format::scenario::fe_zone::{self, FeZone, Site};
use crate::format::scenario::header_counts::{
    MOST_FALLEN_EMPIRES, SeatCounts, fallen_count, is_seat,
};
use crate::format::scenario::is_painted;
use crate::format::scenario::marauder::{self, MarauderRole};
use crate::keys::scenario as keys;
use crate::ops::Op;
use crate::ops::rules::fe_zone as rules;
use crate::projections::galaxy::{
    BypassLink, Galaxy, GalaxyGraph, PaintSpawnKind, SpawnScript, SystemNode,
};
use crate::session::Session;
use crate::{as_u32, plural};

/// One row of the panel. Each system stands in exactly one of the initializer rows, Home
/// starts to Ordinary systems, unless it is a seat or a fallen empire's; Empire seats,
/// Fallen empires, Wormhole pairs and System names cut across them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum PrepareRow {
    /// Seat scripts and spawn weights. A system the choice unseats that stands in no
    /// initializer row, because its initializer is a generic empire start, follows the
    /// Ordinary systems row's choice.
    EmpireSeats,
    /// Seats whose initializer is not a generic empire start.
    HomeStarts,
    /// Every system on one of the game's Sol initializers, seat or not.
    Sol,
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
    /// A seat gets one of the game's random empire starts, and a system the batch unseats
    /// a plain system.
    GenericStart,
    /// An ordinary star in place of the initializer; a generic start on a Sol that keeps
    /// its seat.
    Plain,
    /// No initializer: the game rolls the system. A Sol that keeps its seat gets a generic
    /// start instead, and Paint a Galaxy's Sol seat on it becomes an enabled seat.
    GameDecides,
    /// The seats, zones or pairs go.
    None,
    /// No name: the game names the system.
    GameNames,
    /// One Sol, the seat if one is, with Earth and pre-FTL humans on it and no seat; any
    /// other Sol as Plain.
    PreFtlEarth,
    /// Paint a Galaxy's Sol seat, which only the United Nations of Earth takes, on the one
    /// Sol, its initializer kept.
    UneSeat,
    /// New seats drawn at random over the map, as many as it has now, spaced as a random
    /// galaxy spaces empires; the old seats go.
    RandomSeats,
    /// New Paint a Galaxy fallen empire zones fitted at random where the map has room, up to
    /// six, random kind with fallback; the old zones go.
    RandomZones,
}

/// What [`build`] does beside the rows' choices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PrepareOptions {
    /// Every system the game would roll within [`CLEAR_JUMPS`] lanes of a seat gets Plain
    /// system instead, whichever row it stands in: one its row takes the initializer
    /// from, and one with no initializer that its row keeps as it is.
    pub clear_around_seats: bool,
    /// What every draw takes: the ordinary layouts Plain system picks on a plain map, and the
    /// new seats and zones. The same seed over the same document gives the same edit.
    #[ts(type = "number")]
    pub seed: u64,
}

impl Default for PrepareOptions {
    fn default() -> Self {
        Self {
            clear_around_seats: true,
            seed: 0,
        }
    }
}

/// How many lane jumps from a seat the systems the game would roll get Plain system
/// instead. A scenario's effects run after the roll, so no flag keeps a capital clear.
pub const CLEAR_JUMPS: usize = 2;

/// The game's define of that name in `common/defines/00_defines.txt`: the minimum distance
/// between empires in a random start. New random seats stand this far apart where the map
/// has room.
pub const RANDOM_START_DISTANCE: f64 = 75.0;
/// How far the spacing between new seats comes down each time they do not fit.
const SEAT_SPACING_STEP: f64 = 5.0;
/// The least spacing new seats are drawn at before the draw is refused.
const LEAST_SEAT_SPACING: f64 = 20.0;

/// The game's Sol with Earth and pre-FTL humans on it.
const PRE_FTL_SOL: &str = "pre_ftl_init_sol";

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
    /// Only the shape stays: positions, hyperlanes and nebulae. Seats are drawn again, and the
    /// game rolls everything else.
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
    #[error("only a Paint a Galaxy map has a UNE seat")]
    UneSeatOnPlain,
    #[error("system #{0} already holds the Sol seat")]
    SolSeatTaken(u32),
    #[error("a UNE seat goes on one Sol, and the map has {}", ids(.0))]
    SeveralSols(Vec<u32>),
    #[error("the map has no seats to draw again")]
    NoSeatsToDraw,
    #[error("only {fit} of {wanted} new seats fit on the map, even {LEAST_SEAT_SPACING} apart")]
    SeatsDoNotFit { wanted: usize, fit: usize },
    #[error("only a Paint a Galaxy map has fallen empire zones")]
    RandomZonesOnPlain,
}

fn ids(systems: &[u32]) -> String {
    let ids: Vec<String> = systems.iter().map(|id| format!("#{id}")).collect();
    ids.join(", ")
}

impl PrepareRow {
    pub const ALL: [Self; 14] = [
        Self::EmpireSeats,
        Self::HomeStarts,
        Self::Sol,
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

    /// The choices the row offers, [`PrepareChoice::Keep`] first. Sol offers UNE seat
    /// whatever the dialect, and [`build`] refuses it on a plain scenario.
    pub const fn choices(self) -> &'static [PrepareChoice] {
        use PrepareChoice::{
            GameDecides, GameNames, GenericStart, Keep, None, Plain, PreFtlEarth, RandomSeats,
            RandomZones, UneSeat,
        };
        match self {
            Self::EmpireSeats => &[Keep, RandomSeats, None],
            Self::FallenEmpires => &[Keep, RandomZones, None],
            Self::WormholePairs => &[Keep, None],
            Self::HomeStarts => &[Keep, GenericStart],
            Self::Sol => &[Keep, Plain, PreFtlEarth, UneSeat, GameDecides],
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
            Self::Sol => "sol",
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
    pub const ALL: [Self; 10] = [
        Self::Keep,
        Self::GenericStart,
        Self::Plain,
        Self::GameDecides,
        Self::None,
        Self::GameNames,
        Self::PreFtlEarth,
        Self::UneSeat,
        Self::RandomSeats,
        Self::RandomZones,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Keep => "keep",
            Self::GenericStart => "generic_start",
            Self::Plain => "plain",
            Self::GameDecides => "game_decides",
            Self::None => "none",
            Self::GameNames => "game_names",
            Self::PreFtlEarth => "pre_ftl_earth",
            Self::UneSeat => "une_seat",
            Self::RandomSeats => "random_seats",
            Self::RandomZones => "random_zones",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|choice| choice.as_str() == text)
    }
}

impl PreparePreset {
    pub const ALL: [Self; 3] = [Self::Faithful, Self::FreshStart, Self::BareShell];

    /// The preset's choice for `row` on a map of `profile`.
    pub const fn choice(self, row: PrepareRow, profile: ScenarioProfile) -> PrepareChoice {
        use PrepareChoice::{
            GameDecides, GameNames, GenericStart, Keep, None, Plain, RandomSeats, RandomZones,
        };
        match (self, row) {
            (Self::Faithful, _) => Keep,
            (Self::FreshStart, PrepareRow::HomeStarts) => GenericStart,
            (Self::FreshStart, PrepareRow::Sol | PrepareRow::OriginAndEvent) => Plain,
            (Self::FreshStart, _) => Keep,
            (Self::BareShell, PrepareRow::EmpireSeats) => RandomSeats,
            (Self::BareShell, PrepareRow::HomeStarts) => GenericStart,
            (Self::BareShell, PrepareRow::FallenEmpires) => match profile {
                ScenarioProfile::Plain => Keep,
                ScenarioProfile::PaintAGalaxy => RandomZones,
            },
            (Self::BareShell, PrepareRow::WormholePairs) => None,
            (Self::BareShell, PrepareRow::SystemNames) => GameNames,
            (Self::BareShell, _) => GameDecides,
        }
    }

    /// The preset's choice for every row on a map of `profile`, in [`PrepareRow::ALL`] order.
    pub fn choices(self, profile: ScenarioProfile) -> Vec<RowChoice> {
        PrepareRow::ALL
            .into_iter()
            .map(|row| RowChoice {
                row,
                choice: self.choice(row, profile),
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

/// SplitMix64's increment.
const GOLDEN: u64 = 0x9E37_79B9_7F4A_7C15;

/// SplitMix64's mix.
fn mix(z: u64) -> u64 {
    let z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    let z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// A number in `[0, 1)` from `seed` and `system`, by SplitMix64's mix.
fn unit(seed: u64, system: u32) -> f64 {
    let z = mix((seed ^ u64::from(system).wrapping_mul(GOLDEN)).wrapping_add(GOLDEN));
    (z >> 11) as f64 / (1u64 << 53) as f64
}

/// The draws one seed feeds beside Plain system's, each from its own stream, so that one
/// draw does not move when another changes.
#[derive(Debug, Clone, Copy)]
enum Stream {
    Seats = 1,
    Zones,
    Starts,
}

impl Stream {
    fn seed(self, seed: u64) -> u64 {
        mix(seed ^ (self as u64).wrapping_mul(GOLDEN))
    }
}

/// SplitMix64 over one [`Stream`] of a seed.
struct SplitMix(u64);

impl SplitMix {
    fn new(seed: u64, stream: Stream) -> Self {
        Self(stream.seed(seed))
    }

    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(GOLDEN);
        mix(self.0)
    }

    /// `items` in an order the stream draws, by Fisher and Yates' shuffle.
    fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = (self.next() % (i as u64 + 1)) as usize;
            items.swap(i, j);
        }
    }
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
    let mut ops = row_ops(&plan, draw)?;
    if options.clear_around_seats {
        keep_clear(&plan, &mut ops, draw)?;
    }
    if ops.is_empty() {
        return Ok(None);
    }
    let changed = changed_in(plan.graph, &ops);
    ops.extend(header_counts(&plan, &ops));
    Ok(Some(Op::Batch {
        description: format!("Prepared {} for a new game", plural(changed, "system")),
        ops,
    }))
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

/// What New random seats and New random zones draw from the seed of `options`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Drawn {
    /// The systems the new seats go on, in the order they were drawn: the n-th takes the
    /// n-th old seat's script or weight. Empty unless New random seats is chosen.
    pub seats: Vec<u32>,
    /// The spacing the seats were drawn at, when the map had no room for them at
    /// [`RANDOM_START_DISTANCE`].
    pub seat_floor: Option<f64>,
    /// The new fallen empire zones, each with the system anchoring it, in the order they were
    /// drawn. Empty unless New random zones is chosen.
    pub zones: Vec<(u32, FeZone)>,
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
            (PrepareRow::WormholePairs, _) => ops.extend(dialect::unpaired(profile, &nodes)),
            (PrepareRow::EmpireSeats, _) => {
                for node in nodes.iter().filter(|n| reseated != Some(n.id)) {
                    if let Some(op) = dialect::unseated(profile, node) {
                        unseated.insert(node.id);
                        ops.push(op);
                    }
                }
                ops.extend(plan.new_seats());
                seated = ops.len();
            }
            (PrepareRow::FallenEmpires, _) => {
                for node in nodes {
                    ops.extend(dialect::without_fallen_empire(profile, node, draw)?);
                }
                ops.extend(plan.drawn.zones.iter().map(|(system, zone)| Op::SetFeZone {
                    system: *system,
                    zone: Some(zone.clone()),
                }));
            }
            (_, GameNames) => {
                ops.extend(nodes.iter().filter_map(|n| dialect::game_names(profile, n)));
            }
            (PrepareRow::Sol, GameDecides) => {
                for node in nodes {
                    match plan.seats.contains(&node.id) {
                        true => {
                            let start = dialect::generic_start(profile, node.id);
                            ops.extend(initializer(node, Some(start)));
                            ops.extend(dialect::without_sol_seat(profile, node));
                        }
                        false => ops.extend(dialect::game_decides(profile, node)),
                    }
                }
            }
            (_, GameDecides) => {
                ops.extend(
                    nodes
                        .iter()
                        .filter_map(|n| dialect::game_decides(profile, n)),
                );
            }
            (_, GenericStart | Plain | PreFtlEarth | UneSeat) => {
                for node in nodes {
                    let target = sol.is_some_and(|sol| sol.id == node.id);
                    match choice {
                        PreFtlEarth if target => {
                            ops.extend(initializer(node, Some(PRE_FTL_SOL.to_owned())));
                            if !unseated.contains(&node.id) {
                                ops.extend(dialect::unseated(profile, node));
                            }
                        }
                        UneSeat if target => ops.extend(une_seat(profile, node)?),
                        UneSeat => {}
                        Plain if row != PrepareRow::Sol => {
                            let plain = dialect::plain_system(profile, node.id, draw)?;
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
        if dialect::is_plain(plan.profile, &node.initializer, draw) {
            dropped.extend(at);
            continue;
        }
        let plain = dialect::plain_system(plan.profile, id, draw)?;
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

/// The choices checked against the map, and what [`build`], [`kept_clear`] and [`drawn`] all
/// read from them.
struct Plan<'a> {
    graph: &'a GalaxyGraph,
    profile: ScenarioProfile,
    chosen: BTreeMap<PrepareRow, PrepareChoice>,
    systems: BTreeMap<PrepareRow, &'a [u32]>,
    seed: u64,
    /// The Sol that Pre-FTL Earth or UNE seat writes, when one of them is chosen.
    sol: Option<&'a SystemNode>,
    /// The new seats and zones.
    drawn: Drawn,
    /// The systems that hold a seat once the batch applies.
    seats: BTreeSet<u32>,
    /// The systems within [`CLEAR_JUMPS`] lanes of one of `seats`, `seats` left out.
    near_seats: BTreeSet<u32>,
}

impl<'a> Plan<'a> {
    fn new(
        session: &'a Session,
        rows: &'a [RowSystems],
        choices: &[RowChoice],
        seed: u64,
    ) -> Result<Self, PrepareError> {
        let chosen = checked(choices)?;
        let profile = profile(session);
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
        if plan.chosen(PrepareRow::FallenEmpires) == PrepareChoice::RandomZones {
            dialect::has_zones(profile)?;
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
    fn chosen(&self, row: PrepareRow) -> PrepareChoice {
        self.chosen
            .get(&row)
            .copied()
            .unwrap_or(PrepareChoice::Keep)
    }

    /// The Sol UNE seat seats, which no Empire seats choice takes the seat from.
    fn reseated(&self) -> Option<u32> {
        match self.chosen(PrepareRow::Sol) {
            PrepareChoice::UneSeat => self.sol.map(|node| node.id),
            _ => None,
        }
    }

    /// Whether `system` stands in none of the rows its initializer or a fallen empire places a
    /// system in.
    fn in_no_row(&self, system: u32) -> bool {
        !KEPT_FROM_SEATS
            .into_iter()
            .chain([PrepareRow::OrdinarySystems])
            .any(|row| in_row(&self.systems, row).contains(&system))
    }

    /// The seats Empire seats takes away, in file order.
    fn old_seats(&self) -> Vec<&'a SystemNode> {
        let reseated = self.reseated();
        let mut old = nodes(self.graph, &self.systems, PrepareRow::EmpireSeats);
        old.retain(|node| Some(node.id) != reseated);
        old
    }

    /// The systems that hold a seat once the chosen rows apply: Empire seats None takes
    /// theirs away, New random seats moves them to the systems it draws, Pre-FTL Earth takes
    /// its Sol's away, and UNE seat gives its Sol one.
    fn seats_after(&self) -> BTreeSet<u32> {
        let mut seats: BTreeSet<u32> = self
            .graph
            .systems
            .values()
            .filter(|s| is_seat(s))
            .map(|s| s.id)
            .collect();
        let unseat = |seats: &mut BTreeSet<u32>, node: &SystemNode| {
            if dialect::unseated(self.profile, node).is_some() {
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
    fn seat_candidates(&self) -> Vec<(u32, (f64, f64))> {
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
    fn draw_seats(&self) -> Result<(Vec<u32>, Option<f64>), PrepareError> {
        let wanted = self.old_seats().len();
        if wanted == 0 {
            return Err(PrepareError::NoSeatsToDraw);
        }
        let mut candidates = self.seat_candidates();
        SplitMix::new(self.seed, Stream::Seats).shuffle(&mut candidates);
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

    /// New random zones: the zones Paint a Galaxy would place by itself once the old ones
    /// go, in an order the seed gives, each kept whose ring stands clear of every zone kept
    /// before it and whose centre stands [`RANDOM_START_DISTANCE`] from every seat, up to the
    /// fallen empires the mod can seat. The zones inside the rim are taken first, then at
    /// most [`MOST_RIM_ZONES`] on it. Each is a fallback of random kind.
    fn draw_zones(&self) -> Vec<(u32, FeZone)> {
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
        SplitMix::new(self.seed, Stream::Zones).shuffle(&mut candidates);
        let seats: Vec<(f64, f64)> = self
            .seats
            .iter()
            .filter_map(|id| self.graph.systems.get(id))
            .map(|s| (s.x, s.y))
            .collect();
        let rim = RIM_FRACTION * self.graph.galaxy_radius;
        let placed: Vec<(u32, FeZone, (f64, f64))> = candidates
            .into_iter()
            .filter_map(|(id, zone)| {
                let anchor = self.graph.systems.get(&id)?;
                let centre = fe_zone::centre((anchor.x, anchor.y), &zone);
                Some((id, zone, centre))
            })
            .collect();
        let on_rim = |centre: (f64, f64)| fe_zone::distance(centre, (0.0, 0.0)) > rim;
        let mut centres: Vec<(f64, f64)> = Vec::new();
        let mut zones = Vec::new();
        for (rim_pass, most) in [
            (false, MOST_FALLEN_EMPIRES as usize),
            (true, MOST_RIM_ZONES),
        ] {
            let mut taken = 0;
            for (id, zone, centre) in &placed {
                if zones.len() == MOST_FALLEN_EMPIRES as usize || taken == most {
                    break;
                }
                let clear = on_rim(*centre) == rim_pass
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

    /// The members that seat the new seats: each a generic start the seed draws, then the
    /// script or weight of the old seat drawn in its place.
    fn new_seats(&self) -> Vec<Op> {
        let mut ops = Vec::new();
        for (&id, old) in self.drawn.seats.iter().zip(self.old_seats()) {
            let Some(node) = self.graph.systems.get(&id) else {
                continue;
            };
            let start = dialect::drawn_start(self.profile, id, self.seed);
            ops.extend(initializer(node, Some(start)));
            ops.extend(dialect::seated(self.profile, id, old));
        }
        ops
    }

    /// What a home start or a Sol becomes when it is made ordinary: a generic start on a
    /// system that still holds a seat once the batch applies, else a plain system.
    fn start(&self, node: &SystemNode, draw: &PlainDraw) -> Result<String, PrepareError> {
        match self.seats.contains(&node.id) {
            true => Ok(dialect::generic_start(self.profile, node.id)),
            false => dialect::plain_system(self.profile, node.id, draw),
        }
    }
}

/// How far out, as a share of the map's radius, a new zone's centre stands on the rim.
const RIM_FRACTION: f64 = 0.8;
/// The most new zones New random zones puts on the rim.
const MOST_RIM_ZONES: usize = 2;

/// The rows whose systems New random seats leaves alone when they are kept.
const KEPT_FROM_SEATS: [PrepareRow; 10] = [
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
    let mut adjacent: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
    for system in graph.systems.values() {
        for lane in system
            .lanes
            .iter()
            .filter(|l| graph.systems.contains_key(&l.to))
        {
            adjacent.entry(system.id).or_default().push(lane.to);
            adjacent.entry(lane.to).or_default().push(system.id);
        }
    }
    let mut seen = BTreeSet::new();
    let mut largest = BTreeSet::new();
    for &start in adjacent.keys() {
        if !seen.insert(start) {
            continue;
        }
        let mut part = BTreeSet::from([start]);
        let mut stack = vec![start];
        while let Some(id) = stack.pop() {
            for &next in &adjacent[&id] {
                if seen.insert(next) {
                    part.insert(next);
                    stack.push(next);
                }
            }
        }
        if part.len() > largest.len() {
            largest = part;
        }
    }
    largest
}

fn by_row(rows: &[RowSystems]) -> BTreeMap<PrepareRow, &[u32]> {
    rows.iter()
        .map(|row| (row.row, row.systems.as_slice()))
        .collect()
}

fn in_row<'a>(systems: &BTreeMap<PrepareRow, &'a [u32]>, row: PrepareRow) -> &'a [u32] {
    systems.get(&row).copied().unwrap_or_default()
}

fn nodes<'g>(
    graph: &'g GalaxyGraph,
    systems: &BTreeMap<PrepareRow, &[u32]>,
    row: PrepareRow,
) -> Vec<&'g SystemNode> {
    let ids = in_row(systems, row);
    ids.iter().filter_map(|id| graph.systems.get(id)).collect()
}

/// The one Sol UNE seat seats. Several Sols are refused, and so is a Sol seat another
/// system already holds.
fn une_seat_target<'g>(
    profile: ScenarioProfile,
    graph: &'g GalaxyGraph,
    sols: &[&'g SystemNode],
) -> Result<Option<&'g SystemNode>, PrepareError> {
    dialect::sol_seat(profile)?;
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
fn une_seat(profile: ScenarioProfile, node: &SystemNode) -> Result<Option<Op>, PrepareError> {
    let seat = dialect::sol_seat(profile)?;
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

/// The seats the map holds once `ops` apply, the reserved ones and the player's among them.
fn seat_counts_after(graph: &GalaxyGraph, ops: &[Op]) -> SeatCounts {
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

/// The header keys that bring the fallen empire and marauder counts down to what the map
/// holds once `ops` apply, for each of the two the ops change. A default above what is
/// left comes down to it and one below stays; a max follows the map exactly where the
/// dialect sizes it by the map, and comes down to it elsewhere. Only Paint a Galaxy states
/// fallen empire zones. Under New random seats the empire default comes down to the seats
/// any empire may take among the seats drawn, as the kinds move with them. Keys the header
/// lacks or does not state as a whole number are left alone.
fn header_counts(plan: &Plan<'_>, ops: &[Op]) -> Option<Op> {
    let Plan { profile, graph, .. } = *plan;
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

    use super::{PlainDraw, PrepareError, Stream, initializer, unit};
    use crate::export::ScenarioProfile;
    use crate::format::scenario::paint::{self, BASIC_INITIALIZERS, RL_BASIC};
    use crate::ops::Op;
    use crate::projections::galaxy::{PaintSpawnKind, SpawnScript, SystemNode};

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

    /// The initializer a new random seat `system` gets: one of the same six starts, drawn
    /// from `seed`.
    pub(super) fn drawn_start(profile: ScenarioProfile, system: u32, seed: u64) -> String {
        match profile {
            ScenarioProfile::Plain | ScenarioProfile::PaintAGalaxy => {
                let at = unit(Stream::Starts.seed(seed), system) * BASIC_INITIALIZERS.len() as f64;
                let at = (at as usize).min(BASIC_INITIALIZERS.len() - 1);
                BASIC_INITIALIZERS[at].to_owned()
            }
        }
    }

    /// The op that seats `system` as `old` was seated: a plain file states a weight, and
    /// Paint a Galaxy a script or a weight. The Sol seat is not carried: it means Sol, so it
    /// becomes an enabled seat.
    pub(super) fn seated(profile: ScenarioProfile, system: u32, old: &SystemNode) -> Option<Op> {
        let weight = old.spawn_weight.map(|base| Op::SetSpawnWeight {
            system,
            base: Some(base),
        });
        match profile {
            ScenarioProfile::Plain => weight,
            ScenarioProfile::PaintAGalaxy => match &old.spawn_script {
                Some(script) => Some(Op::SetSpawnScript {
                    system,
                    script: Some(without_sol(script)),
                }),
                None => weight,
            },
        }
    }

    /// The op that makes the Sol seat on `node` an enabled seat, once its Sol initializer
    /// goes; none when it holds no Sol seat. A plain file has none.
    pub(super) fn without_sol_seat(profile: ScenarioProfile, node: &SystemNode) -> Option<Op> {
        match profile {
            ScenarioProfile::Plain => None,
            ScenarioProfile::PaintAGalaxy => {
                let script = node.spawn_script.as_ref()?;
                let enabled = without_sol(script);
                (enabled != *script).then_some(Op::SetSpawnScript {
                    system: node.id,
                    script: Some(enabled),
                })
            }
        }
    }

    /// `script` with a Sol seat made an enabled one, which carries no player's marker.
    fn without_sol(script: &SpawnScript) -> SpawnScript {
        match script {
            SpawnScript::PaintAGalaxy {
                kind: PaintSpawnKind::Sol,
                random_value,
                ..
            } => SpawnScript::PaintAGalaxy {
                kind: PaintSpawnKind::Enabled,
                random_value: *random_value,
                player: false,
            },
            script => script.clone(),
        }
    }

    /// Refuses New random zones where the dialect states no fallen empire zones.
    pub(super) fn has_zones(profile: ScenarioProfile) -> Result<(), PrepareError> {
        match profile {
            ScenarioProfile::Plain => Err(PrepareError::RandomZonesOnPlain),
            ScenarioProfile::PaintAGalaxy => Ok(()),
        }
    }

    /// The seat UNE seat writes: Paint a Galaxy's Sol seat, which only the United Nations
    /// of Earth weighs above zero, with no player's marker. A plain file has none.
    pub(super) fn sol_seat(profile: ScenarioProfile) -> Result<SpawnScript, PrepareError> {
        match profile {
            ScenarioProfile::Plain => Err(PrepareError::UneSeatOnPlain),
            ScenarioProfile::PaintAGalaxy => Ok(SpawnScript::PaintAGalaxy {
                kind: PaintSpawnKind::Sol,
                random_value: 0,
                player: false,
            }),
        }
    }

    /// Whether `initializer` is a plain layout already: one the draw holds, or on Paint a
    /// Galaxy its random list too. Keeping such a system clear of the roll needs no redraw.
    pub(super) fn is_plain(profile: ScenarioProfile, initializer: &str, draw: &PlainDraw) -> bool {
        let drawn = draw.layouts.iter().any(|l| l.key == initializer);
        match profile {
            ScenarioProfile::Plain => drawn,
            ScenarioProfile::PaintAGalaxy => drawn || initializer == RL_BASIC,
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
