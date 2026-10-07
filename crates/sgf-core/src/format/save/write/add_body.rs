//! `AddBody` and `RemoveBody`: one planet or moon added to a save system, with any moons
//! of its own, and taken out again. Each body's entry and its deposits' take slots as
//! [`super::add_system`] gives them, the system lists them after its last `planet=` line,
//! a moon's planet lists it in `moons`, and the inner radius grows when a body lies past
//! it. The game builds each body's construction queue when it loads.

use std::collections::BTreeSet;

use crate::document::Document;
use crate::emit::roman;
use crate::emit::system::{FIXED_NAME_FLAG, MOON_FLAG, RING_FLAG};
use crate::entity::views::EntityKind;
use crate::format::save::added::row;
use crate::format::save::alloc::{Slot, SlotTable};
use crate::format::save::read_spec::written_angle;
use crate::format::save::system_spec::BodySpec;
use crate::format::save::write::add_system::{
    self, MOON_NAME, NUMERAL_VAR, PARENT_VAR, PLANET_NAME, check_body, write_body,
};
use crate::format::save::write::asteroid_names::{self, Pool};
use crate::format::save::write::bodies::{Stored, frame, grow_past, number};
use crate::format::save::write::id_list::{list_planets, unlist_planets};
use crate::format::save::write::planet_entry::{is_star, role};
use crate::format::save::write::planet_entry::{list_moon, unlist_moon};
use crate::format::save::write::planet_modifier;
use crate::format::save::write::remove_system::return_asteroid_names_of;
use crate::format::save::{planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::bodies::check_placement;
use crate::ops::rules::check_name;
use crate::ops::rules::named;
use crate::ops::{BodyName, NewBody, NewModifier, Op, OpError, Plan, Planned, Subject};
use crate::plural;
use crate::projections::geometry::{Body, drawn_radius, normalised, point, reach};
use crate::projections::name::{NameTemplate, NameVariable};
use crate::projections::name::{format, letter, literal};
use crate::projections::read;
use crate::session::Session;
use crate::views::OrbitPlacement;

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    spec: &NewBody,
    at: OrbitPlacement,
) -> Result<Planned, OpError> {
    check_spec(spec)?;
    check_placement(at.radius, at.angle)?;
    for moon in &spec.moons {
        check_placement(moon.at.radius, moon.at.angle)?;
    }
    if !s.graph.systems.contains_key(&system) {
        return Err(OpError::UnknownSystem(system));
    }
    let stored = frame(s, system)?;
    if stored.is_empty() {
        return Err(OpError::NoBodies(system));
    }
    let parent = match spec.moon_of {
        Some(parent) => Some(moon_parent(s, &stored, system, parent)?),
        None => None,
    };
    let centre = parent.map_or((0.0, 0.0), |p| p.at);
    let angle = normalised(at.angle);
    let (x, y) = point(centre, at.radius, angle);
    let pick = match spec.asteroid {
        true => Some(asteroid_name(s, system)?),
        false => None,
    };
    let name = match (&spec.name, &pick) {
        (_, Some(pick)) => pick.name.clone(),
        (Some(name), None) => written_name(name),
        (None, None) => numbered(s, system, &stored, spec.moon_of)?,
    };

    let mut planets = SlotTable::planets(&s.doc)?;
    let has_deposits = std::iter::once(spec)
        .chain(spec.moons.iter().map(|moon| &moon.spec))
        .any(|body| !body.deposits.is_empty());
    let mut deposits = match has_deposits {
        true => Some(SlotTable::deposits(&s.doc)?),
        false => None,
    };
    let slot = planets.take();
    let id = slot.id();
    let moon_slots: Vec<Slot> = spec.moons.iter().map(|_| planets.take()).collect();
    let moon_ids: Vec<u32> = moon_slots.iter().map(|slot| slot.id()).collect();
    let mut tables = Tables {
        planets: &mut planets,
        deposits: deposits.as_mut(),
    };
    let new = NewEntry {
        spec,
        name: &name,
        at: (x, y),
        orbit: at.radius,
        angle,
        moon_of: spec.moon_of,
        moons: moon_ids.clone(),
    };
    write_new(plan, s, system, &new, slot, &mut tables)?;
    let mut added = vec![Body {
        id,
        parent: spec.moon_of,
        at: (x, y),
        orbit: at.radius,
    }];
    let mut letters = 0;
    for (moon, slot) in spec.moons.iter().zip(moon_slots) {
        let moon_angle = normalised(moon.at.angle);
        let moon_at = point((x, y), moon.at.radius, moon_angle);
        let moon_name = match &moon.spec.name {
            Some(name) => written_name(name),
            None => {
                letters += 1;
                format(
                    MOON_NAME,
                    vec![
                        (PARENT_VAR, name.clone()),
                        (NUMERAL_VAR, literal(&letter(letters - 1))),
                    ],
                )
            }
        };
        let new = NewEntry {
            spec: &moon.spec,
            name: &moon_name,
            at: moon_at,
            orbit: moon.at.radius,
            angle: moon_angle,
            moon_of: Some(id),
            moons: Vec::new(),
        };
        write_new(plan, s, system, &new, slot, &mut tables)?;
        added.push(Body {
            id: slot.id(),
            parent: Some(id),
            at: moon_at,
            orbit: moon.at.radius,
        });
    }
    if let Some(entry) = pick.and_then(|pick| pick.entry) {
        plan.erase(&s.doc, Subject::Record(entry), entry)?;
    }
    let listed: Vec<u32> = std::iter::once(id)
        .chain(moon_ids.iter().copied())
        .collect();
    list_planets(plan.edit(&s.doc, system)?, &listed)?;
    if let Some(parent) = spec.moon_of {
        list_moon(plan.edit_planet(&s.doc, parent, system)?, id)?;
    }

    let mut after: Vec<Body> = stored.iter().map(|b| b.body).collect();
    after.extend(added.iter().copied());
    let reached = added
        .iter()
        .map(|body| reach(&after, body))
        .fold(0.0, f64::max);
    let whose = match spec.moon_of {
        Some(parent) => format!("moon #{id} of planet #{parent} in"),
        None => format!("planet #{id} to"),
    };
    let description = format!(
        "Added {whose} {} ({}, size {}) at orbit {} at {}°{}",
        named(&s.graph, system),
        spec.class,
        spec.size,
        number(at.radius),
        number(angle),
        with(spec),
    );
    let inverse = match moon_ids.is_empty() {
        true => Op::RemoveBody { body: id },
        false => Op::Batch {
            description: format!("Undo of \"{description}\""),
            ops: moon_ids
                .iter()
                .rev()
                .chain(std::iter::once(&id))
                .map(|&body| Op::RemoveBody { body })
                .collect(),
        },
    };
    grow_past(plan, s, system, reached, description, inverse)
}

/// ", with 2 moons and 3 deposits", counting the moons' deposits too; nothing when there
/// are neither.
fn with(spec: &NewBody) -> String {
    let deposits = spec.deposits.len()
        + spec
            .moons
            .iter()
            .map(|moon| moon.spec.deposits.len())
            .sum::<usize>();
    let mut parts = Vec::new();
    if !spec.moons.is_empty() {
        parts.push(plural(spec.moons.len(), "moon"));
    }
    if deposits > 0 {
        parts.push(plural(deposits, "deposit"));
    }
    match parts.is_empty() {
        true => String::new(),
        false => format!(", with {}", parts.join(" and ")),
    }
}

/// The tables an add takes its slots from.
struct Tables<'t> {
    planets: &'t mut SlotTable,
    deposits: Option<&'t mut SlotTable>,
}

/// One body of an add as its entry reads, its point relative to the system's centre.
struct NewEntry<'a> {
    spec: &'a NewBody,
    name: &'a NameTemplate,
    at: (f64, f64),
    orbit: f64,
    angle: f64,
    moon_of: Option<u32>,
    moons: Vec<u32>,
}

/// Write one body of an add into planet `slot`, with its deposits, modifiers and features.
fn write_new(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    new: &NewEntry<'_>,
    slot: Slot,
    tables: &mut Tables<'_>,
) -> Result<(), OpError> {
    let (timed, features) = modifier_lines(slot.id(), &new.spec.modifiers)?;
    let spec = body_spec(new.spec, new.orbit, new.angle);
    let body = add_system::Body {
        spec: &spec,
        star: false,
        name: new.name,
        x: new.at.0,
        y: new.at.1,
        moon_of: new.moon_of,
        moons: new.moons.clone(),
        timed,
        features,
    };
    write_body(
        plan,
        &s.doc,
        system,
        &body,
        slot,
        tables.planets,
        tables.deposits.as_deref_mut(),
    )
}

/// A body's `timed_modifier` items as (modifier, days), and its `planet_modifier` lines.
type ModifierLines<'a> = (Vec<(&'a str, i32)>, Vec<&'a str>);

/// The `timed_modifier` items and `planet_modifier` lines of planet `id`, refused when a
/// modifier with days, or a feature, is listed twice.
fn modifier_lines(id: u32, modifiers: &[NewModifier]) -> Result<ModifierLines<'_>, OpError> {
    let mut timed = Vec::new();
    let mut features: Vec<&str> = Vec::new();
    for (i, modifier) in modifiers.iter().enumerate() {
        let twice = modifiers[..i]
            .iter()
            .any(|earlier| earlier.modifier == modifier.modifier && !earlier.days.is_empty());
        if twice && !modifier.days.is_empty() {
            return Err(OpError::ModifierPresent(id, modifier.modifier.clone()));
        }
        timed.extend(
            modifier
                .days
                .iter()
                .map(|&days| (modifier.modifier.as_str(), days)),
        );
        if let Some(feature) = &modifier.feature {
            if features.contains(&feature.as_str()) {
                return Err(OpError::ModifierPresent(id, feature.clone()));
            }
            features.push(feature);
        }
    }
    Ok((timed, features))
}

/// What the add-system writer takes of `spec`, standing at `orbit` and `angle`. A fixed name
/// takes the fixed-name bit when the spec says so.
fn body_spec(spec: &NewBody, orbit: f64, angle: f64) -> BodySpec {
    BodySpec {
        class: spec.class.clone(),
        size: spec.size,
        orbit,
        angle,
        entity: spec.entity.unwrap_or(0),
        deposits: spec.deposits.clone(),
        entity_name: spec.entity_name.clone(),
        ring: spec.ring,
        asteroid: spec.asteroid,
        name: match &spec.name {
            Some(BodyName::Typed(name) | BodyName::Fixed(name)) if spec.fixed_name => {
                Some(name.clone())
            }
            _ => None,
        },
        ..BodySpec::default()
    }
}

fn written_name(name: &BodyName) -> NameTemplate {
    match name {
        BodyName::Typed(typed) => NameTemplate {
            literal: true,
            ..NameTemplate::plain(typed)
        },
        BodyName::Fixed(key) => NameTemplate::plain(key),
    }
}

/// How a spec names a body named `name`: `None` for a name built from variables, which the
/// add numbers again.
pub(crate) fn body_name(name: NameTemplate) -> Option<BodyName> {
    if !name.variables.is_empty() {
        return None;
    }
    Some(match name.literal {
        true => BodyName::Typed(name.key),
        false => BodyName::Fixed(name.key),
    })
}

pub(crate) fn plan_remove(plan: &mut Plan, s: &Session, planet: u32) -> Result<Planned, OpError> {
    let (node, src) = planet_entity(&s.doc, planet)?;
    let Some(slot) = s.doc.added().get(EntityKind::Planet, planet) else {
        return Err(OpError::BodyNotAdded(planet));
    };
    let system = planet_system(&node, src, planet)?;
    let stored = frame(s, system)?;
    let own = stored
        .iter()
        .find(|b| b.body.id == planet)
        .ok_or(OpError::NotABody {
            body: planet,
            system,
        })?;
    if stored.iter().any(|b| b.body.parent == Some(planet)) {
        return Err(OpError::BodyHasMoons(planet));
    }
    let parent = own
        .body
        .parent
        .filter(|&p| stored.iter().any(|b| b.body.id == p));
    let moon_of = parent.filter(|_| own.moon);
    let inverse = Op::AddBody {
        system,
        spec: spec_of(&s.doc, &node, src, moon_of),
        at: placement(&stored, &own.body, moon_of),
    };
    let held = read::ids(&node, keys::DEPOSITS, src);

    let subject = Subject::Planet { id: planet, system };
    let mut planets = SlotTable::planets(&s.doc)?;
    let mut deposits: Option<SlotTable> = None;
    for deposit in held {
        let Some(anchor) = s.doc.added().get(EntityKind::Deposit, deposit) else {
            continue;
        };
        let table = match &mut deposits {
            Some(table) => table,
            None => deposits.insert(SlotTable::deposits(&s.doc)?),
        };
        table.free(plan, &s.doc, Subject::Record(anchor), deposit, anchor)?;
    }
    planets.free(plan, &s.doc, subject, planet, slot)?;
    planets.settle(plan, &s.doc)?;
    if let Some(deposits) = deposits {
        deposits.settle(plan, &s.doc)?;
    }
    unlist_planets(plan.edit(&s.doc, system)?, &[planet])?;
    return_asteroid_names_of(plan, s, &BTreeSet::from([planet]))?;
    if let Some(parent) = parent {
        unlist_moon(plan.edit_planet(&s.doc, parent, system)?, planet)?;
    }
    let whose = match moon_of {
        Some(parent) => format!("moon #{planet} of planet #{parent}"),
        None => format!("planet #{planet}"),
    };
    Ok(Planned {
        description: format!("Removed {whose} from {}", named(&s.graph, system)),
        inverse,
    })
}

/// Refuse a spec whose body or moons [`check_body`] refuses, or whose moons break the rules
/// [`Op::AddBody`] states.
fn check_spec(spec: &NewBody) -> Result<(), OpError> {
    check_one(spec)?;
    if spec.asteroid {
        if spec.name.is_some() {
            return Err(OpError::FixedNameNotAllowed(
                "an asteroid named from the pool",
            ));
        }
        if !spec.moons.is_empty() {
            return Err(OpError::MoonsNotAllowed("an asteroid"));
        }
        if spec.moon_of.is_some() {
            return Err(OpError::AsteroidNotAllowed("a moon"));
        }
    }
    if spec.moon_of.is_some() {
        if spec.ring {
            return Err(OpError::RingNotAllowed("a moon"));
        }
        if !spec.moons.is_empty() {
            return Err(OpError::MoonsNotAllowed("a moon"));
        }
    }
    for moon in &spec.moons {
        check_one(&moon.spec)?;
        if moon.spec.ring {
            return Err(OpError::RingNotAllowed("a moon"));
        }
        if moon.spec.asteroid {
            return Err(OpError::AsteroidNotAllowed("a moon"));
        }
        if !moon.spec.moons.is_empty() {
            return Err(OpError::MoonsNotAllowed("a moon"));
        }
        if let Some(parent) = moon.spec.moon_of {
            let reason = format!("a new planet's moon orbits it, not planet {parent}");
            return Err(OpError::InvalidParent { reason });
        }
    }
    Ok(())
}

/// One body of a spec, its moons aside: what [`check_body`] refuses, its name and its
/// modifiers.
fn check_one(spec: &NewBody) -> Result<(), OpError> {
    check_body(&body_spec(spec, 0.0, 0.0))?;
    if let Some(BodyName::Typed(name) | BodyName::Fixed(name)) = &spec.name {
        check_name(name)?;
    }
    for modifier in &spec.modifiers {
        planet_modifier::check_new(
            &modifier.modifier,
            &modifier.days,
            modifier.feature.as_deref(),
        )?;
    }
    Ok(())
}

/// Body `parent` of the system, refused as a moon's parent when it is a star, a moon or an
/// asteroid. An asteroid is named from the save's pool of asteroid names, as a system read
/// back as a spec tells one.
fn moon_parent(s: &Session, stored: &[Stored], system: u32, parent: u32) -> Result<Body, OpError> {
    let host = stored
        .iter()
        .find(|b| b.body.id == parent)
        .ok_or(OpError::NotABody {
            body: parent,
            system,
        })?;
    let (node, src) = planet_entity(&s.doc, parent)?;
    let primary = stored
        .first()
        .is_some_and(|primary| primary.body.id == parent);
    let star = is_star(role(&node, src, primary, s.star_classes()))
        || stored
            .iter()
            .any(|b| b.body.parent == Some(parent) && !b.moon);
    if asteroid_names::parts(&read::name(&node, src)).is_some() {
        return Err(OpError::MoonsNotAllowed("an asteroid"));
    }
    let reason = if star {
        format!("planet {parent} is a star: a moon needs a planet to orbit")
    } else if host.moon {
        format!("planet {parent} is a moon, and a moon cannot have moons")
    } else {
        return Ok(host.body);
    };
    Err(OpError::InvalidParent { reason })
}

/// A new planet's name: the system's next numeral after the highest its numbered planets
/// hold. A moon's: the letter after the highest its planet's lettered moons hold.
fn numbered(
    s: &Session,
    system: u32,
    stored: &[Stored],
    moon_of: Option<u32>,
) -> Result<NameTemplate, OpError> {
    let names_of = |ids: &mut dyn Iterator<Item = u32>| -> Result<Vec<NameTemplate>, OpError> {
        ids.map(|id| {
            let (node, src) = planet_entity(&s.doc, id)?;
            Ok(read::name(&node, src))
        })
        .collect()
    };
    let (key, parent, highest) = match moon_of {
        Some(parent) => {
            let siblings = names_of(
                &mut stored
                    .iter()
                    .filter(|b| b.body.parent == Some(parent))
                    .map(|b| b.body.id),
            )?;
            let highest = numerals(&siblings, MOON_NAME)
                .filter_map(|text| (0..702).find(|&i| letter(i) == text))
                .max();
            let name = names_of(&mut std::iter::once(parent))?.remove(0);
            let next = highest.map_or(0, |i| i + 1);
            (MOON_NAME, name, literal(&letter(next)))
        }
        None => {
            let siblings = names_of(&mut stored.iter().map(|b| b.body.id))?;
            let highest = numerals(&siblings, PLANET_NAME)
                .filter_map(|text| (1..4000).find(|&n| roman(n) == text))
                .max()
                .unwrap_or(0);
            let named = siblings
                .iter()
                .filter(|name| name.key == PLANET_NAME)
                .find_map(|name| variable(name, PARENT_VAR))
                .cloned()
                .or_else(|| s.graph.systems.get(&system).map(|n| n.name.clone()))
                .unwrap_or_default();
            (PLANET_NAME, named, literal(&roman(highest + 1)))
        }
    };
    Ok(format(
        key,
        vec![(PARENT_VAR, parent), (NUMERAL_VAR, highest)],
    ))
}

/// The `NUMERAL` each of `names` formatted by `key` holds.
fn numerals<'a>(names: &'a [NameTemplate], key: &'a str) -> impl Iterator<Item = &'a str> {
    names
        .iter()
        .filter(move |name| name.key == key)
        .filter_map(|name| variable(name, NUMERAL_VAR))
        .map(|numeral| numeral.key.as_str())
}

fn variable<'a>(name: &'a NameTemplate, var: &str) -> Option<&'a NameTemplate> {
    name.variables
        .iter()
        .find(|v: &&NameVariable| v.name == var)
        .map(|v| &v.value)
}

/// A name from the save's pool of asteroid names for an asteroid of system `system`, and
/// the pool entry it takes.
fn asteroid_name(s: &Session, system: u32) -> Result<asteroid_names::Pick, OpError> {
    let key = s
        .graph
        .systems
        .get(&system)
        .map(|node| node.name.key.clone())
        .unwrap_or_default();
    let mut picks = Pool::read(&s.doc).pick(&s.doc, &key, 1)?;
    Ok(picks.remove(0))
}

/// The spec that adds the body `node` holds back, its moons aside: its class, size, ring,
/// model, live deposits, modifiers and features, and its name unless it was numbered.
pub(crate) fn spec_of(
    doc: &Document,
    node: &crate::cst::Node,
    src: &[u8],
    moon_of: Option<u32>,
) -> NewBody {
    let flags = read::scalar_u32(node, keys::BINARY_FLAGS, src).unwrap_or(0);
    let name = body_name(read::name(node, src));
    NewBody {
        class: read::text(node, keys::PLANET_CLASS, src),
        size: read::scalar_u32(node, keys::PLANET_SIZE, src).unwrap_or_default(),
        moon_of,
        fixed_name: name.is_some() && flags & FIXED_NAME_FLAG != 0,
        name,
        deposits: read::ids(node, keys::DEPOSITS, src)
            .into_iter()
            .filter_map(|id| deposit_kind(doc, id))
            .collect(),
        ring: flags & RING_FLAG != 0 && flags & MOON_FLAG == 0,
        asteroid: asteroid_names::parts(&read::name(node, src)).is_some(),
        entity: read::scalar_u32(node, keys::ENTITY, src),
        entity_name: read::scalar(node, keys::ENTITY_NAME, src).map(str::to_owned),
        modifiers: planet_modifier::read_all(node, src),
        moons: Vec::new(),
    }
}

/// Deposit `id`'s type, when the save holds it live.
fn deposit_kind(doc: &Document, id: u32) -> Option<String> {
    let deposit = row(doc, EntityKind::Deposit.into(), id).ok()??;
    read::scalar(&deposit.node, keys::TYPE, deposit.src).map(str::to_owned)
}

/// Where `body` stands about the point a spec with `moon_of` places it from.
pub(crate) fn placement(stored: &[Stored], body: &Body, moon_of: Option<u32>) -> OrbitPlacement {
    let centre = moon_of
        .and_then(|parent| stored.iter().find(|b| b.body.id == parent))
        .map_or((0.0, 0.0), |parent| parent.body.at);
    let radius = drawn_radius(body.at, centre, Some(body.orbit));
    OrbitPlacement {
        radius,
        angle: written_angle(centre, body.at, radius),
    }
}
