//! `DeleteRingWorld`, which inverts to `RestoreEntities`.
//!
//! A ring world goes whole: its segments as `DeleteBody` takes a body, colonies first, and
//! its rows as `DeleteMegastructure` takes a row. The game never removes one, it only ruins
//! it, so the flags that would stop the system from hosting another ring go with it.

use crate::entity::facts::megastructure;
use crate::format::save::added::rows;
use crate::format::save::galaxy::fleets::orbited_planet;
use crate::format::save::ring_world::{BASE_RING, RING_SLACK, is_segment, on_ring};
use crate::format::save::write::bodies::frame_bodies;
use crate::format::save::write::flags::{drop_flags, flag_spans};
use crate::format::save::write::fleets::present_fleets;
use crate::format::save::write::megastructure_links::{self, MEGASTRUCTURES, Tied, unlink_all};
use crate::format::save::write::remove_planet::{Deletion, Segments, dug};
use crate::format::save::write::restore::{Saved, live, tombstoned};
use crate::format::save::{entity, planet_entity, planet_statement, system_statement};
use crate::keys;
use crate::ops::rules::{named, named_body};
use crate::ops::{OpError, Plan, Planned, RingFlags, SavedTable, Subject};
use crate::projections::geometry::{Body, descendants};
use crate::projections::read;
use crate::session::Session;
use crate::{number, plural};

pub(crate) fn plan_delete(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    radius: Option<f64>,
    rings: Option<&[RingFlags]>,
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
    let standing = rings_left(s, system, &frame, &bodies, &going)?;
    let flags = rings_flags(s, system, rings, (&frame, &bodies, &going), standing)?;
    let flags: Vec<&str> = flags.iter().map(String::as_str).collect();
    let deletion = Deletion::read(s, system, &frame, bodies, Segments::Taken, &going)?;

    let mut saved = Saved::default();
    for tied in &rows {
        saved.keep(doc, SavedTable::Megastructure, tied.id, tied.anchor)?;
        let bytes = tombstoned(doc, tied.anchor, tied.id)?;
        plan.replace(doc, Subject::Record(tied.anchor), tied.anchor, bytes)?;
    }
    unlink_all(plan, s, &rows, Some(&mut saved))?;
    deletion.write(plan, s, &mut saved, &flags)?;
    let mut reorbited = 0;
    if let Some(star) = frame.first() {
        if !standing {
            free_star(plan, s, &mut saved, system, star.id)?;
        }
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

/// The system flags the deleted rings leave: those of each ring in `rings`, the base game's
/// ring alone without them, that a segment among `bodies` or a row among `going` stands at
/// by its distance from the system's centre. A ring with nothing standing off the star
/// stands at the base game's ring's radius, and a ring no entry lists leaves none. With no
/// ring `standing` afterwards, every flag of the system named as a section of an entry is
/// taken too.
fn rings_flags(
    s: &Session,
    system: u32,
    rings: Option<&[RingFlags]>,
    deleted: (&[Body], &[u32], &[u32]),
    standing: bool,
) -> Result<Vec<String>, OpError> {
    let (frame, bodies, going) = deleted;
    let (base_radius, base_flags) = BASE_RING;
    let base = [RingFlags {
        radius: base_radius,
        flags: base_flags.map(str::to_owned).to_vec(),
        sections: Vec::new(),
    }];
    let rings = rings.unwrap_or(&base);
    let mut distances: Vec<f64> = frame
        .iter()
        .filter(|body| bodies.contains(&body.id))
        .map(|body| body.at.0.hypot(body.at.1))
        .collect();
    for row in rows(&s.doc, MEGASTRUCTURES)? {
        if going.contains(&row.id)
            && let Some((x, y)) = megastructure::read(&row.node, row.src).at
        {
            distances.push(x.hypot(y));
        }
    }
    distances.retain(|d| *d > RING_SLACK);
    if distances.is_empty() {
        distances.push(base_radius);
    }
    let mut flags: Vec<String> = Vec::new();
    for distance in distances {
        let standing_there = rings
            .iter()
            .filter(|ring| (distance - ring.radius).abs() <= RING_SLACK);
        for flag in standing_there.flat_map(|ring| &ring.flags) {
            if !flags.contains(flag) {
                flags.push(flag.clone());
            }
        }
    }
    if !standing {
        let anchor = system_statement(&s.doc, system).ok_or(OpError::UnknownSystem(system))?;
        let (node, src) = entity(&s.doc, Subject::System(system), anchor)?;
        let held = node.find(keys::FLAGS, src).map(|block| block.children());
        for flag in held.into_iter().flatten().filter_map(|f| f.key_str(src)) {
            let section = rings.iter().flat_map(|ring| &ring.sections).any(|prefix| {
                flag.strip_prefix(prefix.as_str())
                    .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
            });
            if section && !flags.iter().any(|f| f == flag) {
                flags.push(flag.to_owned());
            }
        }
    }
    Ok(flags)
}

/// Whether a ring world segment or row of `system` stays: one not among the segments
/// `bodies` and the rows `going`.
fn rings_left(
    s: &Session,
    system: u32,
    frame: &[Body],
    bodies: &[u32],
    going: &[u32],
) -> Result<bool, OpError> {
    for body in frame.iter().filter(|body| !bodies.contains(&body.id)) {
        let (node, src) = planet_entity(&s.doc, body.id)?;
        if is_segment(&read::text(&node, keys::PLANET_CLASS, src)) {
            return Ok(true);
        }
    }
    for row in rows(&s.doc, MEGASTRUCTURES)? {
        let facts = megastructure::read(&row.node, row.src);
        if facts.origin == Some(system)
            && s.ring_world_types().is_ring_row(&facts.kind)
            && !going.contains(&row.id)
        {
            return Ok(true);
        }
    }
    Ok(false)
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
        if facts.origin == Some(system) && s.ring_world_types().is_ring_row(&facts.kind) && ringed {
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
