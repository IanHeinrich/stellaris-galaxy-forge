//! `DeleteMegastructure`, which inverts to `RestoreEntities`.
//!
//! A row goes as the game leaves one it destroys: `<id>=none` in its slot and its id out of
//! the lists that name it. A row with `save_on_death=1` is logged in `dead_mega_structure`,
//! which the timeline reads its type and system back from. The body and its colony stay.

use crate::cst::Node;
use crate::document::Document;
use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, row};
use crate::format::save::write::add_megastructure;
use crate::format::save::write::dismantle::{self, TakenBack};
use crate::format::save::write::megastructure_links::{
    self, DELETED_BYPASS_KINDS, Tied, drop_bypass_beside, unlink_beside, unlist_elsewhere,
};
use crate::format::save::write::restore::{Gone, Saved, tombstoned};
use crate::keys;
use crate::ops::rules::named;
use crate::ops::{
    Edit, MegastructureDismantle, MegastructureEdit, OpError, Plan, Planned, SavedTable, Subject,
};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::session::Session;

/// Why a ring world's row is not deleted alone.
pub(crate) const RING_ROW: &str =
    "it is part of a ring world, so delete the whole ring world instead";

pub(crate) fn plan_delete(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    dismantle: Option<&MegastructureDismantle>,
) -> Result<Planned, OpError> {
    let doc = &s.doc;
    if let Some(dismantle) = dismantle {
        dismantle::check(dismantle)?;
    }
    if doc.added().get(EntityKind::Megastructure, id).is_some() {
        return add_megastructure::plan_remove(plan, s, id, None, 0);
    }
    let tied = megastructure_links::read(doc, id)?.ok_or(OpError::UnknownEntity {
        table: SavedTable::Megastructure,
        id,
    })?;
    let refuse = |reason: String| OpError::MegastructureKept {
        megastructure: id,
        edit: MegastructureEdit::Delete,
        reason,
    };
    if s.ring_world_types().is_ring_row(&tied.kind) {
        return Err(refuse(RING_ROW.to_owned()));
    }
    let system = tied
        .system
        .ok_or_else(|| refuse("it isn't in any system".to_owned()))?;
    let bypass = live_bypass(doc, &tied)?;
    if bypass
        .as_ref()
        .is_some_and(|(_, kind)| !DELETED_BYPASS_KINDS.contains(&kind.as_str()))
    {
        return Err(refuse("deleting it hasn't been tested in game".to_owned()));
    }
    let bypass = bypass.map(|(bypass, _)| bypass);

    let mut saved = Saved::default();
    write_rows(
        plan,
        s,
        &mut saved,
        std::slice::from_ref(&tied),
        system,
        Gone::default(),
    )?;
    let taken = match dismantle {
        Some(dismantle) => {
            dismantle::take_back(plan, s, &mut saved, system, tied.owner, dismantle)?
        }
        None => TakenBack::default(),
    };

    let with_bypass = bypass
        .map(|bypass| format!(", and its bypass #{bypass}"))
        .unwrap_or_default();
    Ok(Planned {
        description: format!(
            "Deleted megastructure #{id} ({}) in {}{with_bypass}{}",
            tied.kind,
            named(&s.graph, system),
            taken.what()
        ),
        inverse: saved.inverse(format!("Restored megastructure #{id} ({})", tied.kind)),
    })
}

/// Row `tied`'s bypass the save holds, with its `type`.
pub(crate) fn live_bypass(doc: &Document, tied: &Tied) -> Result<Option<(u32, String)>, OpError> {
    let Some(bypass) = tied.bypass else {
        return Ok(None);
    };
    Ok(row(doc, Table::Bypass, bypass)?
        .map(|found| (bypass, read::text(&found.node, keys::TYPE, found.src))))
}

/// Delete `rows` of system `system`, each as the game destroys one: its tombstone, its id out
/// of the lists that name it, its bypass taken out and its death logged, leaving alone what
/// `gone` takes whole.
pub(crate) fn write_rows(
    plan: &mut Plan,
    s: &Session,
    saved: &mut Saved,
    rows: &[Tied],
    system: u32,
    gone: Gone,
) -> Result<(), OpError> {
    let doc = &s.doc;
    for tied in rows {
        saved.keep(doc, SavedTable::Megastructure, tied.id, tied.anchor)?;
        let bytes = tombstoned(doc, tied.anchor, tied.id)?;
        plan.replace(doc, Subject::Record(tied.anchor), tied.anchor, bytes)?;
    }
    unlink_beside(plan, s, rows, Some(&mut *saved), gone)?;
    for tied in rows {
        unlist_elsewhere(plan, s, tied.id, tied.planet, saved, gone)?;
        if let Some((bypass, _)) = live_bypass(doc, tied)? {
            drop_bypass_beside(plan, s, system, bypass, Some(&mut *saved), gone)?;
        }
    }
    let dead: Vec<&Tied> = rows.iter().filter(|tied| tied.save_on_death).collect();
    log_deaths(plan, doc, saved, &dead, system)
}

/// Log `rows` in `dead_mega_structure` as the game logs the rows it destroys: a `map` line
/// from each id to a new `objects` entry, the lines in numeric order of the ids, and the
/// entries last in `objects`, in the order of `rows`, numbered on from one past the highest
/// there.
fn log_deaths(
    plan: &mut Plan,
    doc: &Document,
    saved: &mut Saved,
    rows: &[&Tied],
    system: u32,
) -> Result<(), OpError> {
    let Some(first) = rows.first() else {
        return Ok(());
    };
    let anchor = doc
        .index()
        .section(keys::DEAD_MEGA_STRUCTURE)
        .map(|section| Anchor::Original(section.stmt))
        .ok_or_else(|| OpError::MegastructureKept {
            megastructure: first.id,
            edit: MegastructureEdit::Delete,
            reason: "the save has no dead_mega_structure table to log it in".to_owned(),
        })?;
    saved.keep(doc, SavedTable::DeadMegastructures, 0, anchor)?;
    let edit = plan.edit_record(doc, anchor)?;
    let table = edit.entity()?.clone();
    let map = table.find(keys::MAP, &edit.buf).cloned();
    let objects = table.find(keys::OBJECTS, &edit.buf).cloned();
    let next = objects.as_ref().map_or(0, |objects| {
        keyed(objects, &edit.buf)
            .map(|(key, _)| key + 1)
            .max()
            .unwrap_or(0)
    });
    let mut lines: Vec<(u32, u32)> = rows
        .iter()
        .zip(next..)
        .map(|(tied, entry)| (tied.id, entry))
        .collect();
    lines.sort_unstable();
    let entries = |indent: &[u8]| {
        let mut w = crate::emit::Lines::new(indent);
        for (tied, entry) in rows.iter().zip(next..) {
            w.open(0, &entry.to_string());
            w.pair(1, keys::TYPE, &crate::emit::quoted(&tied.kind));
            w.pair(1, keys::SOLAR_SYSTEM, &system.to_string());
            w.close(0);
        }
        w.into_bytes()
    };
    match map {
        Some(map) => log_in_map(edit, &map, &lines),
        None => {
            let (at, indent) = match &objects {
                Some(objects) => {
                    let start = edit.line_start(objects.span().start);
                    (start, edit.indent(objects.span().start))
                }
                None => edit.before_close(&table),
            };
            let mut w = crate::emit::Lines::new(&indent);
            w.open(0, keys::MAP);
            for (id, entry) in &lines {
                w.line(1, &format!("{id}={entry}"));
            }
            w.close(0);
            edit.insert(at, w.into_bytes());
        }
    }
    match objects {
        Some(objects) => {
            let (at, indent) = edit.before_close(&objects);
            edit.insert(at, entries(&indent));
        }
        None => {
            let (at, indent) = edit.before_close(&table);
            let mut w = crate::emit::Lines::new(&indent);
            w.open(0, keys::OBJECTS);
            w.bytes(&entries(w.indent(1).as_bytes()));
            w.close(0);
            edit.insert(at, w.into_bytes());
        }
    }
    Ok(())
}

/// Write `lines`, `map` lines from an id to an entry in order of the ids, each before the
/// first line of `map` keyed past its id, or last.
fn log_in_map(edit: &mut Edit, map: &Node, lines: &[(u32, u32)]) {
    let mut inserts: Vec<(usize, Vec<u8>)> = Vec::new();
    for &(id, entry) in lines {
        let next = keyed(map, &edit.buf)
            .find(|&(key, _)| key > id)
            .map(|(_, next)| next.span().start);
        let (at, indent) = match next {
            Some(next) => (edit.line_start(next), edit.indent(next)),
            None => edit.before_close(map),
        };
        let line = [&indent[..], format!("{id}={entry}").as_bytes(), b"\n"].concat();
        match inserts.last_mut() {
            Some((last, bytes)) if *last == at => bytes.extend(line),
            _ => inserts.push((at, line)),
        }
    }
    for (at, bytes) in inserts {
        edit.insert(at, bytes);
    }
}

/// The children of `block` keyed by a number, with that number.
fn keyed<'n>(block: &'n Node, src: &'n [u8]) -> impl Iterator<Item = (u32, &'n Node)> + 'n {
    block
        .children()
        .iter()
        .filter_map(move |child| Some((child.key_str(src)?.parse().ok()?, child)))
}
