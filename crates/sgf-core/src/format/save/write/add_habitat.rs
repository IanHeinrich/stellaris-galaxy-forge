//! `AddHabitat`: a finished habitat round a save body, as the game's `spawn_habitat_effect`
//! leaves one, and what `RemoveBody` takes back with it. The habitat takes a planet slot as
//! an added body does, orbits its body without the moon bit, and is tied to it by the body's
//! `habitat<id>` flag and the system's `has_habitat`. The game builds its construction queue
//! when it loads. A restored complex's habitat also has the orbital `spawn_orbital_effect`
//! leaves, a `megastructures` row at the host's coordinates tied to the host.

use crate::cst::Node;
use crate::emit::system::{HabitatEntry, habitat_entry};
use crate::entity::views::EntityKind;
use crate::format::save::added::row;
use crate::format::save::alloc::SlotTable;
use crate::format::save::write::bodies::{Stored, frame, grow_past};
use crate::format::save::write::flags::{add_flags, drop_flags, today};
use crate::format::save::write::id_list::list_planets;
use crate::format::save::write::megastructure_links::{
    self, HAS_ORBITAL, Holders, MEGASTRUCTURES, NewRow, Tied, unlink, write_rows,
};
use crate::format::save::write::place;
use crate::format::save::write::planet_entry::{body_is_star, list_moon};
use crate::format::save::write::shared::{culture_of, placement, tie, write_slot};
use crate::format::save::{planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::bodies::check_placement;
use crate::ops::rules::{Form, check_text, named, named_as};
use crate::ops::{
    Emitted, HabitatOrbital, NewHabitat, NewPlanet, Op, OpError, ParseAt, Plan, Planned, Subject,
};
use crate::projections::geometry::{Body, normalised, point, reach};
use crate::projections::name::{NameTemplate, format};
use crate::projections::read;
use crate::session::Session;

/// The planet flag a habitat has, and what its host's flag for it starts with.
pub(crate) const HABITAT: &str = "habitat";

/// The system flag the game sets when a habitat is built there.
pub(crate) const HAS_HABITAT: &str = "has_habitat";

/// The class of a habitat.
const PC_HABITAT: &str = "pc_habitat";

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
    let refuse = megastructure_links::refuse(HABITAT);
    if let Some(parent) = host.body.parent
        && !body_is_star(s, &stored, parent)?
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

    let angle = normalised(habitat.planet.at.angle);
    let at = point(host.body.at, habitat.planet.at.radius, angle);
    let name = system_named(
        s,
        system,
        &habitat.planet.name,
        habitat.system_name.as_deref(),
    )?;
    let date = today(&s.doc)?;
    let mut planets = SlotTable::planets(&s.doc)?;
    let slot = planets.take();
    let id = slot.id();
    let entry = HabitatEntry {
        id,
        class: &habitat.planet.class,
        size: habitat.planet.size,
        name: &name,
        x: at.0,
        y: at.1,
        system,
        orbit: habitat.planet.at.radius,
        host: body,
        flags: &habitat.planet.flags,
        flag_date: &date,
        entity_name: habitat.planet.model.as_deref(),
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
    plan.created().planets.push(id);
    plan.created().megastructures.extend(orbital);
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
    if !read::has_flag(system_edit.entity()?, &system_edit.buf, HAS_HABITAT) {
        add_flags(system_edit, &[(HAS_HABITAT, date)], &place::system::FLAGS)?;
    }

    let added = Body {
        id,
        parent: Some(body),
        at,
        orbit: habitat.planet.at.radius,
    };
    let mut after: Vec<Body> = stored.iter().map(|b| b.body).collect();
    after.push(added);
    let kind = if body_is_star(s, &stored, body)? {
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
    check_text("a planet class", &habitat.planet.class, Form::Bare)?;
    if habitat.planet.size == 0 {
        return Err(OpError::ZeroPlanetSize);
    }
    check_placement(habitat.planet.at.radius, habitat.planet.at.angle)?;
    check_text("a name key", &habitat.planet.name, Form::Bare)?;
    if let Some(variable) = &habitat.system_name {
        check_text("a name variable", variable, Form::Bare)?;
    }
    if let Some(model) = &habitat.planet.model {
        check_text("a model", model, Form::Bare)?;
    }
    for (i, flag) in habitat.planet.flags.iter().enumerate() {
        check_text("a planet flag", flag, Form::Bare)?;
        if habitat.planet.flags[..i].contains(flag) {
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
    let held = Holders::read(&s.doc, body, node, src)?;
    let flagged = |flag| held.flags.contains(&flag);
    Ok(held.key.is_some()
        || flagged(keys::HAS_MEGASTRUCTURE)
        || flagged(HAS_ORBITAL)
        || !held.rows.is_empty())
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
    let name = match &orbital.name {
        Some(key) => Some(system_named(
            s,
            system,
            key,
            orbital.system_name.as_deref(),
        )?),
        None => None,
    };
    let culture = match orbital.owner {
        Some(owner) => culture_of(plan.edit_country(&s.doc, owner)?)?,
        None => None,
    };
    let row = NewRow {
        name: name.as_ref(),
        kind: &orbital.kind,
        at,
        owner: orbital.owner.map(|owner| (owner, culture.as_deref())),
        planet: Some(body),
        bypass: None,
    };
    let ids = write_rows(plan, s, system, &[row])?;
    Ok(ids[0])
}

/// Whether planet `node` is a habitat: by its class, or the flag the game sets on one.
pub(crate) fn is_habitat(node: &Node, src: &[u8]) -> bool {
    read::text(node, keys::PLANET_CLASS, src) == PC_HABITAT || read::has_flag(node, src, HABITAT)
}

/// The body's first `habitat<id>` flag, which names a habitat round it.
fn habitat_flag(node: &Node, src: &[u8]) -> Option<String> {
    read::flags(node, src)
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
    Ok(read::has_flag(&node, src, &format!("{HABITAT}{habitat}")))
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
    if !read::has_flag(&node, src, HAS_ORBITAL)
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
    let found = row(&s.doc, MEGASTRUCTURES, orbital.id)?.ok_or(OpError::NotAdded {
        kind: EntityKind::Megastructure,
        id: orbital.id,
    })?;
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
        system_name: name.variables.first().map(|variable| variable.name.clone()),
        planet: NewPlanet {
            class: read::text(node, keys::PLANET_CLASS, src),
            size: read::scalar_u32(node, keys::PLANET_SIZE, src).unwrap_or_default(),
            at: placement(stored, own, Some(host)),
            name: name.key,
            model: read::scalar(node, keys::ENTITY_NAME, src).map(str::to_owned),
            flags: read::flags(node, src).map(str::to_owned).collect(),
        },
        orbital,
    }
}
