//! The save's global event targets, the top-level `saved_event_target` blocks: which it now
//! holds and what each names.

use crate::cst;
use crate::document::Document;
use crate::format::save::entity_at;
use crate::keys;
use crate::ops::EventTargetOf;
use crate::overlay::Anchor;
use crate::projections::read;

/// What one `saved_event_target` block says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EventTarget {
    pub name: String,
    /// `None` for a type [`crate::ops::Op::AddEventTarget`] does not write, such as a fleet.
    pub target: Option<EventTargetOf>,
}

/// Whether `bytes` open a `saved_event_target=` statement, which is how a save tells the
/// blocks an op inserted from anything else inserted at the same offset.
fn opens_target(bytes: &[u8]) -> bool {
    bytes
        .trim_ascii_start()
        .strip_prefix(keys::SAVED_EVENT_TARGET.as_bytes())
        .is_some_and(|rest| rest.trim_ascii_start().starts_with(b"="))
}

/// Every target the save now holds, with its statement, in file order: each one loaded that
/// no op took out, and each one an op wrote.
pub(crate) fn targets(doc: &Document) -> Vec<(Anchor, EventTarget)> {
    let original = doc.original();
    let overlay = doc.overlay();
    let mut anchors: Vec<Anchor> = doc
        .index()
        .sections_named(keys::SAVED_EVENT_TARGET)
        .map(|section| Anchor::Original(section.stmt))
        .filter(|&anchor| !overlay.removed(anchor, original))
        .collect();
    anchors.extend(
        overlay
            .slots()
            .filter(|&(anchor, bytes)| anchor.is_inserted() && opens_target(bytes))
            .map(|(anchor, _)| anchor),
    );
    anchors.sort_unstable();
    anchors
        .into_iter()
        .filter_map(|anchor| {
            let (node, src) = entity_at(doc, anchor).ok().flatten()?;
            let name = read::scalar(&node, keys::NAME, src)?.to_owned();
            let id = read::scalar_u32(&node, keys::ID, src);
            let target = match (read::scalar(&node, keys::TYPE, src), id) {
                (Some(keys::PLANET), Some(body)) => Some(EventTargetOf::Body { body }),
                (Some(keys::GALACTIC_OBJECT), Some(system)) => {
                    Some(EventTargetOf::System { system })
                }
                (Some(keys::COUNTRY), Some(country)) => Some(EventTargetOf::Country { country }),
                _ => None,
            };
            Some((anchor, EventTarget { name, target }))
        })
        .collect()
}

/// The target named `name`, with its statement.
pub(crate) fn find(doc: &Document, name: &str) -> Option<(Anchor, EventTarget)> {
    targets(doc)
        .into_iter()
        .find(|(_, target)| target.name == name)
}

/// The original offset a new block goes at and the indentation it takes: past the line the
/// last loaded block ends on, or when the save holds none the global `flags` section's, or
/// the last top-level section's when it has no global flags either, indented as that one
/// is; at the end of a save with no sections at all.
pub(crate) fn insert_at(doc: &Document) -> (usize, Vec<u8>) {
    let index = doc.index();
    let src = doc.original();
    let last = index
        .sections_named(keys::SAVED_EVENT_TARGET)
        .last()
        .or_else(|| index.section(keys::FLAGS))
        .or_else(|| index.sections().last());
    match last {
        Some(last) => (
            cst::line_end(src, last.stmt.end),
            cst::indent_of(src, last.stmt.start).to_vec(),
        ),
        None => (src.len(), Vec::new()),
    }
}
