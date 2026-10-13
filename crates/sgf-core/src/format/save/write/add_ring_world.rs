//! `AddRingWorld` and `RemoveRingWorld`: a ring world written round a save system's star as
//! the game's build chain leaves one, each quadrant at its own stage, and taken out again.
//!
//! A finished, restored or damaged quadrant is planets round the system's centre, written as
//! the game's `spawn_planet` writes them; a frame or ruined quadrant is a `megastructures`
//! row. The op clears nothing: [`clearing`] lists the deletions that clear the system as the
//! game's frame does, which go first in the same batch.

use crate::emit::system::{SegmentEntry, segment_entry};
use crate::entity::facts::megastructure;
use crate::entity::views::EntityKind;
use crate::format::save::added::rows;
use crate::format::save::alloc::SlotTable;
use crate::format::save::ring_world::{RING_SLACK, is_segment};
use crate::format::save::write::bodies::{Stored, frame, grow_past};
use crate::format::save::write::flags::{add_flags, drop_flags, today};
use crate::format::save::write::id_list::{list_planets, unlist_planets};
use crate::format::save::write::megastructure_links::{
    self, MEGASTRUCTURES, NewRow, Tied, unlink_all, write_rows,
};
use crate::format::save::write::place::{self};
use crate::format::save::write::planet_entry::body_is_star;
use crate::format::save::write::shared::write_slot;
use crate::format::save::write::teardown::some_id;
use crate::format::save::write::variables;
use crate::format::save::{entity, planet_entity, system_statement};
use crate::keys;
use crate::ops::rules::bodies::check_placement;
use crate::ops::rules::modifiers::{check_flags, check_timed, listed_once};
use crate::ops::rules::{Form, check_text, named};
use crate::ops::{
    Emitted, MegastructureRefusal, NewRingWorld, Op, OpError, Plan, Planned, RingPart,
    RingQuadrant, RingRow, RingSegment, RingWorldWritten, Subject,
};
use crate::projections::geometry::{Body, descendants, normalised, point, reach};
use crate::projections::name::NameTemplate;
use crate::projections::read;
use crate::session::Session;
use crate::views::{ClearedMegastructure, RingWorldClearing};
use crate::{and_list, plural, plural_of};

/// What a refusal calls the structure.
const RING_WORLD: &str = "ring world";

/// The radius the game spawns the base game's ring world at, which the points below are for.
const SPAWN_RADIUS: f64 = 45.0;
/// Where the game's spawn at [`SPAWN_RADIUS`] lands, by save angle: its polar maths
/// overshoots, by 0.45% on an axis and less between. A row is spawned round the centre; a
/// segment round its quadrant's row, whose distance it keeps as its `orbit`. Read from
/// Acahuabene's ring in a 4.5.2 save, built in game.
const ROW_POINTS: [(f64, (f64, f64)); 4] = [
    (180.0, (-45.20385, 0.0)),
    (270.0, (-0.00045, -45.20385)),
    (0.0, (45.20385, -0.00045)),
    (90.0, (0.00045, 45.20385)),
];
const SEGMENT_POINTS: [(f64, (f64, f64)); 12] = [
    (210.0, (-39.15873, -22.60463)),
    (180.0, (-45.40862, 0.0)),
    (150.0, (-39.15873, 22.60373)),
    (300.0, (22.60328, -39.15964)),
    (270.0, (-0.00226, -45.40862)),
    (240.0, (-22.60644, -39.15738)),
    (30.0, (39.15919, 22.60328)),
    (0.0, (45.40862, -0.00226)),
    (330.0, (39.15738, -22.60644)),
    (120.0, (-22.60373, 39.15873)),
    (90.0, (0.00045, 45.40862)),
    (60.0, (22.60508, 39.15828)),
];
/// The `orbit` of a segment spawned round a row at [`SPAWN_RADIUS`].
const SEGMENT_ORBIT: f64 = 45.20385;

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    owner: Option<u32>,
    ring: &NewRingWorld,
) -> Result<Planned, OpError> {
    check(ring)?;
    system_statement(&s.doc, system).ok_or(OpError::UnknownSystem(system))?;
    let stored = frame(s, system)?;
    let star = the_star(s, system, &stored)?;
    check_room(s, system, &stored, ring)?;
    if let Some(owner) = owner {
        plan.edit_country(&s.doc, owner)?;
    }

    let date = today(&s.doc)?;
    let mut planets = SlotTable::planets(&s.doc)?;
    let mut written = Vec::new();
    let mut added = Vec::new();
    let mut framed = Vec::new();
    for quadrant in &ring.quadrants {
        match quadrant {
            RingQuadrant::Finished { segments }
            | RingQuadrant::Restored { segments }
            | RingQuadrant::Damaged { segments } => {
                for segment in segments {
                    let slot = planets.take();
                    let id = slot.id();
                    let (at, orbit) = spawned(
                        &SEGMENT_POINTS,
                        segment.planet.at.radius,
                        segment.planet.at.angle,
                    );
                    let name = NameTemplate::plain(&segment.planet.name);
                    let modifiers: Vec<(&str, i32)> = segment
                        .modifiers
                        .iter()
                        .map(|m| (m.modifier.as_str(), m.written_days()))
                        .collect();
                    let entry = SegmentEntry {
                        id,
                        class: &segment.planet.class,
                        size: segment.planet.size,
                        name: &name,
                        x: at.0,
                        y: at.1,
                        system,
                        orbit,
                        flags: &segment.planet.flags,
                        flag_date: &date,
                        entity_name: segment.planet.model.as_deref(),
                        megastructure_icon: segment.megastructure_icon,
                        modifiers: &modifiers,
                    };
                    let emitted = Emitted::Planet { id, system };
                    write_slot(plan, &s.doc, slot, &mut planets, emitted, |indent| {
                        segment_entry(indent, &entry)
                    })?;
                    written.push(id);
                    added.push(Body {
                        id,
                        parent: None,
                        at,
                        orbit,
                    });
                }
            }
            RingQuadrant::Frame { row } | RingQuadrant::Ruined { row } => {
                let (at, _) = spawned(&ROW_POINTS, row.at.radius, row.at.angle);
                let name = row.name.as_deref().map(NameTemplate::plain);
                framed.push((row, at, name));
            }
        }
    }
    if !written.is_empty() {
        list_planets(plan.edit(&s.doc, system)?, &written)?;
    }
    let rows: Vec<NewRow> = framed
        .iter()
        .map(|(row, at, name)| NewRow {
            name: name.as_ref(),
            kind: &row.kind,
            at: *at,
            owner: owner
                .filter(|_| row.owned)
                .map(|owner| (owner, row.culture.as_deref())),
            planet: None,
            bypass: None,
        })
        .collect();
    let row_ids = write_rows(plan, s, system, &rows)?;
    let system_flags = missing_flags(s, system, &ring.system_flags)?;
    let lines: Vec<(&str, String)> = system_flags
        .iter()
        .map(|flag| (flag.as_str(), date.clone()))
        .collect();
    add_flags(plan.edit(&s.doc, system)?, &lines, &place::system::FLAGS)?;
    let (variables, variables_block) = variables::set(
        plan.edit(&s.doc, system)?,
        &place::system::VARIABLES,
        &ring.system_variables,
    )?;
    let (star_node, star_src) = planet_entity(&s.doc, star)?;
    let star_flags: Vec<String> = ring
        .star_flags
        .iter()
        .filter(|flag| !read::has_flag(&star_node, star_src, flag))
        .cloned()
        .collect();
    let lines: Vec<(&str, String)> = star_flags
        .iter()
        .map(|flag| (flag.as_str(), date.clone()))
        .collect();
    add_flags(
        plan.edit_planet(&s.doc, star, system)?,
        &lines,
        &place::planet::FLAGS,
    )?;

    let mut after: Vec<Body> = stored.iter().map(|b| b.body).collect();
    after.extend(added.iter().copied());
    let reached = added
        .iter()
        .map(|body| reach(&after, body))
        .fold(0.0, f64::max);
    let inverse = Op::RemoveRingWorld {
        system,
        written: RingWorldWritten {
            owner,
            ring: ring.clone(),
            planets: written,
            rows: row_ids,
            system_flags,
            star,
            star_flags,
            variables,
            variables_block,
        },
    };
    grow_past(
        plan,
        s,
        system,
        reached,
        description(s, system, &ring.quadrants),
        inverse,
    )
}

pub(crate) fn plan_remove(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    written: &RingWorldWritten,
) -> Result<Planned, OpError> {
    let doc = &s.doc;
    system_statement(doc, system).ok_or(OpError::UnknownSystem(system))?;
    let mut planets = SlotTable::planets(doc)?;
    for &id in &written.planets {
        let slot = doc
            .added()
            .get(EntityKind::Planet, id)
            .ok_or(OpError::NotAdded {
                kind: EntityKind::Planet,
                id,
            })?;
        planets.free(plan, doc, Subject::Planet { id, system }, id, slot)?;
    }
    planets.settle(plan, doc)?;
    let mut tied: Vec<Tied> = Vec::new();
    for &id in &written.rows {
        if doc.added().get(EntityKind::Megastructure, id).is_none() {
            return Err(OpError::NotAdded {
                kind: EntityKind::Megastructure,
                id,
            });
        }
        tied.extend(megastructure_links::read(doc, id)?);
    }
    let mut table = SlotTable::megastructures(doc)?;
    for row in &tied {
        table.free(plan, doc, Subject::Record(row.anchor), row.id, row.anchor)?;
    }
    table.settle(plan, doc)?;
    unlink_all(plan, s, &tied, None)?;
    if !written.planets.is_empty() {
        unlist_planets(plan.edit(doc, system)?, &written.planets)?;
    }
    drop_flags(plan.edit(doc, system)?, |flag| {
        written.system_flags.iter().any(|f| f == flag)
    })?;
    variables::restore(
        plan.edit(doc, system)?,
        &written.variables,
        written.variables_block,
    )?;
    if !written.star_flags.is_empty() {
        drop_flags(plan.edit_planet(doc, written.star, system)?, |flag| {
            written.star_flags.iter().any(|f| f == flag)
        })?;
    }
    Ok(Planned {
        description: format!("Removed the ring world from {}", named(&s.graph, system)),
        inverse: Op::AddRingWorld {
            system,
            owner: written.owner,
            ring: written.ring.clone(),
        },
    })
}

/// What clearing `system` for a ring world takes, as the game's frame clears it: every body
/// that is not a star and every belt, with the megastructure rows that name them, which go
/// first, and the uncolonised bodies a starbase orbits, which [`add_op`] refuses to clear.
/// The segments of a ring world the system holds already stay, with what orbits them, and
/// so do its rows.
pub(crate) fn clearing(s: &Session, system: u32) -> Result<RingWorldClearing, OpError> {
    let anchor = system_statement(&s.doc, system).ok_or(OpError::UnknownSystem(system))?;
    let stored = frame(s, system)?;
    let bodies: Vec<Body> = stored.iter().map(|b| b.body).collect();
    let mut kept = Vec::new();
    let mut going = Vec::new();
    for body in &stored {
        let (node, src) = planet_entity(&s.doc, body.body.id)?;
        if is_segment(&read::text(&node, keys::PLANET_CLASS, src)) {
            kept.push(body.body.id);
            kept.extend(descendants(&bodies, body.body.id));
        } else if !body_is_star(s, &stored, body.body.id)? {
            going.push(body.body.id);
        }
    }
    going.retain(|id| !kept.contains(id));
    // Moons go before the planets they orbit, so that a body added this session, which
    // `DeleteBody` refuses while it has moons, has none left when its turn comes.
    let mut depths: Vec<(u32, usize)> = going
        .iter()
        .map(|&id| (id, depth(&bodies, &going, id)))
        .collect();
    depths.sort_by_key(|&(_, depth)| std::cmp::Reverse(depth));
    let going: Vec<u32> = depths.iter().map(|&(id, _)| id).collect();
    let moons = depths.iter().filter(|&&(_, depth)| depth > 0).count();
    let mut colonies = Vec::new();
    let mut starbase_bodies = Vec::new();
    for &id in &going {
        let (node, src) = planet_entity(&s.doc, id)?;
        if read::scalar_u32(&node, keys::COLONY, src).is_some() {
            colonies.push(id);
        } else if some_id(&node, keys::ORBITAL_DEFENCE, src).is_some() {
            starbase_bodies.push(id);
        }
    }
    let mut megastructures = Vec::new();
    for row in rows(&s.doc, MEGASTRUCTURES)? {
        let facts = megastructure::read(&row.node, row.src);
        if let Some(body) = facts
            .planet
            .filter(|body| going.contains(body) && !s.ring_world_types().is_ring_row(&facts.kind))
        {
            megastructures.push(ClearedMegastructure { id: row.id, body });
        }
    }
    let (node, src) = entity(&s.doc, Subject::System(system), anchor)?;
    let belts = node.find(keys::ASTEROID_BELTS, src).map_or(0, |block| {
        block.children().iter().filter(|c| c.key.is_none()).count()
    });
    Ok(RingWorldClearing {
        system,
        bodies: going,
        moons: u32::try_from(moons).unwrap_or(u32::MAX),
        colonies,
        belts: u32::try_from(belts).unwrap_or(u32::MAX),
        starbase_bodies,
        megastructures,
    })
}

/// The op that adds `ring` round `system`'s star for `owner`: the [`Op::AddRingWorld`]
/// alone, or with `clear`, a batch that first deletes the rows that name a body going, then
/// every body that is not a star and every belt, last first, as the game's frame does. Clearing a body a starbase orbits is
/// refused before any op is built.
pub(crate) fn add_op(
    s: &Session,
    system: u32,
    owner: Option<u32>,
    ring: NewRingWorld,
    clear: bool,
) -> Result<Op, OpError> {
    let cleared = clearing(s, system)?;
    let add_description = description(s, system, &ring.quadrants);
    let add = Op::AddRingWorld {
        system,
        owner,
        ring,
    };
    if !clear || (cleared.bodies.is_empty() && cleared.belts == 0) {
        return Ok(add);
    }
    if let Some(&body) = cleared.starbase_bodies.first() {
        return Err(megastructure_links::refuse(RING_WORLD)(format!(
            "a starbase orbits planet {body}, which clearing {} would delete; add the ring with the planets left in place",
            named(&s.graph, system)
        )));
    }
    let mut ops: Vec<Op> = cleared
        .megastructures
        .iter()
        .map(|row| Op::DeleteMegastructure {
            megastructure: row.id,
            dismantle: None,
        })
        .collect();
    ops.extend(cleared.bodies.iter().map(|&body| Op::DeleteBody { body }));
    ops.extend(
        (0..cleared.belts as usize)
            .rev()
            .map(|index| Op::RemoveBelt { system, index }),
    );
    ops.push(add);
    Ok(Op::Batch {
        description: format!("{add_description}{}", cleared.removing()),
        ops,
    })
}

impl RingWorldClearing {
    /// ", removing 4 planets, 1 moon and 1 belt, with the colony on planet #12 and megastructure
    /// #3", or nothing when there is nothing to clear.
    fn removing(&self) -> String {
        let planets = self.bodies.len() - self.moons as usize;
        let parts: Vec<String> = [
            (planets, "planet", "planets"),
            (self.moons as usize, "moon", "moons"),
            (self.belts as usize, "belt", "belts"),
        ]
        .into_iter()
        .filter(|&(n, _, _)| n > 0)
        .map(|(n, noun, nouns)| plural_of(n, noun, nouns))
        .collect();
        if parts.is_empty() {
            return String::new();
        }
        let listed = and_list(&parts);
        let colonies = match self.colonies.as_slice() {
            [] => None,
            [one] => Some(format!("the colony on planet #{one}")),
            many => Some(format!("{} colonies", many.len())),
        };
        let structures = match self.megastructures.as_slice() {
            [] => None,
            [one] => Some(format!("megastructure #{}", one.id)),
            many => Some(format!("{} megastructures", many.len())),
        };
        let with: Vec<String> = [colonies, structures].into_iter().flatten().collect();
        let with = if with.is_empty() {
            String::new()
        } else {
            format!(", with {}", and_list(&with))
        };
        format!(", removing {listed}{with}")
    }
}

/// "Added a ring world round Lachium #203", named for the quadrants' stages when they share
/// one, else with a count of each.
fn description(s: &Session, system: u32, quadrants: &[RingQuadrant]) -> String {
    let place = named(&s.graph, system);
    let stage = |q: &RingQuadrant| match q {
        RingQuadrant::Finished { .. } | RingQuadrant::Restored { .. } => 0,
        RingQuadrant::Frame { .. } => 1,
        RingQuadrant::Ruined { .. } => 2,
        RingQuadrant::Damaged { .. } => 3,
    };
    let mut counts = [0usize; 4];
    for quadrant in quadrants {
        counts[stage(quadrant)] += 1;
    }
    let stages = counts.iter().filter(|&&n| n > 0).count();
    if stages <= 1 {
        let what = match counts.iter().position(|&n| n > 0) {
            Some(1) => "a ring world frame",
            Some(2) => "a ruined ring world",
            Some(3) => "a damaged ring world",
            _ => "a ring world",
        };
        return format!("Added {what} round {place}");
    }
    let words = ["finished", "frame", "ruined", "damaged"];
    let parts: Vec<String> = counts
        .iter()
        .zip(words)
        .filter(|&(&n, _)| n > 0)
        .map(|(&n, word)| plural(n, &format!("{word} section")))
        .collect();
    format!("Added a ring world round {place} with {}", and_list(&parts))
}

/// Refuse a ring whose values cannot be written.
fn check(ring: &NewRingWorld) -> Result<(), OpError> {
    let refuse = megastructure_links::refuse(RING_WORLD);
    if ring.quadrants.is_empty() {
        return Err(refuse("it has no quadrants".to_owned()));
    }
    for quadrant in &ring.quadrants {
        match quadrant {
            RingQuadrant::Finished { segments }
            | RingQuadrant::Restored { segments }
            | RingQuadrant::Damaged { segments } => {
                if segments.is_empty() {
                    return Err(refuse("a quadrant with no planets".to_owned()));
                }
                segments.iter().try_for_each(check_segment)?;
            }
            RingQuadrant::Frame { row } | RingQuadrant::Ruined { row } => check_row(row)?,
        }
    }
    check_flags("a system flag", &ring.system_flags)?;
    check_flags("a planet flag", &ring.star_flags)?;
    for variable in &ring.system_variables {
        check_text("a variable", &variable.name, Form::Bare)?;
        if !variable.value.is_finite() {
            return Err(OpError::NotFinite);
        }
    }
    let names: Vec<&str> = ring
        .system_variables
        .iter()
        .map(|v| v.name.as_str())
        .collect();
    listed_once("a variable listed once", &names, |name| (*name).to_owned())
}

fn check_segment(segment: &RingSegment) -> Result<(), OpError> {
    check_text("a planet class", &segment.planet.class, Form::Bare)?;
    if segment.planet.size == 0 {
        return Err(OpError::ZeroPlanetSize);
    }
    check_placement(segment.planet.at.radius, segment.planet.at.angle)?;
    check_text("a name key", &segment.planet.name, Form::Quoted)?;
    if let Some(model) = &segment.planet.model {
        check_text("a model", model, Form::Bare)?;
    }
    segment.modifiers.iter().try_for_each(check_timed)?;
    let names: Vec<&str> = segment
        .modifiers
        .iter()
        .map(|m| m.modifier.as_str())
        .collect();
    listed_once("a modifier listed once", &names, |name| (*name).to_owned())?;
    check_flags("a planet flag", &segment.planet.flags)
}

fn check_row(row: &RingRow) -> Result<(), OpError> {
    check_text("a megastructure type", &row.kind, Form::Bare)?;
    if let Some(culture) = &row.culture {
        check_text("a graphical culture", culture, Form::Bare)?;
    }
    check_placement(row.at.radius, row.at.angle)?;
    if let Some(name) = &row.name {
        check_text("a name key", name, Form::Quoted)?;
    }
    Ok(())
}

/// The system's one star body, refused for none or more than one.
fn the_star(s: &Session, system: u32, stored: &[Stored]) -> Result<u32, OpError> {
    let mut stars = Vec::new();
    for body in stored {
        if body_is_star(s, stored, body.body.id)? {
            stars.push(body.body.id);
        }
    }
    let place = named(&s.graph, system);
    let reason = match stars[..] {
        [star] => return Ok(star),
        [] => MegastructureRefusal::NoStar { place },
        _ => MegastructureRefusal::ManyStars {
            place,
            count: stars.len(),
        },
    };
    Err(megastructure_links::refused(RING_WORLD, reason))
}

/// Refuse a ring that would overlap a ring world of the system: one with a segment or row
/// standing within [`RING_SLACK`] of a radius the new ring's sections stand at.
fn check_room(
    s: &Session,
    system: u32,
    stored: &[Stored],
    ring: &NewRingWorld,
) -> Result<(), OpError> {
    let radii = radii(ring);
    let overlaps = |distance: f64| {
        radii
            .iter()
            .any(|radius| (distance - radius).abs() <= RING_SLACK)
    };
    let place = named(&s.graph, system);
    let overlap = |part, orbit| {
        megastructure_links::refused(
            RING_WORLD,
            MegastructureRefusal::RingOverlap {
                place: place.clone(),
                part,
                orbit,
            },
        )
    };
    for body in stored {
        let (node, src) = planet_entity(&s.doc, body.body.id)?;
        let distance = body.body.at.0.hypot(body.body.at.1);
        if is_segment(&read::text(&node, keys::PLANET_CLASS, src)) && overlaps(distance) {
            let planet = body.body.id;
            return Err(overlap(RingPart::Segment { planet }, distance));
        }
    }
    for row in rows(&s.doc, MEGASTRUCTURES)? {
        let facts = megastructure::read(&row.node, row.src);
        if facts.origin != Some(system) || !s.ring_world_types().is_ring_row(&facts.kind) {
            continue;
        }
        if let Some((x, y)) = facts.at
            && overlaps(x.hypot(y))
        {
            let part = RingPart::Row {
                megastructure: row.id,
                kind: facts.kind,
            };
            return Err(overlap(part, x.hypot(y)));
        }
    }
    Ok(())
}

/// Each radius a section of `ring` stands at, once.
fn radii(ring: &NewRingWorld) -> Vec<f64> {
    let mut radii: Vec<f64> = Vec::new();
    for quadrant in &ring.quadrants {
        let placed: Vec<f64> = match quadrant {
            RingQuadrant::Finished { segments }
            | RingQuadrant::Restored { segments }
            | RingQuadrant::Damaged { segments } => {
                segments.iter().map(|s| s.planet.at.radius).collect()
            }
            RingQuadrant::Frame { row } | RingQuadrant::Ruined { row } => vec![row.at.radius],
        };
        for radius in placed {
            if !radii.contains(&radius) {
                radii.push(radius);
            }
        }
    }
    radii
}

/// The flags of `flags` the system does not have yet, in order.
fn missing_flags(s: &Session, system: u32, flags: &[String]) -> Result<Vec<String>, OpError> {
    let anchor = system_statement(&s.doc, system).ok_or(OpError::UnknownSystem(system))?;
    let (node, src) = entity(&s.doc, Subject::System(system), anchor)?;
    Ok(flags
        .iter()
        .filter(|flag| !read::has_flag(&node, src, flag))
        .cloned()
        .collect())
}

/// Where a spawn `radius` out at save `angle` lands and the `orbit` it keeps, as the game
/// places one: on the angles of `points`, their point scaled to the radius; elsewhere the
/// exact point.
fn spawned(points: &[(f64, (f64, f64))], radius: f64, angle: f64) -> ((f64, f64), f64) {
    let angle = normalised(angle);
    let on = points.iter().find(|(at, _)| {
        let off = (at - angle).abs();
        off.min(360.0 - off) < 1e-6
    });
    match on {
        Some(&(_, (x, y))) => {
            let scale = radius / SPAWN_RADIUS;
            ((x * scale, y * scale), SEGMENT_ORBIT * scale)
        }
        None => (point((0.0, 0.0), radius, angle), radius),
    }
}

/// How many of the bodies `going` body `id` orbits, one inside another.
fn depth(bodies: &[Body], going: &[u32], id: u32) -> usize {
    let mut depth = 0;
    let mut at = id;
    while let Some(parent) = bodies
        .iter()
        .find(|b| b.id == at)
        .and_then(|b| b.parent)
        .filter(|p| going.contains(p))
    {
        depth += 1;
        at = parent;
        if depth > bodies.len() {
            break;
        }
    }
    depth
}
