//! What a megastructure's dismantle takes back when its row is deleted: the modifiers its
//! construction gave its system and the system's bodies, the deposits it added to them, and
//! the counters it raised on its owner. The install says which, per type; the caller passes
//! them in.

use crate::cst::Node;
use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, row};
use crate::format::save::galaxy::bodies::planet_ids;
use crate::format::save::write::id_list::{Emptied, unlist};
use crate::format::save::write::place;
use crate::format::save::write::restore::{Saved, country_edit, live, tombstoned};
use crate::format::save::write::timed_modifiers::{ItemEdit, set_items};
use crate::format::save::write::variables;
use crate::format::save::{entity, entity_at, planet_statement, system_statement};
use crate::keys;
use crate::ops::rules::{Form, check_text};
use crate::ops::{MegastructureDismantle, OpError, Plan, SavedTable, Subject};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::session::Session;
use crate::{and_list, plural, plural_of};

/// Refuse a modifier, deposit type or variable that is not an identifier.
pub(crate) fn check(dismantle: &MegastructureDismantle) -> Result<(), OpError> {
    for modifier in &dismantle.modifiers {
        check_text("a modifier", modifier, Form::Bare)?;
    }
    for deposit in &dismantle.deposits {
        check_text("a deposit type", deposit, Form::Bare)?;
    }
    for drop in &dismantle.variables {
        check_text("a variable", &drop.variable, Form::Bare)?;
    }
    Ok(())
}

/// How much a dismantle took back, for the description.
#[derive(Default)]
pub(crate) struct TakenBack {
    modifiers: usize,
    deposits: usize,
    variables: usize,
}

impl TakenBack {
    /// ", and took back 12 modifiers and a deposit", or nothing when nothing went.
    pub(crate) fn what(&self) -> String {
        let mut parts = Vec::new();
        if self.modifiers > 0 {
            parts.push(plural(self.modifiers, "modifier"));
        }
        if self.deposits > 0 {
            parts.push(plural(self.deposits, "deposit"));
        }
        if self.variables > 0 {
            parts.push(plural_of(self.variables, "counter", "counters"));
        }
        match parts.is_empty() {
            true => String::new(),
            false => format!(", and took back {}", and_list(&parts)),
        }
    }
}

/// Take back what `dismantle` lists from system `system`, its bodies and `owner`, keeping
/// each entity rewritten in `saved`.
pub(crate) fn take_back(
    plan: &mut Plan,
    s: &Session,
    saved: &mut Saved,
    system: u32,
    owner: Option<u32>,
    dismantle: &MegastructureDismantle,
) -> Result<TakenBack, OpError> {
    let doc = &s.doc;
    let mut taken = TakenBack::default();
    let removing: Vec<(&str, ItemEdit)> = dismantle
        .modifiers
        .iter()
        .map(|modifier| (modifier.as_str(), ItemEdit::Remove))
        .collect();

    let anchor = system_statement(doc, system).ok_or(OpError::UnknownSystem(system))?;
    let (node, src) = entity(doc, Subject::System(system), anchor)?;
    let items = modifier_items(&node, src, &dismantle.modifiers);
    if items > 0 {
        saved.keep(doc, SavedTable::System, system, anchor)?;
        set_items(
            plan.edit(doc, system)?,
            &place::system::TIMED_MODIFIER,
            &removing,
        )?;
        taken.modifiers += items;
    }

    for planet in planet_ids(&node, src) {
        let Some(anchor) = planet_statement(doc, planet)? else {
            continue;
        };
        let Some((node, src)) = entity_at(doc, anchor)
            .map_err(|e| Subject::Record(anchor).parse_error(e.offset, e.reason))?
        else {
            continue;
        };
        let items = modifier_items(&node, src, &dismantle.modifiers);
        let deposits = deposits_of(s, &node, src, &dismantle.deposits)?;
        if items == 0 && deposits.is_empty() {
            continue;
        }
        saved.keep(doc, SavedTable::Planet, planet, anchor)?;
        let edit = plan.edit_planet(doc, planet, system)?;
        if items > 0 {
            set_items(edit, &place::planet::TIMED_MODIFIER, &removing)?;
        }
        let ids: Vec<u32> = deposits.iter().map(|&(id, _)| id).collect();
        unlist(edit, keys::DEPOSITS, &ids, Emptied::Drop)?;
        for (id, anchor) in deposits {
            saved.keep(doc, SavedTable::Deposit, id, anchor)?;
            let bytes = tombstoned(doc, anchor, id)?;
            plan.replace(doc, Subject::Record(anchor), anchor, bytes)?;
        }
        taken.modifiers += items;
        taken.deposits += ids.len();
    }

    if let Some(owner) = owner
        && let Some(country) = live(doc, SavedTable::Country, owner)?
        && !variables::dismantled(&country.node, country.src, &dismantle.variables).is_empty()
    {
        let edit = country_edit(plan, doc, saved, owner)?;
        let changes = variables::dismantled(edit.entity()?, &edit.buf, &dismantle.variables);
        taken.variables += changes.len();
        for (span, value) in changes {
            edit.replace_span(span, value);
        }
    }
    Ok(taken)
}

/// How many items of the entity's `timed_modifier` name one of `modifiers`.
fn modifier_items(node: &Node, src: &[u8], modifiers: &[String]) -> usize {
    read::timed_items(node, src)
        .filter(|item| {
            read::scalar(item, keys::MODIFIER, src)
                .is_some_and(|m| modifiers.iter().any(|listed| listed == m))
        })
        .count()
}

/// The deposits planet `node` lists whose type is one of `kinds`, with their entries. A
/// deposit an op added this session is left: its slot is the add's to give back.
fn deposits_of(
    s: &Session,
    node: &Node,
    src: &[u8],
    kinds: &[String],
) -> Result<Vec<(u32, Anchor)>, OpError> {
    if kinds.is_empty() {
        return Ok(Vec::new());
    }
    let table = Table::Entity(EntityKind::Deposit);
    let mut found = Vec::new();
    for id in read::ids(node, keys::DEPOSITS, src) {
        if s.doc.added().get(table, id).is_some() {
            continue;
        }
        let Some(deposit) = row(&s.doc, table, id)? else {
            continue;
        };
        let kind = read::scalar(&deposit.node, keys::TYPE, deposit.src);
        if kind.is_some_and(|kind| kinds.iter().any(|listed| listed == kind)) {
            found.push((id, deposit.anchor));
        }
    }
    Ok(found)
}
