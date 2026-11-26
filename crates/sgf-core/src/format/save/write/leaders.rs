//! A leader who goes as the game takes one whose ship or country is gone: a tombstone in
//! `leaders`, out of the country's `owned_leaders`, and off any council position.

use memchr::memmem::Finder;

use crate::Span;
use crate::cst::Node;
use crate::document::Document;
use crate::format::save::write::id_list::{Emptied, unlist};
use crate::format::save::write::restore::{Saved, country_edit, live, locate, tombstone_all};
use crate::format::save::write::teardown::some_id;
use crate::keys;
use crate::ops::{OpError, Plan, SavedTable};
use crate::overlay::Anchor;
use crate::session::Session;

/// The leaders the save holds among `ids`, each with its statement and its `country`.
pub(crate) fn leaders(
    doc: &Document,
    ids: &[u32],
) -> Result<Vec<(u32, Anchor, Option<u32>)>, OpError> {
    let mut found = Vec::new();
    for &id in ids {
        if let Some(leader) = live(doc, SavedTable::Leader, id)? {
            let country = some_id(&leader.node, keys::COUNTRY, leader.src);
            found.push((id, leader.anchor, country));
        }
    }
    Ok(found)
}

/// Tombstone each of `leaders`, take it out of its country's `owned_leaders` and take its
/// `leader` line off each council position naming it.
pub(crate) fn drop_leaders(
    plan: &mut Plan,
    s: &Session,
    saved: &mut Saved,
    leaders: &[(u32, Anchor, Option<u32>)],
) -> Result<(), OpError> {
    let doc = &s.doc;
    let dead: Vec<_> = leaders
        .iter()
        .map(|&(id, anchor, _)| (SavedTable::Leader, id, anchor))
        .collect();
    tombstone_all(plan, doc, saved, &dead)?;
    let mut countries: Vec<u32> = leaders.iter().filter_map(|&(_, _, c)| c).collect();
    countries.sort_unstable();
    countries.dedup();
    for country in countries {
        let ids: Vec<u32> = leaders
            .iter()
            .filter(|&&(_, _, c)| c == Some(country))
            .map(|&(id, _, _)| id)
            .collect();
        let edit = country_edit(plan, doc, saved, country)?;
        unlist(edit, keys::OWNED_LEADERS, &ids, Emptied::Keep)?;
    }
    let ids: Vec<u32> = leaders.iter().map(|&(id, _, _)| id).collect();
    leave_council(plan, doc, saved, &ids)
}

/// Take the `leader` line naming one of `leaders` off each council position, as the game
/// leaves a seat whose leader is gone.
fn leave_council(
    plan: &mut Plan,
    doc: &Document,
    saved: &mut Saved,
    leaders: &[u32],
) -> Result<(), OpError> {
    let Some(inner) = doc.inner_index(keys::COUNCIL_POSITIONS)? else {
        return Ok(());
    };
    let lines: Vec<String> = leaders
        .iter()
        .map(|id| format!("{}={id}\n", keys::LEADER))
        .collect();
    let finders: Vec<Finder> = lines
        .iter()
        .map(|line| Finder::new(line.as_bytes()))
        .collect();
    let src = doc.original();
    let seated: Vec<u32> = inner
        .entities(keys::COUNCIL_POSITIONS)
        .iter()
        .filter(|seat| {
            let bytes = seat.stmt.slice(src);
            finders.iter().any(|finder| finder.find(bytes).is_some())
        })
        .filter_map(|seat| u32::try_from(seat.id).ok())
        .collect();
    for id in seated {
        let Some(anchor) = locate(doc, SavedTable::CouncilPosition, id)? else {
            continue;
        };
        saved.keep(doc, SavedTable::CouncilPosition, id, anchor)?;
        let edit = plan.edit_record(doc, anchor)?;
        let spans: Vec<Span> = edit
            .entity()?
            .find_all(keys::LEADER, &edit.buf)
            .filter(|line| {
                line.scalar_str(&edit.buf)
                    .and_then(|id| id.parse().ok())
                    .is_some_and(|id: u32| leaders.contains(&id))
            })
            .map(Node::span)
            .collect();
        for span in spans {
            edit.bytes().remove_statement(span);
        }
    }
    Ok(())
}

/// The leaders of the ships `ships`.
pub(crate) fn ship_leaders(doc: &Document, ships: &[u32]) -> Result<Vec<u32>, OpError> {
    let mut ids = Vec::new();
    for &ship in ships {
        if let Some(found) = live(doc, SavedTable::Ship, ship)? {
            ids.extend(some_id(&found.node, keys::LEADER, found.src));
        }
    }
    Ok(ids)
}
