//! A save planet's anomaly: `anomaly="<category>"` after its `planet_orbitals`, where
//! Stellaris 4.x writes it, and the planet in the `events.anomalies` of each country that
//! has found it. The game lists an anomaly for a country only when that country's survey
//! turns it up, so one added to a planet the player has surveyed is listed for the player
//! here; on a planet the player has not surveyed, the survey lists it.

use crate::Span;
use crate::cst::Node;
use crate::emit::inline;
use crate::emit::quoted;
use crate::emit::system::anomalies_list;
use crate::format;
use crate::format::save::entity;
use crate::format::save::write::id_list::{Emptied, append_in, unlist_in};
use crate::format::save::write::place::{self, insert_key};
use crate::format::save::write::planet_entry::PlanetEntry;
use crate::keys;
use crate::ops::rules::{Form, check_text};
use crate::ops::{Edit, Op, OpError, Plan, Planned, Subject};
use crate::projections::read;
use crate::session::Session;

/// A deposit holder's `type` for a planet.
const PLANET_HOLDER: &str = "0";

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    category: &str,
    found_by: Option<&[u32]>,
) -> Result<Planned, OpError> {
    check_text("an anomaly category", category, Form::Bare)?;
    let (node, src, system) = planet(s, id)?;
    if let Some(held) = read::scalar(&node, keys::ANOMALY, src) {
        return Err(OpError::AnomalyPresent(id, held.to_owned()));
    }
    let finders = match found_by {
        Some(countries) => countries.iter().fold(Vec::new(), |mut once, &country| {
            if !once.contains(&country) {
                once.push(country);
            }
            once
        }),
        None => match s.graph.player_country {
            Some(player) if surveyed(s, &node, src, id, player)? => vec![player],
            _ => Vec::new(),
        },
    };
    let listed = s.doc.anomaly_finders(id);

    let edit = plan.edit_planet(&s.doc, id, system)?;
    write_key(edit, category)?;
    for &country in finders.iter().filter(|c| !listed.contains(c)) {
        list(plan.edit_country(&s.doc, country)?, id)?;
    }

    let found = match finders.as_slice() {
        [] => String::new(),
        countries => format!(", found by {}", country_names(countries)),
    };
    Ok(Planned {
        description: format!("Added anomaly {category} to planet #{id}{found}"),
        inverse: Op::RemoveAnomaly { body: id },
    })
}

pub(crate) fn plan_remove(plan: &mut Plan, s: &Session, id: u32) -> Result<Planned, OpError> {
    let (node, src, system) = planet(s, id)?;
    let category = read::scalar(&node, keys::ANOMALY, src)
        .ok_or(OpError::AnomalyAbsent(id))?
        .to_owned();
    let finders = s.doc.anomaly_finders(id);

    let edit = plan.edit_planet(&s.doc, id, system)?;
    let keys: Vec<Span> = edit
        .entity()?
        .find_all(keys::ANOMALY, &edit.buf)
        .map(Node::span)
        .collect();
    for span in keys {
        edit.remove_lines(span);
    }
    for &country in &finders {
        unlist(plan.edit_country(&s.doc, country)?, id)?;
    }

    Ok(Planned {
        description: format!("Removed anomaly {category} from planet #{id}"),
        inverse: Op::AddAnomaly {
            body: id,
            category,
            found_by: Some(finders),
        },
    })
}

/// The planet `id`'s entity and system, once the save is known to be 4.x. A star takes an
/// anomaly as any other body does: the game places some categories only on stars.
fn planet(s: &Session, id: u32) -> Result<(Node, &[u8], u32), OpError> {
    let PlanetEntry { node, src, system } = PlanetEntry::open(s, id)?;
    Ok((node, src, system))
}

/// "empire 0", or "empires 0 and 16777218".
fn country_names(countries: &[u32]) -> String {
    let ids: Vec<String> = countries.iter().map(u32::to_string).collect();
    match ids.as_slice() {
        [one] => format!("empire {one}"),
        [rest @ .., last] => format!("empires {} and {last}", rest.join(", ")),
        [] => String::new(),
    }
}

/// Whether country `country` has surveyed planet `id`, whose entity is `node`: the planet
/// names it as `surveyed_by`, which holds the first to survey it, or the country lists the
/// planet among its `surveyed_deposit_holders`, which holds every planet it has surveyed.
fn surveyed(s: &Session, node: &Node, src: &[u8], id: u32, country: u32) -> Result<bool, OpError> {
    if read::scalar_u32(node, keys::SURVEYED_BY, src) == Some(country) {
        return Ok(true);
    }
    let subject = Subject::Country(country);
    let anchor = format::of(s.doc.kind()).statement(&s.doc, subject)?;
    let (entity, buf) = entity(&s.doc, subject, anchor)?;
    let id = id.to_string();
    Ok(entity
        .find(keys::SURVEYED_DEPOSIT_HOLDERS, buf)
        .into_iter()
        .flat_map(Node::children)
        .any(|holder| {
            read::scalar(holder, keys::TYPE, buf) == Some(PLANET_HOLDER)
                && read::scalar(holder, keys::ID, buf) == Some(id.as_str())
        }))
}

/// Write `anomaly="<category>"` where the game does.
fn write_key(edit: &mut Edit, category: &str) -> Result<(), OpError> {
    let text = format!("{}={}", keys::ANOMALY, quoted(category));
    insert_key(edit, &[], &place::planet::ANOMALY, |_| text)
}

/// Put planet `id` last in the country's `events.anomalies`, writing the list where the
/// game does when the country has none.
fn list(edit: &mut Edit, id: u32) -> Result<(), OpError> {
    let entity = edit.entity()?;
    let events = entity
        .find(keys::EVENTS, &edit.buf)
        .ok_or_else(|| edit.parse_error(entity.span().start, "the country has no events"))?;
    if events.scalar_span().is_some() {
        return Err(edit.parse_error(events.span().start, "events is not a block"));
    }
    let Some(anomalies) = events.find(keys::ANOMALIES, &edit.buf) else {
        let text = |indent: &[u8]| inline(indent, &anomalies_list(indent, &[id]));
        return insert_key(edit, &[keys::EVENTS], &place::country::ANOMALIES, text);
    };
    let anomalies = anomalies.clone();
    append_in(edit, &anomalies, keys::ANOMALIES, &[id])
}

/// Take planet `id` out of the country's `events.anomalies`, and the list with it when
/// nothing else is left in it, as the game writes no empty one.
pub(crate) fn unlist(edit: &mut Edit, id: u32) -> Result<(), OpError> {
    let anomalies = edit
        .entity()?
        .find(keys::EVENTS, &edit.buf)
        .and_then(|events| events.find(keys::ANOMALIES, &edit.buf))
        .cloned();
    if let Some(anomalies) = anomalies {
        unlist_in(edit, &anomalies, &[id], Emptied::Drop);
    }
    Ok(())
}
