//! The helpers several writers share.

use crate::cst;
use crate::document::Document;
use crate::emit::inline;
use crate::format::save::alloc::{self, Slot, SlotTable};
use crate::ops::{Emitted, OpError, Plan};
use crate::overlay::Anchor;

/// Write an entry where `slot` stands: in place of its tombstone, indented as that was,
/// or at the end of `table`.
pub(crate) fn write_slot(
    plan: &mut Plan,
    doc: &Document,
    slot: Slot,
    table: &mut SlotTable,
    emitted: Emitted,
    entry: impl Fn(&[u8]) -> Vec<u8>,
) -> Result<(), OpError> {
    match slot {
        Slot::Reused {
            tombstone: tombstone @ Anchor::Original(_),
            ..
        } => {
            let indent = cst::indent_of(doc.original(), tombstone.start());
            let text = inline(indent, &entry(indent)).into_bytes();
            plan.replace(doc, emitted.subject(tombstone), tombstone, text)
        }
        // A tombstone a removal left in an appended slot carries its line with it.
        Slot::Reused { tombstone, .. } => {
            let subject = emitted.subject(tombstone);
            let current = doc.current(tombstone)?;
            let span = alloc::statement_span(current)
                .ok_or_else(|| subject.parse_error(0, "the tombstone holds no statement"))?;
            let indent = cst::indent_of(current, span.start);
            let text = inline(indent, &entry(indent));
            let bytes = [
                &current[..span.start],
                text.as_bytes(),
                &current[span.end..],
            ]
            .concat();
            plan.replace(doc, subject, tombstone, bytes)
        }
        Slot::Appended { .. } => {
            let text = table.end.shape(entry(table.end.indent()));
            plan.emit(emitted, table.end.at(), text);
            Ok(())
        }
    }
}
