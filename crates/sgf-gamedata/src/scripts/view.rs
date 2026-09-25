//! The IPC shapes the scenario owners and the inspector's Scripts section
//! are sent over; `cargo test -p sgf-gamedata` writes their TypeScript to
//! `app/src/generated/`.

use serde::{Deserialize, Serialize};
use sgf_core::projections::galaxy::CountryNode;
use ts_rs::TS;

/// Territory ids start here so they never collide with a save's country ids.
pub const TERRITORY_BASE: u32 = 0x3000_0000;

/// Scripts one system's Scripts section carries before it is truncated.
pub const ROW_LIMIT: usize = 200;

/// Sites one row lists before the rest are cut; they still count towards
/// [`ScriptRow::site_count`].
pub const SITE_LIMIT: usize = 50;

/// One system of a scenario document, as the ownership pass reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScenarioSystem<'a> {
    pub id: u32,
    /// The `initializer = ` the system statement names.
    pub initializer: Option<&'a str>,
    /// The system statement's own `effect = { … }` text.
    pub effect: Option<&'a str>,
}

/// Where a script says what it says: the winning file, its line and the
/// layer that won.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScriptRef {
    /// Absolute path, for Show in Explorer; `None` for a line of the
    /// scenario document itself, which is not a game-data file.
    pub file: Option<String>,
    /// `common/scripted_effects/swnd_country_creation_effects.txt:230`.
    pub display: String,
    pub line: u32,
    /// `"vanilla"` or the name of the mod whose file won.
    pub layer: String,
}

/// How much the identity resolver could say about a territory's owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum OwnerIdentity {
    /// A `create_country` whose own `effect` saves the token.
    Created,
    /// A `create_country` carrying the country flag the chain matched on.
    CountryFlag,
    /// A `prescripted_countries` entry whose `initializer` is the capital's.
    Prescripted,
    /// The capital initializer spawns whatever empire the player designed.
    CustomEmpireSpawn,
    /// Nothing in loaded game data names the token.
    Unresolved,
}

/// When a system's owner was decided: at galaxy generation by its
/// initializer chain, or on day one by an event `on_game_start` fired.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum OwnerTier {
    /// The initializer chain handed the system over.
    #[default]
    Generation,
    /// An `on_game_start` event claimed the system before the first frame.
    DayOne,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Territory {
    /// The `event_target:` token the systems share.
    pub token: String,
    pub identity: OwnerIdentity,
    /// Where the token was saved.
    pub origin: Option<ScriptRef>,
    /// Where the country behind the token is defined.
    pub defined_at: Option<ScriptRef>,
    pub country: CountryNode,
    /// The earliest tier any member system was claimed at.
    pub tier: OwnerTier,
    /// Any member system's claim rests on a condition this editor cannot judge.
    pub assumed: bool,
    /// The distinct day-one events that claimed member systems, `swnd_start.7`.
    pub claimed_by: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemOwner {
    pub system: u32,
    /// The owning [`Territory`]'s `country.id`.
    pub territory: u32,
    pub tier: OwnerTier,
    /// The day-one event that claimed the system, `swnd_start.7`.
    pub claimed_by: Option<String>,
    /// The claim rests on a condition this editor cannot judge.
    pub assumed: bool,
}

/// A body a scenario's scripts colonise, as opposed to a system a scenario's
/// scripts merely hand over.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemColony {
    pub system: u32,
    /// The body's position in the system's planet list.
    pub planet_index: u32,
    /// The colonising [`Territory`]'s `country.id`.
    pub territory: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UnresolvedOwner {
    pub system: u32,
    /// The literal statement, `set_owner = prev`.
    pub wrote: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScenarioOwners {
    /// Sorted by token, so ids and palette indexes are stable across reloads.
    pub territories: Vec<Territory>,
    pub owners: Vec<SystemOwner>,
    /// The bodies the scripts colonise, in `owners` order.
    pub colonies: Vec<SystemColony>,
    pub unresolved: Vec<UnresolvedOwner>,
    /// How many of `owners` were claimed on day one rather than at generation.
    pub day_one_systems: u32,
    /// How many of `owners` rest on a condition this editor cannot judge.
    pub assumed_systems: u32,
    pub with_game_data: bool,
}

impl ScenarioOwners {
    /// The territory id a token was given, for a caller holding only the token.
    pub fn territory_of(&self, token: &str) -> Option<u32> {
        self.territories
            .iter()
            .find(|t| t.token == token)
            .map(|t| t.country.id)
    }
}

/// What a bypass endpoint is, as the game data names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BypassKind {
    Wormhole,
    Gateway {
        ruined: bool,
    },
    /// A `bypass_type` of its own: `shroud_tunnel`, `strange_wormhole`.
    Other {
        kind: String,
    },
}

impl BypassKind {
    /// A `spawn_natural_wormhole`'s `bypass_type`; a plain wormhole by default.
    pub fn of_wormhole(bypass_type: Option<&str>) -> Self {
        match bypass_type {
            None | Some("wormhole") => Self::Wormhole,
            Some(other) => Self::Other {
                kind: other.to_owned(),
            },
        }
    }

    /// A `spawn_megastructure` type, where it is a gateway.
    pub fn of_megastructure(key: &str) -> Option<Self> {
        key.starts_with("gateway").then(|| Self::Gateway {
            ruined: key.ends_with("ruined"),
        })
    }

    /// A wormhole of some sort, which has a far end; a gateway has none.
    pub fn is_wormhole(&self) -> bool {
        !matches!(self, Self::Gateway { .. })
    }
}

/// Which reader found a bypass, and where it is written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BypassSource {
    /// The system's own initializer chain, at galaxy generation.
    Initializer { key: String },
    /// An `on_game_start` event, before the player's first frame.
    DayOne { event: String },
}

/// One bypass endpoint a scenario's game data puts on one system.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScenarioBypass {
    pub system: u32,
    pub kind: BypassKind,
    /// The system at the far end, where this reader can name it.
    pub partner: Option<u32>,
    pub source: BypassSource,
    /// The endpoint rests on a condition this editor cannot judge.
    pub assumed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScenarioBypasses {
    /// One entry per endpoint, by system; a pair carries both ends.
    pub bypasses: Vec<ScenarioBypass>,
    /// Drawn endpoints with a far end this reader could not name: one
    /// wormhole mouth each, at a system it is sure of.
    pub open_endpoints: u32,
    /// Wormhole pairs the game places wherever it likes, never drawn.
    pub random_wormhole_pairs: u32,
    /// Gateways the game places wherever it likes, never drawn.
    pub random_gateways: u32,
    pub with_game_data: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ScriptRowKind {
    Initializer,
    SpawnedInitializer,
    ScriptedEffect,
    Event,
    OnAction,
    ScenarioEffect,
}

/// The order the inspector groups rows in.
pub const ROW_KIND_ORDER: [ScriptRowKind; 6] = [
    ScriptRowKind::Initializer,
    ScriptRowKind::SpawnedInitializer,
    ScriptRowKind::ScriptedEffect,
    ScriptRowKind::ScenarioEffect,
    ScriptRowKind::Event,
    ScriptRowKind::OnAction,
];

/// What made a script a reference to this system.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ReferenceVia {
    StarFlag,
    GlobalFlag,
    PlanetFlag,
    EventTarget,
    Initializer,
    Call,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ScriptTiming {
    Generation,
    /// Fired by `on_game_start` before the player's first frame.
    DayOne,
    Later,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemOwnerView {
    pub token: String,
    /// The [`Territory`] the token belongs to; `None` where no territory
    /// carries it.
    pub territory: Option<u32>,
    pub label: String,
    /// This system's chain is the one that saved the token.
    pub capital: bool,
    pub tier: OwnerTier,
    /// The day-one event that claimed the system, `swnd_start.7`.
    pub claimed_by: Option<String>,
    /// The claim rests on a condition this editor cannot judge.
    pub assumed: bool,
}

/// One line of one script that names this system.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScriptSite {
    pub location: ScriptRef,
    pub via: Option<ReferenceVia>,
    /// The flag or event target this line named.
    pub token: Option<String>,
}

/// One script that names this system, with every line of it that does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScriptRow {
    pub kind: ScriptRowKind,
    /// Definition key, event id (`distar.290`) or on_action name.
    pub name: String,
    /// Localised, where the name is a key localisation knows.
    pub title: Option<String>,
    pub timing: ScriptTiming,
    /// `on_game_start`, `from event distar.290`.
    pub fired_by: Option<String>,
    /// Never empty; the script's own definition line leads, then by line.
    pub sites: Vec<ScriptSite>,
    /// Every site found, including any past [`SITE_LIMIT`] that `sites` drops.
    pub site_count: u32,
    /// The distinct vias across the sites, for the collapsed summary line.
    pub vias: Vec<ReferenceVia>,
    /// The system's own initializer and the scenario `effect`, listed first.
    pub pinned: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemScripts {
    pub system: u32,
    pub initializer: Option<ScriptRef>,
    pub owner: Option<SystemOwnerView>,
    pub rows: Vec<ScriptRow>,
    /// More than [`ROW_LIMIT`] rows were found; the rest are not listed.
    pub truncated: bool,
}

impl SystemScripts {
    /// Fill each owner view's territory id from a computed [`ScenarioOwners`].
    pub fn attach_territory(&mut self, owners: &ScenarioOwners) {
        if let Some(owner) = self.owner.as_mut() {
            owner.territory = owners.territory_of(&owner.token);
        }
    }
}

/// What a mod's file does to the L-Cluster outcome `distar.8000` rolls.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", content = "flag", rename_all = "snake_case")]
pub enum LGateTouchKind {
    /// Defines `distar.8000`, the day-one roll.
    OverridesRoll,
    /// Defines `distar.10950`, which reads the outcome when a gate opens.
    OverridesGateOpening,
    SetsFlag(String),
    RemovesFlag(String),
    ReadsFlag(String),
}

/// One file of a loaded mod that could change the L-Cluster outcome.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LGateModTouch {
    pub mod_name: String,
    /// Relative to the mod's root: `events/distant_stars_events_3.txt`.
    pub file: String,
    pub what: LGateTouchKind,
}
