//! The rows, choices, presets and options of Prepare, and what it refuses.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::format::scenario::ScenarioProfile;
use crate::format::scenario::fe_zone::FeZone;
use crate::format::scenario::unit;
use crate::ops::Op;

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
    /// A seat gets one of the game's ordinary systems, and a system the batch unseats
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

/// What Prepare refuses. The refusals of the Sol, seat and zone choices say what to do
/// instead; the others keep a short message naming what was wrong.
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
    #[error("Only a Paint a Galaxy map has a UNE seat.")]
    UneSeatOnPlain,
    #[error("System #{0} already holds the Sol seat. Keep Sol, or take that seat off first.")]
    SolSeatTaken(u32),
    #[error("A UNE seat goes on one Sol, and this map has {}: {}.", .0.len(), ids(.0))]
    SeveralSols(Vec<u32>),
    #[error(
        "This map has no seats, so there are none to draw again. Add a seat, or keep Empire seats."
    )]
    NoSeatsToDraw,
    #[error(
        "Only {fit} of the {wanted} seats fit on the systems left free, even close together. Let the game decide more rows, or keep Empire seats."
    )]
    SeatsDoNotFit { wanted: usize, fit: usize },
    #[error("Only a Paint a Galaxy map has fallen empire zones.")]
    RandomZonesOnPlain,
}

fn ids(systems: &[u32]) -> String {
    let ids: Vec<String> = systems.iter().map(|id| format!("#{id}")).collect();
    ids.join(", ")
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

/// What a set of choices would do to an open scenario, and the one batch that does it.
#[derive(Debug, Clone, PartialEq)]
pub struct Preview {
    pub profile: ScenarioProfile,
    /// Every row, in [`PrepareRow::ALL`] order, each row's systems in file order.
    pub rows: Vec<RowSystems>,
    /// The one batch; `None` when the choices change nothing.
    pub op: Option<Op>,
    /// How many systems the batch changes, as its description counts them.
    pub changes: usize,
    /// The systems the game would roll near a seat that keeping the space around seats clear
    /// gives a plain system; empty with the option off. Sorted.
    pub kept_clear: Vec<u32>,
    /// The systems the batch cuts off from the rest of the map. Sorted.
    pub cut_off: Vec<u32>,
    pub drawn: Drawn,
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

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Faithful => "faithful",
            Self::FreshStart => "fresh_start",
            Self::BareShell => "bare_shell",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|preset| preset.as_str() == text)
    }

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
            (Self::BareShell, PrepareRow::FallenEmpires) => match profile.states_zones() {
                true => RandomZones,
                false => Keep,
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
    pub(super) fn pick(&self, system: u32) -> Result<&str, PrepareError> {
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
