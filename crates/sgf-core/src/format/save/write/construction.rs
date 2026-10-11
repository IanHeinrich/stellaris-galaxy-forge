//! What a megastructure's construction adds, written with the row by `AddMegastructure` and
//! taken back with it by `RemoveMegastructure`: timed modifiers on its system and the
//! system's bodies, deposits on those bodies, and variables its owner counts with.
//!
//! The caller says what, as the install's build chain gives it for the system; this module
//! only writes it. A modifier goes last in its entity's `timed_modifier`, a deposit as
//! `AddDeposit` writes one, and a variable the owner lacks in its place among the owner's
//! `variables`, which the game keeps sorted by name.

use std::collections::BTreeMap;

use crate::cst::Node;
use crate::emit::coord;
use crate::emit::system::{DepositEntry, deposit_entry};
use crate::emit::{Lines, inline};
use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, row};
use crate::format::save::alloc::SlotTable;
use crate::format::save::write::add_system::write_slot;
use crate::format::save::write::id_list::{Emptied, append_in, statement, unlist_in};
use crate::format::save::write::place::{self, Place, insert_key};
use crate::format::save::write::restore::live;
use crate::format::save::write::timed_modifiers::{End, ItemEdit, set_items};
use crate::format::save::{entity_in, planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::{Form, check_text};
use crate::ops::{
    ConstructionDeposit, ConstructionModifier, Edit, Emitted, MegastructureConstruction,
    ModifierHost, Op, OpError, Plan, SavedTable, VariableRaise,
};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::session::Session;
use crate::span::Span;

/// Refuse a construction the add cannot write as given.
pub(crate) fn check(
    s: &Session,
    kind: &str,
    system: u32,
    owner: Option<u32>,
    construction: &MegastructureConstruction,
) -> Result<(), OpError> {
    let refuse = |reason: String| OpError::MegastructureRefused {
        kind: kind.to_owned(),
        reason,
    };
    for (i, item) in construction.modifiers.iter().enumerate() {
        check_text("a modifier", &item.modifier, Form::Bare)?;
        if item.days == 0 || item.days < -1 {
            return Err(refuse(format!(
                "modifier {} would last {} days",
                item.modifier, item.days
            )));
        }
        if construction.modifiers[..i]
            .iter()
            .any(|earlier| earlier.on == item.on && earlier.modifier == item.modifier)
        {
            return Err(refuse(format!(
                "modifier {} is listed twice",
                item.modifier
            )));
        }
        if let ModifierHost::Body { body } = item.on {
            in_system(s, system, body)?;
        }
    }
    for deposit in &construction.deposits {
        check_text("a deposit type", &deposit.kind, Form::Bare)?;
        in_system(s, system, deposit.body)?;
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
    Ok(edit
        .entity()?
        .find(keys::TIMED_MODIFIER, &edit.buf)
        .and_then(|block| block.find(keys::ITEMS, &edit.buf))
        .map(|items| {
            items
                .children()
                .iter()
                .map(|item| read::text(item, keys::MODIFIER, &edit.buf))
                .collect()
        })
        .unwrap_or_default())
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
        if let Some(item) = items.iter().find(|item| held.contains(&item.modifier)) {
            let on = match host {
                ModifierHost::System => "the system".to_owned(),
                ModifierHost::Body { body } => format!("planet {body}"),
            };
            return Err(OpError::MegastructureRefused {
                kind: kind.to_owned(),
                reason: format!("{on} already has modifier {}", item.modifier),
            });
        }
        let adding: Vec<(&str, ItemEdit)> = items
            .iter()
            .map(|item| {
                let add = ItemEdit::Add {
                    at: End::Last,
                    days: item.days,
                };
                (item.modifier.as_str(), add)
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
            list(plan.edit_planet(&s.doc, body, system)?, &ids)?;
        }
    }
    if let Some(owner) = owner
        && !construction.variables.is_empty()
    {
        raise(plan.edit_country(&s.doc, owner)?, &construction.variables)?;
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

/// Raise each of `raises` in the country's `variables`: a held one to its sum, a new one
/// written before the first name after it.
fn raise(edit: &mut Edit, raises: &[VariableRaise]) -> Result<(), OpError> {
    let Some(block) = edit.entity()?.find(keys::VARIABLES, &edit.buf).cloned() else {
        let mut sorted: Vec<&VariableRaise> = raises.iter().collect();
        sorted.sort_by(|a, b| a.variable.cmp(&b.variable));
        let write = |indent: &[u8]| {
            let mut w = Lines::new(indent);
            w.open(0, keys::VARIABLES);
            for raise in &sorted {
                w.pair(1, &raise.variable, &raise.by.to_string());
            }
            w.close(0);
            inline(indent, &w.into_bytes())
        };
        return insert_key(edit, &[], &place::country::VARIABLES, write);
    };
    let lines: Vec<(String, Node)> = block
        .children()
        .iter()
        .filter_map(|line| Some((line.key_str(&edit.buf)?.to_owned(), line.clone())))
        .collect();
    let mut new: Vec<&VariableRaise> = Vec::new();
    for raise in raises {
        match lines.iter().find(|(name, _)| *name == raise.variable) {
            Some((_, line)) => {
                let span = line.scalar_span().ok_or_else(|| {
                    edit.parse_error(line.span().start, "a variable is no number")
                })?;
                let held: f64 = edit
                    .text(span)
                    .parse()
                    .map_err(|_| edit.parse_error(span.start, "a variable is no number"))?;
                edit.replace_span(span, coord(held + f64::from(raise.by)));
            }
            None => new.push(raise),
        }
    }
    new.sort_by(|a, b| a.variable.cmp(&b.variable));
    for raise in new {
        let text = format!("{}={}", raise.variable, raise.by);
        match lines.iter().find(|(name, _)| *name > raise.variable) {
            Some((_, after)) => edit.bytes().insert_before(after.span(), &text),
            None => match lines.last() {
                Some((_, last)) => edit.bytes().insert_after(last.span().end, &text),
                None => {
                    let (at, indent) = edit.before_close(&block);
                    let line = [&indent[..], text.as_bytes(), edit.eol(at)].concat();
                    edit.insert(at, line);
                }
            },
        }
    }
    Ok(())
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
            && in_system(s, system, body).is_err()
        {
            continue;
        }
        let edit = host_edit(plan, s, system, host)?;
        let held = held_modifiers(edit)?;
        let going: Vec<&ConstructionModifier> = items
            .into_iter()
            .filter(|item| held.contains(&item.modifier))
            .collect();
        let removing: Vec<(&str, ItemEdit)> = going
            .iter()
            .map(|item| (item.modifier.as_str(), ItemEdit::Remove))
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
        kept.variables = lower(plan, s, owner, &construction.variables)?;
    }
    Ok(kept)
}

/// For each of `deposits`, an added deposit of its type on its body, latest first taken,
/// with its id and slot; one no longer there is left out.
fn added_deposits<'c>(
    s: &Session,
    system: u32,
    deposits: &'c [ConstructionDeposit],
) -> Result<Vec<(&'c ConstructionDeposit, u32, Anchor)>, OpError> {
    let table = Table::Entity(EntityKind::Deposit);
    let mut taken: Vec<u32> = Vec::new();
    let mut found = Vec::new();
    for deposit in deposits {
        if in_system(s, system, deposit.body).is_err() {
            continue;
        }
        let (node, src) = planet_entity(&s.doc, deposit.body)?;
        let ids = read::ids(&node, keys::DEPOSITS, src);
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

/// Lower each of `raises` on country `owner` as far as it was raised, a line going at 0 and
/// the block with its last line when the file held neither; return what was lowered.
fn lower(
    plan: &mut Plan,
    s: &Session,
    owner: u32,
    raises: &[VariableRaise],
) -> Result<Vec<VariableRaise>, OpError> {
    let Some(country) = live(&s.doc, SavedTable::Country, owner)? else {
        return Ok(Vec::new());
    };
    let loaded: Option<(Node, &[u8])> = match country.anchor {
        Anchor::Original(span) => {
            let src = span.slice(s.doc.original());
            entity_in(src).ok().flatten().map(|node| (node, src))
        }
        Anchor::Inserted { .. } => None,
    };
    let loaded_block = loaded
        .as_ref()
        .and_then(|(node, src)| Some((node.find(keys::VARIABLES, src)?.clone(), *src)));
    let had_block = loaded_block.is_some();
    let had = |name: &str| {
        loaded_block
            .as_ref()
            .is_some_and(|(block, src)| block.find(name, src).is_some())
    };

    let edit = plan.edit_country(&s.doc, owner)?;
    let Some(block) = edit.entity()?.find(keys::VARIABLES, &edit.buf).cloned() else {
        return Ok(Vec::new());
    };
    let mut lowered = Vec::new();
    let mut changes: Vec<(Span, Option<String>)> = Vec::new();
    for raise in raises {
        let Some(line) = block.find(&raise.variable, &edit.buf) else {
            continue;
        };
        let Some(span) = line.scalar_span() else {
            continue;
        };
        let Ok(held) = edit.text(span).parse::<f64>() else {
            continue;
        };
        let left = held - f64::from(raise.by);
        if left < 0.0 {
            continue;
        }
        let change = if left == 0.0 && !had(&raise.variable) {
            (line.span(), None)
        } else {
            (span, Some(coord(left)))
        };
        changes.push(change);
        lowered.push(raise.clone());
    }
    let gone = changes.iter().filter(|(_, value)| value.is_none()).count();
    if gone == block.children().len() && !had_block {
        edit.bytes().remove_statement(block.span());
        return Ok(lowered);
    }
    for (span, value) in changes {
        match value {
            Some(value) => edit.replace_span(span, value),
            None => edit.bytes().remove_statement(span),
        }
    }
    Ok(lowered)
}

/// The construction the add that wrote row `megastructure` this session gave it: what the
/// latest undoable edit naming the row's removal as its inverse carries.
pub(crate) fn of_session(s: &Session, megastructure: u32) -> Option<MegastructureConstruction> {
    fn find(op: &Op, megastructure: u32) -> Option<Option<&MegastructureConstruction>> {
        match op {
            Op::RemoveMegastructure {
                megastructure: id,
                construction,
            } if *id == megastructure => Some(construction.as_ref()),
            Op::Batch { ops, .. } => ops.iter().rev().find_map(|op| find(op, megastructure)),
            _ => None,
        }
    }
    s.applied()
        .rev()
        .find_map(|applied| find(&applied.inverse, megastructure))
        .flatten()
        .cloned()
}
