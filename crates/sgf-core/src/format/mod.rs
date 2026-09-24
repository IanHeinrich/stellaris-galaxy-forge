//! The one dispatch point between the document kinds.
//!
//! Everything a `.sav` and a scenario script do differently (projecting the galaxy,
//! finding the statement an entity lives in, re-reading it after an edit, planning an op
//! and writing the file back) is a method of [`Format`], or lives under `save/` and
//! `scenario/` where only that format's own code reaches it. The rest of the crate asks
//! the format, not the kind.

pub mod save;
pub mod scenario;

use std::path::{Path, PathBuf};

use crate::cst::{CstError, Node};
use crate::document::{self, Document};
use crate::ops::{Op, OpError, Plan, Planned, Subject};
use crate::overlay::Anchor;
use crate::projections::galaxy::{GalaxyGraph, ProjectionError};
use crate::session::Session;
use crate::validate::Issue;
use crate::views::{Capabilities, DocumentKind};

pub(crate) trait Format: Sync {
    /// Project the galaxy the map draws from the document as loaded.
    fn build_graph(&self, doc: &Document) -> Result<GalaxyGraph, ProjectionError>;

    /// Parse one statement's bytes the way this format's text reads.
    fn parse(&self, bytes: &[u8], base: usize) -> Result<Node, CstError>;

    /// The statement holding the subject's bytes.
    fn statement(&self, doc: &Document, subject: Subject) -> Result<Anchor, OpError>;

    /// Re-extract each touched entity from its current bytes; `slots` are the overlay
    /// slots the edit wrote. Returns the systems a nebula edit reassigned, which the op
    /// owes the map alongside what it rewrote.
    fn refresh(
        &self,
        doc: &mut Document,
        graph: &mut GalaxyGraph,
        touched: &[Subject],
        slots: &[Anchor],
    ) -> Result<Vec<Subject>, OpError>;

    /// Plan `op`: the edits it makes, its description and its inverse, or
    /// [`OpError::Unsupported`] before anything is planned when this format does not take
    /// it.
    fn write(&self, plan: &mut Plan, session: &Session, op: &Op) -> Result<Planned, OpError>;

    /// Plan the second step of an op that needs the slots its first step freed, once that
    /// step is committed; `None` for an op of one step.
    fn follow_up(
        &self,
        _plan: &mut Plan,
        _session: &Session,
        _op: &Op,
    ) -> Result<Option<Planned>, OpError> {
        Ok(None)
    }

    /// Write the document's current bytes to `path`, returning the backup it displaced.
    fn save(
        &self,
        doc: &Document,
        path: &Path,
        progress: &mut dyn FnMut(f64),
    ) -> Result<Option<PathBuf>, document::Error>;

    /// What the document calls itself: the empire name, or the scenario's `name`.
    fn title(&self, doc: &Document) -> String;

    /// Issues that come from the document rather than from the projection.
    fn issues(&self, doc: &Document) -> Vec<Issue>;

    /// Whether the document holds the planets, stations and fleets the details
    /// projection is built from.
    fn has_details(&self) -> bool {
        self.capabilities().details
    }

    /// Whether an entity of this format is described by the inspector's curated rows.
    fn curates_entities(&self) -> bool;

    /// The layers, tabs and ops the app may offer for this format.
    fn capabilities(&self) -> Capabilities;
}

pub(crate) fn of(kind: DocumentKind) -> &'static dyn Format {
    match kind {
        DocumentKind::Save => &save::Save,
        DocumentKind::Scenario => &scenario::Scenario,
    }
}
