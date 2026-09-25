//! Which section holds a kind, and how to reach one entity of it.
//!
//! Two kinds sit one level deeper than the index records, so they are read through
//! [`Document::inner_index`], which scans a block body as if it were a file.
//!
//! A scenario script has no id-keyed sections: its systems are named by the anchors its
//! own index holds, so a `System` address resolves through that instead.

use crate::Span;
use crate::document::Document;
use crate::entity::EntityError;
use crate::entity::views::{EntityAddr, EntityKind};
use crate::keys;
use crate::overlay::Anchor;

/// Where a kind's entities live: a top-level section, and the key they sit under inside
/// it when the section is only their container (`planets.planet`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Address {
    pub section: &'static str,
    pub inner: Option<&'static str>,
}

/// The address table: a new kind is a row here, not an implementation.
pub(crate) const fn address(kind: EntityKind) -> Address {
    let (section, inner) = match kind {
        EntityKind::System => (keys::GALACTIC_OBJECT, None),
        EntityKind::Planet => (keys::PLANETS, Some(keys::PLANET)),
        EntityKind::Colony => (keys::COLONY, None),
        EntityKind::Fleet => (keys::FLEET, None),
        EntityKind::Ship => (keys::SHIPS, None),
        EntityKind::Starbase => (keys::STARBASE_MGR, Some(keys::STARBASES)),
        EntityKind::Megastructure => (keys::MEGASTRUCTURES, None),
        EntityKind::Country => (keys::COUNTRY, None),
        EntityKind::PopGroup => (keys::POP_GROUPS, None),
        EntityKind::Sector => (keys::SECTORS, None),
        EntityKind::Deposit => (keys::DEPOSIT, None),
    };
    Address { section, inner }
}

/// The sections an entity is reached through an inner index in, each one a section
/// [`Document::inner_index`] keeps a scan of.
pub(crate) fn inner_sections() -> impl Iterator<Item = &'static str> {
    EntityKind::ALL.into_iter().filter_map(|kind| {
        let table = address(kind);
        table.inner.map(|_| table.section)
    })
}

/// Where an entity's bytes stand: the anchor they are read through, and the original span
/// behind it. A statement an op inserted has no original, so it reads as entirely new.
pub(crate) struct Located {
    pub anchor: Anchor,
    pub original: Option<Span>,
}

impl Located {
    fn at(anchor: Anchor) -> Self {
        let original = match anchor {
            Anchor::Original(span) => Some(span),
            Anchor::Inserted { .. } => None,
        };
        Self { anchor, original }
    }
}

/// The statement holding `addr`, or [`EntityError::NotFound`] when the document has no
/// such section or no such id in it.
pub(crate) fn locate(doc: &Document, addr: EntityAddr) -> Result<Located, EntityError> {
    if let Some(scenario) = doc.scenario() {
        let anchor = match addr.kind {
            EntityKind::System => scenario.system(addr.id),
            _ => None,
        };
        return anchor.map(Located::at).ok_or(EntityError::NotFound(addr));
    }
    if let Some(anchor) = added(doc, addr) {
        return Ok(Located {
            anchor,
            original: None,
        });
    }
    let table = address(addr.kind);
    let id = u64::from(addr.id);
    let found = match table.inner {
        None => doc.index().entity(table.section, id).copied(),
        Some(inner) => doc
            .inner_index(table.section)?
            .and_then(|index| index.entity(inner, id).copied()),
    };
    found
        .map(|entity| Located::at(Anchor::Original(entity.stmt)))
        .ok_or(EntityError::NotFound(addr))
}

/// The statement an op wrote for `addr`, which stands against no original: an inserted
/// one, or a tombstone's slot a new entity took.
fn added(doc: &Document, addr: EntityAddr) -> Option<Anchor> {
    doc.added().get(addr.kind, addr.id)
}
