//! A planet a build effect spawns finished, as the game's `spawn_planet` and
//! `spawn_habitat_effect` leave one: the habitat [`Op::AddHabitat`] writes, the segments of
//! [`Op::AddRingWorld`] and the planet [`Op::AddMegastructure`] spawns round its body, which
//! [`Op::AddSpawnedPlanet`] writes back. It takes a planet slot as an added body does, and
//! one round a body names it in `moon_of` without the moon bit.

use crate::cst::Node;
use crate::document::Document;
use crate::emit::system::{SpawnedEntry, spawned_entry};
use crate::format::save::alloc::SlotTable;
use crate::format::save::write::bodies::{Stored, frame, grow_past};
use crate::format::save::write::flags::today;
use crate::format::save::write::id_list::list_planets;
use crate::format::save::write::megastructure_links;
use crate::format::save::write::planet_entry::{
    body_is_star, list_moon, named_entity, named_planet,
};
use crate::format::save::write::shared::{placement, write_slot};
use crate::format::save::{planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::bodies::check_placement;
use crate::ops::rules::modifiers::{check_flags, check_timed, listed_once};
use crate::ops::rules::{Form, check_text, named, named_as};
use crate::ops::{
    Emitted, MegastructureRefusal, NewPlanet, Op, OpError, Plan, Planned, TimedModifier,
};
use crate::projections::geometry::{Body, normalised, point, reach};
use crate::projections::name::NameTemplate;
use crate::projections::read;
use crate::session::Session;

/// What a refusal calls the planet [`Op::AddSpawnedPlanet`] writes back.
const PLANET: &str = "planet";

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    body: u32,
    planet: &NewPlanet,
) -> Result<Planned, OpError> {
    check(planet, Form::Quoted)?;
    let (node, src) = planet_entity(&s.doc, body)?;
    let system = planet_system(&node, src, body)?;
    let stored = frame(s, system)?;
    let round = host(s, &stored, system, body, PLANET)?;
    let name = NameTemplate::plain(&planet.name);
    let spawned = Spawned::round(round, planet, &name, normalised(planet.at.angle));
    let (id, reached) = add_round(plan, s, system, &stored, &spawned, &today(&s.doc)?)?;
    let description = format!(
        "Added {} round {} in {}",
        named_as(PLANET, &name, id),
        named_planet(s, body)?,
        named(&s.graph, system)
    );
    grow_past(
        plan,
        s,
        system,
        reached,
        description,
        Op::RemoveBody { body: id },
    )
}

/// The planet the entry `node` holds, as [`Op::AddSpawnedPlanet`] would write it back round
/// `round`, the body it orbits, where `own` stands among the system's bodies `stored`.
pub(crate) fn read_back(
    node: &Node,
    src: &[u8],
    stored: &[Stored],
    own: &Body,
    round: u32,
) -> NewPlanet {
    let modifiers = read::timed_items(node, src)
        .filter_map(|item| {
            let days: i32 = read::text(item, keys::DAYS, src).parse().ok()?;
            Some(TimedModifier {
                modifier: read::text(item, keys::MODIFIER, src),
                days: u32::try_from(days).ok(),
            })
        })
        .collect();
    NewPlanet {
        class: read::text(node, keys::PLANET_CLASS, src),
        size: read::scalar_u32(node, keys::PLANET_SIZE, src).unwrap_or_default(),
        at: placement(stored, own, Some(round)),
        name: read::name(node, src).key,
        model: read::scalar(node, keys::ENTITY_NAME, src).map(str::to_owned),
        flags: read::flags(node, src).map(str::to_owned).collect(),
        modifiers,
    }
}

/// Refuse a planet whose values cannot be written, its name key in the form `name`.
pub(crate) fn check(planet: &NewPlanet, name: Form) -> Result<(), OpError> {
    check_text("a planet class", &planet.class, Form::Bare)?;
    if planet.size == 0 {
        return Err(OpError::ZeroPlanetSize);
    }
    check_placement(planet.at.radius, planet.at.angle)?;
    check_text("a name key", &planet.name, name)?;
    if let Some(model) = &planet.model {
        check_text("a model", model, Form::Bare)?;
    }
    planet.modifiers.iter().try_for_each(check_timed)?;
    let names: Vec<&str> = planet
        .modifiers
        .iter()
        .map(|m| m.modifier.as_str())
        .collect();
    listed_once("a modifier", &names, |name| (*name).to_owned())?;
    check_flags("a planet flag", &planet.flags)
}

/// Body `body` of `system`, whose bodies are `stored`, for a planet that structure `kind`
/// spawns round it; refused when it orbits a planet.
pub(crate) fn host<'a>(
    s: &Session,
    stored: &'a [Stored],
    system: u32,
    body: u32,
    kind: &str,
) -> Result<&'a Stored, OpError> {
    let host = stored
        .iter()
        .find(|b| b.body.id == body)
        .ok_or(OpError::NotABody { body, system })?;
    if let Some(parent) = host.body.parent
        && !body_is_star(s, stored, parent)?
    {
        let (node, src) = planet_entity(&s.doc, body)?;
        return Err(megastructure_links::refused(
            kind,
            MegastructureRefusal::RoundSatellite {
                body,
                planet: named_entity(&node, src, body),
                parent,
                orbits: named_planet(s, parent)?,
            },
        ));
    }
    Ok(host)
}

/// A planet to write, where it stands and what it orbits.
pub(crate) struct Spawned<'a> {
    pub(crate) planet: &'a NewPlanet,
    pub(crate) name: &'a NameTemplate,
    /// Relative to the system's centre.
    pub(crate) at: (f64, f64),
    /// Its distance from what it orbits.
    pub(crate) orbit: f64,
    /// The body it orbits; `None` round the system's centre.
    pub(crate) moon_of: Option<u32>,
    pub(crate) megastructure_icon: bool,
}

/// Write `spawned` into the next slot of `planets`, in `system`, its flags dated `date`,
/// and return the body it is. The system's list and the `moons` of what it orbits are the
/// caller's.
pub(crate) fn write(
    plan: &mut Plan,
    doc: &Document,
    system: u32,
    planets: &mut SlotTable,
    spawned: &Spawned<'_>,
    date: &str,
) -> Result<Body, OpError> {
    let slot = planets.take();
    let id = slot.id();
    let modifiers: Vec<(&str, i32)> = spawned
        .planet
        .modifiers
        .iter()
        .map(|m| (m.modifier.as_str(), m.written_days()))
        .collect();
    let entry = SpawnedEntry {
        id,
        class: &spawned.planet.class,
        size: spawned.planet.size,
        name: spawned.name,
        x: spawned.at.0,
        y: spawned.at.1,
        system,
        orbit: spawned.orbit,
        moon_of: spawned.moon_of,
        flags: &spawned.planet.flags,
        flag_date: date,
        entity_name: spawned.planet.model.as_deref(),
        megastructure_icon: spawned.megastructure_icon,
        modifiers: &modifiers,
    };
    let emitted = Emitted::Planet { id, system };
    write_slot(plan, doc, slot, planets, emitted, |indent| {
        spawned_entry(indent, &entry)
    })?;
    Ok(Body {
        id,
        parent: spawned.moon_of,
        at: spawned.at,
        orbit: spawned.orbit,
    })
}

impl<'a> Spawned<'a> {
    /// `planet`, named `name`, round `host` at `planet.at`'s radius and the save angle
    /// `angle` about it.
    pub(crate) fn round(
        host: &Stored,
        planet: &'a NewPlanet,
        name: &'a NameTemplate,
        angle: f64,
    ) -> Self {
        Self {
            planet,
            name,
            at: point(host.body.at, planet.at.radius, angle),
            orbit: planet.at.radius,
            moon_of: Some(host.body.id),
            megastructure_icon: false,
        }
    }
}

/// Write `spawned` round the body it orbits in `system`, whose bodies are `stored`, its
/// flags dated `date`: listed after the system's last `planet=` line and in the body's
/// `moons`. Returns its id and how far from the centre the system then reaches.
pub(crate) fn add_round(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    stored: &[Stored],
    spawned: &Spawned<'_>,
    date: &str,
) -> Result<(u32, f64), OpError> {
    let mut planets = SlotTable::planets(&s.doc)?;
    let added = write(plan, &s.doc, system, &mut planets, spawned, date)?;
    list_planets(plan.edit(&s.doc, system)?, &[added.id])?;
    if let Some(host) = spawned.moon_of {
        list_moon(plan.edit_planet(&s.doc, host, system)?, added.id)?;
    }
    let mut after: Vec<Body> = stored.iter().map(|b| b.body).collect();
    after.push(added);
    Ok((added.id, reach(&after, &added)))
}
