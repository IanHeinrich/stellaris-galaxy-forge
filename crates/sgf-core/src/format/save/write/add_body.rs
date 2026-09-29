//! `AddSaveBody` and `RemoveAddedBody`: one planet or moon added to a save system, and
//! taken out again. The body's entry and its deposits' take slots as
//! [`super::add_system`] gives them, the system lists it after its last `planet=` line, a
//! moon's planet lists it in `moons`, and the inner radius grows when the body reaches past
//! it. The game builds the body's construction queue when it loads.

use crate::document::Document;
use crate::emit::roman;
use crate::emit::system::{MOON_FLAG, RING_FLAG};
use crate::entity::views::EntityKind;
use crate::format::save::alloc::SlotTable;
use crate::format::save::read_spec::written_angle;
use crate::format::save::system_spec::BodySpec;
use crate::format::save::write::add_system::{
    self, MOON_NAME, NUMERAL_VAR, PARENT_VAR, PLANET_NAME, letter, literal, write_body,
};
use crate::format::save::write::bodies::{Stored, frame, grow, list_moon, number, unlist_moon};
use crate::format::save::write::deposits::check_deposit_kind;
use crate::format::save::write::move_planet::{is_star_class, list_planets, unlist_planets};
use crate::format::save::{check_version, entity_at, planet_entity, planet_system};
use crate::keys;
use crate::ops::rules::bodies::{Body, check_placement, drawn_radius, normalised, point, reach};
use crate::ops::rules::{Form, check_name, check_text};
use crate::ops::{NewBody, Op, OpError, Plan, Planned, Subject};
use crate::overlay::Anchor;
use crate::plural;
use crate::projections::name::{NameTemplate, NameVariable};
use crate::projections::read;
use crate::scan::Value;
use crate::session::Session;
use crate::views::OrbitPlacement;

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    system: u32,
    spec: &NewBody,
    at: OrbitPlacement,
) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    check_spec(spec)?;
    check_placement(at.radius, at.angle)?;
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
    let angle = normalised(at.angle);
    let centre = parent.map_or((0.0, 0.0), |p| p.at);
    let (x, y) = point(centre, at.radius, angle);
    let name = match &spec.name {
        Some(typed) => NameTemplate {
            literal: true,
            ..NameTemplate::plain(typed)
        },
        None => numbered(s, system, &stored, spec.moon_of)?,
    };

    let mut planets = SlotTable::planets(&s.doc)?;
    let mut deposits = match spec.deposits.is_empty() {
        true => None,
        false => Some(SlotTable::deposits(&s.doc)?),
    };
    let slot = planets.take();
    let id = slot.id();
    let body_spec = BodySpec {
        class: spec.class.clone(),
        size: spec.size,
        orbit: at.radius,
        angle,
        deposits: spec.deposits.clone(),
        ring: spec.ring,
        ..BodySpec::default()
    };
    let body = add_system::Body {
        spec: &body_spec,
        star: false,
        name: &name,
        x,
        y,
        moon_of: spec.moon_of,
        moons: Vec::new(),
    };
    write_body(
        plan,
        &s.doc,
        system,
        &body,
        slot,
        &mut planets,
        deposits.as_mut(),
    )?;
    list_planets(plan.edit(&s.doc, system)?, &[id])?;
    if let Some(parent) = spec.moon_of {
        list_moon(plan.edit_planet(&s.doc, parent, system)?, id)?;
    }

    let before: Vec<Body> = stored.iter().map(|b| b.body).collect();
    let added = Body {
        id,
        parent: spec.moon_of,
        at: (x, y),
        orbit: at.radius,
    };
    let mut after = before.clone();
    after.push(added);
    let whose = match spec.moon_of {
        Some(parent) => format!("moon #{id} of planet #{parent} in"),
        None => format!("planet #{id} to"),
    };
    let with = match spec.deposits.len() {
        0 => String::new(),
        n => format!(", with {}", plural(n, "deposit")),
    };
    let description = format!(
        "Added {whose} system #{system} ({}, size {}) at orbit {} at {}°{with}",
        spec.class,
        spec.size,
        number(at.radius),
        number(angle),
    );
    let inverse = Op::RemoveAddedBody { planet: id };
    grow(
        plan,
        s,
        system,
        &before,
        reach(&after, &added),
        description,
        inverse,
    )
}

pub(crate) fn plan_remove(plan: &mut Plan, s: &Session, planet: u32) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    let (node, src) = planet_entity(&s.doc, planet)?;
    let Some(slot) = s.doc.added().get(EntityKind::Planet, planet) else {
        return Err(OpError::BodyNotAdded(planet));
    };
    let system = planet_system(&node, src, planet)?;
    let stored = frame(s, system)?;
    let own = stored
        .iter()
        .find(|b| b.body.id == planet)
        .ok_or(OpError::NotABody { planet, system })?;
    if stored.iter().any(|b| b.body.parent == Some(planet)) {
        return Err(OpError::BodyHasMoons(planet));
    }
    let parent = own
        .body
        .parent
        .filter(|&p| stored.iter().any(|b| b.body.id == p));
    let moon_of = parent.filter(|_| own.moon);
    let inverse = Op::AddSaveBody {
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
    if let Some(parent) = parent {
        unlist_moon(plan.edit_planet(&s.doc, parent, system)?, planet)?;
    }
    let whose = match moon_of {
        Some(parent) => format!("moon #{planet} of planet #{parent}"),
        None => format!("planet #{planet}"),
    };
    Ok(Planned {
        description: format!("Removed {whose} from system #{system}"),
        inverse,
    })
}

fn check_spec(spec: &NewBody) -> Result<(), OpError> {
    check_text("a planet class", &spec.class, Form::Bare)?;
    if spec.size == 0 {
        return Err(OpError::ZeroPlanetSize);
    }
    for deposit in &spec.deposits {
        check_deposit_kind(deposit)?;
    }
    if let Some(name) = &spec.name {
        check_name(name)?;
    }
    if spec.ring && spec.moon_of.is_some() {
        return Err(OpError::RingNotAllowed("a moon"));
    }
    Ok(())
}

/// Body `parent` of the system, refused as a moon's parent when it is a star or a moon.
fn moon_parent(s: &Session, stored: &[Stored], system: u32, parent: u32) -> Result<Body, OpError> {
    let host = stored
        .iter()
        .find(|b| b.body.id == parent)
        .ok_or(OpError::NotABody {
            planet: parent,
            system,
        })?;
    let (node, src) = planet_entity(&s.doc, parent)?;
    let star = stored
        .first()
        .is_some_and(|primary| primary.body.id == parent)
        || is_star_class(&read::text(&node, keys::PLANET_CLASS, src))
        || stored
            .iter()
            .any(|b| b.body.parent == Some(parent) && !b.moon);
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
    Ok(add_system::format(
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

/// The spec that adds the body `node` holds back: its class, size, ring, deposits, and its
/// name when it was typed rather than numbered.
fn spec_of(doc: &Document, node: &crate::cst::Node, src: &[u8], moon_of: Option<u32>) -> NewBody {
    let name = read::name(node, src);
    let flags = read::scalar_u32(node, keys::BINARY_FLAGS, src).unwrap_or(0);
    NewBody {
        class: read::text(node, keys::PLANET_CLASS, src),
        size: read::scalar_u32(node, keys::PLANET_SIZE, src).unwrap_or_default(),
        moon_of,
        name: (name.literal && name.variables.is_empty()).then_some(name.key),
        deposits: read::ids(node, keys::DEPOSITS, src)
            .into_iter()
            .filter_map(|id| deposit_kind(doc, id))
            .collect(),
        ring: flags & RING_FLAG != 0 && flags & MOON_FLAG == 0,
    }
}

/// Deposit `id`'s type, when the save holds it live.
fn deposit_kind(doc: &Document, id: u32) -> Option<String> {
    let anchor = doc.added().get(EntityKind::Deposit, id).or_else(|| {
        let entity = doc.index().entity(keys::DEPOSIT, u64::from(id))?;
        matches!(entity.value, Value::Block { .. }).then_some(Anchor::Original(entity.stmt))
    })?;
    let (node, src) = entity_at(doc, anchor).ok()??;
    read::scalar(&node, keys::TYPE, src).map(str::to_owned)
}

/// Where `body` stands about the point a spec with `moon_of` places it from.
fn placement(stored: &[Stored], body: &Body, moon_of: Option<u32>) -> OrbitPlacement {
    let centre = moon_of
        .and_then(|parent| stored.iter().find(|b| b.body.id == parent))
        .map_or((0.0, 0.0), |parent| parent.body.at);
    let radius = drawn_radius(body.at, centre, Some(body.orbit));
    OrbitPlacement {
        radius,
        angle: written_angle(centre, body.at, radius),
    }
}
