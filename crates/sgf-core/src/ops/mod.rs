//! Edit operations: every edit is an [`Op`] with an inverse and a description.
//!
//! One overlay slot per `galactic_object` entity and per top-level `nebula` section.
//! The commit is atomic: the document is unchanged on error.

mod edit;
pub mod history;
pub(crate) mod rules;

use std::collections::BTreeMap;
use std::collections::btree_map::Entry;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::Span;
use crate::cst;
use crate::document::{self, Document};
use crate::format;
use crate::format::scenario::FeZone;
use crate::overlay::{Anchor, OverlayError};
use crate::projections::galaxy::{
    GalaxyGraph, Lane, ProjectionError, SpawnReservationPreset, SpawnScript,
};
use crate::session::Session;
use crate::views::DocumentKind;

pub(crate) use edit::{Edit, replace_lengths};
pub use edit::{EntityKind, Subject};
use edit::{load, splice};

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
    /// The `index`th nebula's centre to (x, y). Nothing else moves: a save rewrites the
    /// member lines to the systems the radius now covers, a system leaving for whatever
    /// other cloud covers it, and lane lengths are untouched. Its own inverse in effect,
    /// the move back restoring the lists.
    MoveNebula {
        index: usize,
        x: f64,
        y: f64,
    },
    /// A new nebula centred on (x, y), which lands last and so takes the index
    /// `nebulae.len()`. `name` is the save's `key=` or the scenario's `name =`, empty
    /// when `None`. Every system its radius reaches joins it, leaving the cloud that
    /// held it.
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
    /// The `index`th nebula's name, where the document keeps it: the save's
    /// `name={ key="…" }`, the scenario's `name = "…"`. The text is written as it stands,
    /// so a cloud named by a localisation key is left naming the text instead. Empty is
    /// refused; the inverse carries the name it displaced.
    SetNebulaName {
        index: usize,
        name: String,
    },
    /// A new `system` statement. Scenario documents only: a save's systems come with
    /// planets, a starbase and an owner, none of which an op can invent.
    /// `id` defaults to one past the highest the document holds. `spawn_weight` follows
    /// the [`Op::SetInitializer`] rule: `Some(w)` writes `spawn_weight = { base = w }`,
    /// `None` writes nothing.
    AddSystem {
        id: Option<u32>,
        x: f64,
        y: f64,
        name: Option<String>,
        initializer: Option<String>,
        spawn_weight: Option<f64>,
    },
    /// A system and every hyperlane statement naming it, `prevent_hyperlane` included so
    /// no statement is left naming a system that is gone. Scenario documents only. The
    /// inverse names the id, position, name, initializer and spawn weight (best effort,
    /// `None` when the removed one had a modifier); undo puts the bytes back exactly, the
    /// inverse only describes the change.
    RemoveSystem {
        id: u32,
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
    /// One header key: its statement rewritten in place, inserted before the first system
    /// statement when the header lacks it, or removed whole when `value` is `None`.
    /// `value` is the raw text right of `=`, written as it stands. A repeated key is
    /// read and written at its first statement, which is the one the game takes. The
    /// inverse carries the raw text this displaced, or `None` when it added the key.
    /// Scenario documents only.
    SetHeaderField {
        key: String,
        value: Option<String>,
    },
    /// Several header keys as one undo step, each written as [`Op::SetHeaderField`]
    /// writes one with `Some`: rewritten in place, or inserted before the first system
    /// when the header lacks it. A key listed twice is refused. The inverse carries the
    /// raw text each key displaced, so a key this added is not among them: undo puts
    /// the bytes back exactly, the inverse only describes the change. Scenario
    /// documents only.
    SetHeaderKeys {
        entries: Vec<(String, String)>,
    },
    /// The `base` of a system's `spawn_weight`, the weight the generator places an empire
    /// by; `None` removes it, and with it the preset reservation
    /// [`Op::SetSpawnReservation`] writes, and the whole statement when no other
    /// `modifier` remains. The modifiers the map author wrote are left byte for byte. A
    /// base the reader cannot read as a number, `base = { min = 1 max = 2 }`, is rewritten
    /// whole and inverts to `None`. The inverse names the base alone, so a reservation
    /// cleared with it comes back from the bytes undo replays, not from the op.
    /// Scenario documents only.
    SetSpawnWeight {
        id: u32,
        base: Option<f64>,
    },
    /// Several systems' spawn weights as one undo step, each entry an id and the base to
    /// write there; every entry follows the [`Op::SetSpawnWeight`] rules. Scenario
    /// documents only.
    SetSpawnWeights {
        entries: Vec<(u32, Option<f64>)>,
    },
    /// Which preset reservation the system carries, the two being exclusive:
    /// [`SpawnReservationPreset::Human`] writes `modifier = { factor = 0 is_ai = yes }`
    /// into its `spawn_weight`, [`SpawnReservationPreset::Ai`] the mirror with
    /// `is_ai = no`, each taking the other back, and `None` takes back whichever stands.
    /// A block the system has not got is written with `base = 1`. A modifier that tests
    /// `is_ai` in a shape this editor does not read is refused rather than written
    /// beside; every other modifier is left byte for byte. Scenario documents only.
    SetSpawnReservation {
        id: u32,
        reserve: Option<SpawnReservationPreset>,
    },
    /// The scripted seat a system's `spawn_weight` states, in the dialect the script
    /// names: `Some` writes the whole statement afresh in that dialect's exact text,
    /// where the one standing was or beside the initializer when there was none, and
    /// writes the dialect's basic starting initializer beside it when the system names
    /// no `initializer`; `None` removes the `spawn_weight` statement. The `effect`
    /// block is left byte for byte. The inverse names the script alone, so an
    /// initializer written with it comes back from the bytes undo replays, not from
    /// the op. Scenario documents only.
    SetSpawnScript {
        id: u32,
        script: Option<SpawnScript>,
    },
    /// Several systems' scripted seats as one undo step, each entry an id and the
    /// script to write there; every entry follows the [`Op::SetSpawnScript`] rules.
    /// Scenario documents only.
    SetSpawnScripts {
        entries: Vec<(u32, Option<SpawnScript>)>,
    },
    /// The Paint a Galaxy fallen empire zone a system anchors: `Some` takes every zone
    /// flag out of the system's `effect` block and writes the zone's flags at its end,
    /// writing the block when the system has none; `None` takes the zone flags out, and
    /// the block with them when nothing else stood in it. Every other statement of the
    /// block is left byte for byte. A zone whose ring holds another system, or whose
    /// centre lies off the map, is refused: the mod builds the fallen empire's systems
    /// in that ring at game start. Scenario documents only.
    SetFeZone {
        id: u32,
        zone: Option<FeZone>,
    },
    /// Several systems' fallen empire zones as one undo step, each entry an id and the
    /// zone to write there; every entry follows the [`Op::SetFeZone`] rules. Scenario
    /// documents only.
    SetFeZones {
        entries: Vec<(u32, Option<FeZone>)>,
    },
    /// The Paint a Galaxy wormhole pair joining `a` and `b`: `Some(n)` takes every
    /// wormhole flag off both systems and writes `painted_galaxy_wormhole_n` with
    /// `empire_cluster` beside it on each; `None` takes the wormhole flags off both.
    /// An `empire_cluster` goes with the wormhole flag it stands right after, and any
    /// other is left where it is. The two systems must differ and exist, and a number
    /// another system already carries is refused. The inverse puts both systems' pairs
    /// back, each as its own entry. Scenario documents only.
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
            Self::SetSystemName { .. } => "SetSystemName",
            Self::SetInitializer { .. } => "SetInitializer",
            Self::SetInitializers { .. } => "SetInitializers",
            Self::SetHeaderField { .. } => "SetHeaderField",
            Self::SetHeaderKeys { .. } => "SetHeaderKeys",
            Self::SetSpawnWeight { .. } => "SetSpawnWeight",
            Self::SetSpawnWeights { .. } => "SetSpawnWeights",
            Self::SetSpawnReservation { .. } => "SetSpawnReservation",
            Self::SetSpawnScript { .. } => "SetSpawnScript",
            Self::SetSpawnScripts { .. } => "SetSpawnScripts",
            Self::SetFeZone { .. } => "SetFeZone",
            Self::SetFeZones { .. } => "SetFeZones",
            Self::SetWormholePair { .. } => "SetWormholePair",
            Self::SetWormholeEnds { .. } => "SetWormholeEnds",
            Self::PreventLane { .. } => "PreventLane",
            Self::UnpreventLane { .. } => "UnpreventLane",
        }
    }

    /// Whether this op leaves the details of the systems it touched stale. The
    /// projection is keyed by the systems the graph holds, so an op that adds or removes
    /// one stales it, and a scenario system's planets and resources come from its
    /// initializer, so an op that writes one stales it too, a scripted seat included
    /// because it may bring an initializer with it. A save's details are read from
    /// sections no op writes, which is why none of these ops is one a save takes.
    pub const fn stales_details(&self) -> bool {
        matches!(
            self,
            Self::AddSystem { .. }
                | Self::RemoveSystem { .. }
                | Self::SetInitializer { .. }
                | Self::SetInitializers { .. }
                | Self::SetSpawnScript { .. }
                | Self::SetSpawnScripts { .. }
        )
    }

    /// Whether this op can have moved how the systems it touched are classified: the
    /// initializer a classification is read from, the name it is labelled by, or the
    /// star flags the scripts place a wormhole by.
    pub const fn reclassifies(&self) -> bool {
        self.stales_details()
            || matches!(
                self,
                Self::SetSystemName { .. }
                    | Self::SetWormholePair { .. }
                    | Self::SetWormholeEnds { .. }
            )
    }
}

/// One system's initializer in [`Op::SetInitializers`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InitializerSet {
    pub id: u32,
    pub initializer: Option<String>,
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

/// The record of one committed op: what changed, how to describe it, and the bytes
/// needed to undo and redo it without re-running the op.
#[derive(Debug, Clone, PartialEq)]
pub struct Applied {
    pub op: Op,
    pub description: String,
    pub inverse: Op,
    /// Per replaced statement: the slot content it displaced (`None` = the original).
    pub before: Vec<(Anchor, Option<Vec<u8>>)>,
    /// Per replaced statement: the bytes now standing for it.
    pub after: Vec<(Anchor, Vec<u8>)>,
    /// The entities the op rewrote and the systems its nebula edits reassigned, sorted
    /// and deduplicated.
    pub touched: Vec<Subject>,
}

#[derive(Debug, thiserror::Error)]
pub enum OpError {
    #[error("system {0} does not exist")]
    UnknownSystem(u32),
    #[error("system {0} already exists")]
    SystemExists(u32),
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
    #[error("a reserved seat is named by one letter, not {0:?}")]
    InvalidSeatLetter(String),
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
    #[error("no lanes given")]
    Empty,
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

/// Apply `op` to the session's document and projection.
pub fn apply(session: &mut Session, op: Op) -> Result<Applied, OpError> {
    let format = session.format();
    if !format.supports(&op) {
        return Err(OpError::Unsupported {
            op: op.name(),
            kind: session.kind(),
        });
    }
    let mut plan = Plan::new();
    let planned = format.write(&mut plan, session, &op)?;
    plan.commit(session, op, planned)
}

/// What a planner returns once it has planned its edits: an inverse cannot be forgotten.
pub(crate) struct Planned {
    pub description: String,
    pub inverse: Op,
}

/// What a statement an op emits will stand for; its [`Subject`] needs the anchor the
/// overlay only hands out once the text is in.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Emitted {
    System(u32),
    Lane(u32, u32),
    /// A whole `nebula` statement, which lands last and so knows its own index.
    Nebula(usize),
    /// A header statement a key the file lacked was written as.
    Header,
}

impl Emitted {
    fn subject(self, anchor: Anchor) -> Subject {
        match self {
            Self::System(id) => Subject::System(id),
            Self::Nebula(index) => Subject::Nebula(index),
            Self::Lane(a, b) => Subject::Statement {
                anchor,
                ends: (a, b),
            },
            Self::Header => Subject::Header(anchor),
        }
    }
}

/// A planned op: one edit per entity it rewrites, keyed by what that entity stands for,
/// plus the statements it emits whole.
pub(crate) struct Plan {
    edits: BTreeMap<Subject, Edit>,
    emits: Vec<(Emitted, usize, Vec<u8>)>,
}

impl Plan {
    fn new() -> Self {
        Self {
            edits: BTreeMap::new(),
            emits: Vec::new(),
        }
    }

    /// The edit for system `id`, loading and parsing its entity on first use.
    pub fn edit(&mut self, doc: &Document, id: u32) -> Result<&mut Edit, OpError> {
        self.subject(doc, Subject::System(id))
    }

    /// The edit for the `index`th `nebula` section, loading and parsing it on first use.
    pub fn edit_nebula(&mut self, doc: &Document, index: usize) -> Result<&mut Edit, OpError> {
        self.subject(doc, Subject::Nebula(index))
    }

    /// The edit for one header statement, loading and parsing it on first use.
    pub fn edit_header(&mut self, doc: &Document, anchor: Anchor) -> Result<&mut Edit, OpError> {
        self.subject(doc, Subject::Header(anchor))
    }

    /// Emit `bytes` as a new statement at original offset `at`.
    pub fn emit(&mut self, what: Emitted, at: usize, bytes: Vec<u8>) {
        self.emits.push((what, at, bytes));
    }

    /// Leave nothing where the statement at `anchor` stands. An original statement alone
    /// on its line takes the line with it, so the slot is the line rather than the
    /// statement; an inserted one empties its own slot.
    pub fn erase(
        &mut self,
        doc: &Document,
        subject: Subject,
        anchor: Anchor,
    ) -> Result<(), OpError> {
        let slot = erasure_slot(doc, anchor);
        let Entry::Vacant(vacant) = self.edits.entry(subject) else {
            return Ok(());
        };
        let edit = vacant.insert(load(doc, subject, slot)?);
        let end = edit.buf.len();
        edit.splices.push((0..end, Vec::new()));
        Ok(())
    }

    fn subject(&mut self, doc: &Document, subject: Subject) -> Result<&mut Edit, OpError> {
        match self.edits.entry(subject) {
            Entry::Occupied(e) => Ok(e.into_mut()),
            Entry::Vacant(e) => Ok(e.insert(load(doc, subject, statement(doc, subject)?)?)),
        }
    }

    fn commit(self, session: &mut Session, op: Op, planned: Planned) -> Result<Applied, OpError> {
        let mut before = Vec::new();
        let mut after = Vec::new();
        let mut touched = Vec::new();
        let mut replacements = Vec::new();
        for (subject, edit) in self.edits {
            if edit.splices.is_empty() {
                continue;
            }
            let new_buf = splice(subject, &edit.buf, edit.splices)?;
            replacements.push((subject, edit.stmt, new_buf));
        }
        for (subject, stmt, new_buf) in replacements {
            match session.doc.replace(stmt, new_buf.clone()) {
                Ok(prev) => {
                    before.push((stmt, prev));
                    after.push((stmt, new_buf));
                    touched.push(subject);
                }
                Err(e) => {
                    rollback(session, &before, &touched);
                    return Err(e.into());
                }
            }
        }
        for (what, at, bytes) in self.emits {
            match session.doc.insert(at, bytes.clone()) {
                Ok(anchor) => {
                    before.push((anchor, None));
                    after.push((anchor, bytes));
                    touched.push(what.subject(anchor));
                }
                Err(e) => {
                    rollback(session, &before, &touched);
                    return Err(e.into());
                }
            }
        }
        match refresh(&mut session.doc, &mut session.graph, &touched) {
            Ok(reassigned) => {
                touched.extend(reassigned);
                touched.sort_unstable();
                touched.dedup();
            }
            Err(e) => {
                rollback(session, &before, &touched);
                return Err(e);
            }
        }
        Ok(Applied {
            op,
            description: planned.description,
            inverse: planned.inverse,
            before,
            after,
            touched,
        })
    }
}

/// The lane `a`-`b` as the projection lists it on either end.
pub(crate) fn projected_lane(graph: &GalaxyGraph, a: u32, b: u32) -> Option<&Lane> {
    graph.lane(a, b).or_else(|| graph.lane(b, a))
}

/// Put back `before` (in reverse) and re-project what it covers.
fn rollback(session: &mut Session, before: &[(Anchor, Option<Vec<u8>>)], touched: &[Subject]) {
    for (anchor, prev) in before.iter().rev() {
        session.doc.restore(*anchor, prev.clone());
    }
    // The bytes being restored were projected successfully before the op began.
    let _ = refresh(&mut session.doc, &mut session.graph, touched);
}

/// Re-extract each touched entity from its current bytes, as the document's format
/// reads them. Returns the systems a nebula edit reassigned.
pub(crate) fn refresh(
    doc: &mut Document,
    graph: &mut GalaxyGraph,
    touched: &[Subject],
) -> Result<Vec<Subject>, OpError> {
    format::of(doc.kind()).refresh(doc, graph, touched)
}

/// The statement holding the subject's bytes.
fn statement(doc: &Document, subject: Subject) -> Result<Anchor, OpError> {
    format::of(doc.kind()).statement(doc, subject)
}

/// The slot an erasure replaces: the whole line for an original statement that has it to
/// itself, so that no blank line is left behind, and the statement's own span otherwise.
/// A trailing comment belongs to the line, and so goes with it. A statement an earlier op
/// rewrote already owns a slot, which nothing may overlap, so it keeps its span and leaves
/// its line blank.
fn erasure_slot(doc: &Document, anchor: Anchor) -> Anchor {
    let Anchor::Original(span) = anchor else {
        return anchor;
    };
    let rewritten = doc
        .overlay()
        .slots()
        .any(|(slot, _)| !slot.is_inserted() && slot.start() == span.start);
    if rewritten {
        return anchor;
    }
    let src = doc.original();
    let line = Span::new(
        cst::line_start(src, span.start),
        cst::line_end(src, span.end),
    );
    let blank = |&b: &u8| b == b'\t' || b == b' ';
    let before = src[line.start..span.start].iter().all(blank);
    let after = match src[span.end..line.end].iter().position(|&b| b == b'#') {
        Some(comment) => src[span.end..span.end + comment].iter().all(blank),
        None => src[span.end..line.end]
            .iter()
            .all(|&b| blank(&b) || b == b'\n'),
    };
    if before && after {
        Anchor::Original(line)
    } else {
        anchor
    }
}
