//! A save planet's terraforming candidate modifier: a permanent item of its
//! `timed_modifier`, as `add_modifier = { modifier = terraforming_candidate days = -1 }`
//! writes it. The block goes after `bombardment_damage` when it is new.

use crate::cst::Node;
use crate::emit::system::PERMANENT;
use crate::format::save::read_spec::bodies;
use crate::format::save::write::timed_modifiers::{self, Place};
use crate::format::save::{planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::{Form, check_text};
use crate::ops::{Op, OpError, Plan, Planned};
use crate::projections::read;
use crate::session::Session;

pub(crate) fn plan_set(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    modifier: &str,
    on: bool,
) -> Result<Planned, OpError> {
    let (node, src) = planet_entity(&s.doc, id)?;
    let system = planet_system(&node, src, id)?;
    check_text("a modifier", modifier, Form::Bare)?;
    if bodies(&s.doc, system)?.first() == Some(&id) {
        return Err(OpError::StarCandidate(id));
    }
    if !on && let Some(days) = timed_days(&node, src, modifier).find(|d| d != PERMANENT) {
        return Err(OpError::ModifierNotPermanent(id, modifier.to_owned(), days));
    }
    let edit = plan.edit_planet(&s.doc, id, system)?;
    let place = on.then_some(Place::Last);
    if !timed_modifiers::set(edit, keys::BOMBARDMENT_DAMAGE, &[(modifier, place)])? {
        return Err(match on {
            true => OpError::ModifierPresent(id, modifier.to_owned()),
            false => OpError::ModifierAbsent(id, modifier.to_owned()),
        });
    }
    let description = match on {
        true => format!("Make planet #{id} a terraforming candidate"),
        false => format!("Stop planet #{id} being a terraforming candidate"),
    };
    Ok(Planned {
        description,
        inverse: Op::SetTerraformCandidate {
            id,
            modifier: modifier.to_owned(),
            on: !on,
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
