//! What a megastructure's construction adds, written with the row by `AddMegastructure` and
//! taken back with it by `RemoveMegastructure`: timed modifiers on its system and the
//! system's bodies, deposits on those bodies, and variables its owner counts with.
//!
//! The caller says what, as the install's build chain gives it for the system; this module
//! only writes it. A modifier goes last in its entity's `timed_modifier`, a deposit as
//! `AddDeposit` writes one, and a variable the owner lacks in its place among the owner's
//! `variables`, which the game keeps sorted by name.

use std::collections::BTreeMap;

use crate::emit::system::{DepositEntry, deposit_entry};
use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, row};
use crate::format::save::alloc::SlotTable;
use crate::format::save::write::id_list::{Emptied, append_in, statement, unlist_in};
use crate::format::save::write::megastructure_links;
use crate::format::save::write::place::{self, Place, insert_key};
use crate::format::save::write::shared::write_slot;
use crate::format::save::write::timed_modifiers::{End, ItemEdit, set_items};
use crate::format::save::write::variables;
use crate::format::save::{planet_entity, planet_statement, planet_system};
use crate::keys;
use crate::ops::rules::modifiers::{check_timed, listed_once};
use crate::ops::rules::{Form, check_text};
use crate::ops::{
    ConstructionDeposit, ConstructionModifier, Edit, Emitted, MegastructureConstruction,
    ModifierHost, OpError, Plan,
};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::session::Session;

/// Refuse a construction the add cannot write as given.
pub(crate) fn check(
    s: &Session,
    kind: &str,
    system: u32,
    owner: Option<u32>,
    construction: &MegastructureConstruction,
) -> Result<(), OpError> {
    let refuse = megastructure_links::refuse(kind);
    for item in &construction.modifiers {
        check_timed(&item.timed)?;
        if let ModifierHost::Body { body } = item.on {
            in_system(s, system, body)?;
        }
    }
    let hosted: Vec<(ModifierHost, &str)> = construction
        .modifiers
        .iter()
        .map(|item| (item.on, item.timed.modifier.as_str()))
        .collect();
    listed_once("a modifier", &hosted, |(_, modifier)| {
        (*modifier).to_owned()
    })?;
    for deposit in &construction.deposits {
        check_text("a deposit type", &deposit.kind, Form::Bare)?;
        if !deleted(s, deposit.body)? {
            in_system(s, system, deposit.body)?;
        }
    }
    for raise in &construction.variables {
        check_text("a variable", &raise.variable, Form::Bare)?;
        if raise.by == 0 {
            return Err(refuse(format!(
                "variable {} is raised by 0",
                raise.variable
            )));
        }
        if owner.is_none() {
            return Err(refuse(format!(
                "variable {} needs an owner to count it",
                raise.variable
            )));
        }
    }
    Ok(())
}

fn in_system(s: &Session, system: u32, body: u32) -> Result<(), OpError> {
    let (node, src) = planet_entity(&s.doc, body)?;
    if planet_system(&node, src, body)? != system {
        return Err(OpError::NotABody { body, system });
    }
    Ok(())
}

/// Whether body `body` is one the file held that a deletion has since left as `<id>=none`.
fn deleted(s: &Session, body: u32) -> Result<bool, OpError> {
    match planet_entity(&s.doc, body) {
        Ok(_) => Ok(false),
        Err(OpError::UnknownPlanet(_)) => Ok(planet_statement(&s.doc, body)?.is_some()),
        Err(e) => Err(e),
    }
}

/// Whether body `body` still stands in `system`: false once the save no longer holds it or
/// it stands elsewhere. A body the save cannot read is an error.
fn still_in(s: &Session, system: u32, body: u32) -> Result<bool, OpError> {
    match in_system(s, system, body) {
        Ok(()) => Ok(true),
        Err(OpError::UnknownPlanet(_) | OpError::NotABody { .. }) => Ok(false),
        Err(e) => Err(e),
    }
}

/// The modifiers of `construction`, by the entity they go on, each in the order listed.
fn by_host(
    construction: &MegastructureConstruction,
) -> BTreeMap<ModifierHost, Vec<&ConstructionModifier>> {
    let mut hosts: BTreeMap<ModifierHost, Vec<&ConstructionModifier>> = BTreeMap::new();
    for item in &construction.modifiers {
        hosts.entry(item.on).or_default().push(item);
    }
    hosts
}

/// Where a modifier on `host` goes when its entity has no `timed_modifier`.
fn timed_place(host: ModifierHost) -> &'static Place {
    match host {
        ModifierHost::System => &place::system::TIMED_MODIFIER,
        ModifierHost::Body { .. } => &place::planet::TIMED_MODIFIER,
    }
}

fn host_edit<'p>(
    plan: &'p mut Plan,
    s: &Session,
    system: u32,
    host: ModifierHost,
) -> Result<&'p mut Edit, OpError> {
    match host {
        ModifierHost::System => plan.edit(&s.doc, system),
        ModifierHost::Body { body } => plan.edit_planet(&s.doc, body, system),
    }
}

/// The modifiers the entity `edit` holds has in its `timed_modifier`.
fn held_modifiers(edit: &Edit) -> Result<Vec<String>, OpError> {
    Ok(read::timed_items(edit.entity()?, &edit.buf)
        .map(|item| read::text(item, keys::MODIFIER, &edit.buf))
        .collect())
}

/// Write `construction`'s modifiers on the system and its bodies; a body's go before
/// anything else the add writes there, as the game writes `timed_modifier` ahead of
/// `flags`.
pub(crate) fn write_modifiers(
    plan: &mut Plan,
    s: &Session,
    kind: &str,
    system: u32,
    construction: &MegastructureConstruction,
) -> Result<(), OpError> {
    for (host, items) in by_host(construction) {
        let edit = host_edit(plan, s, system, host)?;
        let held = held_modifiers(edit)?;
        if let Some(item) = items
            .iter()
            .find(|item| held.contains(&item.timed.modifier))
        {
            let on = match host {
                ModifierHost::System => "the system".to_owned(),
                ModifierHost::Body { body } => format!("planet {body}"),
            };
            return Err(megastructure_links::refuse(kind)(format!(
                "{on} already has modifier {}",
                item.timed.modifier
            )));
        }
        let adding: Vec<(&str, ItemEdit)> = items
            .iter()
            .map(|item| {
                let add = ItemEdit::Add {
                    at: End::Last,
                    days: item.timed.written_days(),
                };
                (item.timed.modifier.as_str(), add)
            })
            .collect();
        set_items(edit, timed_place(host), &adding)?;
    }
    Ok(())
}

/// Write `construction`'s deposits and raise its variables on `owner`.
pub(crate) fn write_rest(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    owner: Option<u32>,
    construction: &MegastructureConstruction,
) -> Result<(), OpError> {
    if !construction.deposits.is_empty() {
        let mut table = SlotTable::deposits(&s.doc)?;
        let mut listed: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
        for deposit in &construction.deposits {
            let slot = table.take();
            let id = slot.id();
            let entry = DepositEntry {
                id,
                kind: &deposit.kind,
                holder: deposit.body,
            };
            write_slot(plan, &s.doc, slot, &mut table, Emitted::Record, |indent| {
                deposit_entry(indent, &entry)
            })?;
            listed.entry(deposit.body).or_default().push(id);
        }
        for (body, ids) in listed {
            if !deleted(s, body)? {
                list(plan.edit_planet(&s.doc, body, system)?, &ids)?;
            }
        }
    }
    if let Some(owner) = owner
        && !construction.variables.is_empty()
    {
        variables::raise(plan.edit_country(&s.doc, owner)?, &construction.variables)?;
    }
    Ok(())
}

/// Put `ids` last in the planet's `deposits`, writing the list when it has none.
fn list(edit: &mut Edit, ids: &[u32]) -> Result<(), OpError> {
    match edit.entity()?.find(keys::DEPOSITS, &edit.buf).cloned() {
        Some(block) => append_in(edit, &block, keys::DEPOSITS, ids),
        None => insert_key(edit, &[], &place::planet::DEPOSITS, |indent| {
            statement(indent, keys::DEPOSITS, ids)
        }),
    }
}

/// Take back what `construction` wrote in `system` and on `owner`, as much of it as is still
/// there, and return that much.
pub(crate) fn take_back(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    owner: Option<u32>,
    construction: &MegastructureConstruction,
) -> Result<MegastructureConstruction, OpError> {
    let mut kept = MegastructureConstruction::default();
    for (host, items) in by_host(construction) {
        if let ModifierHost::Body { body } = host
            && !still_in(s, system, body)?
        {
            continue;
        }
        let edit = host_edit(plan, s, system, host)?;
        let held = held_modifiers(edit)?;
        let going: Vec<&ConstructionModifier> = items
            .into_iter()
            .filter(|item| held.contains(&item.timed.modifier))
            .collect();
        let removing: Vec<(&str, ItemEdit)> = going
            .iter()
            .map(|item| (item.timed.modifier.as_str(), ItemEdit::Remove))
            .collect();
        set_items(edit, timed_place(host), &removing)?;
        kept.modifiers.extend(going.into_iter().cloned());
    }
    kept.modifiers.sort_by_key(|item| {
        construction
            .modifiers
            .iter()
            .position(|listed| listed == item)
    });

    let deposits = added_deposits(s, system, &construction.deposits)?;
    if !deposits.is_empty() {
        let mut table = SlotTable::deposits(&s.doc)?;
        let mut unlisted: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
        for (deposit, id, anchor) in deposits.iter().rev() {
            table.free(
                plan,
                &s.doc,
                crate::ops::Subject::Record(*anchor),
                *id,
                *anchor,
            )?;
            unlisted.entry(deposit.body).or_default().push(*id);
        }
        table.settle(plan, &s.doc)?;
        for (body, ids) in unlisted {
            if !still_in(s, system, body)? {
                continue;
            }
            let edit = plan.edit_planet(&s.doc, body, system)?;
            if let Some(block) = edit.entity()?.find(keys::DEPOSITS, &edit.buf).cloned() {
                unlist_in(edit, &block, &ids, Emptied::Drop);
            }
        }
        kept.deposits = deposits.into_iter().map(|(d, _, _)| d.clone()).collect();
    }

    if let Some(owner) = owner
        && !construction.variables.is_empty()
    {
        kept.variables = variables::take_back(plan, s, owner, &construction.variables)?;
    }
    Ok(kept)
}

/// For each of `deposits`, an added deposit of its type on its body, latest first taken,
/// with its id and slot; one no longer there is left out. A body deleted since leaves its
/// deposits behind, so they are found by the holder they name.
fn added_deposits<'c>(
    s: &Session,
    system: u32,
    deposits: &'c [ConstructionDeposit],
) -> Result<Vec<(&'c ConstructionDeposit, u32, Anchor)>, OpError> {
    let table = Table::Entity(EntityKind::Deposit);
    let mut taken: Vec<u32> = Vec::new();
    let mut found = Vec::new();
    for deposit in deposits {
        let ids = if still_in(s, system, deposit.body)? {
            let (node, src) = planet_entity(&s.doc, deposit.body)?;
            read::ids(&node, keys::DEPOSITS, src)
        } else {
            held_by(s, deposit.body)?
        };
        let mut pick = None;
        for id in ids.into_iter().rev() {
            if taken.contains(&id) || s.doc.added().get(table, id).is_none() {
                continue;
            }
            let Some(entry) = row(&s.doc, table, id)? else {
                continue;
            };
            if read::scalar(&entry.node, keys::TYPE, entry.src) == Some(deposit.kind.as_str()) {
                pick = Some((id, entry.anchor));
                break;
            }
        }
        if let Some((id, anchor)) = pick {
            taken.push(id);
            found.push((deposit, id, anchor));
        }
    }
    Ok(found)
}

/// The ids of the added deposits whose holder is planet `body`, lowest first.
fn held_by(s: &Session, body: u32) -> Result<Vec<u32>, OpError> {
    let table = Table::Entity(EntityKind::Deposit);
    let mut ids: Vec<u32> = s.doc.added().entries(table).map(|(id, _)| id).collect();
    ids.sort_unstable();
    let mut held = Vec::new();
    for id in ids {
        let Some(entry) = row(&s.doc, table, id)? else {
            continue;
        };
        let holder = entry
            .node
            .find(keys::DEPOSIT_HOLDER, entry.src)
            .and_then(|holder| read::scalar_u32(holder, keys::ID, entry.src));
        if holder == Some(body) {
            held.push(id);
        }
    }
    Ok(held)
}

/// The construction the add that wrote row `megastructure` this session gave it, and how
/// many of its effects it left out, as the document keeps them beside the row.
pub(crate) fn of_session(
    s: &Session,
    megastructure: u32,
) -> Option<(Option<MegastructureConstruction>, u32)> {
    let written = s.doc.added().written(megastructure)?;
    Some((written.construction.clone(), written.left_out))
}
