//! A system an op added, read back from its entries as the [`SystemSpec`] that writes it:
//! the inverse of [`crate::emit::system`], for the removal and the reroll that undo an add.

use std::collections::HashMap;

use crate::document::Document;
use crate::emit::coord;
use crate::emit::system::{RING_FLAG, STAR_CARRIER_FLAGS};
use crate::entity::views::EntityKind;
use crate::format::save::galaxy::bodies::planet_ids;
use crate::format::save::galaxy::systems::timed_modifiers;
use crate::format::save::system_spec::{BeltSpec, BodySpec, SystemSpec, polar};
use crate::format::save::write::asteroid_names;
use crate::format::save::write::initializer_counter::counted;
use crate::format::save::{entity, planet_statement, system_statement};
use crate::keys;
use crate::ops::{OpError, Subject};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::session::Session;

/// System `id` as the spec that writes it: its bodies read back from their entries, each
/// angle measured from the star, or from where the add placed its planet for a moon. A
/// star whose name is the system's own was named by its class.
pub(crate) fn spec_of(s: &Session, id: u32, lanes: Vec<u32>) -> Result<SystemSpec, OpError> {
    let system = s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
    let mut read = Vec::new();
    for planet in bodies(&s.doc, id)? {
        if let Some(anchor) = planet_statement(&s.doc, planet)? {
            read.push((planet, read_body(&s.doc, planet, id, anchor)?));
        }
    }
    let Some(((_, star), rest)) = read.split_first() else {
        return Err(Subject::System(id).parse_error(0, "the system lists no bodies"));
    };
    let mut planets: Vec<BodySpec> = Vec::new();
    let mut planet_at: HashMap<u32, (usize, (f64, f64))> = HashMap::new();
    for (planet, body) in rest {
        match body.moon_of.and_then(|parent| planet_at.get(&parent)) {
            Some(&(at, centre)) => planets[at].moons.push(body.spec(centre).0),
            None => {
                let (spec, placed) = body.spec((0.0, 0.0));
                planet_at.insert(*planet, (planets.len(), placed));
                planets.push(spec);
            }
        }
    }
    let mut star = star.spec((0.0, 0.0)).0;
    let star_named_by_class = star.name.take().is_some();
    Ok(SystemSpec {
        name: system.name.key.clone(),
        x: system.x,
        y: system.y,
        star_class: system.star_class.clone(),
        initializer: system.initializer.clone(),
        capped: counted(&s.doc, &system.initializer),
        star_named_by_class,
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
    asteroid: bool,
    name: Option<String>,
    entity_name: Option<String>,
    modifiers: Vec<String>,
    ring: bool,
    star: bool,
}

impl ReadBody {
    /// The body as it orbits `centre`, where the add placed that, and where the add places
    /// the body from it. The angle measured from the written coordinates can miss them in
    /// the last decimal, so the nearest hundredth of a degree, which the generator writes,
    /// is taken instead whenever it gives the same coordinates.
    fn spec(&self, (cx, cy): (f64, f64)) -> (BodySpec, (f64, f64)) {
        let measured = (self.y - cy)
            .atan2(self.x - cx)
            .to_degrees()
            .rem_euclid(360.0)
            + 0.0;
        let hundredth = (measured * 100.0).round() / 100.0;
        let mut spec = BodySpec {
            class: self.class.clone(),
            size: self.size,
            orbit: self.orbit,
            angle: measured,
            entity: self.entity,
            deposits: self.deposits.clone(),
            moons: Vec::new(),
            asteroid: self.asteroid,
            name: self.name.clone(),
            entity_name: self.entity_name.clone(),
            modifiers: self.modifiers.clone(),
            ring: self.ring,
            star: self.star,
        };
        let written = (coord(self.x), coord(self.y));
        let candidates = [hundredth, hundredth.rem_euclid(360.0) + 0.0, measured];
        for angle in candidates {
            spec.angle = angle;
            let (x, y) = polar(cx, cy, &spec);
            if (coord(x), coord(y)) == written {
                break;
            }
        }
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
    Ok(ReadBody {
        class: read::text(&node, keys::PLANET_CLASS, src),
        size: read::required(&node, keys::PLANET_SIZE, src).map_err(field)?,
        orbit: read::required(&node, keys::ORBIT, src).map_err(field)?,
        x,
        y,
        entity: read::scalar_u32(&node, keys::ENTITY, src).unwrap_or(0),
        moon_of: read::scalar_u32(&node, keys::MOON_OF, src),
        deposits,
        asteroid: asteroid_names::parts(&name).is_some(),
        name: fixed.then_some(name.key),
        entity_name: read::scalar(&node, keys::ENTITY_NAME, src).map(str::to_owned),
        modifiers,
        ring: flags & RING_FLAG != 0,
        star: read::scalar_u32(&node, keys::CARRIER_BINARY_FLAGS, src) == Some(STAR_CARRIER_FLAGS),
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
                inner_radius: read::required(belt, keys::INNER_RADIUS, src)
                    .map_err(|reason| subject.parse_error(0, reason))?,
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
