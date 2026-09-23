//! The op vocabulary: every edit the editor can make, the entries its plural ops take,
//! and the errors an op is refused with.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::document;
use crate::format::scenario::{FeLinkFlags, FeZone};
use crate::overlay::OverlayError;
use crate::projections::galaxy::{LGateOutcome, ProjectionError, SpawnScript};
use crate::views::DocumentKind;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Op {
    MoveSystem {
        id: u32,
        x: f64,
        y: f64,
    },
    AddLane {
        a: u32,
        b: u32,
        bridge: bool,
    },
    /// Several lanes from one system at once; the inverse of [`Op::IsolateSystem`] and
    /// of [`Op::RemoveLanes`].
    AddLanes {
        from: u32,
        to: Vec<(u32, bool)>,
    },
    RemoveLane {
        a: u32,
        b: u32,
    },
    /// Several lanes of one system at once; the inverse of [`Op::AddLanes`].
    RemoveLanes {
        from: u32,
        to: Vec<u32>,
    },
    SetLaneLength {
        a: u32,
        b: u32,
        length: f64,
    },
    IsolateSystem {
        id: u32,
    },
    /// Several systems moved as one; every lane touching any of them gets its length
    /// recomputed from the new positions of both ends.
    MoveSystems {
        moves: Vec<SystemMove>,
    },
    /// Several unrelated lanes at once; the inverse of [`Op::RemoveLanePairs`] and of
    /// [`Op::IsolateSystems`].
    AddLanePairs {
        lanes: Vec<LanePair>,
    },
    /// The inverse of [`Op::AddLanePairs`].
    RemoveLanePairs {
        lanes: Vec<(u32, u32)>,
    },
    /// Every lane touching any of `ids`; a lane between two of them is removed once.
    /// Systems without lanes are allowed, but the op refuses with
    /// [`OpError::NoLanes`] (naming the first id) when no lane is removed at all.
    IsolateSystems {
        ids: Vec<u32>,
    },
    /// Several lane lengths at once; its own inverse. Lengths follow the
    /// [`Op::SetLaneLength`] rules.
    SetLaneLengths {
        lanes: Vec<LaneLength>,
    },
    /// One lane's length rewritten to the `floor(distance)` the generator writes, on both
    /// ends; refuses with [`OpError::Empty`] when it already stands there. The inverse is
    /// the [`Op::SetLaneLength`] that puts the old length back.
    NormaliseLaneLength {
        a: u32,
        b: u32,
    },
    /// Every lane touching one of `systems` whose length is not `floor(distance)`,
    /// rewritten to it as an integer; refuses with [`OpError::Empty`] when none is stale.
    NormaliseLaneLengths {
        systems: Vec<u32>,
    },
    /// The `index`th nebula's centre. Nothing else moves: a save rewrites the member lists
    /// to what the radius now covers, and lane lengths are untouched. Its own inverse.
    MoveNebula {
        index: usize,
        x: f64,
        y: f64,
    },
    /// A new nebula, which lands last and so takes the index `nebulae.len()`. `name` is
    /// the save's `key=` or the scenario's `name =`, empty when `None`. Every system its
    /// radius reaches joins it.
    AddNebula {
        x: f64,
        y: f64,
        radius: f64,
        name: Option<String>,
    },
    /// The `index`th nebula; its members join whatever other cloud covers them. Later
    /// nebulae renumber, so a held index is stale afterwards. The inverse writes the
    /// nebula back, but last rather than where it stood.
    RemoveNebula {
        index: usize,
    },
    /// The `index`th nebula's radius, about its fixed centre; its own inverse.
    SetNebulaRadius {
        index: usize,
        radius: f64,
    },
    /// The `index`th nebula's name, written as it stands: a cloud named by a localisation
    /// key is left naming the text instead. Empty is refused; the inverse carries the name
    /// it displaced.
    SetNebulaName {
        index: usize,
        name: String,
    },
    /// A new `system` statement, `id` defaulting to one past the highest held. Scenario
    /// documents only: a save's systems carry planets, a starbase and an owner no op can
    /// invent. A weight and a script together are refused (see [`Op::SetSpawnScript`]).
    AddSystem {
        id: Option<u32>,
        x: f64,
        y: f64,
        name: Option<String>,
        initializer: Option<String>,
        spawn_weight: Option<f64>,
        #[serde(default)]
        spawn_script: Option<SpawnScript>,
    },
    /// A system and every hyperlane statement naming it, `prevent_hyperlane` included.
    /// Scenario documents only. The inverse is a batch that restores the system's
    /// statement text and each distinct lane and prevented pair between systems the graph
    /// holds; undo through history stays byte-exact.
    RemoveSystem {
        id: u32,
    },
    /// Several systems as one undo step, each following the [`Op::AddSystem`] rules with
    /// its id given. An id listed twice is refused. Scenario documents only.
    AddSystems {
        systems: Vec<NewSystem>,
    },
    /// Several systems as one undo step, each as [`Op::RemoveSystem`]; a statement naming
    /// two of them is removed once. An id listed twice is refused. The inverse restores
    /// what [`Op::RemoveSystem`]'s does, for every system; undo through history stays
    /// byte-exact. Scenario documents only.
    RemoveSystems {
        ids: Vec<u32>,
    },
    /// Scenario documents only.
    SetSystemName {
        id: u32,
        name: String,
    },
    /// The system's `initializer`, which `None` removes. The `spawn_weight` beside it is
    /// not touched: only [`Op::SetSpawnWeight`] writes one. Scenario documents only.
    SetInitializer {
        id: u32,
        initializer: Option<String>,
    },
    /// Several systems' initializers as one undo step; each entry follows the
    /// [`Op::SetInitializer`] rules. Scenario documents only.
    SetInitializers {
        entries: Vec<InitializerSet>,
    },
    /// One header key, scenario documents only: `value` is the raw text right of `=`, and
    /// `None` removes the statement. A repeated key is read and written at its first
    /// statement, the one the game takes. The inverse carries the text displaced.
    SetHeaderField {
        key: String,
        value: Option<String>,
    },
    /// Several header keys as one undo step, each as [`Op::SetHeaderField`] with `Some`.
    /// A key listed twice is refused. The inverse omits a key this added: it describes the
    /// change, and undo puts the bytes back exactly. Scenario documents only.
    SetHeaderKeys {
        entries: Vec<(String, String)>,
    },
    /// Every statement of one repeated header key as one undo step: one per value, in
    /// order, where the first stood, none when `values` is empty. Each value is the raw
    /// text right of `=`; the inverse carries the values held. Scenario documents only.
    SetHeaderList {
        key: String,
        values: Vec<String>,
    },
    /// The `base` of a system's `spawn_weight`: `None` removes it, and the statement with
    /// it when no `modifier` remains. A base that is not a number inverts to `None`.
    /// Scenario documents only.
    SetSpawnWeight {
        id: u32,
        base: Option<f64>,
    },
    /// Several systems' spawn weights as one undo step, each entry following the
    /// [`Op::SetSpawnWeight`] rules. Scenario documents only.
    SetSpawnWeights {
        entries: Vec<(u32, Option<f64>)>,
    },
    /// The scripted seat a system's `spawn_weight` states; `None` removes the statement.
    /// A system with no `initializer` gets the dialect's basic one, which the inverse
    /// omits: undo puts the bytes back exactly. Scenario documents only.
    SetSpawnScript {
        id: u32,
        script: Option<SpawnScript>,
    },
    /// Several systems' scripted seats as one undo step, each entry following the
    /// [`Op::SetSpawnScript`] rules. Scenario documents only.
    SetSpawnScripts {
        entries: Vec<(u32, Option<SpawnScript>)>,
    },
    /// The Paint a Galaxy fallen empire zone a system anchors; `None` clears it. A zone
    /// whose ring holds another system, or whose centre lies off the map, is refused: the
    /// mod builds the fallen empire's systems in that ring. Scenario documents only.
    SetFeZone {
        id: u32,
        zone: Option<FeZone>,
    },
    /// Several systems' fallen empire zones as one undo step, each entry following the
    /// [`Op::SetFeZone`] rules. Scenario documents only.
    SetFeZones {
        entries: Vec<(u32, Option<FeZone>)>,
    },
    /// The Paint a Galaxy wormhole pair joining `a` and `b`; `None` unpairs both. The two
    /// must differ and exist, and a number another system carries is refused. The inverse
    /// puts both ends' old pairs back, each as its own entry. Scenario documents only.
    SetWormholePair {
        a: u32,
        b: u32,
        pair: Option<u32>,
    },
    /// One system's wormhole pair alone: what a [`Op::SetWormholePair`] inverts to when
    /// the two ends held different numbers, or one held none. Scenario documents only.
    SetWormholeEnds {
        entries: Vec<(u32, Option<u32>)>,
    },
    /// The systems Paint a Galaxy lays a hyperlane from into the zone `anchor` anchors,
    /// empty to clear; `anchor` must anchor a zone and may not be in `linked`. Inverts to
    /// a [`Op::SetFeLinkFlags`] over the systems written. Scenario documents only.
    SetFeLinks {
        anchor: u32,
        linked: Vec<u32>,
    },
    /// Several systems' custom connection flags, each set exactly as given: what a
    /// [`Op::SetFeLinks`] inverts to, and the way to a state the mod reads oddly, such
    /// as the custom flag without an id. Scenario documents only.
    SetFeLinkFlags {
        entries: Vec<(u32, FeLinkFlags)>,
    },
    /// One `prevent_hyperlane` statement, barring the generator from linking `a` and `b`.
    /// A pair the file already links is refused: a file that both lays and forbids a lane
    /// leaves the generator undefined, so the lane goes first. Scenario documents only.
    PreventLane {
        a: u32,
        b: u32,
    },
    /// Every `prevent_hyperlane` naming `a` and `b`, whichever way round. Scenario
    /// documents only.
    UnpreventLane {
        a: u32,
        b: u32,
    },
    /// The L-Cluster outcome a save's global flags hold: every outcome flag goes, and the
    /// chosen outcome's flags are written dated like `game_started`. Refused for a galaxy
    /// with no L-Gate and once a gate has opened. Save documents only.
    SetLGateOutcome {
        outcome: LGateOutcome,
    },
    /// A save system's `star_class` and the `planet_class` of each of its star bodies,
    /// each written as given. Which bodies are stars and what they become is the caller's
    /// to say from the install's star classes; each must be one the system lists, once.
    /// The inverse carries the class and body classes displaced. Save documents only.
    SetStarClass {
        id: u32,
        class: String,
        bodies: Vec<StarBody>,
    },
    /// Several ops as one edit and one undo step, applied in order; a refused member
    /// leaves the document as it was before the first. Not nested.
    Batch {
        description: String,
        ops: Vec<Op>,
    },
}

impl Op {
    /// The variant's name, for an error that has to name the op.
    pub fn name(&self) -> &'static str {
        match self {
            Self::MoveSystem { .. } => "MoveSystem",
            Self::AddLane { .. } => "AddLane",
            Self::AddLanes { .. } => "AddLanes",
            Self::RemoveLane { .. } => "RemoveLane",
            Self::RemoveLanes { .. } => "RemoveLanes",
            Self::SetLaneLength { .. } => "SetLaneLength",
            Self::IsolateSystem { .. } => "IsolateSystem",
            Self::MoveSystems { .. } => "MoveSystems",
            Self::AddLanePairs { .. } => "AddLanePairs",
            Self::RemoveLanePairs { .. } => "RemoveLanePairs",
            Self::IsolateSystems { .. } => "IsolateSystems",
            Self::SetLaneLengths { .. } => "SetLaneLengths",
            Self::NormaliseLaneLength { .. } => "NormaliseLaneLength",
            Self::NormaliseLaneLengths { .. } => "NormaliseLaneLengths",
            Self::MoveNebula { .. } => "MoveNebula",
            Self::AddNebula { .. } => "AddNebula",
            Self::RemoveNebula { .. } => "RemoveNebula",
            Self::SetNebulaRadius { .. } => "SetNebulaRadius",
            Self::SetNebulaName { .. } => "SetNebulaName",
            Self::AddSystem { .. } => "AddSystem",
            Self::RemoveSystem { .. } => "RemoveSystem",
            Self::AddSystems { .. } => "AddSystems",
            Self::RemoveSystems { .. } => "RemoveSystems",
            Self::SetSystemName { .. } => "SetSystemName",
            Self::SetInitializer { .. } => "SetInitializer",
            Self::SetInitializers { .. } => "SetInitializers",
            Self::SetHeaderField { .. } => "SetHeaderField",
            Self::SetHeaderKeys { .. } => "SetHeaderKeys",
            Self::SetHeaderList { .. } => "SetHeaderList",
            Self::SetSpawnWeight { .. } => "SetSpawnWeight",
            Self::SetSpawnWeights { .. } => "SetSpawnWeights",
            Self::SetSpawnScript { .. } => "SetSpawnScript",
            Self::SetSpawnScripts { .. } => "SetSpawnScripts",
            Self::SetFeZone { .. } => "SetFeZone",
            Self::SetFeZones { .. } => "SetFeZones",
            Self::SetWormholePair { .. } => "SetWormholePair",
            Self::SetWormholeEnds { .. } => "SetWormholeEnds",
            Self::SetFeLinks { .. } => "SetFeLinks",
            Self::SetFeLinkFlags { .. } => "SetFeLinkFlags",
            Self::PreventLane { .. } => "PreventLane",
            Self::UnpreventLane { .. } => "UnpreventLane",
            Self::SetLGateOutcome { .. } => "SetLGateOutcome",
            Self::SetStarClass { .. } => "SetStarClass",
            Self::Batch { .. } => "Batch",
        }
    }

    /// Whether this op leaves the details of the systems it touched stale. The
    /// projection is keyed by the systems the graph holds, so an op that adds or removes
    /// one stales it, and a scenario system's planets and resources come from its
    /// initializer, so an op that writes one stales it too, a scripted seat included
    /// because it may bring an initializer with it. A save's details list a star's
    /// bodies, whose classes [`Op::SetStarClass`] writes.
    pub fn stales_details(&self) -> bool {
        match self {
            Self::SetStarClass { .. }
            | Self::AddSystem { .. }
            | Self::RemoveSystem { .. }
            | Self::AddSystems { .. }
            | Self::RemoveSystems { .. }
            | Self::SetInitializer { .. }
            | Self::SetInitializers { .. }
            | Self::SetSpawnScript { .. }
            | Self::SetSpawnScripts { .. } => true,
            Self::Batch { ops, .. } => ops.iter().any(Self::stales_details),
            _ => false,
        }
    }

    /// Whether the details this op stales come up to date by rereading the classes of the
    /// planets it rewrote, without building the projection again.
    pub fn stales_only_planet_classes(&self) -> bool {
        match self {
            Self::SetStarClass { .. } => true,
            Self::Batch { ops, .. } => ops
                .iter()
                .all(|op| op.stales_only_planet_classes() || !op.stales_details()),
            _ => false,
        }
    }

    /// Whether this op can have moved how the systems it touched are classified: the
    /// initializer a classification is read from, the name it is labelled by, or the
    /// star flags the scripts place a wormhole by.
    pub fn reclassifies(&self) -> bool {
        match self {
            Self::SetSystemName { .. }
            | Self::SetWormholePair { .. }
            | Self::SetWormholeEnds { .. } => true,
            Self::SetStarClass { .. } => false,
            Self::Batch { ops, .. } => ops.iter().any(Self::reclassifies),
            _ => self.stales_details(),
        }
    }
}

/// One system's initializer in [`Op::SetInitializers`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InitializerSet {
    pub id: u32,
    pub initializer: Option<String>,
}

/// One star body's new planet class in [`Op::SetStarClass`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StarBody {
    pub planet: u32,
    pub class: String,
}

/// One system to add in [`Op::AddSystems`]: an [`Op::AddSystem`] with its id given.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewSystem {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub name: Option<String>,
    pub initializer: Option<String>,
    pub spawn_weight: Option<f64>,
    #[serde(default)]
    pub spawn_script: Option<SpawnScript>,
    /// The whole `system` statement, written as it stands instead of one built from the
    /// fields, which then only describe it: what a removal's inverse carries. It must
    /// read as one `system` statement with this id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub statement: Option<String>,
}

/// One system's destination in [`Op::MoveSystems`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemMove {
    pub id: u32,
    pub x: f64,
    pub y: f64,
}

/// One lane to add in [`Op::AddLanePairs`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LanePair {
    pub a: u32,
    pub b: u32,
    pub bridge: bool,
}

/// One lane's new length in [`Op::SetLaneLengths`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LaneLength {
    pub a: u32,
    pub b: u32,
    pub length: f64,
}

#[derive(Debug, thiserror::Error)]
pub enum OpError {
    #[error("system {0} does not exist")]
    UnknownSystem(u32),
    #[error("system {0} already exists")]
    SystemExists(u32),
    #[error("{0} is the null id, which no system may take")]
    NullSystemId(u32),
    #[error("name {0:?} may not hold a quote, a backslash or a line break")]
    InvalidName(String),
    #[error("a name may not be empty")]
    EmptyName,
    #[error("nebula {0} does not exist")]
    UnknownNebula(usize),
    #[error("system {0} cannot have a lane to itself")]
    SelfLane(u32),
    #[error("systems {0} and {1} are already linked")]
    LaneExists(u32, u32),
    #[error("systems {0} and {1} are not linked")]
    NoSuchLane(u32, u32),
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
    #[error("a reserved seat is named by one letter, not {0:?}")]
    InvalidSeatLetter(String),
    #[error(
        "an enabled seat has no marker to make it the player's; choose a preferred, Sol or reserved seat"
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
    #[error("no lanes given")]
    Empty,
    #[error("a batch with nothing in it")]
    EmptyBatch,
    #[error("a batch may not hold another batch")]
    NestedBatch,
    #[error("system {0} is listed more than once")]
    DuplicateSystem(u32),
    #[error("lane {0} <-> {1} is listed more than once")]
    DuplicateLane(u32, u32),
    #[error("system {system}: {reason} at byte {offset}")]
    Parse {
        system: u32,
        offset: usize,
        reason: String,
    },
    #[error("nebula {nebula}: {reason} at byte {offset}")]
    NebulaParse {
        nebula: usize,
        offset: usize,
        reason: String,
    },
    #[error("scenario header: {reason} at byte {offset}")]
    HeaderParse { offset: usize, reason: String },
    #[error("global flags: {reason} at byte {offset}")]
    FlagsParse { offset: usize, reason: String },
    #[error("planet {planet}: {reason} at byte {offset}")]
    PlanetParse {
        planet: u32,
        offset: usize,
        reason: String,
    },
    #[error("the document has no global flags")]
    NoFlags,
    #[error("the galaxy has no L-Gate")]
    NoLGate,
    #[error("a gate has opened: the outcome has already spawned")]
    LGateOpened,
    #[error("the L-Gate outcome is already {0}")]
    LGateUnchanged(&'static str),
    #[error("planet {0} does not exist")]
    UnknownPlanet(u32),
    #[error("a star class may not be empty")]
    EmptyStarClass,
    #[error("planet {0}'s class may not be empty")]
    EmptyPlanetClass(u32),
    #[error("class {0:?} may not hold a quote, a backslash or a line break")]
    InvalidClass(String),
    #[error("no star bodies given")]
    NoStarBodies,
    #[error("planet {planet} is not a body of system {system}")]
    NotABody { planet: u32, system: u32 },
    #[error("planet {0} is listed more than once")]
    DuplicatePlanet(u32),
    #[error("system {0} is already {1} with those star bodies")]
    StarClassUnchanged(u32, String),
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
