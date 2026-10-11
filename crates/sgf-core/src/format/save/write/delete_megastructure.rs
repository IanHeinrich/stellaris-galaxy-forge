//! `DeleteMegastructure`, which inverts to `RestoreEntities`.
//!
//! A row goes as the game leaves one it destroys: `<id>=none` in its slot and its id out of
//! the lists that name it. A row with `save_on_death=1` is logged in `dead_mega_structure`,
//! which the timeline reads its type and system back from. A colony on a body the
//! structure made goes first, as `RemoveColony` takes it; the body stays.

use crate::cst::Node;
use crate::document::Document;
use crate::format::save::added::{Table, row};
use crate::format::save::write::megastructure_links::{self, Tied, drop_bypass, unlink};
use crate::format::save::write::remove_planet::check_segment;
use crate::format::save::write::restore::{Saved, tombstoned};
use crate::format::save::write::teardown::Teardown;
use crate::format::save::{entity_at, planet_statement, planet_system};
use crate::keys;
use crate::ops::rules::named;
use crate::ops::{Edit, OpError, Plan, Planned, SavedTable, Subject};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::session::Session;

/// The bypass kinds a deletion takes along; another has not been tried in game.
const DROPPED_BYPASSES: [&str; 2] = ["gateway", "relay_bypass"];

pub(crate) fn plan_delete(plan: &mut Plan, s: &Session, id: u32) -> Result<Planned, OpError> {
    let doc = &s.doc;
    let tied = megastructure_links::read(doc, id)?.ok_or(OpError::UnknownEntity {
        table: SavedTable::Megastructure,
        id,
    })?;
    let refuse = |reason: String| OpError::MegastructureKept {
        megastructure: id,
        reason,
    };
    let system = tied
        .system
        .ok_or_else(|| refuse("it stands in no system".to_owned()))?;
    let bypass = match tied.bypass {
        Some(bypass) => match row(doc, Table::Bypass, bypass)? {
            Some(found) => {
                let kind = read::text(&found.node, keys::TYPE, found.src);
                if !DROPPED_BYPASSES.contains(&kind.as_str()) {
                    return Err(refuse(format!(
                        "its bypass is a {kind}, which has not been tried in game"
                    )));
                }
                Some(bypass)
            }
            None => None,
        },
        None => None,
    };
    let colony = made_colony(s, &tied)?;

    let mut saved = Saved::default();
    if let Some(teardown) = &colony {
        teardown.write(plan, s, &mut saved, true)?;
    }
    saved.keep(doc, SavedTable::Megastructure, id, tied.anchor)?;
    let bytes = tombstoned(doc, tied.anchor, id)?;
    plan.replace(doc, Subject::Record(tied.anchor), tied.anchor, bytes)?;
    unlink(plan, s, &tied, Some(&mut saved))?;
    if let Some(bypass) = bypass {
        drop_bypass(plan, s, system, bypass, Some(&mut saved))?;
    }
    if tied.save_on_death {
        log_death(plan, doc, &mut saved, &tied, system)?;
    }

    let with_colony = colony
        .map(|teardown| format!(", with the colony on planet #{}", teardown.planet))
        .unwrap_or_default();
    let with_bypass = bypass
        .map(|bypass| format!(", and its bypass #{bypass}"))
        .unwrap_or_default();
    Ok(Planned {
        description: format!(
            "Deleted megastructure #{id} ({}) in {}{with_colony}{with_bypass}",
            tied.kind,
            named(&s.graph, system)
        ),
        inverse: saved.inverse(format!("Restored megastructure #{id} ({})", tied.kind)),
    })
}

/// The colony on the body row `tied` made, which goes with it: a body with the planet flag
/// `megastructure`, such as a cosmogenesis world. A colony that `RemoveColony` would refuse
/// for anything but the structure refuses the deletion.
fn made_colony(s: &Session, tied: &Tied) -> Result<Option<Teardown>, OpError> {
    let Some(planet) = tied.planet else {
        return Ok(None);
    };
    let Some(anchor) = planet_statement(&s.doc, planet)? else {
        return Ok(None);
    };
    let Some((node, src)) = entity_at(&s.doc, anchor)
        .map_err(|e| Subject::Record(anchor).parse_error(e.offset, e.reason))?
    else {
        return Ok(None);
    };
    let made = node
        .find(keys::FLAGS, src)
        .is_some_and(|flags| flags.find(keys::MEGASTRUCTURE, src).is_some());
    if !made || read::scalar_u32(&node, keys::COLONY, src).is_none() {
        return Ok(None);
    }
    let system = planet_system(&node, src, planet)?;
    let refuse = |reason: String| OpError::ColonyKept {
        body: planet,
        reason,
    };
    check_segment(&node, src, refuse)?;
    Teardown::read(s, planet, system, &node, src).map(Some)
}

/// Log row `tied` in `dead_mega_structure` as the game logs a row it destroys: a `map` line
/// from its id to a new `objects` entry, in numeric order of the ids, and the entry last in
/// `objects`, numbered one past the highest there.
fn log_death(
    plan: &mut Plan,
    doc: &Document,
    saved: &mut Saved,
    tied: &Tied,
    system: u32,
) -> Result<(), OpError> {
    let anchor = doc
        .index()
        .section(keys::DEAD_MEGA_STRUCTURE)
        .map(|section| Anchor::Original(section.stmt))
        .ok_or_else(|| OpError::MegastructureKept {
            megastructure: tied.id,
            reason: "the save has no dead_mega_structure table to log it in".to_owned(),
        })?;
    saved.keep(doc, SavedTable::DeadMegastructures, 0, anchor)?;
    let edit = plan.edit_record(doc, anchor)?;
    let table = edit.entity()?.clone();
    let map = table.find(keys::MAP, &edit.buf).cloned();
    let objects = table.find(keys::OBJECTS, &edit.buf).cloned();
    let entry = objects.as_ref().map_or(0, |objects| {
        keyed(objects, &edit.buf)
            .map(|(key, _)| key + 1)
            .max()
            .unwrap_or(0)
    });
    let line = format!("{}={entry}", tied.id);
    let object = |indent: &[u8]| {
        let mut w = crate::emit::Lines::new(indent);
        w.open(0, &entry.to_string());
        w.pair(1, keys::TYPE, &crate::emit::quoted(&tied.kind));
        w.pair(1, keys::SOLAR_SYSTEM, &system.to_string());
        w.close(0);
        w.into_bytes()
    };
    match map {
        Some(map) => log_in_map(edit, &map, tied.id, &line),
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
            w.line(1, &line);
            w.close(0);
            edit.insert(at, w.into_bytes());
        }
    }
    match objects {
        Some(objects) => {
            let (at, indent) = edit.before_close(&objects);
            edit.insert(at, object(&indent));
        }
        None => {
            let (at, indent) = edit.before_close(&table);
            let mut w = crate::emit::Lines::new(&indent);
            w.open(0, keys::OBJECTS);
            w.bytes(&object(w.indent(1).as_bytes()));
            w.close(0);
            edit.insert(at, w.into_bytes());
        }
    }
    Ok(())
}

/// Write `line`, row `id`'s `map` line, before the first line of `map` keyed past `id`, or
/// last.
fn log_in_map(edit: &mut Edit, map: &Node, id: u32, line: &str) {
    let next = keyed(map, &edit.buf)
        .find(|&(key, _)| key > id)
        .map(|(_, next)| next.span().start);
    let (at, indent) = match next {
        Some(next) => (edit.line_start(next), edit.indent(next)),
        None => edit.before_close(map),
    };
    edit.insert(at, [&indent[..], line.as_bytes(), b"\n"].concat());
}

/// The children of `block` keyed by a number, with that number.
fn keyed<'n>(block: &'n Node, src: &'n [u8]) -> impl Iterator<Item = (u32, &'n Node)> + 'n {
    block
        .children()
        .iter()
        .filter_map(move |child| Some((child.key_str(src)?.parse().ok()?, child)))
}
