//! What a `natural_wormholes` row says about itself, and what its bypass adds: the bypass's
//! type and the system at its other end.

use crate::cst::Node;
use crate::document::Document;
use crate::entity::facts::{Sheet, reference, statement_at};
use crate::entity::views::EntityKind;
use crate::format::save::read_spec::written_angle;
use crate::format::save::write::bodies::number;
use crate::keys;
use crate::ops::rules::bodies::normalised;
use crate::overlay::Anchor;
use crate::projections::read;

#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct WormholeFacts {
    /// Its bypass's `type`, such as `wormhole` or `shroud_tunnel`; empty when the save holds
    /// no such bypass.
    pub kind: String,
    /// `coordinate.origin`: the system it stands in.
    pub origin: Option<u32>,
    /// The system its bypass's `linked_to` stands in.
    pub partner: Option<u32>,
    /// `coordinate` x/y, relative to the star.
    pub at: Option<(f64, f64)>,
    pub bypass: Option<u32>,
}

pub(crate) fn read(doc: &Document, node: &Node, src: &[u8]) -> WormholeFacts {
    let bypass = reference(node, keys::BYPASS, src);
    let (kind, linked_to) = bypass.and_then(|id| bypass_row(doc, id)).map_or_else(
        Default::default,
        |(row, row_src)| {
            (
                read::text(&row, keys::TYPE, row_src),
                reference(&row, keys::LINKED_TO, row_src),
            )
        },
    );
    WormholeFacts {
        kind,
        origin: read::origin(node, src).filter(|&id| id != crate::NULL_ID),
        partner: linked_to.and_then(|linked| system_of(doc, linked)),
        at: read::coordinate(node, src).ok(),
        bypass,
    }
}

/// The `bypasses` row `id`, as it stands now.
fn bypass_row(doc: &Document, id: u32) -> Option<(Node, &[u8])> {
    let entry = doc.index().entity(keys::BYPASSES, u64::from(id))?;
    statement_at(doc, Anchor::Original(entry.stmt))
}

/// The system the `natural_wormholes` row standing for `bypass` is in.
fn system_of(doc: &Document, bypass: u32) -> Option<u32> {
    doc.index()
        .entities(keys::NATURAL_WORMHOLES)
        .iter()
        .find_map(|entry| {
            let (row, src) = statement_at(doc, Anchor::Original(entry.stmt))?;
            if read::scalar_u32(&row, keys::BYPASS, src) != Some(bypass) {
                return None;
            }
            read::origin(&row, src).filter(|&id| id != crate::NULL_ID)
        })
}

/// Distance and angle are about the star, as `MoveSaveWormhole` takes them.
pub(crate) fn sheet(facts: &WormholeFacts) -> Sheet {
    let mut sheet = Sheet::default();
    if !facts.kind.is_empty() {
        sheet.borrowed("Type", facts.kind.clone());
    }
    if let Some(origin) = facts.origin {
        sheet.reference(
            "System",
            EntityKind::System,
            origin,
            &[keys::COORDINATE, keys::ORIGIN],
        );
    }
    if let Some(partner) = facts.partner {
        sheet.borrowed_reference("Linked to", EntityKind::System, partner);
    }
    if let Some((x, y)) = facts.at {
        let distance = x.hypot(y);
        let angle = normalised(written_angle((0.0, 0.0), (x, y), distance));
        sheet.fact("Distance", &number(distance), &[keys::COORDINATE]);
        sheet.fact("Angle", &format!("{}°", number(angle)), &[keys::COORDINATE]);
    }
    if let Some(bypass) = facts.bypass {
        sheet.fact("Bypass", &bypass.to_string(), &[keys::BYPASS]);
    }
    sheet
}
