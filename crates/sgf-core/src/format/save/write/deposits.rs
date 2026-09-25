//! `AddSaveDeposit` and `RemoveSaveDeposit`: one entry of the top-level `deposit` table
//! and its id in the `deposits` list of the uncolonised planet holding it. Nothing else in
//! a save names a deposit of an uncolonised planet, so nothing else is written: a station
//! working a removed deposit is left standing.
//!
//! A new entry takes a slot as [`super::add_system`] gives one, and its id goes last in
//! the planet's list, or in a list written last in the planet, where the game keeps it.
//! A removal leaves the entry's tombstone, `<id>=none`, and drops the list with its last
//! id: the game writes no empty `deposits`. A deposit added since the file was opened
//! gives its slot back instead, as [`super::remove_system`] does for a system's bodies.

use crate::document::Document;
use crate::emit::inline;
use crate::emit::system::{DepositEntry, PLANET_HOLDER, deposit_entry, deposits_list};
use crate::entity::facts::planet::{self, PlanetFacts};
use crate::entity::views::EntityKind;
use crate::format::save::alloc::{self, SlotTable};
use crate::format::save::check_version;
use crate::format::save::write::add_system::write_slot;
use crate::format::save::{entity_at, planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::{Form, check_text};
use crate::ops::{Edit, Emitted, Op, OpError, Plan, Planned, Subject};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::session::Session;
use crate::span::Span;

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    planet: u32,
    kind: &str,
) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    check_deposit_kind(kind)?;
    let (system, _) = uncolonised(&s.doc, planet)?;
    let mut table = SlotTable::deposits(&s.doc)?;
    let slot = table.take();
    let id = slot.id();
    let entry = DepositEntry {
        id,
        kind,
        holder: planet,
    };
    let text = |indent: &[u8]| deposit_entry(indent, &entry);
    write_slot(plan, &s.doc, slot, &mut table, Emitted::Record, text)?;
    list(plan.edit_planet(&s.doc, planet, system)?, id)?;
    Ok(Planned {
        description: format!("Added {kind} (#{id}) to planet #{planet}"),
        inverse: Op::RemoveSaveDeposit { deposit: id },
    })
}

pub(crate) fn plan_remove(plan: &mut Plan, s: &Session, deposit: u32) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    let held = held(&s.doc, deposit)?;
    let planet = held.planet.ok_or(OpError::DepositNotOnPlanet(deposit))?;
    let (system, facts) = match uncolonised(&s.doc, planet) {
        Err(OpError::UnknownPlanet(_)) => Err(OpError::DepositNotOnPlanet(deposit)),
        found => found,
    }?;
    if !facts.deposits.contains(&deposit) {
        return Err(OpError::DepositNotOnPlanet(deposit));
    }
    free_entry(plan, &s.doc, deposit, held.anchor)?;
    unlist(plan.edit_planet(&s.doc, planet, system)?, deposit)?;
    Ok(Planned {
        description: format!("Removed {} (#{deposit}) from planet #{planet}", held.kind),
        inverse: Op::AddSaveDeposit {
            planet,
            kind: held.kind,
        },
    })
}

/// A deposit type as the game names one: `d_minerals_3`.
pub(crate) fn check_deposit_kind(kind: &str) -> Result<(), OpError> {
    check_text("a deposit type", kind, Form::Bare)
}

/// Planet `id`'s system and what its entry says, refused when the planet is colonised:
/// an owner and a colony, which the game writes together.
fn uncolonised(doc: &Document, id: u32) -> Result<(u32, PlanetFacts), OpError> {
    let (node, src) = planet_entity(doc, id)?;
    let facts = planet::read(&node, src);
    if facts.colony.is_some() || facts.owner.is_some() {
        return Err(OpError::PlanetColonised(id));
    }
    Ok((planet_system(&node, src, id)?, facts))
}

/// A live deposit entry: where it stands, its type, and the planet holding it, `None` when
/// its holder is not a planet or it names none.
struct Held {
    anchor: Anchor,
    kind: String,
    planet: Option<u32>,
}

fn held(doc: &Document, id: u32) -> Result<Held, OpError> {
    let unknown = OpError::UnknownDeposit(id);
    let anchor = doc
        .added()
        .get(EntityKind::Deposit, id)
        .or_else(|| {
            let entity = doc.index().entity(keys::DEPOSIT, u64::from(id))?;
            Some(Anchor::Original(entity.stmt))
        })
        .ok_or(unknown)?;
    let subject = Subject::Record(anchor);
    let found = entity_at(doc, anchor).map_err(|e| subject.parse_error(e.offset, e.reason))?;
    // The slot may hold a tombstone, or another entity an add wrote in its place.
    let Some((node, buf)) =
        found.filter(|(node, buf)| node.key_str(buf) == Some(id.to_string().as_str()))
    else {
        return Err(OpError::UnknownDeposit(id));
    };
    let node = &node;
    let kind = read::scalar(node, keys::TYPE, buf)
        .ok_or_else(|| subject.parse_error(node.span().start, "the deposit has no type"))?;
    let planet = node
        .find(keys::DEPOSIT_HOLDER, buf)
        .filter(|holder| read::scalar(holder, keys::TYPE, buf) == Some(PLANET_HOLDER))
        .and_then(|holder| read::scalar_u32(holder, keys::ID, buf));
    Ok(Held {
        anchor,
        kind: kind.to_owned(),
        planet,
    })
}

/// Leave deposit `id`'s slot as the game leaves a removed one, or give back the slot an
/// add took.
fn free_entry(plan: &mut Plan, doc: &Document, id: u32, anchor: Anchor) -> Result<(), OpError> {
    let subject = Subject::Record(anchor);
    if doc.added().get(EntityKind::Deposit, id).is_none() {
        return plan.replace(doc, subject, anchor, alloc::tombstone(id).into_bytes());
    }
    let mut table = SlotTable::deposits(doc)?;
    table.free(plan, doc, subject, id, anchor)?;
    table.settle(plan, doc)?;
    Ok(())
}

/// Put `id` last in the planet's `deposits`, writing the list last in the planet when it
/// has none.
fn list(edit: &mut Edit, id: u32) -> Result<(), OpError> {
    let entity = edit.entity()?;
    let Some(block) = entity.find(keys::DEPOSITS, &edit.buf) else {
        let last = entity
            .children()
            .last()
            .ok_or_else(|| edit.parse_error(entity.span().start, "the planet is empty"))?
            .span();
        let text = statement(&edit.indent(last.start), id);
        edit.insert_after(last.end, &text);
        return Ok(());
    };
    if block.scalar_span().is_some() {
        return Err(edit.parse_error(block.span().start, "deposits is not a block"));
    }
    match block.children().last() {
        Some(item) => {
            let at = item.span().end;
            edit.insert(at, format!(" {id}").into_bytes());
        }
        None => {
            let span = block.span();
            let text = statement(&edit.indent(span.start), id);
            edit.replace_statement(span, &text);
        }
    }
    Ok(())
}

/// A `deposits` list of `id` alone, as a statement whose first line takes `indent` from
/// the line it is written on.
fn statement(indent: &[u8], id: u32) -> String {
    inline(indent, &deposits_list(indent, &[id]))
}

/// Take `id` out of the planet's `deposits`, and the list with it when nothing else is
/// left in it.
fn unlist(edit: &mut Edit, id: u32) -> Result<(), OpError> {
    let entity = edit.entity()?;
    let block = entity
        .find(keys::DEPOSITS, &edit.buf)
        .ok_or(OpError::DepositNotOnPlanet(id))?;
    let listed: Vec<Span> = block
        .children()
        .iter()
        .filter(|item| item.key.is_none() && item.scalar_str(&edit.buf) == Some(&id.to_string()))
        .map(|item| item.span())
        .collect();
    if listed.is_empty() {
        return Err(OpError::DepositNotOnPlanet(id));
    }
    if listed.len() == block.children().len() {
        let span = block.span();
        edit.remove_statement(span);
        return Ok(());
    }
    for item in listed {
        let end = item.end
            + edit.buf[item.end..]
                .iter()
                .take_while(|&&b| b == b' ' || b == b'\t')
                .count();
        edit.replace_span(Span::new(item.start, end), Vec::new());
    }
    Ok(())
}
