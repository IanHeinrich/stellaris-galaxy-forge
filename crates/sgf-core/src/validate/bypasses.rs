//! A save's bypasses that share a slot with one the game wrote, which an editor before
//! 0.27.4 numbered so: the game crashes while it loads the save. A wormhole pair is
//! renumbered, and a megastructure whose bypass the editor deletes is deleted and added
//! again.

use std::collections::BTreeSet;

use super::{Issue, IssueCode};
use crate::document::Document;
use crate::format::save::galaxy::bypasses::{SharedSlot, shared_slots};
use crate::format::save::write::megastructure_links::{DELETED_BYPASS_KINDS, GATEWAY, RELAY};
use crate::format::save::write::wormhole::WORMHOLE;
use crate::ops::rules::named;
use crate::projections::galaxy::GalaxyGraph;

const CRASHES: &str = "uses an id the game already uses, so the game crashes on load.";

/// One issue per wormhole pair with an end in a shared slot, its ends in id order, and one
/// per other bypass in a shared slot.
pub(crate) fn shared_bypass_slots(doc: &Document, g: &GalaxyGraph) -> Vec<Issue> {
    let Ok(shared) = shared_slots(doc, &g.systems) else {
        return Vec::new();
    };
    let mut pairs: BTreeSet<(u32, u32)> = BTreeSet::new();
    let mut issues = Vec::new();
    for bypass in &shared {
        if let Some((a, b)) = pair(bypass) {
            if pairs.insert((a.min(b), a.max(b))) {
                issues.push(Issue::new(
                    IssueCode::BypassSlotShared,
                    format!(
                        "The wormhole between {} and {} {CRASHES}",
                        named(g, a),
                        named(g, b)
                    ),
                    vec![a, b],
                ));
            }
            continue;
        }
        let what = match bypass.kind.as_str() {
            WORMHOLE => "wormhole",
            GATEWAY => "gateway",
            RELAY => "hyper relay",
            _ => "bypass",
        };
        let fix = match DELETED_BYPASS_KINDS.contains(&bypass.kind.as_str()) {
            true => "Delete it and add it again.",
            false => "The editor cannot repair it yet.",
        };
        let (message, systems) = match bypass.system {
            Some(system) => (
                format!("The {what} in {} {CRASHES} {fix}", named(g, system)),
                vec![system],
            ),
            None => (format!("Bypass #{} {CRASHES} {fix}", bypass.id), Vec::new()),
        };
        issues.push(Issue::new(IssueCode::BypassSlotShared, message, systems));
    }
    issues
}

/// The systems of a wormhole's two ends, the end with the lower bypass first.
fn pair(bypass: &SharedSlot) -> Option<(u32, u32)> {
    if bypass.kind != WORMHOLE {
        return None;
    }
    let (system, partner, linked_to) = (bypass.system?, bypass.partner?, bypass.linked_to?);
    Some(match bypass.id < linked_to {
        true => (system, partner),
        false => (partner, system),
    })
}
