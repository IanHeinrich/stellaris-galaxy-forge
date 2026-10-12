//! `AddHabitat`: a finished habitat round a save body, as the game's `spawn_habitat_effect`
//! leaves one, and what `RemoveBody` takes back with it. The habitat takes a planet slot as
//! an added body does, orbits its body without the moon bit, and is tied to it by the body's
//! `habitat<id>` flag and the system's `has_habitat`. The game builds its construction queue
//! when it loads.

use crate::cst::Node;
use crate::emit::system::{HabitatEntry, habitat_entry};
use crate::format::save::alloc::SlotTable;
use crate::format::save::write::add_body::placement;
use crate::format::save::write::add_megastructure::today;
use crate::format::save::write::add_system::write_slot;
use crate::format::save::write::bodies::{Stored, frame, grow_past};
use crate::format::save::write::id_list::list_planets;
use crate::format::save::write::megastructure_links::{add_flags, drop_flags};
use crate::format::save::write::place;
use crate::format::save::write::planet_entry::{is_star, list_moon, role};
use crate::format::save::write::remove_planet::{HABITAT, HAS_HABITAT, is_habitat};
use crate::format::save::{planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::bodies::check_placement;
use crate::ops::rules::{Form, check_text, named, named_as};
use crate::ops::{Emitted, NewHabitat, Op, OpError, Plan, Planned};
use crate::projections::geometry::{Body, normalised, point, reach};
use crate::projections::name::{NameTemplate, format};
use crate::projections::read;
use crate::session::Session;

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    body: u32,
    habitat: &NewHabitat,
) -> Result<Planned, OpError> {
    check(habitat)?;
    let (node, src) = planet_entity(&s.doc, body)?;
    let system = planet_system(&node, src, body)?;
    let stored = frame(s, system)?;
    let host = stored
        .iter()
        .find(|b| b.body.id == body)
        .ok_or(OpError::NotABody { body, system })?;
    let refuse = |reason: String| OpError::MegastructureRefused {
        kind: HABITAT.to_owned(),
        reason,
    };
    if let Some(parent) = host.body.parent
        && !is_star_of(s, &stored, parent)?
    {
        return Err(refuse(format!(
            "planet {body} orbits planet {parent}, and Galaxy Forge puts nothing round a body that orbits a planet"
        )));
    }
    if let Some(flag) = habitat_flag(&node, src) {
        return Err(refuse(format!(
            "planet {body} has a habitat already ({flag})"
        )));
    }

    let angle = normalised(habitat.at.angle);
    let at = point(host.body.at, habitat.at.radius, angle);
    let name = match &habitat.system_name {
        Some(variable) => {
            let system_name = s
                .graph
                .systems
                .get(&system)
                .map(|node| node.name.clone())
                .ok_or(OpError::UnknownSystem(system))?;
            format(&habitat.name, vec![(variable.as_str(), system_name)])
        }
        None => NameTemplate::plain(&habitat.name),
    };
    let date = today(&s.doc)?;
    let mut planets = SlotTable::planets(&s.doc)?;
    let slot = planets.take();
    let id = slot.id();
    let entry = HabitatEntry {
        id,
        class: &habitat.class,
        size: habitat.size,
        name: &name,
        x: at.0,
        y: at.1,
        system,
        orbit: habitat.at.radius,
        host: body,
        flags: &habitat.flags,
        flag_date: &date,
        entity_name: habitat.model.as_deref(),
    };
    let emitted = Emitted::Planet { id, system };
    write_slot(plan, &s.doc, slot, &mut planets, emitted, |indent| {
        habitat_entry(indent, &entry)
    })?;
    list_planets(plan.edit(&s.doc, system)?, &[id])?;
    let host_edit = plan.edit_planet(&s.doc, body, system)?;
    list_moon(host_edit, id)?;
    let host_flag = format!("{HABITAT}{id}");
    add_flags(
        host_edit,
        &[(host_flag.as_str(), date.clone())],
        &place::planet::FLAGS,
    )?;
    let system_edit = plan.edit(&s.doc, system)?;
    let flagged = system_edit
        .entity()?
        .find(keys::FLAGS, &system_edit.buf)
        .is_some_and(|flags| flags.find(HAS_HABITAT, &system_edit.buf).is_some());
    if !flagged {
        add_flags(system_edit, &[(HAS_HABITAT, date)], &place::system::FLAGS)?;
    }

    let added = Body {
        id,
        parent: Some(body),
        at,
        orbit: habitat.at.radius,
    };
    let mut after: Vec<Body> = stored.iter().map(|b| b.body).collect();
    after.push(added);
    let kind = if is_star_of(s, &stored, body)? {
        "star"
    } else {
        "planet"
    };
    let description = format!(
        "Added habitat #{id} round {} in {}",
        named_as(kind, &read::name(&node, src), body),
        named(&s.graph, system)
    );
    grow_past(
        plan,
        s,
        system,
        reach(&after, &added),
        description,
        Op::RemoveBody { body: id },
    )
}

/// Refuse a habitat whose values cannot be written.
fn check(habitat: &NewHabitat) -> Result<(), OpError> {
    check_text("a planet class", &habitat.class, Form::Bare)?;
    if habitat.size == 0 {
        return Err(OpError::ZeroPlanetSize);
    }
    check_placement(habitat.at.radius, habitat.at.angle)?;
    check_text("a name key", &habitat.name, Form::Bare)?;
    if let Some(variable) = &habitat.system_name {
        check_text("a name variable", variable, Form::Bare)?;
    }
    if let Some(model) = &habitat.model {
        check_text("a model", model, Form::Bare)?;
    }
    for (i, flag) in habitat.flags.iter().enumerate() {
        check_text("a planet flag", flag, Form::Bare)?;
        if habitat.flags[..i].contains(flag) {
            return Err(OpError::InvalidText {
                what: "a planet flag listed once",
                text: flag.clone(),
            });
        }
    }
    Ok(())
}

/// Whether body `id` of the system, whose bodies are `stored`, is a star.
fn is_star_of(s: &Session, stored: &[Stored], id: u32) -> Result<bool, OpError> {
    let (node, src) = planet_entity(&s.doc, id)?;
    let primary = stored.first().is_some_and(|first| first.body.id == id);
    Ok(is_star(role(&node, src, primary, s.star_classes())))
}

/// The body's first `habitat<id>` flag, which names a habitat round it.
fn habitat_flag(node: &Node, src: &[u8]) -> Option<String> {
    let flags = node.find(keys::FLAGS, src)?;
    flags
        .children()
        .iter()
        .filter_map(|flag| flag.key_str(src))
        .find(|flag| {
            flag.strip_prefix(HABITAT)
                .is_some_and(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()))
        })
        .map(str::to_owned)
}

/// Whether planet `habitat` was added as one round `host`: the host has its `habitat<id>`
/// flag.
pub(crate) fn hosted(s: &Session, habitat: u32, host: u32) -> Result<bool, OpError> {
    let (node, src) = match planet_entity(&s.doc, host) {
        Ok(found) => found,
        Err(OpError::UnknownPlanet(_)) => return Ok(false),
        Err(error) => return Err(error),
    };
    let flag = format!("{HABITAT}{habitat}");
    Ok(node
        .find(keys::FLAGS, src)
        .is_some_and(|flags| flags.find(&flag, src).is_some()))
}

/// Take habitat `habitat` off its host `host` and its system: the host's `habitat<id>` flag,
/// and the system's `has_habitat` when none of the system's other bodies is a habitat.
pub(crate) fn untie(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    stored: &[Stored],
    habitat: u32,
    host: u32,
) -> Result<(), OpError> {
    let flag = format!("{HABITAT}{habitat}");
    drop_flags(plan.edit_planet(&s.doc, host, system)?, |f| f == flag)?;
    let mut others = false;
    for body in stored.iter().filter(|b| b.body.id != habitat) {
        let (node, src) = planet_entity(&s.doc, body.body.id)?;
        others |= is_habitat(&node, src);
    }
    if !others {
        drop_flags(plan.edit(&s.doc, system)?, |f| f == HAS_HABITAT)?;
    }
    Ok(())
}

/// The habitat the entry `node` holds, as [`Op::AddHabitat`] would write it back round
/// `host`.
pub(crate) fn read_back(
    node: &Node,
    src: &[u8],
    stored: &[Stored],
    own: &Body,
    host: u32,
) -> NewHabitat {
    let name = read::name(node, src);
    NewHabitat {
        class: read::text(node, keys::PLANET_CLASS, src),
        size: read::scalar_u32(node, keys::PLANET_SIZE, src).unwrap_or_default(),
        at: placement(stored, own, Some(host)),
        system_name: name.variables.first().map(|variable| variable.name.clone()),
        name: name.key,
        model: read::scalar(node, keys::ENTITY_NAME, src).map(str::to_owned),
        flags: node
            .find(keys::FLAGS, src)
            .map(|flags| {
                flags
                    .children()
                    .iter()
                    .filter_map(|flag| flag.key_str(src).map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default(),
    }
}
