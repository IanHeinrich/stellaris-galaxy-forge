//! `MoveMegastructure`, which inverts to `RestoreEntities`: a `megastructures` row moved
//! within its system, to a point of its own or onto another body.
//!
//! The game keeps whatever x and y a row is given, and a row tied to a body stands at the
//! body's point. What marks a tied structure on its body, the `megastructure` key, the flags
//! a structure leaves and an Arc Furnace's hiding model, goes to the new body with it.

use crate::cst::Node;
use crate::emit::coord;
use crate::format::save::added::{Table, row, rows};
use crate::format::save::ring_world;
use crate::format::save::write::add_megastructure::{add_flags, planet_flag};
use crate::format::save::write::megastructure_links::{
    self, BODY_FLAGS, FURNACE_ENTITY, MEGASTRUCTURES, Tied, unlink_body,
};
use crate::format::save::write::move_system::splice_coordinate;
use crate::format::save::write::place::{self, insert_key};
use crate::format::save::write::planet_entity::write_entity_name;
use crate::format::save::write::restore::Saved;
use crate::format::save::{planet_entity, planet_statement, planet_system};
use crate::keys;
use crate::ops::rules::named;
use crate::ops::{
    MegastructureEdit, MegastructurePlace, OpError, ParseAt, Plan, Planned, SavedTable, Subject,
};
use crate::projections::geometry::written_angle;
use crate::projections::read;
use crate::session::Session;

use super::bodies::number;

/// The bypass kinds a moved row may stand for; another has not been tried in game.
const MOVED_BYPASSES: [&str; 2] = ["gateway", "relay_bypass"];

pub(crate) fn plan_move(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    at: MegastructurePlace,
) -> Result<Planned, OpError> {
    let doc = &s.doc;
    let tied = megastructure_links::read(doc, id)?.ok_or(OpError::UnknownEntity {
        table: SavedTable::Megastructure,
        id,
    })?;
    if ring_world::is_ring_row(&tied.kind) {
        return Err(refused(
            id,
            "it is part of a ring world, which stands where it is".to_owned(),
        ));
    }
    let system = tied
        .system
        .ok_or_else(|| refused(id, "it stands in no system".to_owned()))?;
    if let Some(bypass) = tied.bypass
        && let Some(found) = row(doc, Table::Bypass, bypass)?
    {
        let kind = read::text(&found.node, keys::TYPE, found.src);
        if !MOVED_BYPASSES.contains(&kind.as_str()) {
            return Err(refused(
                id,
                format!("its bypass is a {kind}, which has not been tried in game"),
            ));
        }
    }
    let mut saved = Saved::default();
    saved.keep(doc, SavedTable::Megastructure, id, tied.anchor)?;
    plan.stale(Subject::System(system));
    let description = match (tied.planet, at) {
        (None, MegastructurePlace::Free { x, y }) => to_point(plan, s, &tied, system, (x, y))?,
        (Some(from), MegastructurePlace::Body { body }) => {
            to_body(plan, s, &mut saved, &tied, system, from, body)?
        }
        (None, MegastructurePlace::Body { .. }) => {
            return Err(refused(
                id,
                "it stands at a point of its own, not on a planet or star".to_owned(),
            ));
        }
        (Some(from), MegastructurePlace::Free { .. }) => {
            return Err(refused(
                id,
                format!(
                    "it stands on or around planet {from}, so it moves only to another planet or star"
                ),
            ));
        }
    };
    Ok(Planned {
        inverse: saved.inverse(format!("Undid: {description}")),
        description,
    })
}

fn refused(megastructure: u32, reason: String) -> OpError {
    OpError::MegastructureKept {
        megastructure,
        edit: MegastructureEdit::Move,
        reason,
    }
}

/// Write row `tied`'s new point, and say what moved.
fn to_point(
    plan: &mut Plan,
    s: &Session,
    tied: &Tied,
    system: u32,
    to: (f64, f64),
) -> Result<String, OpError> {
    if !(to.0.is_finite() && to.1.is_finite()) {
        return Err(OpError::NotFinite);
    }
    let id = tied.id;
    let edit = plan.edit_record(&s.doc, tied.anchor)?;
    let from = read::coordinate(edit.entity()?, &edit.buf)
        .map_err(|reason| OpError::parse(ParseAt::Record, 0, reason))?;
    if (coord(from.0), coord(from.1)) == (coord(to.0), coord(to.1)) {
        return Err(OpError::unchanged(
            format!("megastructure {id}"),
            "already stands there",
        ));
    }
    splice_coordinate(edit, to.0, to.1)?;
    Ok(format!(
        "Moved megastructure #{id} ({}) in {} from {} to {}",
        tied.kind,
        named(&s.graph, system),
        polar(from),
        polar(to),
    ))
}

/// "459.55 at 89.48°": a point's distance and angle about the star.
fn polar(at: (f64, f64)) -> String {
    let radius = at.0.hypot(at.1);
    let angle = written_angle((0.0, 0.0), at, radius);
    format!("{} at {}°", number(radius), number(angle))
}

/// Tie row `tied` to `body` in place of `from`, keeping each entity rewritten in `saved`, and
/// say what moved.
fn to_body(
    plan: &mut Plan,
    s: &Session,
    saved: &mut Saved,
    tied: &Tied,
    system: u32,
    from: u32,
    body: u32,
) -> Result<String, OpError> {
    let doc = &s.doc;
    let id = tied.id;
    if body == from {
        return Err(OpError::unchanged(
            format!("megastructure {id}"),
            format!("already stands at planet {body}"),
        ));
    }
    let (target, src) = planet_entity(doc, body)?;
    if planet_system(&target, src, body)? != system {
        return Err(OpError::NotABody { body, system });
    }
    let held = rows(doc, MEGASTRUCTURES)?.into_iter().find(|row| {
        row.id != id && read::scalar_u32(&row.node, keys::PLANET, row.src) == Some(body)
    });
    if let Some(held) = held {
        return Err(refused(
            id,
            format!("planet {body} already has megastructure {}", held.id),
        ));
    }
    let target_flags = flags_of(&target, src);
    let target_model = read::scalar(&target, keys::ENTITY_NAME, src).map(str::to_owned);
    let stale_key = target.find(keys::MEGASTRUCTURE, src).is_some();
    let to_at = read::coordinate(&target, src)
        .map_err(|reason| OpError::parse(ParseAt::Body(body), 0, reason))?;

    let (old, old_src) = planet_entity(doc, from)?;
    if planet_flag(&old, old_src, keys::MEGASTRUCTURE) {
        return Err(refused(
            id,
            format!("it made planet {from}, which stays where it is"),
        ));
    }
    let carried: Vec<(&str, String)> = flags_of(&old, old_src)
        .into_iter()
        .filter_map(|(flag, date)| {
            let known = BODY_FLAGS.iter().find(|&&known| known == flag)?;
            Some((*known, date))
        })
        .filter(|(flag, _)| !target_flags.iter().any(|(held, _)| held == flag))
        .collect();
    let furnace = read::scalar(&old, keys::ENTITY_NAME, old_src) == Some(FURNACE_ENTITY);

    let edit = plan.edit_record(doc, tied.anchor)?;
    edit.set_scalar(&[keys::PLANET], body.to_string())?;
    splice_coordinate(edit, to_at.0, to_at.1)?;
    unlink_body(plan, s, &[id], &[id], from, &mut Some(&mut *saved))?;
    let anchor = planet_statement(doc, body)?.ok_or(OpError::UnknownPlanet(body))?;
    saved.keep(doc, SavedTable::Planet, body, anchor)?;
    let edit = plan.edit_planet(doc, body, system)?;
    // A planet's key can name a row the table no longer holds; the new row takes its place.
    if stale_key {
        edit.set_scalar(&[keys::MEGASTRUCTURE], id.to_string())?;
    } else {
        insert_key(edit, &[], &place::planet::MEGASTRUCTURE, |_| {
            format!("{}={id}", keys::MEGASTRUCTURE)
        })?;
    }
    add_flags(edit, &carried)?;
    if furnace && target_model.as_deref() != Some(FURNACE_ENTITY) {
        write_entity_name(edit, Some(FURNACE_ENTITY))?;
    }
    Ok(format!(
        "Moved megastructure #{id} ({}) in {} from planet #{from} to planet #{body}",
        tied.kind,
        named(&s.graph, system)
    ))
}

/// The planet flags of the entity `node`, each with its date, in file order.
fn flags_of(node: &Node, src: &[u8]) -> Vec<(String, String)> {
    let Some(flags) = node.find(keys::FLAGS, src) else {
        return Vec::new();
    };
    flags
        .children()
        .iter()
        .filter_map(|flag| {
            Some((
                flag.key_str(src)?.to_owned(),
                flag.scalar_str(src)?.to_owned(),
            ))
        })
        .collect()
}
