//! `DeleteRingWorld`, which inverts to `RestoreEntities`.
//!
//! A ring world goes whole: its segments as `DeleteBody` takes a body, colonies first, and
//! its rows as `DeleteMegastructure` takes a row. The game never removes one, it only ruins
//! it, so the flags that would stop the system from hosting another ring go with it.

use crate::entity::facts::megastructure;
use crate::format::save::added::rows;
use crate::format::save::ring_world::{is_ring_row, is_segment, on_ring};
use crate::format::save::write::bodies::{frame_bodies, number};
use crate::format::save::write::fleets::{orbited_planet, present_fleets};
use crate::format::save::write::megastructure_links::{
    self, MEGASTRUCTURES, Tied, drop_flags, flag_spans, unlink_all,
};
use crate::format::save::write::remove_planet::{Deletion, Segments, dug};
use crate::format::save::write::restore::{Saved, live, tombstoned};
use crate::format::save::{planet_entity, planet_statement, system_statement};
use crate::keys;
use crate::ops::rules::{named, named_body};
use crate::ops::{OpError, Plan, Planned, SavedTable, Subject};
use crate::plural;
use crate::projections::geometry::{Body, descendants};
use crate::projections::read;
use crate::session::Session;

/// The system flags that say a ring world stands or is being built there.
const SYSTEM_FLAGS: [&str; 4] = [
    "ring_world_built",
    "ring_section_1",
    "ring_section_2",
    "ring_section_3",
];

pub(crate) fn plan_delete(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    radius: Option<f64>,
) -> Result<Planned, OpError> {
    if let Some(radius) = radius
        && !(radius.is_finite() && radius > 0.0)
    {
        return Err(OpError::InvalidRadius {
            radius,
            reason: "a ring's radius is a number above 0".to_owned(),
        });
    }
    let doc = &s.doc;
    let at = radius
        .map(|radius| format!(" at orbit {}", number(radius)))
        .unwrap_or_default();
    system_statement(doc, system).ok_or(OpError::UnknownSystem(system))?;
    let frame = frame_bodies(s, system)?;
    let bodies = segments(s, &frame, radius)?;
    let rows = ring_rows(s, system, radius)?;
    if bodies.is_empty() && rows.is_empty() {
        return Err(OpError::unchanged(
            format!("system {system}"),
            format!("has no ring world{at}"),
        ));
    }
    let going: Vec<u32> = rows.iter().map(|tied| tied.id).collect();
    let deletion = Deletion::read(s, system, &frame, bodies, Segments::Taken, &going)?;

    let mut saved = Saved::default();
    for tied in &rows {
        saved.keep(doc, SavedTable::Megastructure, tied.id, tied.anchor)?;
        let bytes = tombstoned(doc, tied.anchor, tied.id)?;
        plan.replace(doc, Subject::Record(tied.anchor), tied.anchor, bytes)?;
    }
    unlink_all(plan, s, &rows, Some(&mut saved))?;
    deletion.write(plan, s, &mut saved, &SYSTEM_FLAGS)?;
    let mut reorbited = 0;
    if let Some(star) = frame.first() {
        free_star(plan, s, &mut saved, system, star.id)?;
        let gone = deletion.gone_fleets();
        reorbited = reorbit(
            plan,
            s,
            &mut saved,
            system,
            star.id,
            &deletion.bodies,
            &gone,
        )?;
    }

    let place = named(&s.graph, system);
    let parts: Vec<String> = [(deletion.bodies.len(), "planet"), (rows.len(), "section")]
        .into_iter()
        .filter(|&(n, _)| n > 0)
        .map(|(n, noun)| plural(n, noun))
        .collect();
    let what = match parts.as_slice() {
        [one] => format!(" and its {one}"),
        [planets, sections] => format!(", its {planets} and {sections}"),
        _ => String::new(),
    };
    let colonies = match deletion.teardowns.as_slice() {
        [] => String::new(),
        [one] => {
            let (node, src) = planet_entity(doc, one.planet)?;
            let planet = named_body(&read::name(&node, src), one.planet);
            format!(", with the colony on {planet}")
        }
        many => format!(", with {} colonies", many.len()),
    };
    let dug = dug(deletion.sites.len());
    let fleets = match reorbited {
        0 => String::new(),
        n => format!(", and left {} orbiting its star", plural(n, "fleet")),
    };
    let restored = format!("Restored the ring world{at} in {place}");
    Ok(Planned {
        description: format!("Deleted the ring world{at} in {place}{what}{colonies}{dug}{fleets}"),
        inverse: deletion.inverse(saved, restored),
    })
}

/// The segments of the system whose bodies are `frame` on the ring of `radius`, or of every
/// ring, with their moons.
fn segments(s: &Session, frame: &[Body], radius: Option<f64>) -> Result<Vec<u32>, OpError> {
    let mut bodies = Vec::new();
    for body in frame {
        let (node, src) = planet_entity(&s.doc, body.id)?;
        if is_segment(&read::text(&node, keys::PLANET_CLASS, src)) && on_ring(body.at, radius) {
            bodies.push(body.id);
            bodies.extend(descendants(frame, body.id));
        }
    }
    bodies.sort_unstable();
    bodies.dedup();
    Ok(bodies)
}

/// The live ring world rows of `system` on the ring of `radius`, or of every ring.
fn ring_rows(s: &Session, system: u32, radius: Option<f64>) -> Result<Vec<Tied>, OpError> {
    let mut found = Vec::new();
    for row in rows(&s.doc, MEGASTRUCTURES)? {
        let facts = megastructure::read(&row.node, row.src);
        let ringed = facts.at.map_or(radius.is_none(), |at| on_ring(at, radius));
        if facts.origin == Some(system) && is_ring_row(&facts.kind) && ringed {
            found.extend(megastructure_links::read(&s.doc, row.id)?);
        }
    }
    Ok(found)
}

/// Take `has_megastructure` off star `star` of `system` when no row names it. A row of the
/// ring that named it took the flag with it already.
fn free_star(
    plan: &mut Plan,
    s: &Session,
    saved: &mut Saved,
    system: u32,
    star: u32,
) -> Result<(), OpError> {
    let doc = &s.doc;
    let named = rows(doc, MEGASTRUCTURES)?
        .iter()
        .any(|row| read::scalar_u32(&row.node, keys::PLANET, row.src) == Some(star));
    if named {
        return Ok(());
    }
    let (node, src) = planet_entity(doc, star)?;
    if flag_spans(&node, src, |flag| flag == keys::HAS_MEGASTRUCTURE).is_empty() {
        return Ok(());
    }
    let anchor = planet_statement(doc, star)?.ok_or(OpError::UnknownPlanet(star))?;
    saved.keep(doc, SavedTable::Planet, star, anchor)?;
    drop_flags(plan.edit_planet(doc, star, system)?, |flag| {
        flag == keys::HAS_MEGASTRUCTURE
    })?;
    Ok(())
}

/// Point each fleet of `system` that orbits one of the deleted `bodies` at the star `star`
/// instead, unless it is one of the fleets in `gone`. Such a fleet, as a fallen empire's
/// deep-space citadel at its home ring, stays where it stands. Returns how many were.
fn reorbit(
    plan: &mut Plan,
    s: &Session,
    saved: &mut Saved,
    system: u32,
    star: u32,
    bodies: &[u32],
    gone: &[u32],
) -> Result<usize, OpError> {
    let doc = &s.doc;
    let mut reorbited = 0;
    for fleet in present_fleets(s, system)? {
        let orbits = orbited_planet(doc, fleet).is_some_and(|planet| bodies.contains(&planet));
        if gone.contains(&fleet) || !orbits {
            continue;
        }
        let Some(found) = live(doc, SavedTable::Fleet, fleet)? else {
            continue;
        };
        saved.keep(doc, SavedTable::Fleet, fleet, found.anchor)?;
        plan.edit_record(doc, found.anchor)?.set_scalar(
            &[
                keys::MOVEMENT_MANAGER,
                keys::ORBIT,
                keys::ORBITABLE,
                keys::PLANET,
            ],
            star.to_string(),
        )?;
        reorbited += 1;
    }
    Ok(reorbited)
}
