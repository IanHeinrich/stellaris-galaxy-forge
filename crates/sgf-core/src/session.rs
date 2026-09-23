//! The one object the CLI and the app hold: document + projection + history.
//!
//! Every edit goes through [`Session::apply`], which runs the op, records it for
//! undo and validates the projection. Undo and redo replay recorded bytes.
//!
//! The details projection is built on first use and dropped by an op that stales it
//! (`Op::stales_details`). A scenario has no details sections at all: its systems'
//! planets and resources come from the initializer, which the app resolves through
//! game data.

use std::cell::OnceCell;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::cst;
use crate::document::{self, Document, SaveOutcome};
use crate::entity::views::{EntityAddr, EntityKind};
use crate::format::save::details::DetailsProjection;
use crate::format::{self, Format};
use crate::keys;
use crate::library;
use crate::ops::history::History;
use crate::ops::{self, Applied, Op, OpError, Subject};
use crate::projections::galaxy::{GalaxyGraph, ProjectionError, SystemNode, Wayline};
use crate::search;
use crate::validate::{self, Issue, validate};
use crate::views::{
    DocumentKind, EditResult, ErrorKind, GalaxyDelta, HistoryEntry, HistoryView, SaveResult,
    SearchHit, SgfError,
};

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
    /// The op that undoes this one, as [`Applied::inverse`] describes it.
    pub inverse: Op,
    /// The entities the op rewrote, sorted and deduplicated.
    pub subjects: Vec<Subject>,
    /// The systems among [`Self::subjects`], ascending.
    pub touched: Vec<u32>,
    /// The systems whose details the op left stale, ascending.
    pub details_stale: Vec<u32>,
    /// See [`Op::reclassifies`].
    pub reclassifies: bool,
    /// The whole wayline list when the op changed it, `None` when it stands as before.
    pub waylines: Option<Vec<Wayline>>,
    pub issues: Vec<Issue>,
}

#[derive(Debug)]
pub struct Session {
    /// Where the document was opened from or last saved to; `None` for one never saved.
    pub path: Option<PathBuf>,
    pub doc: Document,
    pub graph: GalaxyGraph,
    details: OnceCell<Arc<DetailsProjection>>,
    history: History,
    /// Undo-stack length when the document was last opened or saved; `None` once that
    /// state has been discarded by a new op after an undo.
    saved_at: Option<usize>,
}

impl Session {
    /// Load a save or a scenario script and project its galaxy.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, SessionError> {
        let path = path.as_ref().to_path_buf();
        let doc = Document::load(&path)?;
        Self::from_document(Some(path), doc)
    }

    /// Hold `doc` as the session and project its galaxy. With no `path` the document has
    /// never been saved: it is dirty until a save-as names its file.
    pub fn from_document(path: Option<PathBuf>, doc: Document) -> Result<Self, SessionError> {
        let graph = format::of(doc.kind()).build_graph(&doc)?;
        let saved_at = path.as_ref().map(|_| 0);
        Ok(Self {
            path,
            doc,
            graph,
            details: OnceCell::new(),
            history: History::new(),
            saved_at,
        })
    }

    /// Apply `op`, record it for undo and validate. The document is unchanged on error.
    pub fn apply(&mut self, op: Op) -> Result<OpResult, OpError> {
        let waylines = self.graph.waylines.clone();
        let applied = ops::apply(self, op)?;
        let result = result(
            &self.graph,
            self.history.undo_len() + 1,
            &applied,
            &waylines,
        );
        if self.saved_at.is_some_and(|at| at > self.history.undo_len()) {
            self.saved_at = None;
        }
        self.history.push(applied);
        self.drop_stale_details(&result);
        Ok(result)
    }

    /// Undo the last op; `None` when there is nothing to undo.
    pub fn undo(&mut self) -> Result<Option<OpResult>, OpError> {
        let seq = self.history.undo_len();
        let waylines = self.graph.waylines.clone();
        let Some(applied) = self.history.undo(&mut self.doc, &mut self.graph)? else {
            return Ok(None);
        };
        let result = result(&self.graph, seq, applied, &waylines);
        self.drop_stale_details(&result);
        Ok(Some(result))
    }

    /// Redo the last undone op; `None` when there is nothing to redo.
    pub fn redo(&mut self) -> Result<Option<OpResult>, OpError> {
        let seq = self.history.undo_len() + 1;
        let waylines = self.graph.waylines.clone();
        let Some(applied) = self.history.redo(&mut self.doc, &mut self.graph)? else {
            return Ok(None);
        };
        let result = result(&self.graph, seq, applied, &waylines);
        self.drop_stale_details(&result);
        Ok(Some(result))
    }

    /// What `apply_op`, `undo` and `redo` report to the app.
    pub fn edit_result(&self, result: OpResult) -> EditResult {
        EditResult {
            entry: result.entry,
            delta: self.delta(&result.subjects, result.waylines),
            issues: result.issues,
            history: self.history(),
            dirty: self.is_dirty(),
            touched_entities: result
                .touched
                .iter()
                .map(|&id| EntityAddr::new(EntityKind::System, id))
                .collect(),
            details_stale: result.details_stale,
            reclassifies: result.reclassifies,
        }
    }

    /// What `save` and `save_as` report to the app.
    pub fn save_result(&self, outcome: SaveOutcome) -> SaveResult {
        SaveResult {
            path: outcome.path.to_string_lossy().into_owned(),
            cloud: library::is_cloud_save(&outcome.path),
            backup_path: outcome.backup.map(|p| p.to_string_lossy().into_owned()),
            dirty: self.is_dirty(),
        }
    }

    /// What the map must replace after an edit of `subjects`: the systems as they now
    /// project, and the ones the document no longer holds so the map drops them.
    fn delta(&self, subjects: &[Subject], waylines: Option<Vec<Wayline>>) -> GalaxyDelta {
        let mut delta = GalaxyDelta {
            waylines,
            ..GalaxyDelta::default()
        };
        let mut listed = HashSet::new();
        for subject in subjects {
            match *subject {
                Subject::Nebula(_) if delta.nebulae.is_none() => {
                    delta.nebulae = Some(self.graph.nebulae.clone());
                }
                Subject::Nebula(_) => {}
                Subject::Header(_) if delta.header.is_none() => {
                    delta.header = Some(self.graph.header.clone());
                }
                Subject::Header(_) => {}
                Subject::Flags => delta.lgate = self.graph.lgate,
                subject => {
                    for id in subject.systems() {
                        if !listed.insert(id) {
                            continue;
                        }
                        match self.system(id) {
                            Some(system) => delta.systems.push(system.clone()),
                            None => delta.removed.push(id),
                        }
                    }
                }
            }
        }
        delta
    }

    fn drop_stale_details(&mut self, result: &OpResult) {
        if !result.details_stale.is_empty() {
            self.details.take();
        }
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

    pub fn validate(&self) -> Vec<Issue> {
        let mut issues = validate(&self.graph);
        issues.extend(self.format().issues(&self.doc));
        validate::sort(&mut issues);
        issues
    }

    pub fn history(&self) -> HistoryView {
        self.history.entries()
    }

    pub fn system(&self, id: u32) -> Option<&SystemNode> {
        self.graph.systems.get(&id)
    }

    /// A scenario system's own `effect = { … }` block and the line it starts on.
    pub fn scenario_system_effect(&self, id: u32) -> Option<(String, u32)> {
        let anchor = self.doc.scenario()?.system(id)?;
        let bytes = self.doc.current(anchor).ok()?;
        let original = self.doc.original();
        let before = newlines(&original[..anchor.start().min(original.len())]);
        system_effect(bytes, before)
    }

    /// Every scenario system carrying an `effect = { … }` block, in file order: its id,
    /// the block's text and the line it starts on. A save document has none.
    ///
    /// One pass over the index: the lines before each statement accumulate as the walk
    /// advances, rather than the whole file being counted again per system.
    pub fn scenario_system_effects(&self) -> Vec<(u32, String, u32)> {
        let Some(scenario) = self.doc.scenario() else {
            return Vec::new();
        };
        let original = self.doc.original();
        let (mut counted, mut lines) = (0, 0);
        let mut effects = Vec::new();
        for (id, anchor) in scenario.systems() {
            let start = anchor.start().min(original.len());
            // An inserted statement can anchor before the one ahead of it, so the running
            // count starts again from the top of the file.
            if start < counted {
                (counted, lines) = (0, 0);
            }
            lines += newlines(&original[counted..start]);
            counted = start;
            let Ok(bytes) = self.doc.current(anchor) else {
                continue;
            };
            if let Some((text, line)) = system_effect(bytes, lines) {
                effects.push((id, text, line));
            }
        }
        effects
    }

    /// Per-system planets, deposits, starbase and fleets, built on first call.
    pub fn details(&self) -> Result<Arc<DetailsProjection>, ProjectionError> {
        if let Some(details) = self.details.get() {
            return Ok(Arc::clone(details));
        }
        let built = Arc::new(DetailsProjection::build(&self.doc, &self.graph)?);
        Ok(Arc::clone(self.details.get_or_init(|| built)))
    }

    /// The details projection if it has already been built, never building it.
    pub fn built_details(&self) -> Option<Arc<DetailsProjection>> {
        self.details.get().map(Arc::clone)
    }

    /// Build the details projection if it is not built yet, so that later calls are cheap.
    pub fn warm_details(&mut self) -> Result<(), ProjectionError> {
        if !self.format().has_details() {
            return Ok(());
        }
        self.details().map(|_| ())
    }

    /// Systems, countries, planets, fleets and nebulae matching `query` by id, key or
    /// resolved name; see [`search::search`].
    ///
    /// Planets and fleets are only searched once the details projection is built, which
    /// search never does itself: it runs under the session lock, and building parses about
    /// half the file. The app calls [`Session::warm_details`] after a save opens.
    pub fn search(
        &self,
        query: &str,
        limit: usize,
        resolve: search::NameResolver<'_>,
    ) -> Vec<SearchHit> {
        search::search(
            &self.graph,
            self.built_details().as_deref(),
            query,
            limit,
            resolve,
        )
    }

    /// Whether the document differs from what was last opened or saved at `path`.
    pub fn is_dirty(&self) -> bool {
        self.saved_at != Some(self.history.undo_len())
    }

    /// Write to `path` (backing up any file there), which becomes the session's path.
    pub fn save_as(&mut self, path: impl AsRef<Path>) -> Result<SaveOutcome, document::Error> {
        self.save_as_with(path, |_| {})
    }

    /// [`Self::save_as`], reporting write progress as a fraction in `0..=1`.
    pub fn save_as_with(
        &mut self,
        path: impl AsRef<Path>,
        progress: impl FnMut(f64),
    ) -> Result<SaveOutcome, document::Error> {
        let outcome = self.doc.save_as_with(path, progress)?;
        self.path = Some(outcome.path.clone());
        self.saved_at = Some(self.history.undo_len());
        Ok(outcome)
    }

    /// Write to `path`, or in place when it is `None`; either way the file already
    /// there is backed up first.
    pub fn save_to(&mut self, path: Option<&Path>) -> Result<SaveOutcome, document::Error> {
        self.save_to_with(path, |_| {})
    }

    /// [`Self::save_to`], reporting write progress as a fraction in `0..=1`.
    pub fn save_to_with(
        &mut self,
        path: Option<&Path>,
        progress: impl FnMut(f64),
    ) -> Result<SaveOutcome, document::Error> {
        let path = match (path, &self.path) {
            (Some(path), _) => path.to_path_buf(),
            (None, Some(path)) => path.clone(),
            (None, None) => return Err(document::Error::NoPath),
        };
        self.save_as_with(path, progress)
    }
}

fn result(graph: &GalaxyGraph, seq: usize, applied: &Applied, waylines: &[Wayline]) -> OpResult {
    let mut touched: Vec<u32> = applied.touched.iter().flat_map(|s| s.systems()).collect();
    touched.sort_unstable();
    touched.dedup();
    OpResult {
        details_stale: details_stale(&applied.op, &applied.touched),
        reclassifies: applied.op.reclassifies(),
        entry: HistoryEntry {
            seq,
            description: applied.description.clone(),
        },
        inverse: applied.inverse.clone(),
        subjects: applied.touched.clone(),
        touched,
        waylines: (graph.waylines != waylines).then(|| graph.waylines.clone()),
        issues: validate(graph),
    }
}

/// The systems `op` left the details of stale, ascending; the lane statements it also
/// rewrote name no system of their own.
fn details_stale(op: &Op, subjects: &[Subject]) -> Vec<u32> {
    if !op.stales_details() {
        return Vec::new();
    }
    let mut ids: Vec<u32> = subjects.iter().filter_map(|s| s.system()).collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}

/// One system statement's `effect = { … }` block and the line it starts on, counted
/// from `before`, the lines standing ahead of the statement.
fn system_effect(bytes: &[u8], before: usize) -> Option<(String, u32)> {
    let root = cst::parse_script(bytes, 0).ok()?;
    let effect = root
        .children()
        .first()?
        .find(keys::scenario::EFFECT, bytes)?;
    let text = String::from_utf8_lossy(effect.span().slice(bytes)).into_owned();
    let line = before + newlines(&bytes[..effect.span().start]) + 1;
    Some((text, crate::as_u32(line)))
}

fn newlines(bytes: &[u8]) -> usize {
    bytes.iter().filter(|&&c| c == b'\n').count()
}
