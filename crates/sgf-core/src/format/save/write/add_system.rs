//! `AddSystemFromSpec`: a new `galactic_object` entry with its belts, its bodies in
//! `planets.planet`, their deposits in `deposit`, its lanes on both ends, the system
//! counter raised, a capped layout counted, the name taken out of the pool of unused star
//! or black hole names and each asteroid's out of the pool of asteroid names. A system
//! standing inside a nebula's radius then joins it, with its member line and footprint.
//! The game builds everything else a spawned system has (construction queues, intel,
//! terra incognita) when it loads.

use std::collections::BTreeMap;

use crate::document::Document;
use crate::emit::system::{
    DepositEntry, PlanetEntry, SystemEntry, deposit_entry, planet_entry, system_entry,
};
use crate::emit::{coord, roman, rounded};
use crate::entity::views::EntityKind;
use crate::format::save::alloc::{self, Slot, SlotTable, TableEnd};
use crate::format::save::system_spec::{BodySpec, SpecBody, SystemSpec, polar};
use crate::format::save::write::asteroid_names::Pool;
use crate::format::save::write::deposits::check_deposit_kind;
use crate::format::save::write::flags::day_one;
use crate::format::save::write::game_tables::SPAWN_BUFFER;
use crate::format::save::write::initializer_counter;
use crate::format::save::write::lanes::insert_entries;
use crate::format::save::write::name_pool::{self, SYSTEM_POOLS};
use crate::format::save::write::nebula::{plan_membership, written_literal};
use crate::format::save::write::shared::write_slot;
use crate::keys;
use crate::ops::rules::nebula::{Membership, describe_membership, prospective};
use crate::ops::rules::systems::check_reach;
use crate::ops::rules::{Form, check_name, check_text, labelled};
use crate::ops::{Emitted, Op, OpError, Plan, Planned, Subject, SystemMove};
use crate::plural;
use crate::projections::galaxy::{GalaxyGraph, lane_length, nearest_prospective};
use crate::projections::name::{NameTemplate, format, letter, literal};
use crate::session::Session;

const STAR_NAME: &str = "STAR_NAME_1_OF_1";
pub(crate) const PLANET_NAME: &str = "PLANET_NAME_FORMAT";
pub(crate) const MOON_NAME: &str = "SUBPLANET_NAME_FORMAT";
pub(crate) const NAME_VAR: &str = "NAME";
pub(crate) const PARENT_VAR: &str = "PARENT";
pub(crate) const NUMERAL_VAR: &str = "NUMERAL";

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    spec: &SystemSpec,
) -> Result<Planned, OpError> {
    check_spec(spec)?;
    check_capped(s, spec, None)?;
    let id = alloc::next_system(&s.doc, &s.graph)?;
    let (x, y) = (rounded(spec.x), rounded(spec.y));
    check_place(&s.graph, x, y)?;
    let lanes = lane_lengths(&s.graph, id, x, y, &spec.lanes)?;

    plan.created().systems.push(id);
    let written = write_bodies(plan, s, id, spec)?;
    let mut end = TableEnd::of(&s.doc, EntityKind::System)?;
    let text = system_text(&s.doc, end.indent(), id, (x, y), spec, &written, &lanes)?;
    let text = end.shape(text);
    plan.emit(Emitted::System(id), end.at(), text);
    for &(to, length) in &lanes {
        insert_entries(plan.edit(&s.doc, to)?, &[(id, length, false)])?;
    }

    alloc::system_counter(&s.doc)?.set(plan, &s.doc, id)?;
    count_layout(plan, &s.doc, spec)?;
    name_pool::take(plan, &s.doc, SYSTEM_POOLS, &spec.name)?;

    Ok(Planned {
        description: add_description(s, id, spec, lanes.len()),
        inverse: Op::RemoveSystem { system: id },
    })
}

/// What an add of `spec` as system `id` with `lanes` lanes says in the undo list, the nebula
/// it joins named: "Added Mura #601 at (-292.2, -137.6) with 7 bodies and 1 lane".
pub(crate) fn add_description(s: &Session, id: u32, spec: &SystemSpec, lanes: usize) -> String {
    let (x, y) = (rounded(spec.x), rounded(spec.y));
    let joins = nearest_prospective(&prospective(&s.graph), x, y).map(|nebula| Membership {
        system: id,
        nebula,
        joined: true,
    });
    let joins = describe_membership(&s.graph, joins.as_slice(), false);
    format!(
        "Added {} at ({}, {}) with {} and {}{joins}",
        labelled(&spec.name, written_literal(&spec.name), id),
        coord(x),
        coord(y),
        bodies(spec, order(spec).count()),
        plural(lanes, "lane")
    )
}

/// The second step of an add, once the graph holds the new system: it joins the nebula
/// whose radius it stands in, as a system moved there does. `None` when it stands in none.
pub(crate) fn plan_join(
    plan: &mut Plan,
    s: &Session,
    spec: &SystemSpec,
) -> Result<Option<Planned>, OpError> {
    let id = alloc::system_counter(&s.doc)?.last;
    let (x, y) = (rounded(spec.x), rounded(spec.y));
    let (joined, _) = plan_membership(plan, s, &[SystemMove { system: id, x, y }])?;
    Ok((!joined.is_empty()).then(|| Planned {
        description: String::new(),
        inverse: Op::RemoveSystem { system: id },
    }))
}

/// What [`write_bodies`] wrote: the planets the system lists, star first, and how far
/// from its star its inner and outer radii lie.
pub(crate) struct Written {
    pub ids: Vec<u32>,
    pub inner_radius: f64,
    pub outer_radius: f64,
}

/// Write the spec's bodies and their deposits as bodies of system `id`, each in the slot
/// its table hands out next, list them among what the op adds, and take their asteroids'
/// names out of the pool.
pub(crate) fn write_bodies(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    spec: &SystemSpec,
) -> Result<Written, OpError> {
    let asteroids = spec.planets.iter().filter(|p| p.asteroid).count();
    let picks = Pool::read(&s.doc).pick(&s.doc, &spec.name, asteroids)?;
    let names: Vec<NameTemplate> = picks.iter().map(|pick| pick.name.clone()).collect();
    let layout = layout(spec, names);
    let mut planets = SlotTable::planets(&s.doc)?;
    let mut deposits = match layout.iter().any(|b| !b.spec.deposits.is_empty()) {
        true => Some(SlotTable::deposits(&s.doc)?),
        false => None,
    };
    let slots: Vec<Slot> = layout.iter().map(|_| planets.take()).collect();
    let ids: Vec<u32> = slots.iter().map(|slot| slot.id()).collect();
    for (i, placed) in layout.iter().enumerate() {
        let body = Body {
            spec: placed.spec,
            star: i == 0,
            name: &placed.name,
            x: placed.x,
            y: placed.y,
            moon_of: placed.parent.map(|p| ids[p]),
            moons: layout
                .iter()
                .enumerate()
                .filter(|(_, moon)| moon.parent == Some(i))
                .map(|(m, _)| ids[m])
                .collect(),
            timed: Vec::new(),
            features: Vec::new(),
        };
        write_body(
            plan,
            &s.doc,
            id,
            &body,
            slots[i],
            &mut planets,
            deposits.as_mut(),
        )?;
    }
    plan.created().planets.extend(&ids);
    for entry in picks.iter().filter_map(|pick| pick.entry) {
        plan.erase(&s.doc, Subject::Record(entry), entry)?;
    }
    let extent = layout.iter().map(|b| b.extent).fold(0.0, f64::max);
    let radii = s.radii();
    let inner_radius = radii.inner_about(extent);
    Ok(Written {
        ids,
        inner_radius,
        outer_radius: radii.outer(inner_radius),
    })
}

/// System `id`'s `galactic_object` entry, indented with `indent`, at (`x`, `y`) with
/// the bodies `written` holds and `lanes` as (other end, length).
pub(crate) fn system_text(
    doc: &Document,
    indent: &[u8],
    id: u32,
    (x, y): (f64, f64),
    spec: &SystemSpec,
    written: &Written,
    lanes: &[(u32, u32)],
) -> Result<Vec<u8>, OpError> {
    let flag_date = flag_date(doc, &spec.flags)?;
    let belts = belts(spec);
    Ok(system_entry(
        indent,
        &SystemEntry {
            id,
            x,
            y,
            name: &spec.name,
            planets: &written.ids,
            star_class: &spec.star_class,
            lanes,
            belts: &belts,
            flags: &spec.flags,
            flag_date: &flag_date,
            initializer: &spec.initializer,
            inner_radius: written.inner_radius,
            outer_radius: written.outer_radius,
        },
    ))
}

/// The date a spec's star or planet flags `flags` are written with: the save's day one, as
/// the game dates the flags of a generated galaxy. Empty when there are none.
pub(crate) fn flag_date(doc: &Document, flags: &[String]) -> Result<String, OpError> {
    match flags.is_empty() {
        true => Ok(String::new()),
        false => day_one(doc),
    }
}

/// The spec's belts as the emitter takes them.
pub(crate) fn belts(spec: &SystemSpec) -> Vec<(&str, f64)> {
    spec.belts
        .iter()
        .map(|belt| (belt.kind.as_str(), belt.inner_radius))
        .collect()
}

/// Refuse a spec whose `capped` differs from that of a system added since the file was
/// opened with the same layout, other than `except`. The core cannot read `max_instances`,
/// so it holds the flag to one value per layout, and a removal can tell from the count
/// alone whether the system it takes out was counted.
pub(crate) fn check_capped(
    s: &Session,
    spec: &SystemSpec,
    except: Option<u32>,
) -> Result<(), OpError> {
    let other = s
        .doc
        .added()
        .entries(EntityKind::System)
        .map(|(id, _)| id)
        .filter(|&id| Some(id) != except)
        .find(|id| {
            s.graph
                .systems
                .get(id)
                .is_some_and(|system| system.initializer == spec.initializer)
        });
    let Some(other) = other else {
        return Ok(());
    };
    let capped = initializer_counter::counted(&s.doc, &spec.initializer);
    if capped == spec.capped {
        return Ok(());
    }
    Err(OpError::CappedMismatch {
        initializer: spec.initializer.clone(),
        other,
        capped,
    })
}

/// Count one more of the spec's layout when it is capped.
pub(crate) fn count_layout(
    plan: &mut Plan,
    doc: &Document,
    spec: &SystemSpec,
) -> Result<(), OpError> {
    if !spec.capped {
        return Ok(());
    }
    let changes = BTreeMap::from([(spec.initializer.as_str(), 1)]);
    initializer_counter::count(plan, doc, &changes)
}

/// `7 bodies`, and the belts after them: `7 bodies, 2 belts`.
pub(crate) fn bodies(spec: &SystemSpec, count: usize) -> String {
    let mut bodies = match count {
        1 => "1 body".to_owned(),
        n => format!("{n} bodies"),
    };
    if !spec.belts.is_empty() {
        bodies = format!("{bodies}, {}", plural(spec.belts.len(), "belt"));
    }
    bodies
}

/// One body as its entry reads, once every body of the system has its id.
pub(crate) struct Body<'a> {
    pub spec: &'a BodySpec,
    pub star: bool,
    pub name: &'a NameTemplate,
    /// Relative to the system's centre.
    pub x: f64,
    pub y: f64,
    pub moon_of: Option<u32>,
    pub moons: Vec<u32>,
    /// Timed modifiers with their days, written after the spec's permanent ones.
    pub timed: Vec<(&'a str, i32)>,
    /// Planet features, each a `planet_modifier` line.
    pub features: Vec<&'a str>,
}

/// Write one body of `system` into planet `slot`: a deposit per key into the slots
/// `deposits` gives them, then the body's own entry naming them. `deposits` is only read
/// when the body has some, so a save without the table takes bodies without deposits.
pub(crate) fn write_body(
    plan: &mut Plan,
    doc: &Document,
    system: u32,
    body: &Body<'_>,
    slot: Slot,
    planets: &mut SlotTable,
    mut deposits: Option<&mut SlotTable>,
) -> Result<(), OpError> {
    let planet = slot.id();
    let mut held = Vec::with_capacity(body.spec.deposits.len());
    for kind in &body.spec.deposits {
        let deposits = deposits
            .as_deref_mut()
            .ok_or(OpError::MissingKey(keys::DEPOSIT))?;
        let deposit = deposits.take();
        held.push(deposit.id());
        let entry = DepositEntry {
            id: deposit.id(),
            kind,
            holder: planet,
        };
        let text = |indent: &[u8]| deposit_entry(indent, &entry);
        write_slot(plan, doc, deposit, deposits, Emitted::Record, text)?;
    }
    let modifiers: Vec<(&str, i32)> = body
        .spec
        .modifiers
        .iter()
        .map(|m| (m.as_str(), -1))
        .chain(body.timed.iter().copied())
        .collect();
    let flag_date = flag_date(doc, &body.spec.flags)?;
    let entry = PlanetEntry {
        id: planet,
        class: &body.spec.class,
        size: body.spec.size,
        star: body.star || body.spec.star,
        name: body.name,
        x: body.x,
        y: body.y,
        system,
        orbit: body.spec.orbit,
        moon_of: body.moon_of,
        moons: &body.moons,
        fixed_name: body.spec.name.is_some(),
        ring: body.spec.ring,
        modifiers: &modifiers,
        features: &body.features,
        entity: body.spec.entity,
        entity_name: body.spec.entity_name.as_deref(),
        picture: body.spec.picture.as_deref(),
        prevent_anomaly: body.spec.prevent_anomaly,
        deposits: &held,
        flags: &body.spec.flags,
        flag_date: &flag_date,
    };
    let text = |indent: &[u8]| planet_entry(indent, &entry);
    let emitted = Emitted::Planet { id: planet, system };
    write_slot(plan, doc, slot, planets, emitted, text)
}

/// A body of the spec with its name and position, in the order the system lists them:
/// the star, then each planet followed by its moons. An asteroid takes the next of
/// `asteroid_names` and no numeral, and a body with a fixed name takes that and none.
struct Placed<'a> {
    spec: &'a BodySpec,
    name: NameTemplate,
    x: f64,
    y: f64,
    /// The index of the planet a moon orbits.
    parent: Option<usize>,
    /// How far from the star it reaches.
    extent: f64,
}

/// The spec's bodies in the order the system lists them, which is the order
/// [`write_bodies`] gives them their slots in: the star, then each planet followed by its
/// moons.
pub(crate) fn order(spec: &SystemSpec) -> impl Iterator<Item = (SpecBody, &BodySpec)> {
    let planets = spec.planets.iter().enumerate().flat_map(|(of, planet)| {
        let moons = planet
            .moons
            .iter()
            .enumerate()
            .map(move |(index, moon)| (SpecBody::Moon { of, index }, moon));
        std::iter::once((SpecBody::Planet { index: of }, planet)).chain(moons)
    });
    std::iter::once((SpecBody::Star, &spec.star)).chain(planets)
}

/// Where `body` stands in [`order`]; `None` for a body the spec lacks.
pub(crate) fn body_place(spec: &SystemSpec, body: SpecBody) -> Option<usize> {
    order(spec).position(|(at, _)| at == body)
}

/// The ids [`write_bodies`] gives the bodies of each of `specs`, added one after another to
/// `doc` as it stands, each in [`order`]: every body takes the next slot of the planet
/// table, and nothing else an add writes takes one.
pub(crate) fn body_ids(doc: &Document, specs: &[&SystemSpec]) -> Result<Vec<Vec<u32>>, OpError> {
    let mut planets = SlotTable::planets(doc)?;
    Ok(specs
        .iter()
        .map(|spec| order(spec).map(|_| planets.take().id()).collect())
        .collect())
}

fn layout(spec: &SystemSpec, asteroid_names: Vec<NameTemplate>) -> Vec<Placed<'_>> {
    let mut asteroid_names = asteroid_names.into_iter();
    let mut numeral = 0;
    let mut letters = 0;
    let mut placed: Vec<Placed<'_>> = Vec::new();
    // The planet the moons that follow orbit: its place, name and position.
    let mut planet_at: (usize, NameTemplate, (f64, f64)) = (0, NameTemplate::default(), (0.0, 0.0));
    for (at, body) in order(spec) {
        match at {
            SpecBody::Star => {
                let (x, y) = polar(0.0, 0.0, body);
                let name = match spec.star_named_by_class {
                    true => NameTemplate::plain(&spec.name),
                    false => format(STAR_NAME, vec![(NAME_VAR, NameTemplate::plain(&spec.name))]),
                };
                placed.push(Placed {
                    spec: body,
                    name,
                    x,
                    y,
                    parent: None,
                    extent: body.orbit,
                });
            }
            SpecBody::Planet { .. } => {
                let name = match (&body.name, body.asteroid) {
                    (Some(fixed), _) => NameTemplate::plain(fixed),
                    (None, true) => asteroid_names.next().unwrap_or_default(),
                    (None, false) => {
                        numeral += 1;
                        format(
                            PLANET_NAME,
                            vec![
                                (PARENT_VAR, NameTemplate::plain(&spec.name)),
                                (NUMERAL_VAR, literal(&roman(numeral))),
                            ],
                        )
                    }
                };
                let (x, y) = polar(0.0, 0.0, body);
                letters = 0;
                planet_at = (placed.len(), name.clone(), (x, y));
                placed.push(Placed {
                    spec: body,
                    name,
                    x,
                    y,
                    parent: None,
                    extent: body.orbit,
                });
            }
            SpecBody::Moon { of, .. } => {
                let (parent, ref planet_name, (px, py)) = planet_at;
                let (x, y) = polar(px, py, body);
                let name = match &body.name {
                    Some(fixed) => NameTemplate::plain(fixed),
                    None => {
                        letters += 1;
                        format(
                            MOON_NAME,
                            vec![
                                (PARENT_VAR, planet_name.clone()),
                                (NUMERAL_VAR, literal(&letter(letters - 1))),
                            ],
                        )
                    }
                };
                placed.push(Placed {
                    spec: body,
                    name,
                    x,
                    y,
                    parent: Some(parent),
                    extent: spec.planets[of].orbit + body.orbit,
                });
            }
        }
    }
    placed
}

fn check_spec(spec: &SystemSpec) -> Result<(), OpError> {
    if !spec.x.is_finite() || !spec.y.is_finite() {
        return Err(OpError::NotFinite);
    }
    check_contents(spec)
}

/// Everything of the spec but where it stands and its lanes.
pub(crate) fn check_contents(spec: &SystemSpec) -> Result<(), OpError> {
    check_name(&spec.name)?;
    check_text("a star class", &spec.star_class, Form::Bare)?;
    check_text("an initializer", &spec.initializer, Form::Bare)?;
    for flag in &spec.flags {
        check_text("a star flag", flag, Form::Bare)?;
    }
    if !spec.star.moons.is_empty() {
        return Err(OpError::MoonsNotAllowed("the star"));
    }
    if spec.star.asteroid {
        return Err(OpError::AsteroidNotAllowed("the star"));
    }
    if spec.star.name.is_some() {
        return Err(OpError::FixedNameNotAllowed("the star"));
    }
    check_body(&spec.star)?;
    for belt in &spec.belts {
        check_text("a belt type", &belt.kind, Form::Bare)?;
        if !belt.inner_radius.is_finite() {
            return Err(OpError::NotFinite);
        }
    }
    for planet in &spec.planets {
        check_body(planet)?;
        if planet.asteroid && !planet.moons.is_empty() {
            return Err(OpError::MoonsNotAllowed("an asteroid"));
        }
        if planet.asteroid && planet.name.is_some() {
            return Err(OpError::FixedNameNotAllowed(
                "an asteroid named from the pool",
            ));
        }
        for moon in &planet.moons {
            if !moon.moons.is_empty() {
                return Err(OpError::MoonsNotAllowed("a moon"));
            }
            if moon.asteroid {
                return Err(OpError::AsteroidNotAllowed("a moon"));
            }
            if moon.ring {
                return Err(OpError::RingNotAllowed("a moon"));
            }
            check_body(moon)?;
        }
    }
    Ok(())
}

pub(crate) fn check_body(body: &BodySpec) -> Result<(), OpError> {
    check_text("a planet class", &body.class, Form::Bare)?;
    if body.size == 0 {
        return Err(OpError::ZeroPlanetSize);
    }
    if !body.orbit.is_finite() || !body.angle.is_finite() {
        return Err(OpError::NotFinite);
    }
    for deposit in &body.deposits {
        check_deposit_kind(deposit)?;
    }
    if let Some(name) = &body.name {
        check_name(name)?;
    }
    if let Some(entity) = &body.entity_name {
        check_text("an entity name", entity, Form::Bare)?;
    }
    for modifier in &body.modifiers {
        check_text("a modifier", modifier, Form::Bare)?;
    }
    for flag in &body.flags {
        check_text("a planet flag", flag, Form::Bare)?;
    }
    Ok(())
}

/// Within the galaxy's reach (see [`check_reach`]) and no nearer than the game spawns a
/// system to any other.
fn check_place(graph: &GalaxyGraph, x: f64, y: f64) -> Result<(), OpError> {
    check_reach(graph, x, y)?;
    check_apart(
        x,
        y,
        graph
            .systems
            .values()
            .map(|other| (other.id, other.x, other.y)),
    )
}

/// [`check_place`] for each of several new systems, rounded as the op writes them, and each
/// no nearer than the game spawns a system to the new ones before it, the `j`th taking id
/// `first + j`. Nothing is written.
pub(crate) fn check_places(
    graph: &GalaxyGraph,
    first: u32,
    points: &[(f64, f64)],
) -> Result<(), OpError> {
    match place_refusals(graph, first, points)
        .into_iter()
        .flatten()
        .next()
    {
        Some(refused) => Err(refused),
        None => Ok(()),
    }
}

/// Why [`check_places`] refuses each of `points`, or `None` for one it takes.
pub(crate) fn place_refusals(
    graph: &GalaxyGraph,
    first: u32,
    points: &[(f64, f64)],
) -> Vec<Option<OpError>> {
    let points: Vec<(f64, f64)> = points
        .iter()
        .map(|&(x, y)| (rounded(x), rounded(y)))
        .collect();
    points
        .iter()
        .enumerate()
        .map(|(i, &(x, y))| {
            let earlier = (first..)
                .zip(&points[..i])
                .map(|(id, &(ox, oy))| (id, ox, oy));
            check_place(graph, x, y)
                .and_then(|()| check_apart(x, y, earlier))
                .err()
        })
        .collect()
}

/// No nearer to any of `others`, each an id and a position, than the game spawns a system.
fn check_apart(
    x: f64,
    y: f64,
    others: impl Iterator<Item = (u32, f64, f64)>,
) -> Result<(), OpError> {
    let nearest = others
        .map(|(id, ox, oy)| (id, (ox - x).hypot(oy - y)))
        .min_by(|a, b| a.1.total_cmp(&b.1));
    match nearest {
        Some((id, distance)) if distance < SPAWN_BUFFER => Err(OpError::TooClose { id, distance }),
        _ => Ok(()),
    }
}

/// Each lane's other end with the floor of its length, as the generator writes it.
fn lane_lengths(
    graph: &GalaxyGraph,
    id: u32,
    x: f64,
    y: f64,
    targets: &[u32],
) -> Result<Vec<(u32, u32)>, OpError> {
    let mut lanes: Vec<(u32, u32)> = Vec::with_capacity(targets.len());
    for &to in targets {
        let other = graph.systems.get(&to).ok_or(OpError::UnknownSystem(to))?;
        if lanes.iter().any(|&(seen, _)| seen == to) {
            return Err(OpError::DuplicateLane(id, to));
        }
        lanes.push((to, lane_length(other.position(), (x, y)) as u32));
    }
    Ok(lanes)
}
