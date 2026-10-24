//! A save planet's modifiers: the items of its `timed_modifier`, as the game's `add_modifier`
//! and `remove_modifier` write them, and the `planet_modifier="pm_…"` line of a planet
//! feature whose static modifier one of them is, with the planet flags set beside them. A
//! new block goes after `bombardment_damage` and a feature's line before `entity`, where
//! Stellaris 4.x writes them; an older save puts both elsewhere and is refused.

use crate::cst::Node;
use crate::emit::quoted;
use crate::format::save::read_spec::bodies;
use crate::format::save::write::flags::{add_flags, drop_flags, today};
use crate::format::save::write::place::{self, insert_key};
use crate::format::save::write::planet_entry::{PlanetEntry, named_planet, star_refused};
use crate::format::save::write::timed_modifiers::{self, End, ItemEdit};
use crate::keys;
use crate::ops::rules::modifiers::{check_days, check_flags, check_modifier};
use crate::ops::rules::{Form, check_text};
use crate::ops::{Edit, NewModifier, Op, OpError, ParseAt, Plan, PlanetFlag, Planned, StarEdit};
use crate::projections::read;
use crate::session::Session;
use crate::span::Span;

/// The most items of one modifier an op adds, or removes with an inverse that restores
/// them. The console adds one per `add_modifier`, so a save holds one or two; the bound
/// keeps a hand-typed op from writing thousands.
pub(crate) const MAX_MODIFIER_COPIES: u32 = 16;

/// The planet `id`'s entity and system, once the save is known to be 4.x, the modifier,
/// feature and flags are checked and the planet is known not to be its system's star.
fn planet<'a>(
    s: &'a Session,
    id: u32,
    modifier: &str,
    feature: Option<&str>,
    flags: &[PlanetFlag],
) -> Result<(Node, &'a [u8], u32), OpError> {
    let PlanetEntry { node, src, system } = PlanetEntry::open(s, id)?;
    check_modifier(modifier)?;
    if let Some(feature) = feature {
        check_text("a planet feature", feature, Form::Bare)?;
    }
    let names: Vec<String> = flags.iter().map(|f| f.flag.clone()).collect();
    check_flags("a planet flag", &names)?;
    if bodies(&s.doc, system)?.first() == Some(&id) {
        return Err(star_refused(&node, src, id, StarEdit::Modifier));
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
    flags: &[PlanetFlag],
) -> Result<Planned, OpError> {
    let (node, src, system) = planet(s, id, modifier, feature, flags)?;
    check_items(days, feature)?;
    if timed_days(&node, src, modifier).next().is_some() {
        return Err(OpError::ModifierPresent(id, modifier.to_owned()));
    }
    let written = feature.filter(|f| feature_lines(&node, src, f).next().is_none());
    if days.is_empty() && written.is_none() {
        let feature = feature.unwrap_or(modifier);
        return Err(OpError::ModifierPresent(id, feature.to_owned()));
    }
    let lacked: Vec<&PlanetFlag> = flags
        .iter()
        .filter(|f| !read::has_flag(&node, src, &f.flag))
        .collect();
    let today = if lacked.iter().any(|f| f.date.is_none()) {
        today(&s.doc)?
    } else {
        String::new()
    };
    let dated: Vec<(&str, String)> = lacked
        .iter()
        .map(|f| {
            let date = f
                .date
                .map_or_else(|| today.clone(), |date| date.to_string());
            (f.flag.as_str(), date)
        })
        .collect();
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
    add_flags(edit, &dated, &place::planet::FLAGS)?;
    Ok(Planned {
        description: add_description(&named_planet(s, id)?, modifier, days, written),
        inverse: Op::RemoveBodyModifier {
            body: id,
            modifier: modifier.to_owned(),
            feature: written.map(str::to_owned),
            flags: lacked
                .iter()
                .map(|f| PlanetFlag {
                    flag: f.flag.clone(),
                    date: None,
                })
                .collect(),
        },
    })
}

pub(crate) fn plan_remove(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    modifier: &str,
    feature: Option<&str>,
    flags: &[PlanetFlag],
) -> Result<Planned, OpError> {
    let (node, src, system) = planet(s, id, modifier, feature, flags)?;
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
    let taken_flags = held_flags(&node, src, flags);
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
    drop_flags(edit, |flag| taken_flags.iter().any(|f| f.flag == flag))?;
    let named = named_planet(s, id)?;
    let description = match taken {
        Some(feature) => format!("Removed planet feature {feature} ({modifier}) from {named}"),
        None => format!("Removed modifier {modifier} from {named}"),
    };
    Ok(Planned {
        description,
        inverse: Op::AddBodyModifier {
            body: id,
            modifier: modifier.to_owned(),
            days,
            feature: taken.map(str::to_owned),
            flags: taken_flags,
        },
    })
}

/// The flags of `listed` that planet `node` holds dated, in the order its `flags` block holds
/// them, each once with its first date. A flag held as a timed block is left out, because an
/// add cannot write it back, and stays on the planet.
fn held_flags(node: &Node, src: &[u8], listed: &[PlanetFlag]) -> Vec<PlanetFlag> {
    let Some(block) = node.find(keys::FLAGS, src) else {
        return Vec::new();
    };
    let lines = block.children();
    let mut held: Vec<PlanetFlag> = Vec::new();
    for flag in lines.iter().filter_map(|line| line.key_str(src)) {
        if held.iter().any(|f| f.flag == flag) || !listed.iter().any(|f| f.flag == flag) {
            continue;
        }
        let dates: Option<Vec<u32>> = lines
            .iter()
            .filter(|line| line.key_str(src) == Some(flag))
            .map(|line| line.scalar_str(src).and_then(|date| date.parse().ok()))
            .collect();
        if let Some(dates) = dates {
            held.push(PlanetFlag {
                flag: flag.to_owned(),
                date: dates.first().copied(),
            });
        }
    }
    held
}

/// Refuse a modifier added for `days`: more items than `MAX_MODIFIER_COPIES`, none without
/// a feature, and an item [`check_days`] refuses.
fn check_items(days: &[i32], feature: Option<&str>) -> Result<(), OpError> {
    let count = u32::try_from(days.len()).unwrap_or(u32::MAX);
    if count > MAX_MODIFIER_COPIES || (count == 0 && feature.is_none()) {
        return Err(OpError::ModifierCopies(count));
    }
    days.iter().try_for_each(|&days| check_days(days.into()))
}

/// Refuse a modifier a new body is written with, as [`plan_add`] refuses one for a planet
/// the save holds.
pub(crate) fn check_new(
    modifier: &str,
    days: &[i32],
    feature: Option<&str>,
) -> Result<(), OpError> {
    check_modifier(modifier)?;
    if let Some(feature) = feature {
        check_text("a planet feature", feature, Form::Bare)?;
    }
    check_items(days, feature)
}

/// The modifiers and features of planet `node`, as a [`NewBody`] writes them back: a feature
/// pairs with the modifier its name holds after `pm_`, as the game names them, when the
/// planet has that; the others stand alone. An item whose days are not a number is left out.
pub(crate) fn read_all(node: &Node, src: &[u8]) -> Vec<NewModifier> {
    let mut modifiers: Vec<NewModifier> = Vec::new();
    for item in read::timed_items(node, src) {
        let modifier = read::text(item, keys::MODIFIER, src);
        let Ok(days) = read::text(item, keys::DAYS, src).parse() else {
            continue;
        };
        match modifiers.iter_mut().find(|m| m.modifier == modifier) {
            Some(held) => held.days.push(days),
            None => modifiers.push(NewModifier {
                modifier,
                days: vec![days],
                feature: None,
            }),
        }
    }
    let features = node
        .find_all(keys::PLANET_MODIFIER, src)
        .filter_map(|line| line.scalar_str(src));
    for feature in features {
        let named = feature.strip_prefix("pm_").unwrap_or(feature);
        match modifiers
            .iter_mut()
            .find(|m| m.modifier == named && m.feature.is_none())
        {
            Some(held) => held.feature = Some(feature.to_owned()),
            None => modifiers.push(NewModifier {
                modifier: named.to_owned(),
                days: Vec::new(),
                feature: Some(feature.to_owned()),
            }),
        }
    }
    modifiers
}

fn add_description(named: &str, modifier: &str, days: &[i32], feature: Option<&str>) -> String {
    let what = match feature {
        Some(feature) => format!("planet feature {feature} ({modifier})"),
        None => format!("modifier {modifier}"),
    };
    let lasting = match days {
        [days] if *days > 0 => format!(" for {days} days"),
        _ => String::new(),
    };
    format!("Added {what} to {named}{lasting}")
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
    read::timed_items(node, src)
        .filter(move |item| read::text(item, keys::MODIFIER, src) == modifier)
        .map(move |item| (item.span().start, read::text(item, keys::DAYS, src)))
}
