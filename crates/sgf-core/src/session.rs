//! The one object the CLI and the app hold: document + projection + history.
//!
//! Every edit goes through [`Session::apply`], which runs the op, records it for
//! undo and validates the projection. Undo and redo replay recorded bytes.
//!
//! The details projection is built on first use. An op that stales it (`Op::reach`) has
//! what it staled read again in place when it can, and otherwise the projection is built
//! again. A scenario has no details sections at all: its systems' planets and resources come
//! from the initializer, which the app resolves through game data.

use std::cell::OnceCell;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use crate::document::{self, Document, SaveOutcome};
use crate::entity::views::{EntityAddr, EntityKind};
use crate::format::save::details::DetailsProjection;
use crate::format::save::write::move_planet;
use crate::format::scenario::effect;
use crate::format::{self, Format};
use crate::library;
use crate::ops::history::History;
use crate::ops::{self, Applied, DetailsReach, Op, OpError, Plan, Subject, SystemRadii};
use crate::projections::galaxy::{BypassLink, GalaxyGraph, ProjectionError, SystemNode, Wayline};
use crate::search;
use crate::validate::{self, Issue, validate};
use crate::views::{
    DocumentKind, EditResult, ErrorKind, GalaxyDelta, HistoryEntry, HistoryView, OrbitPlacement,
    PlanetMoveCheck, PlanetMoveTargets, SaveResult, SearchResult, SgfError,
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
    /// See [`crate::ops::OpReach::reclassifies`].
    pub reclassifies: bool,
    /// The whole wayline list when the op changed it, `None` when it stands as before.
    pub waylines: Option<Vec<Wayline>>,
    /// The whole bypass link list when the op changed it, `None` when it stands as before.
    pub bypasses: Option<Vec<BypassLink>>,
    /// See [`Applied::renumbered`]; an undo reports the renumbering that takes it back.
    pub renumbered: Vec<(u32, Option<u32>)>,
    pub issues: Vec<Issue>,
}

#[derive(Debug)]
pub struct Session {
    /// Where the document was opened from or last saved to; `None` for one never saved.
    pub path: Option<PathBuf>,
    /// How the file at `path` stood when it was opened or last saved, so a save in place can
    /// tell that something else wrote it since.
    stamp: Option<DiskStamp>,
    pub doc: Document,
    pub graph: GalaxyGraph,
    details: OnceCell<Arc<DetailsProjection>>,
    history: History,
    /// Undo-stack length when the document was last opened or saved; `None` once that
    /// state has been discarded by a new op after an undo.
    saved_at: Option<usize>,
    /// How the geometry ops size a system; the vanilla values until the shell sets the
    /// install's.
    radii: SystemRadii,
}

impl Session {
    /// Load a save or a scenario script and project its galaxy.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, SessionError> {
        let path = path.as_ref().to_path_buf();
        // Read before the bytes are, so a write that lands while they load still shows.
        let stamp = DiskStamp::read(&path);
        let doc = Document::load(&path)?;
        let mut session = Self::from_document(Some(path), doc)?;
        session.stamp = stamp;
        Ok(session)
    }

    /// Hold `doc` as the session and project its galaxy. With no `path` the document has
    /// never been saved: it is dirty until a save-as names its file. Nothing records how
    /// the file at `path` stood, so the first save in place is not checked against it.
    pub fn from_document(path: Option<PathBuf>, doc: Document) -> Result<Self, SessionError> {
        let graph = format::of(doc.kind()).build_graph(&doc)?;
        let saved_at = path.as_ref().map(|_| 0);
        Ok(Self {
            path,
            stamp: None,
            doc,
            graph,
            details: OnceCell::new(),
            history: History::new(),
            saved_at,
            radii: SystemRadii::VANILLA,
        })
    }

    /// How the geometry ops size a system.
    pub fn radii(&self) -> SystemRadii {
        self.radii
    }

    /// Size systems by `radii` from the next op on, as the loaded install's defines give them.
    pub fn set_radii(&mut self, radii: SystemRadii) {
        self.radii = radii;
    }

    /// Apply `op`, record it for undo and validate. The document is unchanged on error, and
    /// an op the document's kind does not take is refused before its format sees it. Built
    /// details are brought up to date before validating, so a finding that reads them (an
    /// overlap) is current. An op that is only an inverse is refused, alone or in a batch.
    pub fn apply(&mut self, op: Op) -> Result<OpResult, OpError> {
        op.check_sendable()?;
        self.apply_inverse(op)
    }

    /// Apply `op` as [`Self::apply`] does, taking an op that is only an inverse too: the
    /// inverse an earlier op returned.
    pub fn apply_inverse(&mut self, op: Op) -> Result<OpResult, OpError> {
        let before = Derived::of(&self.graph);
        let applied = ops::apply(self, op)?;
        let mut result = result(
            &self.graph,
            self.history.undo_len() + 1,
            &applied,
            &before,
            false,
            Vec::new(),
        );
        if self.saved_at.is_some_and(|at| at > self.history.undo_len()) {
            self.saved_at = None;
        }
        let in_place = in_place(&applied.op);
        self.history.push(applied);
        self.update_details(in_place, &result);
        result.issues = self.validate();
        Ok(result)
    }

    /// Undo the last op; `None` when there is nothing to undo. The details are brought up
    /// to date before validating, as [`Self::apply`] does.
    pub fn undo(&mut self) -> Result<Option<OpResult>, OpError> {
        let seq = self.history.undo_len();
        let before = Derived::of(&self.graph);
        let Some(applied) = self.history.undo(&mut self.doc, &mut self.graph)? else {
            return Ok(None);
        };
        let mut result = result(&self.graph, seq, applied, &before, true, Vec::new());
        let in_place = in_place(&applied.op);
        self.update_details(in_place, &result);
        result.issues = self.validate();
        Ok(Some(result))
    }

    /// Redo the last undone op; `None` when there is nothing to redo. The details are
    /// brought up to date before validating, as [`Self::apply`] does.
    pub fn redo(&mut self) -> Result<Option<OpResult>, OpError> {
        let seq = self.history.undo_len() + 1;
        let before = Derived::of(&self.graph);
        let Some(applied) = self.history.redo(&mut self.doc, &mut self.graph)? else {
            return Ok(None);
        };
        let mut result = result(&self.graph, seq, applied, &before, false, Vec::new());
        let in_place = in_place(&applied.op);
        self.update_details(in_place, &result);
        result.issues = self.validate();
        Ok(Some(result))
    }

    /// What `apply_op`, `undo` and `redo` report to the app.
    pub fn edit_result(&self, result: OpResult) -> EditResult {
        let touched_entities = touched_entities(&result.touched, &result.subjects);
        EditResult {
            entry: result.entry,
            delta: self.delta(
                &result.subjects,
                result.waylines,
                result.bypasses,
                result.renumbered,
            ),
            issues: result.issues,
            history: self.history(),
            dirty: self.is_dirty(),
            touched_entities,
            details_stale: result.details_stale,
            reclassifies: result.reclassifies,
            title: self.title(),
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

    /// What the map must replace after an edit of `subjects`: the systems and countries as
    /// they now project, and the systems the document no longer holds so the map drops them.
    fn delta(
        &self,
        subjects: &[Subject],
        waylines: Option<Vec<Wayline>>,
        bypasses: Option<Vec<BypassLink>>,
        renumbered: Vec<(u32, Option<u32>)>,
    ) -> GalaxyDelta {
        let mut delta = GalaxyDelta {
            waylines,
            bypasses,
            renumbered,
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
                Subject::Country(id) => {
                    let country = self.graph.countries.iter().find(|c| c.id == id);
                    delta.countries.extend(country.cloned());
                }
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

    /// Bring a built details projection up to date with `result`: reread the planets and
    /// systems it rewrote when `in_place` says that is enough, else build it again.
    fn update_details(&mut self, in_place: bool, result: &OpResult) {
        if result.details_stale.is_empty() {
            return;
        }
        let Some(details) = self.details.get_mut() else {
            return;
        };
        if in_place {
            let planets = result.subjects.iter().filter_map(|s| match *s {
                Subject::Planet { id, system } => Some((id, system)),
                _ => None,
            });
            let systems = result.subjects.iter().filter_map(|s| s.system());
            let details = Arc::make_mut(details);
            let refreshed = details
                .refresh_planets(&self.doc, planets)
                .and_then(|()| details.refresh_systems(&self.doc, systems));
            if refreshed.is_ok() {
                return;
            }
        }
        self.details.take();
        // A projection that fails to build is left unbuilt, as on open.
        let _ = self.details();
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

    /// A scenario system's own `effect = { … }` block and the line it starts on.
    pub fn scenario_system_effect(&self, id: u32) -> Option<(String, u32)> {
        effect::system_effect(&self.doc, id)
    }

    /// Every scenario system carrying an `effect = { … }` block, in file order: its id,
    /// the block's text and the line it starts on. A save document has none.
    pub fn scenario_system_effects(&self) -> Vec<(u32, String, u32)> {
        effect::system_effects(&self.doc)
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

    /// Build the details projection if it is not built yet, so that later calls are cheap,
    /// and return the issues now that a finding reading the details (an overlap) can show.
    pub fn warm_details(&mut self) -> Result<Vec<Issue>, ProjectionError> {
        if self.format().has_details(&self.doc) {
            self.details()?;
        }
        Ok(self.validate())
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
        special: search::SpecialLabels<'_>,
    ) -> SearchResult {
        search::search(
            &self.graph,
            self.built_details().as_deref(),
            query,
            limit,
            resolve,
            special,
        )
    }

    /// Where the save planets `planets` may move together, and which of them cannot move.
    pub fn planet_move_targets(&self, planets: &[u32]) -> PlanetMoveTargets {
        move_planet::targets(self, planets)
    }

    /// The op that moves `planets` to system `to`: one [`Op::MoveBodyToSystem`] per planet
    /// [`Self::planet_move_targets`] keeps, in order, the first at `at` when given, batched
    /// when there are several. Refused when it keeps none.
    pub fn planet_move_op(
        &self,
        planets: &[u32],
        to: u32,
        at: Option<OrbitPlacement>,
    ) -> Result<Op, OpError> {
        move_planet::move_op(self, planets, to, at)
    }

    /// Why [`Self::planet_move_op`] would be refused, or else the colonies and stations it
    /// takes into another country's system. Nothing is written: each move is planned
    /// against the session and dropped.
    pub fn planet_move_check(
        &self,
        planets: &[u32],
        to: u32,
        at: Option<OrbitPlacement>,
    ) -> PlanetMoveCheck {
        move_planet::check(self, planets, to, at)
    }

    /// Why `op` would be refused, or `None` when it would apply. Nothing is written: the op
    /// is planned against the session and dropped. A batch is refused, since its members
    /// after the first would be planned against a session none of them had changed, and so
    /// is an op with a second step, which is planned against its first.
    pub fn check_op(&self, op: &Op) -> Option<String> {
        if matches!(op, Op::Batch { .. }) {
            return Some("a batch cannot be checked: check each of its ops".to_owned());
        }
        if let Err(error) = op.check_kind(self.kind()) {
            return Some(error.to_string());
        }
        if let Err(error) = op.check_sendable() {
            return Some(error.to_string());
        }
        if op.reach().follow_up {
            return Some(format!(
                "{} cannot be checked: its second step needs its first applied",
                op.name()
            ));
        }
        self.format()
            .write(&mut Plan::new(), self, op)
            .err()
            .map(|error| error.to_string())
    }

    /// Whether the document differs from what was last opened or saved at `path`.
    pub fn is_dirty(&self) -> bool {
        self.saved_at != Some(self.history.undo_len())
    }

    /// Write to `path` (backing up any file there), which becomes the session's path.
    /// Refuses with [`document::Error::ChangedOnDisk`] when `path` is the session's own file
    /// and something else wrote it since it was opened or last saved.
    pub fn save_as(&mut self, path: impl AsRef<Path>) -> Result<SaveOutcome, document::Error> {
        self.save_as_with(path, false, |_| {})
    }

    /// [`Self::save_as`], reporting write progress as a fraction in `0..=1`. With `force` a
    /// file changed on disk is written over, and becomes the backup like any other.
    pub fn save_as_with(
        &mut self,
        path: impl AsRef<Path>,
        force: bool,
        progress: impl FnMut(f64),
    ) -> Result<SaveOutcome, document::Error> {
        let path = path.as_ref();
        if !force && self.changed_on_disk(path) {
            return Err(document::Error::ChangedOnDisk {
                path: path.to_path_buf(),
            });
        }
        let outcome = self.doc.save_as_with(path, progress)?;
        self.stamp = DiskStamp::read(&outcome.path);
        self.path = Some(outcome.path.clone());
        self.saved_at = Some(self.history.undo_len());
        Ok(outcome)
    }

    /// Write to `path`, or in place when it is `None`; either way the file already
    /// there is backed up first. Refuses as [`Self::save_as`] does.
    pub fn save_to(&mut self, path: Option<&Path>) -> Result<SaveOutcome, document::Error> {
        self.save_to_with(path, false, |_| {})
    }

    /// [`Self::save_to`], reporting write progress as a fraction in `0..=1`; `force` as
    /// [`Self::save_as_with`] takes it.
    pub fn save_to_with(
        &mut self,
        path: Option<&Path>,
        force: bool,
        progress: impl FnMut(f64),
    ) -> Result<SaveOutcome, document::Error> {
        let path = match (path, &self.path) {
            (Some(path), _) => path.to_path_buf(),
            (None, Some(path)) => path.clone(),
            (None, None) => return Err(document::Error::NoPath),
        };
        self.save_as_with(path, force, progress)
    }

    /// Whether `path` is the session's own file and no longer stands as it was opened or
    /// last saved. Another path is never checked: the file dialog already asked about it.
    /// A file that is gone is no conflict.
    fn changed_on_disk(&self, path: &Path) -> bool {
        let Some(own) = self.path.as_deref() else {
            return false;
        };
        if !same_file(own, path) {
            return false;
        }
        match (self.stamp, DiskStamp::read(path)) {
            (Some(recorded), Some(now)) => recorded != now,
            _ => false,
        }
    }
}

/// Whether `a` and `b` name one file, however each is spelled (on Windows, whatever its
/// case); plain equality when either cannot be resolved.
fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// A file's length and modification time, enough to tell that something rewrote it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct DiskStamp {
    len: u64,
    modified: SystemTime,
}

impl DiskStamp {
    /// `None` when the file is not there or its metadata cannot be read.
    fn read(path: &Path) -> Option<Self> {
        let meta = fs::metadata(path).ok()?;
        Some(Self {
            len: meta.len(),
            modified: meta.modified().ok()?,
        })
    }
}

fn validate_document(doc: &Document, graph: &GalaxyGraph) -> Vec<Issue> {
    let mut issues = validate(graph);
    issues.extend(format::of(doc.kind()).issues(doc));
    validate::sort(&mut issues);
    issues
}

/// The lists the graph derives whole after an edit, as they stood before it, so a result
/// reports each only when the edit changed it.
struct Derived {
    waylines: Vec<Wayline>,
    bypasses: Vec<BypassLink>,
}

impl Derived {
    fn of(graph: &GalaxyGraph) -> Self {
        Self {
            waylines: graph.waylines.clone(),
            bypasses: graph.bypasses.clone(),
        }
    }
}

/// What `applied` did, or what undoing it did when `undone`, with the `issues` it left.
fn result(
    graph: &GalaxyGraph,
    seq: usize,
    applied: &Applied,
    before: &Derived,
    undone: bool,
    issues: Vec<Issue>,
) -> OpResult {
    let mut touched: Vec<u32> = applied.touched.iter().flat_map(|s| s.systems()).collect();
    touched.sort_unstable();
    touched.dedup();
    let renumbered = if undone {
        applied
            .renumbered
            .iter()
            .filter_map(|&(before, after)| Some((after?, Some(before))))
            .collect()
    } else {
        applied.renumbered.clone()
    };
    let mut details_stale = details_stale(graph.kind, &applied.op, &applied.touched);
    if !renumbered.is_empty() {
        let ids = applied
            .renumbered
            .iter()
            .flat_map(|&(old, new)| [Some(old), new]);
        details_stale.extend(ids.flatten());
        details_stale.sort_unstable();
        details_stale.dedup();
    }
    OpResult {
        details_stale,
        reclassifies: applied.op.reach().reclassifies,
        entry: HistoryEntry {
            seq,
            description: applied.description.clone(),
        },
        inverse: applied.inverse.clone(),
        subjects: applied.touched.clone(),
        touched,
        waylines: (graph.waylines != before.waylines).then(|| graph.waylines.clone()),
        bypasses: (graph.bypasses != before.bypasses).then(|| graph.bypasses.clone()),
        renumbered,
        issues,
    }
}

/// Whether the details `op` stales come up to date by rereading them in place.
fn in_place(op: &Op) -> bool {
    op.reach().details == DetailsReach::InPlace
}

/// The entities an edit rewrote, as the app addresses them: its `systems`, then the planets
/// and countries among its `subjects`.
fn touched_entities(systems: &[u32], subjects: &[Subject]) -> Vec<EntityAddr> {
    let systems = systems
        .iter()
        .map(|&id| EntityAddr::new(EntityKind::System, id));
    let others = subjects.iter().filter_map(|subject| match *subject {
        Subject::Planet { id, .. } => Some(EntityAddr::new(EntityKind::Planet, id)),
        Subject::Country(id) => Some(EntityAddr::new(EntityKind::Country, id)),
        _ => None,
    });
    systems.chain(others).collect()
}

/// The systems `op` left the details of stale, ascending: those it rewrote and those
/// whose bodies it rewrote, or in a save only the latter when that is all it stales (see
/// [`DetailsReach::Bodies`]). The lane statements it also rewrote name no system of
/// their own.
fn details_stale(kind: DocumentKind, op: &Op, subjects: &[Subject]) -> Vec<u32> {
    let reach = op.reach().details;
    if !reach.stales() {
        return Vec::new();
    }
    if kind == DocumentKind::Scenario && reach == DetailsReach::SaveBodies {
        return Vec::new();
    }
    let bodies_only = kind == DocumentKind::Save
        && matches!(reach, DetailsReach::Bodies | DetailsReach::SaveBodies);
    let mut ids: Vec<u32> = subjects
        .iter()
        .filter_map(|s| match *s {
            Subject::System(id) if !bodies_only => Some(id),
            Subject::Planet { system: id, .. } => Some(id),
            _ => None,
        })
        .collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}
