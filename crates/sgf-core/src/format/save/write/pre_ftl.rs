//! A pre-FTL country whose homeworld's system is deleted, which goes as the game's
//! `remove_system` leaves it after a month: a tombstone in `country`, its leaders, its
//! situations and the spy networks on it or of it tombstones too, and the other countries'
//! relations with it gone. Their intel on it is the game's to let stand.

use crate::cst::Node;
use crate::document::Document;
use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, rows_where};
use crate::format::save::write::id_list::{drop_statements_naming, statements_naming};
use crate::format::save::write::leaders::{drop_leaders, leaders};
use crate::format::save::write::restore::{
    IdLines, Saved, country_edit, live, live_where, tombstone_all, tombstoned,
};
use crate::format::save::write::teardown::some_id;
use crate::keys;
use crate::ops::{OpError, Plan, SavedTable, Subject};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::scan::Index;
use crate::session::Session;

/// Take out what goes with country `country`, a pre-FTL country whose homeworld is gone: its
/// leaders, situations and spy networks, and the other countries' relations with it.
pub(crate) fn drop_dependents(
    plan: &mut Plan,
    s: &Session,
    saved: &mut Saved,
    country: u32,
) -> Result<(), OpError> {
    let doc = &s.doc;
    let found = live(doc, SavedTable::Country, country)?.ok_or(OpError::UnknownCountry(country))?;
    let led = leaders(doc, &read::ids(&found.node, keys::OWNED_LEADERS, found.src))?;
    drop_leaders(plan, s, saved, &led)?;
    let mut dead = naming(
        doc,
        SavedTable::Situation,
        doc.inner_index(keys::SITUATIONS)?,
        keys::SITUATIONS,
        country,
        &[keys::COUNTRY],
    )?;
    dead.extend(naming(
        doc,
        SavedTable::SpyNetwork,
        Some(doc.index()),
        keys::SPY_NETWORKS,
        country,
        &[keys::OWNER, keys::TARGET],
    )?);
    tombstone_all(plan, doc, saved, &dead)?;
    leave_relations(plan, s, saved, country)
}

/// Write country `country` as its tombstone, over whatever the other writers of a deletion
/// edited in it as an owner, a controller or a finder.
pub(crate) fn tombstone_country(
    plan: &mut Plan,
    doc: &Document,
    saved: &mut Saved,
    country: u32,
) -> Result<(), OpError> {
    let found = live(doc, SavedTable::Country, country)?.ok_or(OpError::UnknownCountry(country))?;
    saved.keep(doc, SavedTable::Country, country, found.anchor)?;
    let bytes = tombstoned(doc, found.anchor, country)?;
    plan.supersede(doc, Subject::Country(country), found.anchor, bytes)
}

/// The live rows of `table`, standing under `section` in `index`, one of whose `keys` is
/// `country`.
fn naming(
    doc: &Document,
    table: SavedTable,
    index: Option<&Index>,
    section: &str,
    country: u32,
    keys: &[&str],
) -> Result<Vec<(SavedTable, u32, Anchor)>, OpError> {
    let lines = IdLines::new("", &[country]);
    let rows = live_where(
        doc,
        table,
        index,
        section,
        |bytes| lines.found_in(bytes),
        |node, src| {
            keys.iter()
                .any(|key| some_id(node, key, src) == Some(country))
        },
    )?;
    Ok(rows
        .into_iter()
        .map(|(id, row)| (table, id, row.anchor))
        .collect())
}

/// Take each other country's `relations_manager.relation` with country `country` out.
fn leave_relations(
    plan: &mut Plan,
    s: &Session,
    saved: &mut Saved,
    country: u32,
) -> Result<(), OpError> {
    let doc = &s.doc;
    let lines = IdLines::new(keys::COUNTRY, &[country]);
    let others = rows_where(doc, Table::Entity(EntityKind::Country), |bytes| {
        lines.found_in(bytes)
    })?;
    for other in others {
        if other.id == country {
            continue;
        }
        let related = other
            .node
            .find(keys::RELATIONS_MANAGER, other.src)
            .is_some_and(|manager| {
                !statements_naming(manager, other.src, keys::RELATION, &[country], related_to)
                    .is_empty()
            });
        if !related {
            continue;
        }
        let edit = country_edit(plan, doc, saved, other.id)?;
        if let Some(manager) = edit
            .entity()?
            .find(keys::RELATIONS_MANAGER, &edit.buf)
            .cloned()
        {
            drop_statements_naming(edit, &manager, keys::RELATION, &[country], related_to);
        }
    }
    Ok(())
}

/// The country a `relation` block is with.
fn related_to(relation: &Node, src: &[u8]) -> Option<u32> {
    read::scalar_u32(relation, keys::COUNTRY, src)
}
