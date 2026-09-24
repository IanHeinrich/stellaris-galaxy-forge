//! One reader per kind: the facts its Overview and Contents rows are built from.
//!
//! A reader takes a parsed entity and the bytes it spans and returns a struct, so the
//! details projection runs it over a whole table while [`super::get_entity`] runs it over
//! one entity and both see the same fields. Values stay as the save wrote them: a class,
//! a level or a deposit is a raw key, because turning one into what the player reads
//! needs the install's definitions and belongs to the app.

pub(crate) mod fleet;
pub(crate) mod megastructure;
pub(crate) mod planet;
pub(crate) mod starbase;
pub(crate) mod system;

use crate::NULL_ID;
use crate::cst::{self, Node};
use crate::document::Document;
use crate::entity::address;
use crate::entity::views::{ContentsRow, EntityAddr, EntityKind, Fact};
use crate::overlay::Anchor;

/// The curated rows of one entity's root level.
#[derive(Debug, Default)]
pub(crate) struct Sheet {
    pub overview: Vec<Fact>,
    pub contents: Vec<ContentsRow>,
}

impl Sheet {
    /// A row the save wrote as text; nothing is added for an empty value.
    fn fact(&mut self, label: &str, value: &str, path: &[&str]) {
        if value.is_empty() {
            return;
        }
        self.overview.push(Fact {
            label: label.to_owned(),
            value: value.to_owned(),
            icon: None,
            link: None,
            path: Some(owned(path)),
        });
    }

    /// A row naming another entity; the null id names nothing.
    fn reference(&mut self, label: &str, kind: EntityKind, id: u32, path: &[&str]) {
        if id == NULL_ID {
            return;
        }
        self.overview.push(Fact {
            label: label.to_owned(),
            value: id.to_string(),
            icon: None,
            link: Some(EntityAddr::new(kind, id)),
            path: Some(owned(path)),
        });
    }

    /// A row whose value is a key of its own and whose link, when the save names one, is
    /// what that key is aimed at: a fleet's order and the planet it is surveying.
    fn aimed(&mut self, label: &str, value: &str, target: Option<EntityAddr>, path: &[&str]) {
        if value.is_empty() {
            return;
        }
        self.overview.push(Fact {
            label: label.to_owned(),
            value: value.to_owned(),
            icon: None,
            link: target,
            path: Some(owned(path)),
        });
    }

    /// A row read from another entity's bytes, so it carries no path of its own.
    fn borrowed(&mut self, label: &str, value: String) {
        self.overview.push(Fact {
            label: label.to_owned(),
            value,
            icon: None,
            link: None,
            path: None,
        });
    }

    /// A Contents row for child entities a repeated key names (`planet=` appears once per
    /// body), which is no single node of this entity and so carries no path to badge.
    fn entities(&mut self, label: &str, count: u32, of: EntityKind) {
        if count == 0 {
            return;
        }
        self.contents.push(ContentsRow {
            label: label.to_owned(),
            count,
            link: None,
            path: None,
            of: Some(of),
        });
    }

    /// A Contents row drilling into a node list of this entity; an empty list is no row.
    fn rows(&mut self, label: &str, count: u32, path: &[&str], of: Option<EntityKind>) {
        if count == 0 {
            return;
        }
        self.contents.push(ContentsRow {
            label: label.to_owned(),
            count,
            link: None,
            path: Some(owned(path)),
            of,
        });
    }
}

fn owned(path: &[&str]) -> Vec<String> {
    path.iter().map(|s| (*s).to_owned()).collect()
}

/// The Overview and Contents of `addr`'s root level, empty for a kind with no curated
/// view of its own (country, colony, ship, pop group, sector, deposit), which open on Data.
pub(crate) fn sheet(doc: &Document, addr: EntityAddr, node: &Node, src: &[u8]) -> Sheet {
    match addr.kind {
        EntityKind::System => system::sheet(&system::read(node, src)),
        EntityKind::Planet => planet::sheet(&planet::read(node, src), doc),
        EntityKind::Fleet => fleet::sheet(&fleet::read(node, src)),
        EntityKind::Starbase => starbase::sheet(&starbase::read(node, src), doc),
        EntityKind::Megastructure => megastructure::sheet(&megastructure::read(node, src)),
        _ => Sheet::default(),
    }
}

/// The parsed statement of another entity, for the one cross-entity fact a kind needs
/// (a planet's pops, a starbase's hull). `None` when it is absent or a tombstone.
fn other(doc: &Document, addr: EntityAddr) -> Option<(Node, &[u8])> {
    let located = address::locate(doc, addr).ok()?;
    statement_at(doc, located.anchor)
}

/// The parsed statement standing at `anchor`; `None` when it will not parse or is a
/// tombstone.
fn statement_at(doc: &Document, anchor: Anchor) -> Option<(Node, &[u8])> {
    let bytes = doc.current(anchor).ok()?;
    let statement = cst::parse(bytes, 0).ok()?.children().first()?.clone();
    statement
        .scalar_span()
        .is_none()
        .then_some((statement, bytes))
}

/// The number of children of `node.<key>`, zero when the key is absent.
fn count(node: &Node, key: &str, src: &[u8]) -> u32 {
    node.find(key, src)
        .map_or(0, |block| crate::as_u32(block.children().len()))
}

/// A reference the save may write as the null id.
fn reference(node: &Node, key: &str, src: &[u8]) -> Option<u32> {
    crate::projections::read::scalar_u32(node, key, src).filter(|&id| id != NULL_ID)
}
