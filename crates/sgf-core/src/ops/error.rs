//! The errors an op is refused with.

use std::fmt;

use crate::document;
use crate::format::save::write::planet_modifier::MAX_MODIFIER_COPIES;
use crate::ops::SavedTable;
use crate::overlay::OverlayError;
use crate::projections::galaxy::ProjectionError;
use crate::views::{DocumentKind, ErrorKind};

#[derive(Debug, thiserror::Error)]
pub enum OpError {
    #[error("system {0} does not exist")]
    UnknownSystem(u32),
    #[error("system {0} already exists")]
    SystemExists(u32),
    #[error("{0} is the null id, which no system may take")]
    NullSystemId(u32),
    #[error("{what} may not be empty")]
    EmptyText { what: &'static str },
    #[error("{text:?} cannot be written as {what}")]
    InvalidText { what: &'static str, text: String },
    #[error("planet {body}: {error}")]
    OnBody { body: u32, error: Box<OpError> },
    #[error("nebula {0} does not exist")]
    UnknownNebula(usize),
    #[error("system {0} cannot have a lane to itself")]
    SelfLane(u32),
    #[error("systems {0} and {1} are already linked")]
    LaneExists(u32, u32),
    #[error("systems {0} and {1} are not linked")]
    NoSuchLane(u32, u32),
    #[error("lane {0} <-> {1} holds a different length on each end")]
    LaneEndsDisagree(u32, u32),
    #[error("lane {0} <-> {1} is already prevented")]
    PreventExists(u32, u32),
    #[error("a hyperlane already runs between {0} and {1}: remove it before preventing the pair")]
    PreventLinked(u32, u32),
    #[error("lane {0} <-> {1} is not prevented")]
    NotPrevented(u32, u32),
    #[error("system {0} has no hyperlanes")]
    NoLanes(u32),
    #[error("value is not a finite number")]
    NotFinite,
    #[error("length {length} is invalid: {reason}")]
    InvalidLength { length: f64, reason: String },
    #[error("radius {radius} is invalid: {reason}")]
    InvalidRadius { radius: f64, reason: String },
    #[error("spawn weight {weight} is invalid: {reason}")]
    InvalidWeight { weight: f64, reason: String },
    #[error("system {0}'s spawn weight is script; change its spawn kind instead")]
    ScriptedSpawn(u32),
    #[error("a system takes a spawn weight or a spawn script, not both")]
    WeightAndScript,
    #[error(
        "a reserved seat is named by a letter a to z or a Greek letter alpha to omega, not {0:?}"
    )]
    InvalidSeatName(String),
    #[error(
        "an enabled seat has no marker to make it the player's; choose a 1st Player, Sol or reserved seat"
    )]
    EnabledSeatPlayer,
    #[error(
        "Fallen empire zone from {anchor} is blocked by {blocker}: the mod needs the ring empty"
    )]
    FeZoneBlocked { anchor: String, blocker: String },
    #[error("Fallen empire zone from {anchor} is off the map")]
    FeZoneOffMap { anchor: String },
    #[error("system {0} cannot be paired with itself")]
    WormholeSelf(u32),
    #[error("wormhole pair {0} is already in use")]
    WormholePairInUse(u32),
    #[error("system {0} anchors no fallen empire zone")]
    FeLinkNoZone(u32),
    #[error("system {0} cannot link to its own fallen empire zone")]
    FeLinkSelf(u32),
    #[error("every fallen empire connection id is taken")]
    FeLinkIdsExhausted,
    #[error("fallen empire connection id {0} is beyond the {1} the mod reads")]
    FeLinkIdOutOfRange(u8, u8),
    #[error("random value {0} is beyond the {1} a Paint a Galaxy seat is drawn from")]
    RandomValueOutOfRange(u8, u8),
    #[error("no entries given")]
    NoEntries,
    #[error("every lane already has the length the game writes")]
    AlreadyNormal,
    #[error("a batch with nothing in it")]
    EmptyBatch,
    #[error("no planets to move")]
    NoPlanets,
    #[error("a batch may not hold another batch")]
    NestedBatch,
    #[error("system {0} is listed more than once")]
    DuplicateSystem(u32),
    #[error("lane {0} <-> {1} is listed more than once")]
    DuplicateLane(u32, u32),
    #[error("{at}: {reason} at byte {offset}")]
    Parse {
        at: ParseAt,
        offset: usize,
        reason: String,
    },
    #[error("{what} {state}")]
    Unchanged { what: String, state: String },
    #[error("planet {body} {edit}")]
    StarRefused { body: u32, edit: StarEdit },
    #[error("the document has no global flags")]
    NoFlags,
    #[error("the galaxy has no L-Gate")]
    NoLGate,
    #[error("a gate has opened: the outcome has already spawned")]
    LGateOpened,
    #[error("planet {0} does not exist")]
    UnknownPlanet(u32),
    #[error("no star bodies given")]
    NoStarBodies,
    #[error("planet {body} is not a body of system {system}")]
    NotABody { body: u32, system: u32 },
    #[error("planet {0} is listed more than once")]
    DuplicatePlanet(u32),
    #[error("a planet size may not be zero")]
    ZeroPlanetSize,
    #[error("planet {0} already has {1}")]
    ModifierPresent(u32, String),
    #[error("planet {0} does not have {1}")]
    ModifierAbsent(u32, String),
    #[error("a modifier cannot last 0 days: -1 keeps it for ever")]
    ModifierDays,
    #[error("{0} copies of a modifier: an op adds or restores 1 to {max}", max = MAX_MODIFIER_COPIES)]
    ModifierCopies(u32),
    #[error("planet {0} already has anomaly {1}")]
    AnomalyPresent(u32, String),
    #[error("planet {0} has no anomaly")]
    AnomalyAbsent(u32),
    #[error("country {0} does not exist")]
    UnknownCountry(u32),
    #[error("country {0} has no map colours: map colours need a Stellaris 4.5 save")]
    NoMapColors(u32),
    #[error("this edit needs a save from Stellaris 4.0 or later, not {0}")]
    VersionTooOld(String),
    #[error("the save's version {0:?} names no major version, so it cannot take this edit")]
    UnknownVersion(String),
    #[error("the save has no `{0}`")]
    MissingKey(&'static str),
    #[error(
        "the save's last system is {last} but it holds {count} systems: a new system needs ids 0 to {last} held, without a gap"
    )]
    SystemIdsNotDense { last: u32, count: usize },
    #[error("system {id} is {distance:.2} away; a new system needs 10 between them")]
    TooClose { id: u32, distance: f64 },
    #[error("({x}, {y}) is outside the galaxy's radius of {radius}")]
    OutsideGalaxy { x: f64, y: f64, radius: f64 },
    #[error("{0} cannot have moons")]
    MoonsNotAllowed(&'static str),
    #[error("{0} cannot be an asteroid")]
    AsteroidNotAllowed(&'static str),
    #[error("{0} cannot have a fixed name")]
    FixedNameNotAllowed(&'static str),
    #[error("{0} cannot have a ring")]
    RingNotAllowed(&'static str),
    #[error(
        "system {other}, added since the file was opened, has layout {initializer} with capped set to {capped}: a system of the same layout must match it"
    )]
    CappedMismatch {
        initializer: String,
        other: u32,
        capped: bool,
    },
    #[error(
        "system {0} was in the save when it was opened: only a system added since then can be removed, rolled again or renamed"
    )]
    SystemNotAdded(u32),
    #[error("deposit {0} does not exist")]
    UnknownDeposit(u32),
    #[error("deposit {0} is not held by a planet")]
    DepositNotOnPlanet(u32),
    #[error("planet {body} already has dig site {site}")]
    DigSitePresent { body: u32, site: u32 },
    #[error("dig site {0} does not exist")]
    UnknownDigSite(u32),
    #[error("dig site {0} is not on a planet")]
    DigSiteNotOnPlanet(u32),
    #[error("{0:?} is not a nebula cloud type")]
    InvalidCloudType(String),
    #[error("ambient object {0} cannot be written back: its slot is taken")]
    AmbientSlotTaken(u32),
    #[error("planet {0} stands at the system's centre")]
    AtCentre(u32),
    #[error(
        "planet {body} is a moon of planet {parent}, which the save does not hold: make it a planet first"
    )]
    ParentMissing { body: u32, parent: u32 },
    #[error("natural wormhole {0} does not exist")]
    UnknownWormhole(u32),
    #[error("natural wormhole {wormhole} has bypass type \"{kind}\": only a wormhole can be moved")]
    NotAWormhole { wormhole: u32, kind: String },
    #[error(
        "system {system} already has a natural wormhole of bypass type \"{kind}\", and a system holds one at most"
    )]
    HasNaturalWormhole { system: u32, kind: String },
    #[error("systems {0} and {1} are not the two ends of a wormhole")]
    NotAWormholePair(u32, u32),
    #[error(
        "the wormhole in system {system} is linked to system {partner}, which has no natural wormhole for it"
    )]
    WormholeEndMissing { system: u32, partner: u32 },
    #[error("system {0} has a wormhole: remove the wormhole pair first")]
    HoldsWormhole(u32),
    #[error("{reason}")]
    InvalidParent { reason: String },
    #[error("planet {0} has moons, so it cannot become a moon")]
    HasMoons(u32),
    #[error("{0} is a class no planet is changed to or from")]
    FixedPlanetClass(String),
    #[error("planet {body} is a colony, and a colony cannot be changed to or from {class}")]
    ColonyPlanetClass { body: u32, class: String },
    #[error("planet {body} is {class}, not {from}")]
    PlanetClassMismatch {
        body: u32,
        class: String,
        from: String,
    },
    #[error("system {system} has no belt {index}")]
    UnknownBelt { system: u32, index: usize },
    #[error(
        "the inner radius cannot go below {least:.2}, which the system's bodies and belts reach"
    )]
    InnerRadiusTooSmall { least: f64 },
    #[error("planet {body} is already a body of system {system}")]
    AlreadyInSystem { body: u32, system: u32 },
    #[error("system {0} lists no bodies, so a planet cannot join it")]
    NoBodies(u32),
    #[error("system {system} holds planet {body} from the save; move it out first")]
    HoldsBody { system: u32, body: u32 },
    #[error("planet {0} has a megastructure, so it cannot move to another system")]
    MegastructurePlanet(u32),
    #[error("planet {0} has a megastructure, so it keeps its class")]
    MegastructureClass(u32),
    #[error("{class} has {models} models, so planet {body} cannot take model {entity}")]
    PlanetModelIndex {
        body: u32,
        entity: u32,
        class: String,
        models: u32,
    },
    #[error(
        "planet {0} was in the save when it was opened: only a body added since then can be taken out again"
    )]
    BodyNotAdded(u32),
    #[error("planet {0} has moons: take them out first")]
    BodyHasMoons(u32),
    #[error("planet {body} is owned by country {owner} but controlled by country {controller}")]
    PlanetOccupied {
        body: u32,
        owner: u32,
        controller: u32,
    },
    #[error("planet {0} has no colony")]
    NoColony(u32),
    #[error("planet {body} cannot be deleted: {reason}")]
    PlanetKept { body: u32, reason: String },
    #[error("the colony on planet {body} cannot be removed: {reason}")]
    ColonyKept { body: u32, reason: String },
    #[error("{table:?} {id} does not exist")]
    UnknownEntity { table: SavedTable, id: u32 },
    #[error("the text for {table:?} {id} is not one entity with that id")]
    EntityMismatch { table: SavedTable, id: u32 },
    #[error("{0} is only an inverse: undo writes it back")]
    InverseOnly(&'static str),
    #[error("{op} is not supported for a {kind} document")]
    Unsupported {
        op: &'static str,
        kind: DocumentKind,
    },
    #[error(transparent)]
    Overlay(#[from] OverlayError),
    #[error(transparent)]
    Projection(#[from] ProjectionError),
    #[error(transparent)]
    Document(#[from] document::Error),
}

impl OpError {
    /// How the refusal crosses to the app: an entity the document does not hold, text it
    /// could not read, or an edit refused.
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::UnknownSystem { .. }
            | Self::UnknownNebula { .. }
            | Self::UnknownPlanet { .. }
            | Self::UnknownCountry { .. }
            | Self::UnknownDeposit { .. }
            | Self::UnknownDigSite { .. }
            | Self::UnknownWormhole { .. }
            | Self::UnknownBelt { .. }
            | Self::UnknownEntity { .. } => ErrorKind::NotFound,
            Self::Parse { .. }
            | Self::Overlay { .. }
            | Self::Projection { .. }
            | Self::Document { .. } => ErrorKind::Format,
            Self::SystemExists { .. }
            | Self::NullSystemId { .. }
            | Self::EmptyText { .. }
            | Self::InvalidText { .. }
            | Self::OnBody { .. }
            | Self::SelfLane { .. }
            | Self::LaneExists { .. }
            | Self::NoSuchLane { .. }
            | Self::LaneEndsDisagree { .. }
            | Self::PreventExists { .. }
            | Self::PreventLinked { .. }
            | Self::NotPrevented { .. }
            | Self::NoLanes { .. }
            | Self::NotFinite { .. }
            | Self::InvalidLength { .. }
            | Self::InvalidRadius { .. }
            | Self::InvalidWeight { .. }
            | Self::ScriptedSpawn { .. }
            | Self::WeightAndScript { .. }
            | Self::InvalidSeatName { .. }
            | Self::EnabledSeatPlayer { .. }
            | Self::FeZoneBlocked { .. }
            | Self::FeZoneOffMap { .. }
            | Self::WormholeSelf { .. }
            | Self::WormholePairInUse { .. }
            | Self::FeLinkNoZone { .. }
            | Self::FeLinkSelf { .. }
            | Self::FeLinkIdsExhausted { .. }
            | Self::FeLinkIdOutOfRange { .. }
            | Self::RandomValueOutOfRange { .. }
            | Self::NoEntries { .. }
            | Self::AlreadyNormal { .. }
            | Self::EmptyBatch { .. }
            | Self::NoPlanets { .. }
            | Self::NestedBatch { .. }
            | Self::DuplicateSystem { .. }
            | Self::DuplicateLane { .. }
            | Self::Unchanged { .. }
            | Self::StarRefused { .. }
            | Self::NoFlags { .. }
            | Self::NoLGate { .. }
            | Self::LGateOpened { .. }
            | Self::NoStarBodies { .. }
            | Self::NotABody { .. }
            | Self::DuplicatePlanet { .. }
            | Self::ZeroPlanetSize { .. }
            | Self::ModifierPresent { .. }
            | Self::ModifierAbsent { .. }
            | Self::ModifierDays { .. }
            | Self::ModifierCopies { .. }
            | Self::AnomalyPresent { .. }
            | Self::AnomalyAbsent { .. }
            | Self::NoMapColors { .. }
            | Self::VersionTooOld { .. }
            | Self::UnknownVersion { .. }
            | Self::MissingKey { .. }
            | Self::SystemIdsNotDense { .. }
            | Self::TooClose { .. }
            | Self::OutsideGalaxy { .. }
            | Self::MoonsNotAllowed { .. }
            | Self::AsteroidNotAllowed { .. }
            | Self::FixedNameNotAllowed { .. }
            | Self::RingNotAllowed { .. }
            | Self::CappedMismatch { .. }
            | Self::SystemNotAdded { .. }
            | Self::DepositNotOnPlanet { .. }
            | Self::DigSitePresent { .. }
            | Self::DigSiteNotOnPlanet { .. }
            | Self::InvalidCloudType { .. }
            | Self::AmbientSlotTaken { .. }
            | Self::AtCentre { .. }
            | Self::ParentMissing { .. }
            | Self::NotAWormhole { .. }
            | Self::HasNaturalWormhole { .. }
            | Self::NotAWormholePair { .. }
            | Self::WormholeEndMissing { .. }
            | Self::HoldsWormhole { .. }
            | Self::InvalidParent { .. }
            | Self::HasMoons { .. }
            | Self::FixedPlanetClass { .. }
            | Self::ColonyPlanetClass { .. }
            | Self::PlanetClassMismatch { .. }
            | Self::InnerRadiusTooSmall { .. }
            | Self::AlreadyInSystem { .. }
            | Self::NoBodies { .. }
            | Self::HoldsBody { .. }
            | Self::MegastructurePlanet { .. }
            | Self::MegastructureClass { .. }
            | Self::PlanetModelIndex { .. }
            | Self::BodyNotAdded { .. }
            | Self::BodyHasMoons { .. }
            | Self::PlanetOccupied { .. }
            | Self::NoColony { .. }
            | Self::PlanetKept { .. }
            | Self::ColonyKept { .. }
            | Self::EntityMismatch { .. }
            | Self::InverseOnly { .. }
            | Self::Unsupported { .. } => ErrorKind::Op,
        }
    }

    /// Text at `at` that could not be read, `offset` bytes in.
    pub(crate) fn parse(at: ParseAt, offset: usize, reason: impl Into<String>) -> Self {
        Self::Parse {
            at,
            offset,
            reason: reason.into(),
        }
    }

    /// An edit that would leave `what` as it is, `state` saying how it already stands.
    pub(crate) fn unchanged(what: impl fmt::Display, state: impl fmt::Display) -> Self {
        Self::Unchanged {
            what: what.to_string(),
            state: state.to_string(),
        }
    }
}

/// Where text an op could not read stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseAt {
    System(u32),
    Body(u32),
    Nebula(usize),
    Header,
    Flags,
    Country(u32),
    Meta,
    /// A save statement no projection reads.
    Record,
}

impl fmt::Display for ParseAt {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::System(id) => write!(f, "system {id}"),
            Self::Body(id) => write!(f, "planet {id}"),
            Self::Nebula(index) => write!(f, "nebula {index}"),
            Self::Header => f.write_str("scenario header"),
            Self::Flags => f.write_str("global flags"),
            Self::Country(id) => write!(f, "country {id}"),
            Self::Meta => f.write_str("save meta"),
            Self::Record => f.write_str("save statement"),
        }
    }
}

/// The edit [`OpError::StarRefused`] turns away from a star.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StarEdit {
    Modifier,
    DigSite,
    Rename,
    Model,
    Class,
    Move,
    Delete,
}

impl fmt::Display for StarEdit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Modifier => "is its system's star, which takes no planet modifiers",
            Self::DigSite => "is a star, which takes no dig site",
            Self::Rename => "is a star: only a planet or moon can be renamed",
            Self::Model => "is a star, which takes no planet model",
            Self::Class => "is a star; its star type is changed on the star's page",
            Self::Move => "is a star: only a planet can move to another system",
            Self::Delete => "is a star: only a planet or moon can be deleted",
        })
    }
}
