//! `AddHabitat`: a finished habitat round a save body, as the game's `spawn_habitat_effect`
//! leaves one, and what `RemoveBody` takes back with it. The habitat takes a planet slot as
//! an added body does, orbits its body without the moon bit, and is tied to it by the body's
//! `habitat<id>` flag and the system's `has_habitat`. The game builds its construction queue
//! when it loads. A restored complex's habitat also has the orbital `spawn_orbital_effect`
//! leaves, a `megastructures` row at the host's coordinates tied to the host.

use crate::NULL_ID;
use crate::cst::Node;
use crate::emit::megastructure::{MegastructureRow, megastructure_row};
use crate::emit::system::{HabitatEntry, habitat_entry};
use crate::entity::facts::megastructure;
use crate::entity::views::EntityKind;
use crate::format::save::added::{row, rows};
use crate::format::save::alloc::SlotTable;
use crate::format::save::write::add_body::placement;
use crate::format::save::write::add_megastructure::{culture_of, tie, today};
use crate::format::save::write::add_system::write_slot;
use crate::format::save::write::bodies::{Stored, frame, grow_past};
use crate::format::save::write::id_list::{append, list_planets};
use crate::format::save::write::megastructure_links::{
    self, HAS_ORBITAL, MEGASTRUCTURES, Tied, add_flags, drop_flags, unlink,
};
use crate::format::save::write::place;
use crate::format::save::write::planet_entry::{is_star, list_moon, role};
use crate::format::save::write::remove_planet::{HABITAT, HAS_HABITAT, is_habitat};
use crate::format::save::{planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::bodies::check_placement;
use crate::ops::rules::{Form, check_text, named, named_as};
use crate::ops::{
    Emitted, HabitatOrbital, NewHabitat, Op, OpError, ParseAt, Plan, Planned, Subject,
};
use crate::projections::geometry::{Body, normalised, point, reach};
use crate::projections::name::{NameTemplate, format};
use crate::projections::read;
use crate::session::Session;

/// The types `spawn_orbital_effect` spawns, one of which a restored complex leaves.
const ORBITAL_TYPES: [&str; 2] = ["habitat_major_orbital", "habitat_minor_orbital"];

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
    let orbital = match &habitat.orbital {
        Some(orbital) if !holds_megastructure(s, &node, src, body)? => Some(orbital),
        _ => None,
    };

    let angle = normalised(habitat.at.angle);
    let at = point(host.body.at, habitat.at.radius, angle);
    let name = system_named(s, system, &habitat.name, habitat.system_name.as_deref())?;
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
    let orbital = match orbital {
        Some(orbital) => {
            let at = read::coordinate(&node, src)
                .map_err(|reason| OpError::parse(ParseAt::Body(body), 0, reason))?;
            Some(add_orbital(plan, s, system, body, at, orbital)?)
        }
        None => None,
    };
    let host_edit = plan.edit_planet(&s.doc, body, system)?;
    list_moon(host_edit, id)?;
    let host_flag = format!("{HABITAT}{id}");
    let mut host_flags = vec![(host_flag.as_str(), date.clone())];
    match orbital {
        Some(orbital) => {
            host_flags.push((HAS_ORBITAL, date.clone()));
            tie(host_edit, orbital, &host_flags)?;
        }
        None => add_flags(host_edit, &host_flags, &place::planet::FLAGS)?,
    }
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
    let with = orbital
        .map(|orbital| format!(", with orbital #{orbital}"))
        .unwrap_or_default();
    let description = format!(
        "Added habitat #{id} round {} in {}{with}",
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
    if let Some(orbital) = &habitat.orbital {
        check_text("a megastructure type", &orbital.kind, Form::Bare)?;
        if let Some(name) = &orbital.name {
            check_text("a name key", name, Form::Bare)?;
        }
        if let Some(variable) = &orbital.system_name {
            check_text("a name variable", variable, Form::Bare)?;
        }
    }
    Ok(())
}

/// Name key `key`, with `variable` filled in by system `system`'s name.
fn system_named(
    s: &Session,
    system: u32,
    key: &str,
    variable: Option<&str>,
) -> Result<NameTemplate, OpError> {
    let Some(variable) = variable else {
        return Ok(NameTemplate::plain(key));
    };
    let system_name = s
        .graph
        .systems
        .get(&system)
        .map(|node| node.name.clone())
        .ok_or(OpError::UnknownSystem(system))?;
    Ok(format(key, vec![(variable, system_name)]))
}

/// Whether planet `body`, whose entry is `node`, has a megastructure: one its
/// `megastructure` key names, the flag `has_megastructure` or `has_orbital` one leaves, or a
/// live row whose `planet` it is.
fn holds_megastructure(s: &Session, node: &Node, src: &[u8], body: u32) -> Result<bool, OpError> {
    if read::scalar_u32(node, keys::MEGASTRUCTURE, src).is_some_and(|id| id != NULL_ID)
        || [keys::HAS_MEGASTRUCTURE, HAS_ORBITAL]
            .into_iter()
            .any(|flag| has_flag(node, src, flag))
    {
        return Ok(true);
    }
    Ok(rows(&s.doc, MEGASTRUCTURES)?
        .iter()
        .any(|row| megastructure::read(&row.node, row.src).planet == Some(body)))
}

/// Write `orbital` as a finished row at `at`, the coordinates of body `body` of `system`,
/// listed by the system and its owner, and return its id. The body's link and flag are the
/// caller's.
fn add_orbital(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    body: u32,
    at: (f64, f64),
    orbital: &HabitatOrbital,
) -> Result<u32, OpError> {
    let culture = match orbital.owner {
        Some(owner) => culture_of(plan.edit_country(&s.doc, owner)?)?,
        None => None,
    };
    let name = match &orbital.name {
        Some(key) => Some(system_named(
            s,
            system,
            key,
            orbital.system_name.as_deref(),
        )?),
        None => None,
    };
    let mut table = SlotTable::megastructures(&s.doc)?;
    let slot = table.append();
    let id = slot.id();
    let row = MegastructureRow {
        id,
        name: name.as_ref(),
        kind: &orbital.kind,
        at,
        system,
        owner: orbital.owner.map(|owner| (owner, culture.as_deref())),
        planet: body,
        bypass: None,
    };
    write_slot(plan, &s.doc, slot, &mut table, Emitted::Record, |indent| {
        megastructure_row(indent, &row)
    })?;
    append(
        plan.edit(&s.doc, system)?,
        &place::system::MEGASTRUCTURES,
        &[id],
    )?;
    if let Some(owner) = orbital.owner {
        append(
            plan.edit_country(&s.doc, owner)?,
            &place::country::OWNED_MEGASTRUCTURES,
            &[id],
        )?;
    }
    Ok(id)
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

/// Whether planet `node` has the planet flag `flag`.
fn has_flag(node: &Node, src: &[u8], flag: &str) -> bool {
    node.find(keys::FLAGS, src)
        .is_some_and(|flags| flags.find(flag, src).is_some())
}

/// The orbital added with a habitat round `host`: the row the host names in `megastructure`,
/// when the host has `has_orbital`, the row was added since the file was opened and it is
/// one of the habitat orbital types. An add writes the orbital only round a host that had
/// neither the flag nor a megastructure.
pub(crate) fn orbital_of(s: &Session, host: u32) -> Result<Option<Tied>, OpError> {
    let (node, src) = planet_entity(&s.doc, host)?;
    let Some(id) = read::scalar_u32(&node, keys::MEGASTRUCTURE, src) else {
        return Ok(None);
    };
    if !has_flag(&node, src, HAS_ORBITAL)
        || s.doc.added().get(EntityKind::Megastructure, id).is_none()
    {
        return Ok(None);
    }
    Ok(megastructure_links::read(&s.doc, id)?
        .filter(|tied| ORBITAL_TYPES.contains(&tied.kind.as_str()) && tied.planet == Some(host)))
}

/// Take habitat `habitat` off its host `host` and its system: the host's `habitat<id>` flag,
/// and the system's `has_habitat` when none of the system's other bodies is a habitat. With
/// `orbital`, its row goes too, out of its system's and its owner's lists, and the host loses
/// its `megastructure` key and `has_orbital`.
pub(crate) fn untie(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    stored: &[Stored],
    habitat: u32,
    host: u32,
    orbital: Option<&Tied>,
) -> Result<(), OpError> {
    let flag = format!("{HABITAT}{habitat}");
    let host_edit = plan.edit_planet(&s.doc, host, system)?;
    drop_flags(host_edit, |f| {
        f == flag || (orbital.is_some() && f == HAS_ORBITAL)
    })?;
    if let Some(orbital) = orbital {
        let links: Vec<_> = host_edit
            .entity()?
            .find_all(keys::MEGASTRUCTURE, &host_edit.buf)
            .filter(|key| {
                key.scalar_str(&host_edit.buf).and_then(|t| t.parse().ok()) == Some(orbital.id)
            })
            .map(Node::span)
            .collect();
        for span in links {
            host_edit.bytes().remove_statement(span);
        }
        let mut table = SlotTable::megastructures(&s.doc)?;
        let anchor = orbital.anchor;
        table.free(plan, &s.doc, Subject::Record(anchor), orbital.id, anchor)?;
        table.settle(plan, &s.doc)?;
        let listed = Tied {
            planet: None,
            ..orbital.clone()
        };
        unlink(plan, s, &listed, None)?;
    }
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

/// The orbital row `orbital`, as [`Op::AddHabitat`] would write it back.
pub(crate) fn orbital_back(s: &Session, orbital: &Tied) -> Result<HabitatOrbital, OpError> {
    let found = row(&s.doc, MEGASTRUCTURES, orbital.id)?
        .ok_or(OpError::MegastructureNotAdded(orbital.id))?;
    let name = found
        .node
        .find(keys::NAME, found.src)
        .map(|_| read::name(&found.node, found.src));
    Ok(HabitatOrbital {
        kind: orbital.kind.clone(),
        owner: orbital.owner,
        system_name: name
            .as_ref()
            .and_then(|name| name.variables.first())
            .map(|variable| variable.name.clone()),
        name: name.map(|name| name.key),
    })
}

/// The habitat the entry `node` holds, as [`Op::AddHabitat`] would write it back round
/// `host`, with `orbital`.
pub(crate) fn read_back(
    node: &Node,
    src: &[u8],
    stored: &[Stored],
    own: &Body,
    host: u32,
    orbital: Option<HabitatOrbital>,
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
        orbital,
    }
}
