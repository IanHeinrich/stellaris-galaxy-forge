//! A `megastructures` row and what names it: its system's `megastructures`, its owner's
//! `owned_megastructures`, its body's `megastructure` key and flags, and the `bypasses` row
//! it brings with it, which other bypasses name in their connections.
//!
//! A bypass row the file held is emptied rather than erased, so that its slot stays where
//! an inverse can write it back; one an op wrote is erased. Either way nothing is left in
//! the table, since a tombstone there shows a broken bypass on the galaxy map.

use crate::Span;
use crate::cst::Node;
use crate::document::Document;
use crate::entity::facts::megastructure;
use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, row, rows};
use crate::format::save::write::id_list::{Emptied, unlist};
use crate::format::save::write::restore::{Saved, live};
use crate::format::save::{entity_at, planet_statement, planet_system, system_statement};
use crate::keys;
use crate::ops::{OpError, Plan, SavedTable, Subject};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::session::Session;

/// The `megastructures` table.
pub(crate) const MEGASTRUCTURES: Table = Table::Entity(EntityKind::Megastructure);

/// The model the game swaps an Arc Furnace's planet to, which hides it inside the furnace.
const FURNACE_ENTITY: &str = "invisible_turret_entity";

/// The planet flags a built or ruined megastructure leaves on its body.
const BODY_FLAGS: [&str; 3] = [
    keys::HAS_MEGASTRUCTURE,
    keys::HAS_ARC_FURNACE,
    keys::RUINED_ORBITAL_RING_PLANET,
];

/// One live `megastructures` row and what it names.
#[derive(Debug, Clone)]
pub(crate) struct Tied {
    pub(crate) id: u32,
    pub(crate) anchor: Anchor,
    /// The `type`, such as `think_tank_3`.
    pub(crate) kind: String,
    /// `coordinate.origin`; `None` when the row names no system.
    pub(crate) system: Option<u32>,
    pub(crate) owner: Option<u32>,
    pub(crate) planet: Option<u32>,
    pub(crate) bypass: Option<u32>,
    /// `save_on_death=1`: the game logs the row in `dead_mega_structure` when it goes.
    pub(crate) save_on_death: bool,
}

/// Row `id` as the bytes now standing for it hold it; `None` when the save holds no such
/// row, holds its tombstone, or an op took it out.
pub(crate) fn read(doc: &Document, id: u32) -> Result<Option<Tied>, OpError> {
    let Some(row) = row(doc, MEGASTRUCTURES, id)? else {
        return Ok(None);
    };
    let facts = megastructure::read(&row.node, row.src);
    Ok(Some(Tied {
        id,
        anchor: row.anchor,
        kind: facts.kind,
        system: facts.origin,
        owner: facts.owner,
        planet: facts.planet,
        bypass: facts.bypass,
        save_on_death: read::scalar(&row.node, keys::SAVE_ON_DEATH, row.src) == Some("1"),
    }))
}

/// Take row `tied`'s id out of its system's `megastructures` and its owner's
/// `owned_megastructures`, each list going with its last id, and its body's `megastructure`
/// key away. Unless another live row names the body, the body also loses the flags the
/// structure left and an Arc Furnace's hiding model. The row itself is the caller's. With
/// `saved`, each entity rewritten is kept for the inverse.
pub(crate) fn unlink(
    plan: &mut Plan,
    s: &Session,
    tied: &Tied,
    mut saved: Option<&mut Saved>,
) -> Result<(), OpError> {
    let doc = &s.doc;
    if let Some(system) = tied.system {
        let anchor = system_statement(doc, system).ok_or(OpError::UnknownSystem(system))?;
        keep(&mut saved, doc, SavedTable::System, system, anchor)?;
        unlist(
            plan.edit(doc, system)?,
            keys::MEGASTRUCTURES,
            &[tied.id],
            Emptied::Drop,
        )?;
    }
    if let Some(owner) = tied.owner
        && let Some(country) = live(doc, SavedTable::Country, owner)?
        && read::ids(&country.node, keys::OWNED_MEGASTRUCTURES, country.src).contains(&tied.id)
    {
        keep(&mut saved, doc, SavedTable::Country, owner, country.anchor)?;
        unlist(
            plan.edit_country(doc, owner)?,
            keys::OWNED_MEGASTRUCTURES,
            &[tied.id],
            Emptied::Drop,
        )?;
    }
    if let Some(planet) = tied.planet {
        unlink_body(plan, s, tied, planet, &mut saved)?;
    }
    Ok(())
}

/// Take the keys row `tied` left on `planet` away.
fn unlink_body(
    plan: &mut Plan,
    s: &Session,
    tied: &Tied,
    planet: u32,
    saved: &mut Option<&mut Saved>,
) -> Result<(), OpError> {
    let doc = &s.doc;
    let Some(anchor) = planet_statement(doc, planet)? else {
        return Ok(());
    };
    let Some((node, src)) = entity_at(doc, anchor)
        .map_err(|e| Subject::Record(anchor).parse_error(e.offset, e.reason))?
    else {
        return Ok(());
    };
    let system = planet_system(&node, src, planet)?;
    let alone = !rows(doc, MEGASTRUCTURES)?.iter().any(|row| {
        row.id != tied.id && read::scalar_u32(&row.node, keys::PLANET, row.src) == Some(planet)
    });
    let spans = body_keys(&node, src, tied.id, alone);
    if spans.is_empty() {
        return Ok(());
    }
    keep(saved, doc, SavedTable::Planet, planet, anchor)?;
    let edit = plan.edit_planet(doc, planet, system)?;
    for span in spans {
        edit.bytes().remove_statement(span);
    }
    Ok(())
}

/// The statements of planet `node` that name row `id`: its `megastructure` key, and when
/// `alone`, the flags a structure leaves (the whole `flags` block when nothing else is in
/// it) and an Arc Furnace's hiding model.
fn body_keys(node: &Node, src: &[u8], id: u32, alone: bool) -> Vec<Span> {
    let mut spans: Vec<Span> = node
        .find_all(keys::MEGASTRUCTURE, src)
        .filter(|key| key.scalar_str(src).and_then(|t| t.parse().ok()) == Some(id))
        .map(Node::span)
        .collect();
    if !alone {
        return spans;
    }
    if let Some(flags) = node.find(keys::FLAGS, src) {
        let left: Vec<&Node> = flags
            .children()
            .iter()
            .filter(|flag| !flag.key_str(src).is_some_and(|k| BODY_FLAGS.contains(&k)))
            .collect();
        if left.is_empty() {
            spans.push(flags.span());
        } else if left.len() < flags.children().len() {
            spans.extend(
                flags
                    .children()
                    .iter()
                    .filter(|flag| flag.key_str(src).is_some_and(|k| BODY_FLAGS.contains(&k)))
                    .map(Node::span),
            );
        }
    }
    spans.extend(
        node.find_all(keys::ENTITY_NAME, src)
            .filter(|name| name.scalar_str(src) == Some(FURNACE_ENTITY))
            .map(Node::span),
    );
    spans
}

/// Take bypass `bypass` of system `system` out: the row is emptied when the file held it
/// and erased when an op wrote it, its id leaves the system's `bypasses` and every other
/// bypass's `connections`, `active_connections` and `linked_to`. Each country's
/// `usable_bypasses` and a fleet's `bypass_from` and `bypass_to` are left for the game, as
/// a removed wormhole leaves them. With `saved`, each entity rewritten is kept for the
/// inverse.
pub(crate) fn drop_bypass(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    bypass: u32,
    mut saved: Option<&mut Saved>,
) -> Result<(), OpError> {
    let doc = &s.doc;
    if let Some(own) = row(doc, Table::Bypass, bypass)? {
        if doc.added().get(Table::Bypass, bypass).is_some() {
            plan.erase(doc, Subject::Record(own.anchor), own.anchor)?;
        } else {
            keep(&mut saved, doc, SavedTable::Bypass, bypass, own.anchor)?;
            plan.replace(doc, Subject::Record(own.anchor), own.anchor, Vec::new())?;
        }
    }
    for other in rows(doc, Table::Bypass)? {
        if other.id == bypass || !names_bypass(&other.node, other.src, bypass) {
            continue;
        }
        keep(&mut saved, doc, SavedTable::Bypass, other.id, other.anchor)?;
        let edit = plan.edit_record(doc, other.anchor)?;
        unlist(edit, keys::CONNECTIONS, &[bypass], Emptied::Drop)?;
        unlist(edit, keys::ACTIVE_CONNECTIONS, &[bypass], Emptied::Drop)?;
        let linked: Vec<Span> = edit
            .entity()?
            .find_all(keys::LINKED_TO, &edit.buf)
            .filter(|key| key.scalar_str(&edit.buf).and_then(|t| t.parse().ok()) == Some(bypass))
            .map(Node::span)
            .collect();
        for span in linked {
            edit.bytes().remove_statement(span);
        }
    }
    let anchor = system_statement(doc, system).ok_or(OpError::UnknownSystem(system))?;
    keep(&mut saved, doc, SavedTable::System, system, anchor)?;
    unlist(
        plan.edit(doc, system)?,
        keys::BYPASSES,
        &[bypass],
        Emptied::Drop,
    )?;
    Ok(())
}

/// Whether bypass row `node` names `bypass` as a connection or the other end of its link.
fn names_bypass(node: &Node, src: &[u8], bypass: u32) -> bool {
    read::ids(node, keys::CONNECTIONS, src).contains(&bypass)
        || read::ids(node, keys::ACTIVE_CONNECTIONS, src).contains(&bypass)
        || read::scalar_u32(node, keys::LINKED_TO, src) == Some(bypass)
}

fn keep(
    saved: &mut Option<&mut Saved>,
    doc: &Document,
    table: SavedTable,
    id: u32,
    anchor: Anchor,
) -> Result<(), OpError> {
    match saved {
        Some(saved) => saved.keep(doc, table, id, anchor),
        None => Ok(()),
    }
}
