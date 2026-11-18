//! `RestoreEntities` in a scenario: whole `system` statements an edit of what their `effect`
//! block places rewrote, written back as they stood, and what such an edit keeps for it.

use crate::cst;
use crate::format::scenario::index::index;
use crate::keys::scenario as keys;
use crate::ops::{OpError, Plan, Planned, SavedEntity, SavedTable, Subject, restored_inverse};
use crate::projections::read;
use crate::session::Session;

pub(super) fn restore(
    plan: &mut Plan,
    s: &Session,
    description: &str,
    entities: &[SavedEntity],
) -> Result<Planned, OpError> {
    let mut displaced: Vec<SavedEntity> = Vec::with_capacity(entities.len());
    for SavedEntity { table, id, text } in entities {
        let (table, id) = (*table, *id);
        if table != SavedTable::System {
            return Err(OpError::UnknownEntity { table, id });
        }
        if !holds(id, text) {
            return Err(OpError::EntityMismatch { table, id });
        }
        if !displaced.iter().any(|kept| kept.id == id) {
            displaced.push(kept(s, id)?);
        }
        let anchor = index(&s.doc).system(id).ok_or(OpError::UnknownSystem(id))?;
        plan.replace(
            &s.doc,
            Subject::System(id),
            anchor,
            text.clone().into_bytes(),
        )?;
    }
    Ok(Planned {
        description: description.to_owned(),
        inverse: restored_inverse(description, displaced),
    })
}

/// System `system`'s statement as it stands, for an inverse to write back.
pub(super) fn kept(s: &Session, system: u32) -> Result<SavedEntity, OpError> {
    let anchor = index(&s.doc)
        .system(system)
        .ok_or(OpError::UnknownSystem(system))?;
    Ok(SavedEntity {
        table: SavedTable::System,
        id: system,
        text: String::from_utf8_lossy(s.doc.current(anchor)?).into_owned(),
    })
}

/// Whether `text` is one `system` statement whose `id` is `id`.
fn holds(id: u32, text: &str) -> bool {
    let bytes = text.as_bytes();
    let Ok(root) = cst::parse_script(bytes, 0) else {
        return false;
    };
    let [node] = root.children() else {
        return false;
    };
    node.key_str(bytes) == Some(keys::SYSTEM)
        && read::scalar(node, keys::ID, bytes).and_then(|i| i.parse().ok()) == Some(id)
}
