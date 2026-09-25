//! Reading one entity of any kind: the Contents, Data and Source tabs of the inspector.
//!
//! One call parses one entity's current bytes and returns one level of it, so the payload
//! is bounded by that level's width rather than by the entity's size; nothing is cached,
//! because a cache would have to be invalidated by every op.

mod address;
pub(crate) mod facts;
mod node;
mod schema;
mod source;
pub mod views;

use crate::as_u32;
use crate::cst::{CstError, Node};
use crate::document::Document;
use crate::entity::node::Baseline;
use crate::format;
use crate::keys;
use crate::overlay::OverlayError;
use crate::projections::galaxy::ProjectionError;
use crate::projections::name::NameTemplate;
use crate::span::Span;
use crate::views::{ErrorKind, SgfError};

pub(crate) use address::{address, inner_sections};
pub use schema::{EntitySchema, FieldSchema, FieldType};
pub use views::{
    ContentsRow, EntityAddr, EntityKind, EntityNode, EntitySource, EntityView, Fact, NodeValue,
    PlanetPage, PlanetPageColony, PlanetPageDeposit, PlanetPageMoon, PlanetPageSpecies,
    PlanetPageTimedModifier, ScalarForm,
};

#[derive(Debug, thiserror::Error)]
pub enum EntityError {
    #[error("{0} not found")]
    NotFound(EntityAddr),
    /// No node at the path a drill named.
    #[error("{addr}: no node at {}", path.join("."))]
    NoPath { addr: EntityAddr, path: Vec<String> },
    #[error("{addr}: {source}")]
    Parse {
        addr: EntityAddr,
        #[source]
        source: CstError,
    },
    #[error(transparent)]
    Overlay(#[from] OverlayError),
    #[error(transparent)]
    Projection(#[from] ProjectionError),
}

impl From<EntityError> for SgfError {
    fn from(e: EntityError) -> Self {
        let kind = match e {
            EntityError::NotFound(_) | EntityError::NoPath { .. } => ErrorKind::NotFound,
            _ => ErrorKind::Format,
        };
        Self::new(kind, e.to_string())
    }
}

/// The children of `addr` at `path`, with the entity's own state around them.
///
/// `path` is empty for the entity's root. A tombstone (`<id>=none`) yields the scalar
/// `none` as its one node, not an error.
pub fn get_entity(
    doc: &Document,
    addr: EntityAddr,
    path: &[String],
) -> Result<EntityView, EntityError> {
    let located = address::locate(doc, addr)?;
    let current = doc.current(located.anchor)?;
    let root = parse(doc, addr, current)?;
    let statement = first_statement(addr, &root)?;
    // An inserted statement stands against no original at all, so it is dirty throughout.
    let dirty = located.original.is_none_or(|stmt| is_dirty(doc, stmt));
    let was = located
        .original
        .filter(|_| dirty)
        .map(|stmt| {
            let bytes = stmt.slice(doc.original());
            parse(doc, addr, bytes).map(|root| (root, bytes))
        })
        .transpose()?;
    let name = statement
        .find(keys::NAME, current)
        .map(|n| NameTemplate::parse(n, current));

    let nodes = if statement.scalar_span().is_some() {
        match path.is_empty() {
            true => vec![root_value(statement, current)],
            false => return Err(no_path(addr, path)),
        }
    } else {
        let target = node::resolve(statement, current, path).ok_or_else(|| no_path(addr, path))?;
        let baseline = match &was {
            None if dirty => Baseline::New,
            None => Baseline::Clean,
            Some((root, bytes)) => root
                .children()
                .first()
                .and_then(|statement| node::resolve(statement, bytes, path))
                .map_or(Baseline::New, |node| Baseline::Was(node, bytes)),
        };
        node::level(target, current, path, baseline)
    };

    // The curated rows describe the entity, not the level a drill is standing on, so they
    // are read once at the root and the nodelist a drill opens carries none of its own.
    let curated = path.is_empty()
        && statement.scalar_span().is_none()
        && format::of(doc.kind()).curates_entities();
    let sheet = match curated {
        true => facts::sheet(doc, addr, statement, current),
        false => facts::Sheet::default(),
    };

    Ok(EntityView {
        addr,
        path: path.to_vec(),
        label: label(addr, name.as_ref()),
        name,
        span: [located.anchor.start(), located.anchor.end()],
        dirty,
        bytes: as_u32(current.len()),
        nodes,
        overview: sheet.overview,
        contents: sheet.contents,
    })
}

/// A save body's own Overview, read from its current bytes. A scenario addresses no
/// planets, so there every id is [`EntityError::NotFound`].
pub fn get_planet_page(doc: &Document, id: u32) -> Result<PlanetPage, EntityError> {
    let addr = EntityAddr::new(EntityKind::Planet, id);
    let located = address::locate(doc, addr)?;
    let current = doc.current(located.anchor)?;
    let root = parse(doc, addr, current)?;
    let statement = first_statement(addr, &root)?;
    if statement.scalar_span().is_some() {
        return Err(EntityError::NotFound(addr));
    }
    Ok(facts::planet::page(doc, id, statement, current))
}

/// The entity's current bytes as text, with the ranges an op changed.
pub fn get_entity_source(doc: &Document, addr: EntityAddr) -> Result<EntitySource, EntityError> {
    let located = address::locate(doc, addr)?;
    let current = doc.current(located.anchor)?;
    // An inserted statement has no original, so every line of it reads as changed.
    let (original, dirty) = match located.original {
        Some(stmt) => (stmt.slice(doc.original()), is_dirty(doc, stmt)),
        None => (&[][..], true),
    };
    Ok(source::source(addr, original, current, dirty))
}

/// The labels, controls and references the Data tab draws a kind's keys with.
pub fn get_entity_schema(kind: EntityKind) -> EntitySchema {
    schema::of(kind)
}

fn parse(doc: &Document, addr: EntityAddr, bytes: &[u8]) -> Result<Node, EntityError> {
    format::of(doc.kind())
        .parse(bytes, 0)
        .map_err(|source| EntityError::Parse { addr, source })
}

/// The `<id>=` statement: the one child of a parsed entity's synthetic root.
fn first_statement(addr: EntityAddr, root: &Node) -> Result<&Node, EntityError> {
    root.children().first().ok_or(EntityError::Parse {
        addr,
        source: CstError {
            offset: 0,
            reason: "empty entity",
        },
    })
}

/// A tombstone's own value, so `<id>=none` reads as a node rather than an error.
fn root_value(statement: &Node, src: &[u8]) -> EntityNode {
    let span = statement.value_span();
    EntityNode {
        key: None,
        path: Vec::new(),
        value: node::value(statement, src),
        span: [span.start, span.end],
        changed: false,
    }
}

fn label(addr: EntityAddr, name: Option<&NameTemplate>) -> String {
    name.map(NameTemplate::stand_in)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("{} #{}", addr.kind, addr.id))
}

fn no_path(addr: EntityAddr, path: &[String]) -> EntityError {
    EntityError::NoPath {
        addr,
        path: path.to_vec(),
    }
}

/// Whether an op has rewritten this statement: an overlay slot overlaps it.
fn is_dirty(doc: &Document, stmt: Span) -> bool {
    doc.overlay()
        .slots()
        .any(|(slot, _)| slot.start() < stmt.end && slot.end() > stmt.start)
}
