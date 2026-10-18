//! A system an op added, read back from its entries as the [`SystemSpec`] that writes it:
//! the inverse of [`crate::emit::system`], for the removal and the reroll that undo an add.

use std::collections::HashMap;

use crate::cst::Node;
use crate::document::Document;
use crate::emit::system::{FIXED_NAME_FLAG, PREVENT_ANOMALY_FLAG, RING_FLAG, STAR_CARRIER_FLAGS};
use crate::entity::views::EntityKind;
use crate::format::save::galaxy::bodies::planet_ids;
use crate::format::save::galaxy::systems::timed_modifiers;
use crate::format::save::system_spec::{
    BeltSpec, BodyKind, BodySpec, PrimaryName, SystemSpec, polar,
};
use crate::format::save::write::asteroid_names;
use crate::format::save::write::flags::day_one;
use crate::format::save::write::initializer_counter::counted;
use crate::format::save::{entity, planet_statement, system_statement};
use crate::keys;
use crate::ops::{OpError, Subject};
use crate::overlay::Anchor;
pub(crate) use crate::projections::geometry::written_angle;
use crate::projections::read;
use crate::session::Session;

/// Where a body read back that others may orbit stands in the spec: the star, a body about
/// the centre, or a planet of a star (`None` for the system's own).
#[derive(Clone, Copy)]
enum Place {
    Star,
    Centre(usize),
    Satellite(Option<usize>, usize),
}

/// System `id` as the spec that writes it: its bodies read back from their entries, each
/// angle measured from where the add placed what it orbits, or from the centre. A body
/// joins the `moons` of the body its `moon_of` names when that is the star, a body about
/// the centre or a star's planet; any other orbits the centre. The star's name is its own
/// when it has the fixed-name bit, the system's when it is the system's key alone, and
/// lettered otherwise.
pub(crate) fn spec_of(s: &Session, id: u32, lanes: Vec<u32>) -> Result<SystemSpec, OpError> {
    let system = s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
    let mut read = Vec::new();
    for planet in bodies(&s.doc, id)? {
        if let Some(anchor) = planet_statement(&s.doc, planet)? {
            read.push((planet, read_body(&s.doc, planet, id, anchor)?));
        }
    }
    let Some(((primary, star), rest)) = read.split_first() else {
        return Err(Subject::System(id).parse_error(0, "the system lists no bodies"));
    };
    let (star_spec, star_point) = star.spec((0.0, 0.0));
    let mut star_spec = BodySpec {
        name: None,
        ..star_spec
    };
    let mut planets: Vec<BodySpec> = Vec::new();
    let mut placed: HashMap<u32, (Place, (f64, f64))> =
        HashMap::from([(*primary, (Place::Star, star_point))]);
    for (planet, body) in rest {
        let Some((parent, centre)) = body.moon_of.and_then(|parent| placed.get(&parent).copied())
        else {
            let (spec, point) = body.spec((0.0, 0.0));
            planets.push(spec);
            placed.insert(*planet, (Place::Centre(planets.len() - 1), point));
            continue;
        };
        // The star whose planet the body is, `None` for the system's own.
        let of_star = match parent {
            Place::Star => Some(None),
            Place::Centre(at) if planets[at].kind == BodyKind::Star => Some(Some(at)),
            Place::Centre(_) | Place::Satellite(..) => None,
        };
        let moons = match parent {
            Place::Star => &mut star_spec.moons,
            Place::Centre(at) => &mut planets[at].moons,
            Place::Satellite(None, index) => &mut star_spec.moons[index].moons,
            Place::Satellite(Some(at), index) => &mut planets[at].moons[index].moons,
        };
        let (spec, point) = body.spec(centre);
        moons.push(spec);
        if let Some(star) = of_star {
            let place = Place::Satellite(star, moons.len() - 1);
            placed.insert(*planet, (place, point));
        }
    }
    let star_name = match (star.fixed_flag, star.name.clone()) {
        (true, Some(name)) => PrimaryName::Fixed(name),
        (false, Some(_)) => PrimaryName::System,
        (_, None) => PrimaryName::Lettered,
    };
    let star = star_spec;
    Ok(SystemSpec {
        name: system.name.key.clone(),
        x: system.x,
        y: system.y,
        star_class: system.star_class.clone(),
        initializer: system.initializer.clone(),
        capped: counted(&s.doc, &system.initializer),
        star_name,
        star,
        planets,
        belts: belts(&s.doc, id)?,
        flags: system.flags.clone(),
        lanes,
    })
}

/// One body's entry as a spec reads it.
struct ReadBody {
    class: String,
    size: u32,
    orbit: f64,
    /// Relative to the system's centre.
    x: f64,
    y: f64,
    entity: u32,
    moon_of: Option<u32>,
    deposits: Vec<String>,
    kind: BodyKind,
    name: Option<String>,
    /// The fixed-name bit is set.
    fixed_flag: bool,
    entity_name: Option<String>,
    picture: Option<String>,
    prevent_anomaly: bool,
    modifiers: Vec<String>,
    ring: bool,
    flags: Vec<String>,
}

impl ReadBody {
    /// The body as it orbits `centre`, where the add placed that, and where the add places
    /// the body from it.
    fn spec(&self, (cx, cy): (f64, f64)) -> (BodySpec, (f64, f64)) {
        let spec = BodySpec {
            class: self.class.clone(),
            size: self.size,
            orbit: self.orbit,
            angle: written_angle((cx, cy), (self.x, self.y), self.orbit),
            entity: self.entity,
            deposits: self.deposits.clone(),
            moons: Vec::new(),
            kind: self.kind,
            name: self.name.clone(),
            entity_name: self.entity_name.clone(),
            picture: self.picture.clone(),
            prevent_anomaly: self.prevent_anomaly,
            modifiers: self.modifiers.clone(),
            ring: self.ring,
            flags: self.flags.clone(),
        };
        let placed = polar(cx, cy, &spec);
        (spec, placed)
    }
}

fn read_body(
    doc: &Document,
    planet: u32,
    system: u32,
    anchor: Anchor,
) -> Result<ReadBody, OpError> {
    let subject = Subject::Planet { id: planet, system };
    let (node, src) = entity(doc, subject, anchor)?;
    let field = |reason: String| subject.parse_error(0, reason);
    let (x, y) = read::coordinate(&node, src).map_err(field)?;
    let deposits = read::ids(&node, keys::DEPOSITS, src)
        .into_iter()
        .filter_map(|deposit| deposit_kind(doc, deposit))
        .collect();
    let name = read::name(&node, src);
    let fixed = !name.literal && name.variables.is_empty();
    let modifiers = timed_modifiers(&node, src).map(str::to_owned).collect();
    let flags = read::scalar_u32(&node, keys::BINARY_FLAGS, src).unwrap_or(0);
    let star = read::scalar_u32(&node, keys::CARRIER_BINARY_FLAGS, src) == Some(STAR_CARRIER_FLAGS);
    let kind = match (star, asteroid_names::parts(&name).is_some()) {
        (true, _) => BodyKind::Star,
        (false, true) => BodyKind::Asteroid,
        (false, false) => BodyKind::Planet,
    };
    Ok(ReadBody {
        class: read::text(&node, keys::PLANET_CLASS, src),
        size: read::required(&node, keys::PLANET_SIZE, src).map_err(field)?,
        orbit: read::required(&node, keys::ORBIT, src).map_err(field)?,
        x,
        y,
        entity: read::scalar_u32(&node, keys::ENTITY, src).unwrap_or(0),
        moon_of: read::scalar_u32(&node, keys::MOON_OF, src),
        deposits,
        kind,
        name: fixed.then_some(name.key),
        fixed_flag: flags & FIXED_NAME_FLAG != 0,
        entity_name: read::scalar(&node, keys::ENTITY_NAME, src).map(str::to_owned),
        picture: read::scalar(&node, keys::PICTURE, src).map(str::to_owned),
        prevent_anomaly: flags & PREVENT_ANOMALY_FLAG != 0,
        modifiers,
        ring: flags & RING_FLAG != 0,
        flags: spec_flags(doc, &node, src),
    })
}

/// The `type` of a deposit an op added.
fn deposit_kind(doc: &Document, id: u32) -> Option<String> {
    let anchor = doc.added().get(EntityKind::Deposit, id)?;
    let (node, src) = entity(doc, Subject::Record(anchor), anchor).ok()?;
    read::scalar(&node, keys::TYPE, src).map(str::to_owned)
}

/// The belts system `id`'s entry lists, in order.
pub(crate) fn belts(doc: &Document, id: u32) -> Result<Vec<BeltSpec>, OpError> {
    let anchor = system_statement(doc, id).ok_or(OpError::UnknownSystem(id))?;
    let subject = Subject::System(id);
    let (node, src) = entity(doc, subject, anchor)?;
    belts_in(&node, src).map_err(|reason| subject.parse_error(0, reason))
}

/// The belts a parsed system entry lists, in order; the reason when a belt's radius
/// cannot be read.
pub(crate) fn belts_in(node: &Node, src: &[u8]) -> Result<Vec<BeltSpec>, String> {
    let Some(block) = node.find(keys::ASTEROID_BELTS, src) else {
        return Ok(Vec::new());
    };
    block
        .children()
        .iter()
        .filter(|belt| belt.key.is_none())
        .map(|belt| {
            Ok(BeltSpec {
                kind: read::text(belt, keys::TYPE, src),
                inner_radius: read::required(belt, keys::INNER_RADIUS, src)?,
            })
        })
        .collect()
}

/// The planets system `id`'s entry lists, star first.
pub(crate) fn bodies(doc: &Document, id: u32) -> Result<Vec<u32>, OpError> {
    let anchor = system_statement(doc, id).ok_or(OpError::UnknownSystem(id))?;
    let (node, src) = entity(doc, Subject::System(id), anchor)?;
    Ok(planet_ids(&node, src))
}

/// The planet flags of the body `node` a spec writes: those dated the save's day one. A flag
/// another op set later, such as a habitat's on its host, is dated the day it was set and
/// is left to that op.
fn spec_flags(doc: &Document, node: &Node, src: &[u8]) -> Vec<String> {
    let Some(flags) = node.find(keys::FLAGS, src) else {
        return Vec::new();
    };
    let Ok(day_one) = day_one(doc) else {
        return Vec::new();
    };
    flags
        .children()
        .iter()
        .filter(|flag| flag.scalar_str(src) == Some(day_one.as_str()))
        .filter_map(|flag| flag.key_str(src).map(str::to_owned))
        .collect()
}
