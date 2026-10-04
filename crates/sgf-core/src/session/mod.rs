//! The one object the CLI and the app hold: document + projection + history.
//!
//! Every edit goes through [`Session::apply`], which runs the op, records it for
//! undo and validates the projection. Undo and redo replay recorded bytes.
//!
//! The details projection is built on first use. An op that stales it (`Op::reach`) has
//! what it staled read again in place when it can, and otherwise the projection is built
//! again. A scenario has no details sections at all: its systems' planets and resources come
//! from the initializer, which the app resolves through game data.

mod details;
mod edit;
mod file;
mod game_data;
mod query;
mod report;

use std::cell::OnceCell;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::document::{self, Document};
use crate::format::save::details::DetailsProjection;
use crate::format::{self, Format};
use crate::ops::history::History;
use crate::ops::{Op, Subject, SystemRadii};
use crate::projections::galaxy::{
    BypassLink, GalaxyGraph, ProjectionError, StarClasses, SystemNode, Wayline,
};
use crate::validate::{self, Issue, validate};
use crate::views::{DocumentKind, ErrorKind, HistoryEntry, HistoryView, SgfError};
use file::DiskStamp;

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error(transparent)]
    Document(#[from] document::Error),
    #[error(transparent)]
    Projection(#[from] ProjectionError),
}

impl From<SessionError> for SgfError {
    fn from(e: SessionError) -> Self {
        match e {
            SessionError::Document(e) => e.into(),
            SessionError::Projection(_) => Self::new(ErrorKind::Format, e.to_string()),
        }
    }
}

/// What an apply, undo or redo did, with the validator's verdict afterwards.
#[derive(Debug, Clone, PartialEq)]
pub struct OpResult {
    pub entry: HistoryEntry,
    /// The op that undoes this one, as [`crate::ops::Applied::inverse`] describes it.
    pub inverse: Op,
    /// The entities the op rewrote, sorted and deduplicated.
    pub subjects: Vec<Subject>,
    /// The systems among [`Self::subjects`], ascending.
    pub touched: Vec<u32>,
    /// The systems whose details the op left stale, ascending.
    pub details_stale: Vec<u32>,
    /// See [`crate::ops::OpReach::reclassifies`].
    pub reclassifies: bool,
    /// The whole wayline list when the op changed it, `None` when it stands as before.
    pub waylines: Option<Vec<Wayline>>,
    /// The whole bypass link list when the op changed it, `None` when it stands as before.
    pub bypasses: Option<Vec<BypassLink>>,
    /// See [`crate::ops::Applied::renumbered`]; an undo reports the renumbering that takes it
    /// back.
    pub renumbered: Vec<(u32, Option<u32>)>,
    pub issues: Vec<Issue>,
}

#[derive(Debug, Clone)]
pub struct Session {
    /// Where the document was opened from or last saved to; `None` for one never saved.
    pub(crate) path: Option<PathBuf>,
    /// How the file at `path` stood when it was opened or last saved, so a save in place can
    /// tell that something else wrote it since.
    stamp: Option<DiskStamp>,
    pub(crate) doc: Document,
    pub(crate) graph: GalaxyGraph,
    details: OnceCell<Arc<DetailsProjection>>,
    history: History,
    /// Undo-stack length when the document was last opened or saved; `None` once that
    /// state has been discarded by a new op after an undo.
    saved_at: Option<usize>,
    /// How the geometry ops size a system; the vanilla values until the shell sets the
    /// install's.
    radii: SystemRadii,
    /// What the loaded install says of stars; what is known without one until the shell
    /// sets the install's.
    stars: Arc<StarClasses>,
}

impl Session {
    /// Where the document was opened from or last saved to; `None` for one never saved.
    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    /// The document: its bytes, edits and meta.
    pub fn doc(&self) -> &Document {
        &self.doc
    }

    /// The galaxy as the ops and the map read it.
    pub fn graph(&self) -> &GalaxyGraph {
        &self.graph
    }

    /// What the document kind holds, so the app shows only what it can answer for.
    pub fn kind(&self) -> DocumentKind {
        self.doc.kind()
    }

    /// The document's own name: the empire's, or the scenario's `name`.
    pub fn title(&self) -> String {
        self.format().title(&self.doc)
    }

    pub(crate) fn format(&self) -> &'static dyn Format {
        format::of(self.doc.kind())
    }

    /// The projection's issues and the document's own, as open and every edit report them.
    /// Once the details are built, their cached overlap findings are appended too: a plain
    /// open validates before anything has read the details, so it never shows one.
    pub fn validate(&self) -> Vec<Issue> {
        let mut issues = validate_document(&self.doc, &self.graph);
        if let Some(details) = self.details.get() {
            issues.extend(details.overlap_issues());
            validate::sort(&mut issues);
        }
        issues
    }

    pub fn history(&self) -> HistoryView {
        self.history.entries()
    }

    pub fn system(&self, id: u32) -> Option<&SystemNode> {
        self.graph.systems.get(&id)
    }

    /// Whether the document differs from what was last opened or saved at `path`.
    pub fn is_dirty(&self) -> bool {
        self.saved_at != Some(self.history.undo_len())
    }
}

fn validate_document(doc: &Document, graph: &GalaxyGraph) -> Vec<Issue> {
    let mut issues = validate(graph);
    issues.extend(format::of(doc.kind()).issues(doc));
    validate::sort(&mut issues);
    issues
}
