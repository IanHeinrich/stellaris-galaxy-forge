//! Edit operations: every edit is an [`Op`] with an inverse and a description.
//!
//! One overlay slot per `galactic_object` entity and per top-level `nebula` section.
//! The commit is atomic: the document is unchanged on error.

mod edit;
pub mod history;
pub mod rules;

use std::collections::BTreeMap;
use std::collections::btree_map::Entry;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::Span;
use crate::cst;
use crate::document::{self, Document};
use crate::format;
use crate::format::scenario::{FeLinkFlags, FeZone};
use crate::overlay::{Anchor, OverlayError};
use crate::projections::galaxy::{GalaxyGraph, Lane, ProjectionError, SpawnScript};
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
    /// Scenario documents only. The inverse describes the change (the spawn weight best
    /// effort, `None` when a modifier stood); undo puts the bytes back exactly.
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
            Self::Batch { .. } => "Batch",
        }
    }

    /// Whether this op leaves the details of the systems it touched stale. The
    /// projection is keyed by the systems the graph holds, so an op that adds or removes
    /// one stales it, and a scenario system's planets and resources come from its
    /// initializer, so an op that writes one stales it too, a scripted seat included
    /// because it may bring an initializer with it. A save's details are read from
    /// sections no op writes, which is why none of these ops is one a save takes.
    pub fn stales_details(&self) -> bool {
        match self {
            Self::AddSystem { .. }
            | Self::RemoveSystem { .. }
            | Self::SetInitializer { .. }
            | Self::SetInitializers { .. }
            | Self::SetSpawnScript { .. }
            | Self::SetSpawnScripts { .. } => true,
            Self::Batch { ops, .. } => ops.iter().any(Self::stales_details),
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
    match op {
        Op::Batch { description, ops } => apply_batch(session, description, ops),
        op => apply_one(session, op),
    }
}

fn apply_one(session: &mut Session, op: Op) -> Result<Applied, OpError> {
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

fn apply_batch(
    session: &mut Session,
    description: String,
    ops: Vec<Op>,
) -> Result<Applied, OpError> {
    if ops.is_empty() {
        return Err(OpError::EmptyBatch);
    }
    if ops.iter().any(|op| matches!(op, Op::Batch { .. })) {
        return Err(OpError::NestedBatch);
    }
    let op = Op::Batch {
        description: description.clone(),
        ops: ops.clone(),
    };
    let mut members: Vec<Applied> = Vec::with_capacity(ops.len());
    for member in ops {
        match apply_one(session, member) {
            Ok(applied) => members.push(applied),
            Err(e) => {
                let before: Vec<_> = members.iter().flat_map(|m| m.before.clone()).collect();
                let touched: Vec<_> = members.iter().flat_map(|m| m.touched.clone()).collect();
                rollback(session, &before, &touched);
                return Err(e);
            }
        }
    }
    let mut inverses = Vec::with_capacity(members.len());
    let mut before = Vec::new();
    let mut after = Vec::new();
    let mut touched = Vec::new();
    for member in members {
        inverses.push(member.inverse);
        before.extend(member.before);
        after.extend(member.after);
        touched.extend(member.touched);
    }
    inverses.reverse();
    touched.sort_unstable();
    touched.dedup();
    Ok(Applied {
        op,
        description: description.clone(),
        inverse: Op::Batch {
            description,
            ops: inverses,
        },
        before,
        after,
        touched,
    })
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
