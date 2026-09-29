//! Reading a save's `bypasses` table through the systems that own each bypass.

use std::collections::{HashMap, HashSet};

use crate::cst::Node;
use crate::document::Document;
use crate::entity::views::EntityKind;
use crate::format::save::added::Table;
use crate::format::save::entity_at;
use crate::keys;
use crate::overlay::Anchor;
use crate::projections::galaxy::{BypassLink, ProjectionError, SystemNode};
use crate::projections::read;
use crate::scan::Index;

/// The `natural_wormholes` table.
pub(crate) const NATURAL: Table = Table::Entity(EntityKind::Wormhole);

pub(super) fn extract(
    index: &Index,
    src: &[u8],
    systems: &HashMap<u32, SystemNode>,
) -> Result<Vec<BypassLink>, ProjectionError> {
    let mut ends = Vec::new();
    for entity in index.entities(keys::NATURAL_WORMHOLES) {
        if let Some(node) = read::entity_node(entity, src, keys::NATURAL_WORMHOLES)? {
            ends.extend(end(&node, src));
        }
    }
    let mut rows = Vec::new();
    for entity in index.entities(keys::BYPASSES) {
        let Some(node) = read::entity_node(entity, src, keys::BYPASSES)? else {
            continue;
        };
        if let Ok(id) = u32::try_from(entity.id) {
            rows.push(bypass(id, &node, src));
        }
    }
    Ok(links(&rows, &owners(systems, ends)))
}

/// [`extract`] from the bytes now standing for each row, the rows ops wrote included.
pub(crate) fn extract_current(
    doc: &Document,
    systems: &HashMap<u32, SystemNode>,
) -> Result<Vec<BypassLink>, ProjectionError> {
    let ends = rows(doc, NATURAL)?
        .iter()
        .filter_map(|row| end(&row.node, row.src))
        .collect::<Vec<_>>();
    let rows: Vec<Bypass> = rows(doc, Table::Bypass)?
        .iter()
        .map(|row| bypass(row.id, &row.node, row.src))
        .collect();
    Ok(links(&rows, &owners(systems, ends)))
}

/// What one `bypasses` row says that the links are read from.
struct Bypass {
    id: u32,
    kind: String,
    active: bool,
    linked_to: Option<u32>,
}

fn bypass(id: u32, node: &Node, src: &[u8]) -> Bypass {
    Bypass {
        id,
        kind: read::scalar(node, keys::TYPE, src)
            .unwrap_or_default()
            .to_owned(),
        active: read::scalar(node, keys::ACTIVE, src) == Some("yes"),
        linked_to: read::scalar_u32(node, keys::LINKED_TO, src),
    }
}

/// A `natural_wormholes` row's bypass and the system it stands in.
fn end(node: &Node, src: &[u8]) -> Option<(u32, u32)> {
    Some((
        read::scalar_u32(node, keys::BYPASS, src)?,
        read::origin(node, src)?,
    ))
}

fn links(rows: &[Bypass], owner: &HashMap<u32, u32>) -> Vec<BypassLink> {
    let mut links = Vec::new();
    let mut paired: HashSet<(u32, u32)> = HashSet::new();
    for row in rows {
        let Some(&system) = owner.get(&row.id) else {
            continue;
        };
        let link = match row.kind.as_str() {
            "wormhole" => {
                let Some(linked_to) = row.linked_to else {
                    continue;
                };
                if !paired.insert((row.id.min(linked_to), row.id.max(linked_to))) {
                    continue;
                }
                let Some(&other) = owner.get(&linked_to) else {
                    continue;
                };
                BypassLink::Wormhole {
                    a: system,
                    b: other,
                }
            }
            "gateway" => BypassLink::Gateway {
                system,
                active: row.active,
            },
            "lgate" => BypassLink::LGate { system },
            kind => BypassLink::Other {
                system,
                kind: kind.to_owned(),
            },
        };
        links.push(link);
    }
    links
}

/// Bypass id → owning system: the systems' own `bypasses` lists first, then the wormhole
/// `ends`, each a natural wormhole's bypass and its `coordinate.origin`.
fn owners(
    systems: &HashMap<u32, SystemNode>,
    ends: impl IntoIterator<Item = (u32, u32)>,
) -> HashMap<u32, u32> {
    let mut owner: HashMap<u32, u32> = HashMap::new();
    for system in systems.values() {
        for &bypass in &system.bypass_ids {
            owner.entry(bypass).or_insert(system.id);
        }
    }
    for (bypass, origin) in ends {
        owner.entry(bypass).or_insert(origin);
    }
    owner
}

/// One row of a keyed table as the bytes now standing for it hold it.
pub(crate) struct Row<'d> {
    pub(crate) id: u32,
    pub(crate) anchor: Anchor,
    pub(crate) node: Node,
    pub(crate) src: &'d [u8],
}

/// Every live row of `table` in file order: each one loaded that no op took out, and each
/// one an op wrote.
pub(crate) fn rows(doc: &Document, table: Table) -> Result<Vec<Row<'_>>, ProjectionError> {
    let mut anchors: Vec<(u32, Anchor)> = doc.added().entries(table).collect();
    for entity in doc.index().entities(table.section()) {
        let anchor = Anchor::Original(entity.stmt);
        if let Ok(id) = u32::try_from(entity.id)
            && !doc.overlay().removed(anchor, doc.original())
        {
            anchors.push((id, anchor));
        }
    }
    anchors.sort_by_key(|&(_, anchor)| anchor);
    let mut rows = Vec::new();
    for (id, anchor) in anchors {
        rows.extend(row_at(doc, table, id, anchor)?);
    }
    Ok(rows)
}

/// Row `id` of `table` as it stands now; `None` when the save holds no such row, holds its
/// tombstone, or an op took it out.
pub(crate) fn row(
    doc: &Document,
    table: Table,
    id: u32,
) -> Result<Option<Row<'_>>, ProjectionError> {
    let anchor = doc.added().get(table, id).or_else(|| {
        let entity = doc.index().entity(table.section(), u64::from(id))?;
        let anchor = Anchor::Original(entity.stmt);
        (!doc.overlay().removed(anchor, doc.original())).then_some(anchor)
    });
    match anchor {
        Some(anchor) => row_at(doc, table, id, anchor),
        None => Ok(None),
    }
}

/// The entity `anchor` holds, when it is row `id` of `table`.
fn row_at(
    doc: &Document,
    table: Table,
    id: u32,
    anchor: Anchor,
) -> Result<Option<Row<'_>>, ProjectionError> {
    let found = entity_at(doc, anchor).map_err(|source| ProjectionError::Entity {
        section: table.section(),
        id: u64::from(id),
        source,
    })?;
    Ok(found
        .filter(|(node, src)| node.key_str(src) == Some(id.to_string().as_str()))
        .map(|(node, src)| Row {
            id,
            anchor,
            node,
            src,
        }))
}

/// One `natural_wormholes` entry as the bytes now standing for it hold it.
#[derive(Debug, Clone)]
pub(crate) struct NaturalWormhole {
    pub(crate) id: u32,
    pub(crate) anchor: Anchor,
    pub(crate) bypass: u32,
    /// Its bypass's `type`: `wormhole`, `shroud_tunnel`, or empty when the save holds no
    /// such bypass.
    pub(crate) kind: String,
    /// `coordinate.origin`.
    pub(crate) system: u32,
    /// Its bypass's `linked_to`: the bypass of the other end of a wormhole.
    pub(crate) linked_to: Option<u32>,
    /// The system its bypass's `linked_to` stands in: the other end of a wormhole.
    pub(crate) partner: Option<u32>,
    /// `coordinate` x/y, relative to the system's centre.
    pub(crate) at: (f64, f64),
}

/// Every entry of `natural_wormholes` that names its bypass, its system and its point, in
/// file order, the entries ops wrote included.
pub(crate) fn natural_wormholes(
    doc: &Document,
    systems: &HashMap<u32, SystemNode>,
) -> Result<Vec<NaturalWormhole>, ProjectionError> {
    let naturals = rows(doc, NATURAL)?;
    let owner = owners(
        systems,
        naturals.iter().filter_map(|row| end(&row.node, row.src)),
    );
    let bypasses: HashMap<u32, Bypass> = rows(doc, Table::Bypass)?
        .iter()
        .map(|row| (row.id, bypass(row.id, &row.node, row.src)))
        .collect();
    let mut found = Vec::new();
    for row in &naturals {
        let (Some((bypass, system)), Ok(at)) = (
            end(&row.node, row.src),
            read::coordinate(&row.node, row.src),
        ) else {
            continue;
        };
        let table = bypasses.get(&bypass);
        let linked_to = table.and_then(|b| b.linked_to);
        found.push(NaturalWormhole {
            id: row.id,
            anchor: row.anchor,
            bypass,
            kind: table.map(|b| b.kind.clone()).unwrap_or_default(),
            system,
            linked_to,
            partner: linked_to.and_then(|linked| owner.get(&linked).copied()),
            at,
        });
    }
    Ok(found)
}
