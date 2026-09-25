//! The loaded document: original bytes held once, `meta` verbatim, the index, and the
//! patch overlay. `pieces` yields original gaps and slot contents in offset order.
//!
//! A document is a `.sav` or a static galaxy scenario script; the kind is sniffed from
//! the bytes and everything that differs between the two lives behind `format::Format`.

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use crate::Span;
use crate::archive::{self, RawSave};
use crate::entity::inner_sections;
use crate::format;
use crate::format::save::added::Added;
use crate::format::scenario::index::{self as scenario, Changes, ScenarioIndex};
use crate::keys;
use crate::overlay::{Anchor, Overlay, OverlayError};
use crate::projections::galaxy::ProjectionError;
use crate::scan::{self, Index, ScanError, Value, key_name};
use crate::views::DocumentKind;

/// The first bytes of a zip archive, which is what a `.sav` is.
const ZIP_MAGIC: [u8; 4] = [b'P', b'K', 3, 4];

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Archive(#[from] archive::Error),
    #[error("gamestate: {0}")]
    Scan(#[from] ScanError),
    #[error("{path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error(transparent)]
    Scenario(#[from] scenario::Error),
    #[error("the document has never been saved, so it has no path to save to")]
    NoPath,
    #[error("{path} changed on disk after it was opened or last saved")]
    ChangedOnDisk { path: PathBuf },
}

/// Where a save landed and the backup it displaced, if any.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SaveOutcome {
    pub path: PathBuf,
    pub backup: Option<PathBuf>,
}

/// Whether inserted bytes open a `nebula=` statement, which is how a save tells the
/// sections an op added from anything else it inserted at the same offset.
fn opens_nebula(bytes: &[u8]) -> bool {
    bytes
        .trim_ascii_start()
        .strip_prefix(keys::NEBULA.as_bytes())
        .is_some_and(|rest| rest.trim_ascii_start().starts_with(b"="))
}

/// A save's `nebula` sections as the bytes now stand, in emission order.
fn save_nebulae(index: &Index, overlay: &Overlay, original: &[u8]) -> Vec<Anchor> {
    let mut anchors: Vec<Anchor> = index
        .sections_named(keys::NEBULA)
        .map(|s| Anchor::Original(s.stmt))
        .filter(|&a| !overlay.removed(a, original))
        .collect();
    anchors.extend(
        overlay
            .slots()
            .filter(|&(anchor, bytes)| anchor.is_inserted() && opens_nebula(bytes))
            .map(|(anchor, _)| anchor),
    );
    anchors.sort_unstable();
    anchors
}

/// Which format `path` holds, read from its first bytes; the extension is never trusted.
/// A file that cannot be read is treated as text, so opening it reports the read error.
pub fn sniff(path: impl AsRef<Path>) -> DocumentKind {
    let mut header = [0u8; 4];
    let read = File::open(path).and_then(|mut f| f.read_exact(&mut header));
    if read.is_ok() && header == ZIP_MAGIC {
        DocumentKind::Save
    } else {
        DocumentKind::Scenario
    }
}

/// What each kind keeps about its bytes beyond the index, read again by its format's
/// refresh after every edit, undo and redo.
#[derive(Clone, Debug)]
enum Body {
    Save {
        /// The top-level `nebula` statements in emission order, the ones an op inserted
        /// among them.
        nebulae: Vec<Anchor>,
        /// The systems, planets and deposits an op wrote.
        added: Added,
    },
    Scenario(Box<ScenarioIndex>),
}

/// The `added` a scenario answers with: it keeps its own id map.
static NOTHING_ADDED: Added = Added::new();

#[derive(Clone, Debug)]
pub struct Document {
    original: Arc<Vec<u8>>,
    meta: Vec<u8>,
    index: Index,
    overlay: Overlay,
    body: Body,
    /// See [`Self::inner_index`]; one cell per section, so a damaged one is nobody
    /// else's business.
    inner: HashMap<&'static str, OnceLock<Option<Index>>>,
}

/// An empty cell for each section [`Document::inner_index`] answers for: those an entity
/// address is reached through, and `archaeological_sites`, which only a projection reads.
fn inner_cells() -> HashMap<&'static str, OnceLock<Option<Index>>> {
    inner_sections()
        .chain([keys::ARCHAEOLOGICAL_SITES])
        .map(|name| (name, OnceLock::new()))
        .collect()
}

/// The statements inside a top-level block section, indexed as if they were a file, so
/// `planets.planet` and `starbase_mgr.starbases` expose their entities. `None` when the
/// section is absent.
fn scan_inner(
    index: &Index,
    src: &[u8],
    section: &'static str,
) -> Result<Option<Index>, ProjectionError> {
    let Some(outer) = index.section(section) else {
        return Ok(None);
    };
    let Value::Block { open, close } = outer.value else {
        return Err(ProjectionError::SectionField {
            section,
            reason: "expected a block".to_owned(),
        });
    };
    scan::scan_range(src, open + 1..close)
        .map(Some)
        .map_err(|e| ProjectionError::SectionField {
            section,
            reason: e.to_string(),
        })
}

impl Document {
    /// Read a document and index it, as the kind its bytes say it is.
    pub fn load(path: impl AsRef<Path>) -> Result<Self, Error> {
        let path = path.as_ref();
        match sniff(path) {
            DocumentKind::Save => {
                let RawSave { gamestate, meta } = archive::read_sav(path)?;
                Self::from_bytes(gamestate, meta)
            }
            DocumentKind::Scenario => {
                let text = std::fs::read(path).map_err(|source| Error::Io {
                    path: path.to_path_buf(),
                    source,
                })?;
                Self::from_scenario_bytes(text)
            }
        }
    }

    pub fn from_bytes(gamestate: Vec<u8>, meta: Vec<u8>) -> Result<Self, Error> {
        let index = scan::scan(&gamestate)?;
        let overlay = Overlay::new();
        let nebulae = save_nebulae(&index, &overlay, &gamestate);
        Ok(Self {
            original: Arc::new(gamestate),
            meta,
            index,
            overlay,
            body: Body::Save {
                nebulae,
                added: Added::new(),
            },
            inner: inner_cells(),
        })
    }

    /// Index a static galaxy scenario script; a document of this kind carries no `meta`.
    pub fn from_scenario_bytes(text: Vec<u8>) -> Result<Self, Error> {
        let (scenario, index) = ScenarioIndex::build_indexed(&text)?;
        Ok(Self {
            original: Arc::new(text),
            meta: Vec::new(),
            index,
            overlay: Overlay::new(),
            body: Body::Scenario(Box::new(scenario)),
            inner: inner_cells(),
        })
    }

    pub fn kind(&self) -> DocumentKind {
        match self.body {
            Body::Save { .. } => DocumentKind::Save,
            Body::Scenario(_) => DocumentKind::Scenario,
        }
    }

    /// The scenario's body index, `None` for a save.
    pub fn scenario(&self) -> Option<&ScenarioIndex> {
        match &self.body {
            Body::Scenario(scenario) => Some(scenario.as_ref()),
            Body::Save { .. } => None,
        }
    }

    /// A save's `nebula` statements in emission order, one per top-level section the
    /// document now holds; empty for a scenario, which lists its own
    /// ([`ScenarioIndex::nebulae`]).
    pub fn nebulae(&self) -> &[Anchor] {
        match &self.body {
            Body::Save { nebulae, .. } => nebulae,
            Body::Scenario(_) => &[],
        }
    }

    /// A save's systems, planets and deposits an op wrote, which the index cannot know;
    /// none for a scenario.
    pub(crate) fn added(&self) -> &Added {
        match &self.body {
            Body::Save { added, .. } => added,
            Body::Scenario(_) => &NOTHING_ADDED,
        }
    }

    /// Re-read the scenario statements `slots` hold from their current bytes, so the id
    /// map matches what the document now holds.
    pub(crate) fn refresh_scenario(&mut self, slots: &[Anchor]) -> Result<Changes, Error> {
        match &mut self.body {
            Body::Scenario(scenario) => {
                Ok(scenario.refresh(&self.original, &self.overlay, slots)?)
            }
            Body::Save { .. } => Ok(Changes::default()),
        }
    }

    /// Re-read which entities the save's `slots` now hold, so one an op wrote is found and
    /// one an undo took away is gone; with `nebulae`, also which statements are `nebula`
    /// sections, so one an op erased is gone and one it inserted is listed.
    pub(crate) fn refresh_save(&mut self, slots: &[Anchor], nebulae: bool) {
        let Body::Save {
            nebulae: listed,
            added,
        } = &mut self.body
        else {
            return;
        };
        added.refresh(&self.original, &self.index, &self.overlay, slots);
        if nebulae {
            *listed = save_nebulae(&self.index, &self.overlay, &self.original);
        }
    }

    /// The original bytes as loaded.
    pub fn original(&self) -> &[u8] {
        &self.original
    }

    /// The `meta` bytes as loaded; empty for a scenario.
    pub fn meta(&self) -> &[u8] {
        &self.meta
    }

    pub fn index(&self) -> &Index {
        &self.index
    }

    /// The body of a section whose entities sit one level deeper than the index records
    /// (`planets.planet`), indexed as if it were a file; `None` when the document has no
    /// such section. A section is scanned on the first call for it and kept, because no
    /// op rewrites one, and one that will not scan fails only its own callers.
    pub(crate) fn inner_index(&self, section: &str) -> Result<Option<&Index>, ProjectionError> {
        let Some((name, cell)) = self.inner.get_key_value(section) else {
            return Ok(None);
        };
        if let Some(scanned) = cell.get() {
            return Ok(scanned.as_ref());
        }
        let scanned = scan_inner(&self.index, &self.original, name)?;
        Ok(cell.get_or_init(|| scanned).as_ref())
    }

    pub fn overlay(&self) -> &Overlay {
        &self.overlay
    }

    /// Whether any slot exists, i.e. saving would not reproduce the original.
    pub fn is_dirty(&self) -> bool {
        !self.overlay.is_empty()
    }

    /// Bytes currently standing for `anchor`: its slot's content, or the original bytes
    /// when no slot touches it. See [`Overlay::current`].
    pub fn current(&self, anchor: impl Into<Anchor>) -> Result<&[u8], OverlayError> {
        self.overlay.current(anchor.into(), &self.original)
    }

    /// Replace the bytes standing for `anchor`; returns the previous replacement if the
    /// slot existed. See [`Overlay::replace`].
    pub fn replace(
        &mut self,
        anchor: impl Into<Anchor>,
        bytes: Vec<u8>,
    ) -> Result<Option<Vec<u8>>, OverlayError> {
        let anchor = anchor.into();
        self.in_bounds(anchor)?;
        self.overlay.replace(anchor, bytes)
    }

    /// Insert `bytes` at original offset `at`. See [`Overlay::insert`].
    pub fn insert(&mut self, at: usize, bytes: Vec<u8>) -> Result<Anchor, OverlayError> {
        self.in_bounds(Span::new(at, at).into())?;
        self.overlay.insert(at, bytes)
    }

    /// Undo helper: put back `prev` or remove the slot when `None`. See [`Overlay::restore`].
    pub fn restore(&mut self, anchor: impl Into<Anchor>, prev: Option<Vec<u8>>) {
        self.overlay.restore(anchor.into(), prev);
    }

    /// The current bytes as a sequence of slices to stream to the writer: original gaps
    /// interleaved with slot contents. With no slots it yields the whole original once,
    /// so a no-edit save is byte-identical.
    pub fn pieces(&self) -> impl Iterator<Item = &[u8]> {
        self.overlay.pieces(&self.original)
    }

    /// Write the current document to `path`, backing up any existing file first.
    pub fn save_as(&self, path: impl AsRef<Path>) -> Result<SaveOutcome, Error> {
        self.save_as_with(path, |_| {})
    }

    /// [`Self::save_as`], reporting write progress as a fraction in `0..=1`.
    pub fn save_as_with(
        &self,
        path: impl AsRef<Path>,
        mut progress: impl FnMut(f64),
    ) -> Result<SaveOutcome, Error> {
        let path = path.as_ref();
        let backup = format::of(self.kind()).save(self, path, &mut progress)?;
        Ok(SaveOutcome {
            path: path.to_path_buf(),
            backup,
        })
    }

    /// Bytes per top-level key (duplicates summed), largest first.
    pub fn section_sizes(&self) -> Vec<(String, usize)> {
        let mut sizes: HashMap<String, usize> = HashMap::new();
        for s in self.index.sections() {
            *sizes
                .entry(key_name(&self.original, s).into_owned())
                .or_default() += s.stmt.len();
        }
        let mut sizes: Vec<_> = sizes.into_iter().collect();
        sizes.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        sizes
    }

    /// The overlay does not hold the original, so the document bounds every anchor.
    fn in_bounds(&self, anchor: Anchor) -> Result<(), OverlayError> {
        let len = self.original.len();
        if anchor.end() > len {
            return Err(OverlayError::OutOfBounds {
                span: Span::new(anchor.start(), anchor.end()),
                len,
            });
        }
        Ok(())
    }
}
