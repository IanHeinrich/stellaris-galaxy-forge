//! A save planet's modifiers: the items of its `timed_modifier`, as the game's `add_modifier`
//! and `remove_modifier` write them, and the `planet_modifier="pm_…"` line of a planet
//! feature whose static modifier one of them is. A new block goes after
//! `bombardment_damage` and a feature's line before `entity`, where Stellaris 4.x writes
//! them; an older save puts both elsewhere and is refused.

use crate::cst::Node;
use crate::emit::quoted;
use crate::format::save::read_spec::bodies;
use crate::format::save::write::place::{self, insert_key};
use crate::format::save::write::planet_entry::PlanetEntry;
use crate::format::save::write::timed_modifiers::{self, End, ItemEdit};
use crate::keys;
use crate::ops::rules::{Form, check_text};
use crate::ops::{Edit, Op, OpError, ParseAt, Plan, Planned, StarEdit};
use crate::projections::read;
use crate::session::Session;
use crate::span::Span;

/// The most items of one modifier an op adds, or removes with an inverse that restores
/// them. The console adds one per `add_modifier`, so a save holds one or two; the bound
/// keeps a hand-typed op from writing thousands.
pub(crate) const MAX_MODIFIER_COPIES: u32 = 16;

/// The planet `id`'s entity and system, once the save is known to be 4.x, the modifier and
/// feature are checked and the planet is known not to be its system's star.
fn planet<'a>(
    s: &'a Session,
    id: u32,
    modifier: &str,
    feature: Option<&str>,
) -> Result<(Node, &'a [u8], u32), OpError> {
    let PlanetEntry { node, src, system } = PlanetEntry::open(s, id)?;
    check_text("a modifier", modifier, Form::Bare)?;
    if let Some(feature) = feature {
        check_text("a planet feature", feature, Form::Bare)?;
    }
    if bodies(&s.doc, system)?.first() == Some(&id) {
        return Err(OpError::StarRefused {
            body: id,
            edit: StarEdit::Modifier,
        });
    }
    Ok((node, src, system))
}

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    modifier: &str,
    days: &[i32],
    feature: Option<&str>,
) -> Result<Planned, OpError> {
    let (node, src, system) = planet(s, id, modifier, feature)?;
    let count = u32::try_from(days.len()).unwrap_or(u32::MAX);
    if count > MAX_MODIFIER_COPIES || (count == 0 && feature.is_none()) {
        return Err(OpError::ModifierCopies(count));
    }
    if days.contains(&0) {
        return Err(OpError::ModifierDays);
    }
    if timed_days(&node, src, modifier).next().is_some() {
        return Err(OpError::ModifierPresent(id, modifier.to_owned()));
    }
    let written = feature.filter(|f| feature_lines(&node, src, f).next().is_none());
    if days.is_empty() && written.is_none() {
        let feature = feature.unwrap_or(modifier);
        return Err(OpError::ModifierPresent(id, feature.to_owned()));
    }
    let edit = plan.edit_planet(&s.doc, id, system)?;
    let items: Vec<_> = days
        .iter()
        .map(|&days| {
            (
                modifier,
                ItemEdit::Add {
                    at: End::Last,
                    days,
                },
            )
        })
        .collect();
    timed_modifiers::set_items(edit, &place::planet::TIMED_MODIFIER, &items)?;
    if let Some(feature) = written {
        add_feature_line(edit, feature)?;
    }
    Ok(Planned {
        description: add_description(id, modifier, days, written),
        inverse: Op::RemoveBodyModifier {
            body: id,
            modifier: modifier.to_owned(),
            feature: written.map(str::to_owned),
        },
    })
}

pub(crate) fn plan_remove(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    modifier: &str,
    feature: Option<&str>,
) -> Result<Planned, OpError> {
    let (node, src, system) = planet(s, id, modifier, feature)?;
    let days: Vec<i32> = timed_days(&node, src, modifier)
        .map(|(offset, days)| {
            days.parse().map_err(|_| {
                let reason = format!("{modifier} lasts {days:?} days, which is not a number");
                OpError::parse(ParseAt::Body(id), offset, reason)
            })
        })
        .collect::<Result<_, _>>()?;
    let held = u32::try_from(days.len()).unwrap_or(u32::MAX);
    if held > MAX_MODIFIER_COPIES {
        return Err(OpError::ModifierCopies(held));
    }
    let taken = feature.filter(|f| feature_lines(&node, src, f).next().is_some());
    if days.is_empty() && taken.is_none() {
        return Err(OpError::ModifierAbsent(
            id,
            feature.unwrap_or(modifier).to_owned(),
        ));
    }
    let edit = plan.edit_planet(&s.doc, id, system)?;
    let items = [(modifier, ItemEdit::Remove)];
    timed_modifiers::set_items(edit, &place::planet::TIMED_MODIFIER, &items)?;
    if let Some(feature) = taken {
        let lines: Vec<Span> = feature_lines(edit.entity()?, &edit.buf, feature)
            .map(|n| n.span())
            .collect();
        for span in lines {
            edit.bytes().remove_lines(span);
        }
    }
    let description = match taken {
        Some(feature) => format!("Removed planet feature {feature} ({modifier}) from planet #{id}"),
        None => format!("Removed modifier {modifier} from planet #{id}"),
    };
    Ok(Planned {
        description,
        inverse: Op::AddBodyModifier {
            body: id,
            modifier: modifier.to_owned(),
            days,
            feature: taken.map(str::to_owned),
        },
    })
}

fn add_description(id: u32, modifier: &str, days: &[i32], feature: Option<&str>) -> String {
    let what = match feature {
        Some(feature) => format!("planet feature {feature} ({modifier})"),
        None => format!("modifier {modifier}"),
    };
    let lasting = match days {
        [days] if *days > 0 => format!(" for {days} days"),
        _ => String::new(),
    };
    format!("Added {what} to planet #{id}{lasting}")
}

/// Write `planet_modifier="<feature>"` where the game does.
fn add_feature_line(edit: &mut Edit, feature: &str) -> Result<(), OpError> {
    let text = format!("{}={}", keys::PLANET_MODIFIER, quoted(feature));
    insert_key(edit, &[], &place::planet::PLANET_MODIFIER, |_| text)
}

/// The planet's `planet_modifier` lines naming `feature`.
fn feature_lines<'a>(
    node: &'a Node,
    src: &'a [u8],
    feature: &'a str,
) -> impl Iterator<Item = &'a Node> {
    node.find_all(keys::PLANET_MODIFIER, src)
        .filter(move |m| m.scalar_str(src) == Some(feature))
}

/// The offset and `days` text of each of the planet's `timed_modifier` items naming
/// `modifier`.
fn timed_days<'a>(
    node: &'a Node,
    src: &'a [u8],
    modifier: &'a str,
) -> impl Iterator<Item = (usize, String)> {
    node.find(keys::TIMED_MODIFIER, src)
        .and_then(|block| block.find(keys::ITEMS, src))
        .into_iter()
        .flat_map(|items| items.children())
        .filter(move |item| read::text(item, keys::MODIFIER, src) == modifier)
        .map(move |item| (item.span().start, read::text(item, keys::DAYS, src)))
}
