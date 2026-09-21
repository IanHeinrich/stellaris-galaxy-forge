//! Static galaxy scenario scripts (`map/setup_scenarios/*.txt`): the index of the
//! `static_galaxy_scenario` body, the header scalars, and where each system, hyperlane
//! and nebula statement lives.
//!
//! Every statement is named by an [`Anchor`], so a statement inserted by an op has the
//! same standing as one the file already held. The id map is rebuilt from the bytes
//! currently standing for each statement, never from a running tally.

use std::collections::BTreeMap;

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
    /// The `max` of `num_empires = { min = … max = … }`.
    pub num_empires_max: Option<u32>,
    pub num_empire_default: Option<u32>,
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

#[derive(Clone, Debug)]
pub struct ScenarioIndex {
    /// The statements inside the `static_galaxy_scenario` braces, indexed as a file.
    pub body: Index,
    /// Inside the braces, exclusive of both.
    pub body_span: Span,
    /// Where a new statement goes: the start of the line holding the closing brace.
    pub insert_at: usize,
    pub header: ScenarioHeader,
    systems: BTreeMap<u32, Anchor>,
    /// System ids in file order.
    order: Vec<u32>,
    lanes: Vec<(Anchor, bool)>,
    nebulae: Vec<Anchor>,
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
            systems: BTreeMap::new(),
            order: Vec::new(),
            lanes: Vec::new(),
            nebulae: Vec::new(),
        };
        scenario.rebuild(bytes, &Overlay::new())?;
        Ok((scenario, index))
    }

    /// Re-read every statement's current bytes and rebuild the id map and the header from
    /// them, so a statement an op emptied is gone and one it inserted is listed.
    ///
    /// The header is read here rather than once at build because a header op rewrites,
    /// inserts and removes statements like any other, and a projection read from the
    /// original bytes would go stale the moment one applied.
    pub fn rebuild(&mut self, original: &[u8], overlay: &Overlay) -> Result<(), Error> {
        let mut systems = BTreeMap::new();
        let mut order = Vec::new();
        let mut lanes = Vec::new();
        let mut nebulae = Vec::new();
        let mut header = ScenarioHeader {
            insert_at: self.insert_at,
            indent: DEFAULT_INDENT.to_vec(),
            ..ScenarioHeader::default()
        };
        let mut first_entity = None;
        let mut counted = 0;
        let mut line = 1;
        for anchor in self.anchors(overlay) {
            if removed(overlay, anchor, original) {
                continue;
            }
            let start = anchor.start().min(original.len());
            line += newlines(&original[counted..start]);
            counted = start;
            let buf = overlay.current(anchor, original)?;
            let root = cst::parse_script(buf, 0)?;
            let Some(node) = root.children().first() else {
                continue;
            };
            match node.key_str(buf) {
                Some(keys::SYSTEM) => {
                    let id = system_id(node, buf, anchor.start())?;
                    if systems.insert(id, anchor).is_none() {
                        order.push(id);
                    }
                    first_entity.get_or_insert(anchor);
                }
                Some(keys::ADD_HYPERLANE) => {
                    lanes.push((anchor, false));
                    first_entity.get_or_insert(anchor);
                }
                Some(keys::PREVENT_HYPERLANE) => {
                    lanes.push((anchor, true));
                    first_entity.get_or_insert(anchor);
                }
                Some(keys::NEBULA) => {
                    nebulae.push(anchor);
                    first_entity.get_or_insert(anchor);
                }
                Some(key) => {
                    header.indent = indent_of(original, buf, anchor);
                    header.statements.push(HeaderStmt {
                        field: HeaderField {
                            key: key.to_owned(),
                            value: String::from_utf8_lossy(node.value_span().slice(buf))
                                .into_owned(),
                            line,
                        },
                        anchor,
                    });
                }
                None => {}
            }
        }
        if let Some(anchor) = first_entity {
            header.insert_at = cst::line_start(original, anchor.start().min(original.len()));
        }
        read_scalars(&mut header);
        self.systems = systems;
        self.order = order;
        self.lanes = lanes;
        self.nebulae = nebulae;
        self.header = header;
        Ok(())
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

    /// Every hyperlane statement as its current bytes read it; one whose ends no longer
    /// parse is left out.
    pub fn lane_statements(&self, doc: &Document) -> Vec<LaneStmt> {
        self.lanes
            .iter()
            .filter_map(|&(anchor, prevent)| {
                let buf = doc.current(anchor).ok()?;
                let root = cst::parse_script(buf, 0).ok()?;
                let node = root.children().first()?;
                let end = |key: &str| -> Option<u32> {
                    node.find(key, buf)?.scalar_str(buf)?.parse().ok()
                };
                Some(LaneStmt {
                    anchor,
                    from: end(keys::FROM)?,
                    to: end(keys::TO)?,
                    prevent,
                })
            })
            .collect()
    }

    /// Every statement of the body in emission order: the ones the file holds plus the
    /// ones inserted inside it. The insertion point sits at the closing brace, which is
    /// the body's end, so the range is inclusive of it.
    fn anchors(&self, overlay: &Overlay) -> Vec<Anchor> {
        let mut anchors: Vec<Anchor> = self
            .body
            .sections()
            .iter()
            .map(|s| Anchor::Original(s.stmt))
            .collect();
        let body = self.body_span.start..=self.body_span.end;
        anchors.extend(
            overlay
                .slots()
                .map(|(anchor, _)| anchor)
                .filter(|a| a.is_inserted() && body.contains(&a.start())),
        );
        anchors.sort_unstable();
        anchors
    }
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
    let num_empire_default = scalar(keys::NUM_EMPIRE_DEFAULT).and_then(|s| s.parse().ok());
    let num_empires_max = header
        .get(keys::NUM_EMPIRES)
        .and_then(|stmt| block_field(keys::NUM_EMPIRES, &stmt.field.value, keys::MAX));
    header.has_coordinate_transform = header.get(keys::COORDINATE_TRANSFORM).is_some();
    header.name = name;
    header.core_radius = core_radius;
    header.num_empires_max = num_empires_max;
    header.num_empire_default = num_empire_default;
}

/// One number inside a header block, `key = { … field = N … }`, read from the raw text.
fn block_field(key: &str, raw: &str, field: &str) -> Option<u32> {
    let text = format!("{key} = {raw}");
    let bytes = text.as_bytes();
    let root = cst::parse_script(bytes, 0).ok()?;
    let node = root.children().first()?;
    node.find(field, bytes)?.scalar_str(bytes)?.parse().ok()
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
