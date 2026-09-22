//! Static galaxy scenario scripts (`map/setup_scenarios/*.txt`): the index of the
//! `static_galaxy_scenario` body, the header scalars, and where each system, hyperlane
//! and nebula statement lives.
//!
//! Every statement is named by an [`Anchor`], so a statement inserted by an op has the
//! same standing as one the file already held. The id map is rebuilt from the bytes
//! currently standing for each statement, never from a running tally.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::NULL_ID;
use crate::Span;
use crate::cst::{self, CstError, Node};
use crate::document::Document;
use crate::keys::scenario as keys;
use crate::lexer::Mode;
use crate::overlay::{Anchor, Overlay, OverlayError};
use crate::projections::galaxy::HeaderField;
use crate::scan::{self, Index, Value};

/// The sign each axis is read with: a scenario's `position` runs the same way as a
/// save's `coordinate`, checked in-game (`docs/adr/0004-scenario-documents.md`). This is
/// the one place a scenario's coordinates become the map's.
pub const SCENARIO_X_SIGN: f64 = 1.0;
pub const SCENARIO_Y_SIGN: f64 = 1.0;

/// A scenario document always holds its index: the kind is that field.
pub(crate) fn index(doc: &Document) -> &ScenarioIndex {
    doc.scenario()
        .expect("a scenario document holds a scenario index")
}

/// What a header statement is indented with when the file holds none to copy.
const DEFAULT_INDENT: &[u8] = b"	";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(
        "`setup_scenario` is a dynamic shape scenario, which this editor cannot open; only `static_galaxy_scenario` files are supported"
    )]
    Dynamic,
    #[error("the file holds no `static_galaxy_scenario` block")]
    NotAScenario,
    #[error(
        "the file holds {count} top-level statements; a scenario file holds one `static_galaxy_scenario` block"
    )]
    NotOneStatement { count: usize },
    #[error("`static_galaxy_scenario` is not a block")]
    NotABlock,
    #[error("system id `{text}` at byte {offset} is not a number")]
    SystemId { offset: usize, text: String },
    #[error("the system at byte {offset} has no id")]
    MissingId { offset: usize },
    #[error("scenario name {0:?} may not be empty or hold a quote, a backslash or a line break")]
    InvalidName(String),
    #[error(transparent)]
    Scan(#[from] scan::ScanError),
    #[error(transparent)]
    Cst(#[from] CstError),
    #[error(transparent)]
    Overlay(#[from] OverlayError),
}

/// One header statement: the field the app sees and the slot an op rewrites.
#[derive(Clone, Debug, PartialEq)]
pub struct HeaderStmt {
    pub field: HeaderField,
    pub anchor: Anchor,
}

/// The scalars a scenario carries before its systems, as the current bytes read them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ScenarioHeader {
    /// Every statement that is not a system, hyperlane or nebula, in file order,
    /// duplicates kept: the game takes the first of a repeated key.
    pub statements: Vec<HeaderStmt>,
    pub name: String,
    pub core_radius: Option<f64>,
    /// `coordinate_transform` is present, so the positions in the file are not the ones
    /// the game plots.
    pub has_coordinate_transform: bool,
    /// Where a key the header lacks is inserted: the line start of the first system,
    /// hyperlane or nebula statement, else the scenario's own insertion slot.
    pub insert_at: usize,
    /// What such a statement is indented with: the last header statement's indentation.
    pub indent: Vec<u8>,
}

impl ScenarioHeader {
    /// The header as the app lists it.
    pub fn fields(&self) -> Vec<HeaderField> {
        self.statements.iter().map(|s| s.field.clone()).collect()
    }

    /// The first statement of `key`, which is the one the game reads.
    pub fn get(&self, key: &str) -> Option<&HeaderStmt> {
        self.statements.iter().find(|s| s.field.key == key)
    }

    /// Every statement of `key`, in file order.
    pub fn all<'a>(&'a self, key: &'a str) -> impl Iterator<Item = &'a HeaderStmt> {
        self.statements.iter().filter(move |s| s.field.key == key)
    }
}

/// One `add_hyperlane` or `prevent_hyperlane` statement as it currently reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LaneStmt {
    pub anchor: Anchor,
    pub from: u32,
    pub to: u32,
    /// `prevent_hyperlane` rather than `add_hyperlane`.
    pub prevent: bool,
}

/// What one body statement reads as.
#[derive(Clone, Debug, PartialEq)]
enum Stmt {
    System(u32),
    /// `ends` is `None` when either end is not a number.
    Lane {
        prevent: bool,
        ends: Option<(u32, u32)>,
    },
    Nebula,
    Header {
        field: HeaderField,
        indent: Vec<u8>,
    },
}

/// What a [`ScenarioIndex::refresh`] found changed, for the projection to follow.
#[derive(Debug, Default)]
pub(crate) struct Changes {
    /// Systems whose statement was rewritten, added or removed.
    pub systems: BTreeSet<u32>,
    /// Systems a hyperlane statement that was rewritten, added or removed names.
    pub lanes: BTreeSet<u32>,
    /// A `nebula` statement was rewritten, added or removed.
    pub nebulae: bool,
}

#[derive(Clone, Debug)]
pub struct ScenarioIndex {
    /// The statements inside the `static_galaxy_scenario` braces, indexed as a file.
    pub body: Index,
    /// Inside the braces, exclusive of both.
    pub body_span: Span,
    /// Where a new statement goes: the start of the line holding the closing brace.
    pub insert_at: usize,
    pub header: ScenarioHeader,
    /// Every statement standing in the body, in emission order.
    stmts: BTreeMap<Anchor, Stmt>,
    systems: BTreeMap<u32, Anchor>,
    /// System ids in file order.
    order: Vec<u32>,
    nebulae: Vec<Anchor>,
    /// The hyperlane statements naming each system at either end.
    lanes_of: HashMap<u32, BTreeSet<Anchor>>,
}

impl ScenarioIndex {
    /// Index a scenario file, refusing anything that is not one static galaxy scenario.
    pub fn build(bytes: &[u8]) -> Result<Self, Error> {
        Ok(Self::build_indexed(bytes)?.0)
    }

    /// [`Self::build`] together with the whole-file scan it made, so a caller that holds
    /// the file as a document does not scan it a second time.
    pub fn build_indexed(bytes: &[u8]) -> Result<(Self, Index), Error> {
        let index = scan::scan_range_with(bytes, 0..bytes.len(), Mode::Script)?;
        let section = match index.sections() {
            [one] => one,
            [] => return Err(Error::NotAScenario),
            many => return Err(Error::NotOneStatement { count: many.len() }),
        };
        match scan::key_name(bytes, section).as_ref() {
            keys::STATIC_GALAXY_SCENARIO => {}
            keys::SETUP_SCENARIO => return Err(Error::Dynamic),
            _ => return Err(Error::NotAScenario),
        }
        let Value::Block { open, close } = section.value else {
            return Err(Error::NotABlock);
        };
        let body_span = Span::new(open + 1, close);
        let body = scan::scan_range_with(bytes, body_span.range(), Mode::Script)?;
        let mut scenario = Self {
            header: ScenarioHeader::default(),
            body,
            body_span,
            insert_at: cst::line_start(bytes, close),
            stmts: BTreeMap::new(),
            systems: BTreeMap::new(),
            order: Vec::new(),
            nebulae: Vec::new(),
            lanes_of: HashMap::new(),
        };
        let overlay = Overlay::new();
        let (mut counted, mut line) = (0, 1);
        let anchors: Vec<Anchor> = scenario
            .body
            .sections()
            .iter()
            .map(|s| Anchor::Original(s.stmt))
            .collect();
        for anchor in anchors {
            line += newlines(&bytes[counted..anchor.start()]);
            counted = anchor.start();
            if let Some(stmt) = scenario.read(bytes, &overlay, anchor, Some(line))? {
                scenario.index_lanes(anchor, &stmt, true);
                scenario.stmts.insert(anchor, stmt);
            }
        }
        scenario.list_systems();
        scenario.list_nebulae();
        scenario.list_header(bytes);
        Ok((scenario, index))
    }

    /// Re-read the statements `slots` hold from their current bytes, so a statement an op
    /// emptied is gone and one it inserted is listed. Only those statements are read; on
    /// error nothing is changed.
    ///
    /// The header is read here rather than once at build because a header op rewrites,
    /// inserts and removes statements like any other, and a projection read from the
    /// original bytes would go stale the moment one applied.
    pub(crate) fn refresh(
        &mut self,
        original: &[u8],
        overlay: &Overlay,
        slots: &[Anchor],
    ) -> Result<Changes, Error> {
        let mut read = Vec::new();
        for anchor in self.statements_in(slots) {
            read.push((anchor, self.read(original, overlay, anchor, None)?));
        }
        let mut changes = Changes::default();
        let (mut systems, mut nebulae, mut header) = (false, false, false);
        for (anchor, new) in read {
            let old = match &new {
                Some(stmt) => self.stmts.insert(anchor, stmt.clone()),
                None => self.stmts.remove(&anchor),
            };
            let id = |stmt: &Option<Stmt>| match stmt {
                Some(Stmt::System(id)) => Some(*id),
                _ => None,
            };
            let is_nebula = |stmt: &Option<Stmt>| matches!(stmt, Some(Stmt::Nebula));
            systems |= id(&old) != id(&new);
            nebulae |= is_nebula(&old) != is_nebula(&new);
            for stmt in [&old, &new].into_iter().flatten() {
                match stmt {
                    Stmt::System(id) => {
                        changes.systems.insert(*id);
                    }
                    Stmt::Lane { ends, .. } => {
                        changes.lanes.extend(ends.iter().flat_map(|e| [e.0, e.1]))
                    }
                    Stmt::Nebula => changes.nebulae = true,
                    Stmt::Header { .. } => header = true,
                }
            }
            if let Some(stmt) = &old {
                self.index_lanes(anchor, stmt, false);
            }
            if let Some(stmt) = &new {
                self.index_lanes(anchor, stmt, true);
            }
        }
        if systems {
            self.list_systems();
        }
        if nebulae {
            self.list_nebulae();
        }
        if header {
            self.list_header(original);
        } else {
            self.header.insert_at = self.first_entity(original);
        }
        Ok(changes)
    }

    /// The statement holding system `id`.
    pub fn system(&self, id: u32) -> Option<Anchor> {
        self.systems.get(&id).copied()
    }

    /// Every system with its statement, in file order.
    pub fn systems(&self) -> impl Iterator<Item = (u32, Anchor)> + '_ {
        self.order
            .iter()
            .filter_map(|&id| Some((id, self.system(id)?)))
    }

    /// The system last in file order, with its statement.
    pub fn last_system(&self) -> Option<(u32, Anchor)> {
        let &id = self.order.last()?;
        Some((id, self.system(id)?))
    }

    /// System ids in file order.
    pub fn order(&self) -> &[u32] {
        &self.order
    }

    /// An id no system holds: one past the highest, or 1 when there are none.
    /// [`NULL_ID`] is what a file writes for "no system", so the lowest free id stands
    /// in when one past the highest would be it.
    pub fn next_id(&self) -> u32 {
        let after = self
            .systems
            .keys()
            .next_back()
            .map_or(1, |max| max.saturating_add(1));
        if after == NULL_ID {
            return (1..NULL_ID)
                .find(|id| !self.systems.contains_key(id))
                .unwrap_or(1);
        }
        after
    }

    /// The `index`th `nebula` statement, in file order.
    pub fn nebula(&self, index: usize) -> Option<Anchor> {
        self.nebulae.get(index).copied()
    }

    /// Every `nebula` statement, in file order.
    pub fn nebulae(&self) -> &[Anchor] {
        &self.nebulae
    }

    /// Every hyperlane statement as its current bytes read it, in file order; one whose
    /// ends do not parse is left out.
    pub fn lane_statements(&self) -> impl DoubleEndedIterator<Item = LaneStmt> + '_ {
        self.stmts
            .iter()
            .filter_map(|(&anchor, stmt)| lane_stmt(anchor, stmt))
    }

    /// Every hyperlane statement naming system `id` at either end, in file order.
    pub fn lanes_naming(&self, id: u32) -> impl Iterator<Item = LaneStmt> + '_ {
        self.lanes_of
            .get(&id)
            .into_iter()
            .flatten()
            .filter_map(|&anchor| lane_stmt(anchor, self.stmts.get(&anchor)?))
    }

    /// What the statement at `anchor` now reads as; `None` when it is gone or empty. `line`
    /// is the one it starts on in the file as opened, counted here when not given.
    fn read(
        &self,
        original: &[u8],
        overlay: &Overlay,
        anchor: Anchor,
        line: Option<u32>,
    ) -> Result<Option<Stmt>, Error> {
        if anchor.is_inserted() && !self.in_body(anchor) {
            return Ok(None);
        }
        if removed(overlay, anchor, original) {
            return Ok(None);
        }
        let buf = match overlay.current(anchor, original) {
            Ok(buf) => buf,
            Err(OverlayError::MissingInsert { .. }) => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        let root = cst::parse_script(buf, 0)?;
        let Some(node) = root.children().first() else {
            return Ok(None);
        };
        let lane = |prevent| {
            let end =
                |key: &str| -> Option<u32> { node.find(key, buf)?.scalar_str(buf)?.parse().ok() };
            Stmt::Lane {
                prevent,
                ends: end(keys::FROM).zip(end(keys::TO)),
            }
        };
        Ok(match node.key_str(buf) {
            Some(keys::SYSTEM) => Some(Stmt::System(system_id(node, buf, anchor.start())?)),
            Some(keys::ADD_HYPERLANE) => Some(lane(false)),
            Some(keys::PREVENT_HYPERLANE) => Some(lane(true)),
            Some(keys::NEBULA) => Some(Stmt::Nebula),
            Some(key) => Some(Stmt::Header {
                field: HeaderField {
                    key: key.to_owned(),
                    value: String::from_utf8_lossy(node.value_span().slice(buf)).into_owned(),
                    line: line.unwrap_or_else(|| {
                        1 + newlines(&original[..anchor.start().min(original.len())])
                    }),
                },
                indent: indent_of(original, buf, anchor),
            }),
            None => None,
        })
    }

    /// Every body statement a slot holds: an inserted one is its own statement, and an
    /// original slot holds the statements its span reaches, which is the one it rewrote or
    /// the one whose line it took.
    fn statements_in(&self, slots: &[Anchor]) -> BTreeSet<Anchor> {
        let sections = self.body.sections();
        let mut anchors = BTreeSet::new();
        for &slot in slots {
            let Anchor::Original(span) = slot else {
                anchors.insert(slot);
                continue;
            };
            let first = sections.partition_point(|s| s.stmt.end <= span.start);
            anchors.extend(
                sections[first..]
                    .iter()
                    .take_while(|s| s.stmt.start < span.end)
                    .map(|s| Anchor::Original(s.stmt)),
            );
        }
        anchors
    }

    fn in_body(&self, anchor: Anchor) -> bool {
        (self.body_span.start..=self.body_span.end).contains(&anchor.start())
    }

    /// File `anchor` under the systems its hyperlane statement names, or take it away.
    fn index_lanes(&mut self, anchor: Anchor, stmt: &Stmt, add: bool) {
        let Stmt::Lane {
            ends: Some((from, to)),
            ..
        } = *stmt
        else {
            return;
        };
        for id in [from, to] {
            if add {
                self.lanes_of.entry(id).or_default().insert(anchor);
            } else if let Some(anchors) = self.lanes_of.get_mut(&id) {
                anchors.remove(&anchor);
                if anchors.is_empty() {
                    self.lanes_of.remove(&id);
                }
            }
        }
    }

    /// A repeated id keeps the place of its first statement and names its last.
    fn list_systems(&mut self) {
        self.systems.clear();
        self.order.clear();
        for (&anchor, stmt) in &self.stmts {
            if let Stmt::System(id) = *stmt
                && self.systems.insert(id, anchor).is_none()
            {
                self.order.push(id);
            }
        }
    }

    fn list_nebulae(&mut self) {
        self.nebulae = self
            .stmts
            .iter()
            .filter(|(_, stmt)| matches!(stmt, Stmt::Nebula))
            .map(|(&anchor, _)| anchor)
            .collect();
    }

    fn list_header(&mut self, original: &[u8]) {
        let mut header = ScenarioHeader {
            insert_at: self.first_entity(original),
            indent: DEFAULT_INDENT.to_vec(),
            ..ScenarioHeader::default()
        };
        for (&anchor, stmt) in &self.stmts {
            if let Stmt::Header { field, indent } = stmt {
                header.indent.clone_from(indent);
                header.statements.push(HeaderStmt {
                    field: field.clone(),
                    anchor,
                });
            }
        }
        read_scalars(&mut header);
        self.header = header;
    }

    /// Where a header key the file lacks goes: the line start of the first system,
    /// hyperlane or nebula statement, else the scenario's own insertion slot.
    fn first_entity(&self, original: &[u8]) -> usize {
        self.stmts
            .iter()
            .find(|(_, stmt)| !matches!(stmt, Stmt::Header { .. }))
            .map_or(self.insert_at, |(&anchor, _)| {
                cst::line_start(original, anchor.start().min(original.len()))
            })
    }
}

fn lane_stmt(anchor: Anchor, stmt: &Stmt) -> Option<LaneStmt> {
    let Stmt::Lane {
        prevent,
        ends: Some((from, to)),
    } = *stmt
    else {
        return None;
    };
    Some(LaneStmt {
        anchor,
        from,
        to,
        prevent,
    })
}

/// Whether the statement at `anchor` is gone: the bytes now standing for it, whether
/// that is its own slot or the bigger slot that swallowed it when a removal took the
/// whole line, are blank.
pub(crate) fn removed(overlay: &Overlay, anchor: Anchor, original: &[u8]) -> bool {
    let Anchor::Original(span) = anchor else {
        return false;
    };
    let blank = |bytes: &[u8]| bytes.iter().all(u8::is_ascii_whitespace);
    match overlay.current(anchor, original) {
        Ok(bytes) => blank(bytes),
        Err(_) => overlay.enclosing(span).is_some_and(blank),
    }
}

/// The few header keys the editor reads as values rather than as raw text, from the
/// fields just listed.
fn read_scalars(header: &mut ScenarioHeader) {
    let scalar = |key: &str| {
        let text = &header.get(key)?.field.value;
        (!text.starts_with('{'))
            .then(|| String::from_utf8_lossy(scan::unquote(text.as_bytes())).into_owned())
    };
    let name = scalar(keys::NAME).unwrap_or_default();
    let core_radius = scalar(keys::CORE_RADIUS).and_then(|s| s.parse().ok());
    header.has_coordinate_transform = header.get(keys::COORDINATE_TRANSFORM).is_some();
    header.name = name;
    header.core_radius = core_radius;
}

/// The indentation the statement at `anchor` carries; an inserted one brought its own
/// along in its text.
fn indent_of(original: &[u8], buf: &[u8], anchor: Anchor) -> Vec<u8> {
    match anchor {
        Anchor::Original(span) => cst::indent_of(original, span.start).to_vec(),
        Anchor::Inserted { .. } => cst::indent_of(buf, 0).to_vec(),
    }
}

fn newlines(bytes: &[u8]) -> u32 {
    crate::as_u32(bytes.iter().filter(|&&b| b == b'\n').count())
}

/// `node` is one `system=` statement; `base` is where its bytes start in the file.
fn system_id(node: &Node, src: &[u8], base: usize) -> Result<u32, Error> {
    let missing = Error::MissingId {
        offset: base + node.span().start,
    };
    let span = node
        .find(keys::ID, src)
        .and_then(Node::scalar_span)
        .ok_or(missing)?;
    let text = String::from_utf8_lossy(scan::unquote(span.slice(src)));
    text.parse().map_err(|_| Error::SystemId {
        offset: base + span.start,
        text: text.into_owned(),
    })
}
