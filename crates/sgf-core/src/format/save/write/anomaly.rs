//! A save planet's anomaly: `anomaly="<category>"` after its `planet_orbitals`, where
//! Stellaris 4.x writes it, and the planet in the `events.anomalies` of each country that
//! has found it. The game lists an anomaly for a country only when that country's survey
//! turns it up, so one added to a planet the player has surveyed is listed for the player
//! here; on a planet the player has not surveyed, the survey lists it.

use crate::Span;
use crate::cst::Node;
use crate::emit::inline;
use crate::emit::system::anomalies_list;
use crate::format;
use crate::format::save::read_spec::bodies;
use crate::format::save::{check_version, entity, planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::{Form, check_text, quoted};
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
        Some(countries) => countries.to_vec(),
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
        description: format!("Add anomaly {category} to planet #{id}{found}"),
        inverse: Op::RemoveAnomaly { planet: id },
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
        description: format!("Remove anomaly {category} from planet #{id}"),
        inverse: Op::AddAnomaly {
            planet: id,
            category,
            found_by: Some(finders),
        },
    })
}

/// The planet `id`'s entity and system, once the save is known to be 4.x and the planet
/// is known not to be its system's star.
fn planet(s: &Session, id: u32) -> Result<(Node, &[u8], u32), OpError> {
    check_version(&s.doc)?;
    let (node, src) = planet_entity(&s.doc, id)?;
    let system = planet_system(&node, src, id)?;
    if bodies(&s.doc, system)?.first() == Some(&id) {
        return Err(OpError::StarAnomaly(id));
    }
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

/// Write `anomaly="<category>"` after the planet's `planet_orbitals`, else before its
/// `bombardment_damage`, else last.
fn write_key(edit: &mut Edit, category: &str) -> Result<(), OpError> {
    let text = format!("{}={}", keys::ANOMALY, quoted(category));
    let entity = edit.entity()?;
    if let Some(orbitals) = entity.find(keys::PLANET_ORBITALS, &edit.buf) {
        let end = orbitals.span().end;
        edit.insert_after(end, &text);
        return Ok(());
    }
    if let Some(damage) = entity.find(keys::BOMBARDMENT_DAMAGE, &edit.buf) {
        let span = damage.span();
        edit.insert_before(span, &text);
        return Ok(());
    }
    let (at, indent) = edit.before_close(entity);
    edit.insert(at, [&indent[..], text.as_bytes(), b"\n"].concat());
    Ok(())
}

/// Put planet `id` last in the country's `events.anomalies`, writing the list before the
/// block's `situations`, else last in it, when the country has none.
fn list(edit: &mut Edit, id: u32) -> Result<(), OpError> {
    let entity = edit.entity()?;
    let events = entity
        .find(keys::EVENTS, &edit.buf)
        .ok_or_else(|| edit.parse_error(entity.span().start, "the country has no events"))?;
    if events.scalar_span().is_some() {
        return Err(edit.parse_error(events.span().start, "events is not a block"));
    }
    let Some(anomalies) = events.find(keys::ANOMALIES, &edit.buf) else {
        let (at, indent) = match events.find(keys::SITUATIONS, &edit.buf) {
            Some(situations) => {
                let start = situations.span().start;
                (edit.line_start(start), edit.indent(start))
            }
            None => edit.before_close(events),
        };
        edit.insert(at, anomalies_list(&indent, &[id]));
        return Ok(());
    };
    if anomalies.scalar_span().is_some() {
        return Err(edit.parse_error(anomalies.span().start, "anomalies is not a block"));
    }
    match anomalies.children().last() {
        Some(item) => {
            let at = item.span().end;
            edit.insert(at, format!(" {id}").into_bytes());
        }
        None => {
            let span = anomalies.span();
            let indent = edit.indent(span.start);
            let text = inline(&indent, &anomalies_list(&indent, &[id]));
            edit.replace_statement(span, &text);
        }
    }
    Ok(())
}

/// Take planet `id` out of the country's `events.anomalies`, and the list with it when
/// nothing else is left in it, as the game writes no empty one.
fn unlist(edit: &mut Edit, id: u32) -> Result<(), OpError> {
    let entity = edit.entity()?;
    let Some(anomalies) = entity
        .find(keys::EVENTS, &edit.buf)
        .and_then(|events| events.find(keys::ANOMALIES, &edit.buf))
    else {
        return Ok(());
    };
    let id = id.to_string();
    let listed: Vec<Span> = anomalies
        .children()
        .iter()
        .filter(|item| item.key.is_none() && item.scalar_str(&edit.buf) == Some(id.as_str()))
        .map(Node::span)
        .collect();
    if listed.len() == anomalies.children().len() {
        let span = anomalies.span();
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
