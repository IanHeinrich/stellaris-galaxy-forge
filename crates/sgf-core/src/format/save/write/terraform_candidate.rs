//! A save planet's terraforming candidate modifier: a permanent item of its
//! `timed_modifier`, as `add_modifier = { modifier = terraforming_candidate days = -1 }`
//! writes it. The block goes after `bombardment_damage` when it is new.

use crate::cst::Node;
use crate::format::save::read_spec::bodies;
use crate::format::save::write::timed_modifiers::{self, Place};
use crate::format::save::{planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::{Form, check_text};
use crate::ops::{Op, OpError, Plan, Planned};
use crate::projections::read::{self, PERMANENT};
use crate::session::Session;

/// The most copies of one modifier `SetTerraformCandidate` adds, or removes with an
/// inverse that restores them. The console adds one per `add_modifier`, so a save holds one or
/// two; the bound keeps a hand-typed op from writing thousands.
pub(crate) const MAX_MODIFIER_COPIES: u32 = 16;

pub(crate) fn plan_set(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    modifier: &str,
    on: bool,
    copies: Option<u32>,
) -> Result<Planned, OpError> {
    let (node, src) = planet_entity(&s.doc, id)?;
    let system = planet_system(&node, src, id)?;
    check_text("a modifier", modifier, Form::Bare)?;
    if bodies(&s.doc, system)?.first() == Some(&id) {
        return Err(OpError::StarCandidate(id));
    }
    let days: Vec<String> = timed_days(&node, src, modifier).collect();
    if !on && let Some(days) = days.iter().find(|d| *d != PERMANENT) {
        return Err(OpError::ModifierNotPermanent(
            id,
            modifier.to_owned(),
            days.clone(),
        ));
    }
    let held = u32::try_from(days.len()).unwrap_or(u32::MAX);
    let count = if on { copies.unwrap_or(1) } else { 1 };
    if on && !(1..=MAX_MODIFIER_COPIES).contains(&count) {
        return Err(OpError::ModifierCopies(count));
    }
    if !on && held > MAX_MODIFIER_COPIES {
        return Err(OpError::ModifierCopies(held));
    }
    let edit = plan.edit_planet(&s.doc, id, system)?;
    let entries = vec![(modifier, on.then_some(Place::Last)); count as usize];
    if !timed_modifiers::set(edit, keys::BOMBARDMENT_DAMAGE, &entries)? {
        return Err(match on {
            true => OpError::ModifierPresent(id, modifier.to_owned()),
            false => OpError::ModifierAbsent(id, modifier.to_owned()),
        });
    }
    let description = match on {
        true => format!("Make planet #{id} a terraforming candidate ({modifier})"),
        false => format!("Stop planet #{id} being a terraforming candidate ({modifier})"),
    };
    Ok(Planned {
        description,
        inverse: Op::SetTerraformCandidate {
            id,
            modifier: modifier.to_owned(),
            on: !on,
            copies: (!on && held > 1).then_some(held),
        },
    })
}

/// The `days` of each of the planet's `timed_modifier` items naming `modifier`.
fn timed_days<'a>(
    node: &'a Node,
    src: &'a [u8],
    modifier: &'a str,
) -> impl Iterator<Item = String> {
    node.find(keys::TIMED_MODIFIER, src)
        .and_then(|block| block.find(keys::ITEMS, src))
        .into_iter()
        .flat_map(|items| items.children())
        .filter(move |item| read::text(item, keys::MODIFIER, src) == modifier)
        .map(move |item| read::text(item, keys::DAYS, src))
}
