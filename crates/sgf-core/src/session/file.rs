use std::cell::OnceCell;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use super::{Session, SessionError};
use crate::document::{self, Document, SaveOutcome};
use crate::format;
use crate::ops::SystemRadii;
use crate::ops::history::History;

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
            stars: Arc::default(),
        })
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
pub(super) struct DiskStamp {
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
