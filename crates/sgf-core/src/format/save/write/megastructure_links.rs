//! A `megastructures` row and what names it: its system's `megastructures`, its owner's
//! `owned_megastructures`, its body's `megastructure` key and flags, and the `bypasses` row
//! it brings with it, which other bypasses name in their connections.
//!
//! A bypass row the file held is emptied rather than erased, so that its slot stays where
//! an inverse can write it back; one an op wrote is erased. Either way nothing is left in
//! the table, since a tombstone there shows a broken bypass on the galaxy map.

use crate::NULL_ID;
use crate::Span;
use crate::cst::Node;
use crate::document::Document;
use crate::emit::megastructure::{MegastructureRow, megastructure_row};
use crate::entity::facts::megastructure;
use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, row, rows};
use crate::format::save::alloc::SlotTable;
use crate::format::save::write::flags;
use crate::format::save::write::id_list::{Emptied, append, unlist};
use crate::format::save::write::place;
use crate::format::save::write::restore::{Saved, live};
use crate::format::save::write::shared::write_slot;
use crate::format::save::{entity_at, planet_statement, planet_system, system_statement};
use crate::keys;
use crate::ops::rules::FURNACE_ENTITY;
use crate::ops::{Emitted, OpError, Plan, SavedTable, Subject};
use crate::overlay::Anchor;
use crate::projections::name::NameTemplate;
use crate::projections::read;
use crate::session::Session;

/// The `megastructures` table.
pub(crate) const MEGASTRUCTURES: Table = Table::Entity(EntityKind::Megastructure);

/// The bypass types a row the editor adds, moves or deletes may stand for: those tried in
/// game.
pub const BYPASS_KINDS: [&str; 2] = [GATEWAY, RELAY];
pub(crate) const GATEWAY: &str = "gateway";
pub(crate) const RELAY: &str = "relay_bypass";

/// The planet flag the game's habitat orbitals set on their body when they are spawned.
pub(crate) const HAS_ORBITAL: &str = "has_orbital";

/// The planet flags a built or ruined megastructure leaves on its body.
pub(crate) const BODY_FLAGS: [&str; 4] = [
    keys::HAS_MEGASTRUCTURE,
    keys::HAS_ARC_FURNACE,
    keys::RUINED_ORBITAL_RING_PLANET,
    HAS_ORBITAL,
];

/// What refuses an add of megastructure type `kind`, for the reason it is given.
pub(crate) fn refuse(kind: &str) -> impl Fn(String) -> OpError + '_ {
    move |reason| OpError::MegastructureRefused {
        kind: kind.to_owned(),
        reason,
    }
}

/// What holds a body, for each op to choose what it refuses. Whether a structure made the
/// body is [`made`].
#[derive(Debug)]
pub(crate) struct Holders {
    /// The row the body's `megastructure` key names, unless it names the null id.
    pub(crate) key: Option<u32>,
    /// The live rows whose `planet` is the body, in table order.
    pub(crate) rows: Vec<u32>,
    /// The flags of [`BODY_FLAGS`] the body has.
    pub(crate) flags: Vec<&'static str>,
}

impl Holders {
    /// What holds body `body`, whose entry is `node`.
    pub(crate) fn read(
        doc: &Document,
        body: u32,
        node: &Node,
        src: &[u8],
    ) -> Result<Self, OpError> {
        let rows = rows(doc, MEGASTRUCTURES)?
            .iter()
            .filter(|row| read::scalar_u32(&row.node, keys::PLANET, row.src) == Some(body))
            .map(|row| row.id)
            .collect();
        Ok(Self {
            key: read::scalar_u32(node, keys::MEGASTRUCTURE, src).filter(|&id| id != NULL_ID),
            rows,
            flags: BODY_FLAGS
                .into_iter()
                .filter(|flag| read::has_flag(node, src, flag))
                .collect(),
        })
    }

    /// The first live row naming the body other than those in `going`.
    pub(crate) fn row_besides(&self, going: &[u32]) -> Option<u32> {
        self.rows.iter().copied().find(|id| !going.contains(id))
    }
}

/// Whether the body `node` has the planet flag `megastructure`, which a structure that made
/// the body leaves on it, such as a cosmogenesis world.
pub(crate) fn made(node: &Node, src: &[u8]) -> bool {
    read::has_flag(node, src, keys::MEGASTRUCTURE)
}

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

/// A `megastructures` row [`write_rows`] writes finished.
pub(crate) struct NewRow<'a> {
    pub(crate) name: Option<&'a NameTemplate>,
    pub(crate) kind: &'a str,
    pub(crate) at: (f64, f64),
    /// The owner and the `graphical_culture` it names.
    pub(crate) owner: Option<(u32, Option<&'a str>)>,
    pub(crate) planet: Option<u32>,
    pub(crate) bypass: Option<u32>,
}

/// Write `rows` of system `system`, each in the slot past the highest the table has used,
/// and list them in the system's `megastructures` and each owner's `owned_megastructures`.
/// Returns their ids. The counterpart of [`unlink_all`].
pub(crate) fn write_rows(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    rows: &[NewRow],
) -> Result<Vec<u32>, OpError> {
    let mut table = SlotTable::megastructures(&s.doc)?;
    let mut ids = Vec::with_capacity(rows.len());
    for new in rows {
        let slot = table.append();
        let id = slot.id();
        let row = MegastructureRow {
            id,
            name: new.name,
            kind: new.kind,
            at: new.at,
            system,
            owner: new.owner,
            planet: new.planet.unwrap_or(NULL_ID),
            bypass: new.bypass,
        };
        write_slot(plan, &s.doc, slot, &mut table, Emitted::Record, |indent| {
            megastructure_row(indent, &row)
        })?;
        ids.push(id);
    }
    append(
        plan.edit(&s.doc, system)?,
        &place::system::MEGASTRUCTURES,
        &ids,
    )?;
    let owner_of = |new: &NewRow| new.owner.map(|(owner, _)| owner);
    let mut owners: Vec<u32> = rows.iter().filter_map(owner_of).collect();
    owners.sort_unstable();
    owners.dedup();
    for owner in owners {
        let owned: Vec<u32> = rows
            .iter()
            .zip(&ids)
            .filter(|(new, _)| owner_of(new) == Some(owner))
            .map(|(_, &id)| id)
            .collect();
        append(
            plan.edit_country(&s.doc, owner)?,
            &place::country::OWNED_MEGASTRUCTURES,
            &owned,
        )?;
    }
    Ok(ids)
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
    saved: Option<&mut Saved>,
) -> Result<(), OpError> {
    unlink_all(plan, s, std::slice::from_ref(tied), saved)
}

/// [`unlink`] for rows that go together, so that a list goes with the last of them and a
/// body they all name keeps nothing they left.
pub(crate) fn unlink_all(
    plan: &mut Plan,
    s: &Session,
    rows: &[Tied],
    mut saved: Option<&mut Saved>,
) -> Result<(), OpError> {
    let doc = &s.doc;
    let naming = |pick: fn(&Tied) -> Option<u32>, id: u32| -> Vec<u32> {
        rows.iter()
            .filter(|tied| pick(tied) == Some(id))
            .map(|tied| tied.id)
            .collect()
    };
    for system in distinct(rows, |tied| tied.system) {
        let anchor = system_statement(doc, system).ok_or(OpError::UnknownSystem(system))?;
        keep(&mut saved, doc, SavedTable::System, system, anchor)?;
        unlist(
            plan.edit(doc, system)?,
            keys::MEGASTRUCTURES,
            &naming(|tied| tied.system, system),
            Emptied::Drop,
        )?;
    }
    for owner in distinct(rows, |tied| tied.owner) {
        let Some(country) = live(doc, SavedTable::Country, owner)? else {
            continue;
        };
        let listed = read::ids(&country.node, keys::OWNED_MEGASTRUCTURES, country.src);
        let gone: Vec<u32> = naming(|tied| tied.owner, owner)
            .into_iter()
            .filter(|id| listed.contains(id))
            .collect();
        if gone.is_empty() {
            continue;
        }
        keep(&mut saved, doc, SavedTable::Country, owner, country.anchor)?;
        unlist(
            plan.edit_country(doc, owner)?,
            keys::OWNED_MEGASTRUCTURES,
            &gone,
            Emptied::Drop,
        )?;
    }
    let going: Vec<u32> = rows.iter().map(|tied| tied.id).collect();
    for planet in distinct(rows, |tied| tied.planet) {
        let named = naming(|tied| tied.planet, planet);
        unlink_body(plan, s, &named, &going, planet, &mut saved)?;
    }
    Ok(())
}

/// The ids `pick` reads from `rows`, each once, in order.
fn distinct(rows: &[Tied], pick: fn(&Tied) -> Option<u32>) -> Vec<u32> {
    let mut ids: Vec<u32> = rows.iter().filter_map(pick).collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}

/// Take the keys rows `named` left on `planet` away; the flags and model too unless a live
/// row other than those `going` names it.
pub(crate) fn unlink_body(
    plan: &mut Plan,
    s: &Session,
    named: &[u32],
    going: &[u32],
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
        !going.contains(&row.id)
            && read::scalar_u32(&row.node, keys::PLANET, row.src) == Some(planet)
    });
    let spans = body_keys(&node, src, named, alone);
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

/// The statements of planet `node` that name one of rows `ids`: its `megastructure` keys,
/// and when `alone`, the flags a structure leaves (the whole `flags` block when nothing else
/// is in it) and an Arc Furnace's hiding model.
fn body_keys(node: &Node, src: &[u8], ids: &[u32], alone: bool) -> Vec<Span> {
    let mut spans: Vec<Span> = node
        .find_all(keys::MEGASTRUCTURE, src)
        .filter(|key| {
            key.scalar_str(src)
                .and_then(|t| t.parse().ok())
                .is_some_and(|id| ids.contains(&id))
        })
        .map(Node::span)
        .collect();
    if !alone {
        return spans;
    }
    spans.extend(flags::flag_spans(node, src, |flag| {
        BODY_FLAGS.contains(&flag)
    }));
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
