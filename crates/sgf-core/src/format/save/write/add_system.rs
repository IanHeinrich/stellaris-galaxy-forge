//! `AddSaveSystem`: a new `galactic_object` entry with its belts, its bodies in
//! `planets.planet`, their deposits in `deposit`, its lanes on both ends, the system
//! counter raised, the name taken out of the pool of unused star names and each
//! asteroid's out of the pool of asteroid names. The game builds everything else a
//! spawned system has (construction queues, intel, terra incognita) when it loads.

use crate::archive;
use crate::cst;
use crate::document::Document;
use crate::emit::system::{
    DepositEntry, PlanetEntry, SystemEntry, deposit_entry, planet_entry, system_entry,
};
use crate::emit::{coord, rounded};
use crate::format::save::added::Table;
use crate::format::save::alloc::{self, Slot, SlotTable, TableEnd};
use crate::format::save::system_spec::{BodySpec, SystemSpec};
use crate::format::save::write::asteroid_names::{self, Pool};
use crate::format::save::write::lanes::insert_entries;
use crate::format::scenario::index::removed;
use crate::keys;
use crate::ops::rules::{check_name, quotable};
use crate::ops::{Emitted, Op, OpError, Plan, Planned, Subject};
use crate::overlay::Anchor;
use crate::plural;
use crate::projections::galaxy::GalaxyGraph;
use crate::projections::name::{NameTemplate, NameVariable};
use crate::scan::{self, Value};
use crate::session::Session;
use crate::span::Span;

/// How close the game lets a system it spawns stand to another
/// (`SPAWN_SYSTEM_BUFFER_DISTANCE`).
const SPAWN_BUFFER: f64 = 10.0;
/// The smallest `inner_radius` a system has, and how far past its outermost body the
/// inner radius lies and the outer one past that.
const MIN_INNER_RADIUS: f64 = 150.0;
const INNER_MARGIN: f64 = 30.0;
const OUTER_MARGIN: f64 = 100.0;

const STAR_NAME: &str = "STAR_NAME_1_OF_1";
const PLANET_NAME: &str = "PLANET_NAME_FORMAT";
const MOON_NAME: &str = "SUBPLANET_NAME_FORMAT";
const NAME_VAR: &str = "NAME";
const PARENT_VAR: &str = "PARENT";
const NUMERAL_VAR: &str = "NUMERAL";

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    spec: &SystemSpec,
) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    check_spec(spec)?;
    let id = alloc::next_system(&s.doc, &s.graph)?;
    let (x, y) = (rounded(spec.x), rounded(spec.y));
    check_place(&s.graph, x, y)?;
    let lanes = lane_lengths(&s.graph, id, x, y, &spec.lanes)?;

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

    let extent = layout.iter().map(|b| b.extent).fold(0.0, f64::max);
    let belts: Vec<(&str, f64)> = spec
        .belts
        .iter()
        .map(|belt| (belt.kind.as_str(), belt.inner_radius))
        .collect();
    let inner_radius = MIN_INNER_RADIUS.max(extent + INNER_MARGIN);
    let mut end = systems_end(&s.doc)?;
    let text = system_entry(
        end.indent(),
        &SystemEntry {
            id,
            x,
            y,
            name: &spec.name,
            planets: &ids,
            star_class: &spec.star_class,
            lanes: &lanes,
            belts: &belts,
            initializer: &spec.initializer,
            inner_radius,
            outer_radius: inner_radius + OUTER_MARGIN,
        },
    );
    let text = end.shape(text);
    plan.emit(Emitted::System(id), end.at(), text);
    for &(to, length) in &lanes {
        insert_entries(plan.edit(&s.doc, to)?, &[(id, length, false)])?;
    }

    let counter = alloc::system_counter(&s.doc)?;
    let edit = plan.edit_record(&s.doc, counter.anchor)?;
    let span = edit
        .entity()?
        .scalar_span()
        .ok_or_else(|| edit.parse_error(0, "last_created_system is not a scalar"))?;
    edit.splices
        .push((span.range(), id.to_string().into_bytes()));
    let src = s.doc.original();
    let unused = pool_entries(&s.doc, &spec.name)
        .into_iter()
        .find(|&entry| !removed(s.doc.overlay(), entry, src));
    if let Some(entry) = unused {
        plan.erase(&s.doc, Subject::Record(entry), entry)?;
    }
    for entry in picks.iter().filter_map(|pick| pick.entry) {
        plan.erase(&s.doc, Subject::Record(entry), entry)?;
    }

    let mut bodies = match layout.len() {
        1 => "1 body".to_owned(),
        n => format!("{n} bodies"),
    };
    if !spec.belts.is_empty() {
        bodies = format!("{bodies}, {}", plural(spec.belts.len(), "belt"));
    }
    Ok(Planned {
        description: format!(
            "Added {} (#{id}) at ({}, {}) with {bodies} and {}",
            spec.name,
            coord(x),
            coord(y),
            plural(lanes.len(), "lane")
        ),
        inverse: Op::RemoveSystem { id },
    })
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
            .ok_or(OpError::MissingSaveKey(keys::DEPOSIT))?;
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
    let entry = PlanetEntry {
        id: planet,
        class: &body.spec.class,
        size: body.spec.size,
        star: body.star,
        name: body.name,
        x: body.x,
        y: body.y,
        system,
        orbit: body.spec.orbit,
        moon_of: body.moon_of,
        moons: &body.moons,
        entity: body.spec.entity,
        deposits: &held,
    };
    let text = |indent: &[u8]| planet_entry(indent, &entry);
    let emitted = Emitted::Planet { id: planet, system };
    write_slot(plan, doc, slot, planets, emitted, text)
}

/// Write an entry where `slot` stands: in place of its tombstone, indented as that was,
/// or at the end of `table`.
fn write_slot(
    plan: &mut Plan,
    doc: &Document,
    slot: Slot,
    table: &mut SlotTable,
    emitted: Emitted,
    entry: impl Fn(&[u8]) -> Vec<u8>,
) -> Result<(), OpError> {
    match slot {
        Slot::Reused {
            tombstone: tombstone @ Anchor::Original(_),
            ..
        } => {
            let indent = cst::indent_of(doc.original(), tombstone.start());
            let mut text = entry(indent);
            text.pop();
            text.drain(..indent.len());
            plan.replace(doc, emitted.subject(tombstone), tombstone, text)
        }
        // A tombstone a removal left in an appended slot carries its line with it.
        Slot::Reused { tombstone, .. } => {
            let subject = emitted.subject(tombstone);
            let current = doc.current(tombstone)?;
            let span = alloc::statement_span(current)
                .ok_or_else(|| subject.parse_error(0, "the tombstone holds no statement"))?;
            let indent = cst::indent_of(current, span.start);
            let mut text = entry(indent);
            text.pop();
            text.drain(..indent.len());
            let bytes = [&current[..span.start], &text[..], &current[span.end..]].concat();
            plan.replace(doc, subject, tombstone, bytes)
        }
        Slot::Appended { .. } => {
            let text = table.end.shape(entry(table.end.indent()));
            plan.emit(emitted, table.end.at(), text);
            Ok(())
        }
    }
}

/// A body of the spec with its name and position, in the order the system lists them:
/// the star, then each planet followed by its moons. An asteroid takes the next of
/// `asteroid_names` and no numeral.
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

fn layout(spec: &SystemSpec, asteroid_names: Vec<NameTemplate>) -> Vec<Placed<'_>> {
    let mut asteroid_names = asteroid_names.into_iter();
    let mut numeral = 0;
    let (sx, sy) = polar(0.0, 0.0, &spec.star);
    let mut placed = vec![Placed {
        spec: &spec.star,
        name: format(STAR_NAME, vec![(NAME_VAR, NameTemplate::plain(&spec.name))]),
        x: sx,
        y: sy,
        parent: None,
        extent: spec.star.orbit,
    }];
    for planet in &spec.planets {
        let name = match planet.asteroid {
            true => asteroid_names.next().unwrap_or_default(),
            false => {
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
        let (px, py) = polar(0.0, 0.0, planet);
        let parent = placed.len();
        for (j, moon) in planet.moons.iter().enumerate() {
            let (mx, my) = polar(px, py, moon);
            placed.push(Placed {
                spec: moon,
                name: format(
                    MOON_NAME,
                    vec![
                        (PARENT_VAR, name.clone()),
                        (NUMERAL_VAR, literal(&letter(j))),
                    ],
                ),
                x: mx,
                y: my,
                parent: Some(parent),
                extent: planet.orbit + moon.orbit,
            });
        }
        placed.insert(
            parent,
            Placed {
                spec: planet,
                name,
                x: px,
                y: py,
                parent: None,
                extent: planet.orbit,
            },
        );
    }
    placed
}

/// Where a body stands: `orbit` from (x, y) at `angle` degrees.
fn polar(x: f64, y: f64, body: &BodySpec) -> (f64, f64) {
    let angle = body.angle.to_radians();
    (x + body.orbit * angle.cos(), y + body.orbit * angle.sin())
}

fn format(key: &str, variables: Vec<(&str, NameTemplate)>) -> NameTemplate {
    NameTemplate {
        key: key.to_owned(),
        literal: false,
        variables: variables
            .into_iter()
            .map(|(name, value)| NameVariable {
                name: name.to_owned(),
                value,
            })
            .collect(),
    }
}

fn literal(text: &str) -> NameTemplate {
    NameTemplate {
        literal: true,
        ..NameTemplate::plain(text)
    }
}

fn roman(mut n: usize) -> String {
    const NUMERALS: [(usize, &str); 13] = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut out = String::new();
    for (value, numeral) in NUMERALS {
        while n >= value {
            out.push_str(numeral);
            n -= value;
        }
    }
    out
}

/// `a`, `b`, … `z`, `aa`, `ab`, …
fn letter(index: usize) -> String {
    let this = char::from(b'a' + (index % 26) as u8);
    match index / 26 {
        0 => this.to_string(),
        n => format!("{}{this}", letter(n - 1)),
    }
}

/// Only a 4.x save: a 3.x system carries an `arm` and more that nothing here writes.
/// The version is `Cygnus v4.5.0` or a bare `4.5.0`; one whose major number cannot be
/// read is refused too.
fn check_version(doc: &Document) -> Result<(), OpError> {
    let version = archive::parse_meta(doc.meta())
        .map(|meta| meta.version)
        .unwrap_or_default();
    let major = version
        .split_whitespace()
        .next_back()
        .map(|number| number.trim_start_matches(['v', 'V']))
        .and_then(|number| number.split('.').next()?.parse::<u32>().ok());
    match major {
        Some(major) if major >= 4 => Ok(()),
        Some(_) => Err(OpError::SaveTooOld(version)),
        None => Err(OpError::UnknownSaveVersion(version)),
    }
}

fn check_spec(spec: &SystemSpec) -> Result<(), OpError> {
    check_name(&spec.name)?;
    if !spec.x.is_finite() || !spec.y.is_finite() {
        return Err(OpError::NotFinite);
    }
    if spec.star_class.is_empty() {
        return Err(OpError::EmptyStarClass);
    }
    check_text(&spec.star_class)?;
    if spec.initializer.is_empty() {
        return Err(OpError::EmptyKey("an initializer"));
    }
    check_text(&spec.initializer)?;
    if !spec.star.moons.is_empty() {
        return Err(OpError::MoonsNotAllowed("the star"));
    }
    if spec.star.asteroid {
        return Err(OpError::AsteroidNotAllowed("the star"));
    }
    check_body(&spec.star)?;
    for belt in &spec.belts {
        if belt.kind.is_empty() {
            return Err(OpError::EmptyKey("a belt type"));
        }
        check_text(&belt.kind)?;
        if !belt.inner_radius.is_finite() {
            return Err(OpError::NotFinite);
        }
    }
    for planet in &spec.planets {
        check_body(planet)?;
        if planet.asteroid && !planet.moons.is_empty() {
            return Err(OpError::MoonsNotAllowed("an asteroid"));
        }
        for moon in &planet.moons {
            if !moon.moons.is_empty() {
                return Err(OpError::MoonsNotAllowed("a moon"));
            }
            if moon.asteroid {
                return Err(OpError::AsteroidNotAllowed("a moon"));
            }
            check_body(moon)?;
        }
    }
    Ok(())
}

fn check_body(body: &BodySpec) -> Result<(), OpError> {
    if body.class.is_empty() {
        return Err(OpError::EmptyBodyClass);
    }
    check_text(&body.class)?;
    if body.size == 0 {
        return Err(OpError::ZeroPlanetSize);
    }
    if !body.orbit.is_finite() || !body.angle.is_finite() {
        return Err(OpError::NotFinite);
    }
    for deposit in &body.deposits {
        if deposit.is_empty() {
            return Err(OpError::EmptyKey("a deposit type"));
        }
        check_text(deposit)?;
    }
    Ok(())
}

fn check_text(text: &str) -> Result<(), OpError> {
    if !quotable(text) {
        return Err(OpError::InvalidKey(text.to_owned()));
    }
    Ok(())
}

/// Inside the galaxy's radius, when the save records one, and no nearer than the game
/// spawns a system to any other.
fn check_place(graph: &GalaxyGraph, x: f64, y: f64) -> Result<(), OpError> {
    let radius = graph.galaxy_radius;
    if radius > 0.0 && x.hypot(y) > radius {
        return Err(OpError::OutsideGalaxy { x, y, radius });
    }
    let nearest = graph
        .systems
        .values()
        .map(|other| (other.id, (other.x - x).hypot(other.y - y)))
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
        lanes.push((to, (other.x - x).hypot(other.y - y).floor() as u32));
    }
    Ok(lanes)
}

/// Where a new `galactic_object` entry goes, and how the entries it joins are indented.
fn systems_end(doc: &Document) -> Result<TableEnd, OpError> {
    let missing = OpError::MissingSaveKey(keys::GALACTIC_OBJECT);
    let section = doc.index().section(keys::GALACTIC_OBJECT).ok_or(missing)?;
    let Value::Block { close, .. } = section.value else {
        return Err(OpError::MissingSaveKey(keys::GALACTIC_OBJECT));
    };
    let entities = doc.index().entities(keys::GALACTIC_OBJECT);
    Ok(TableEnd::read(doc, Table::System, close, entities))
}

/// Every entry of the save's pool of unused star names, as loaded, that holds `name`,
/// in file order, whether an add has since taken it or not.
pub(crate) fn pool_entries(doc: &Document, name: &str) -> Vec<Anchor> {
    let src = doc.original();
    pool(doc)
        .into_iter()
        .filter(|span| scan::unquote(span.slice(src)) == name.as_bytes())
        .map(Anchor::Original)
        .collect()
}

/// The names left in the save's pool of unused star names, in file order; empty when the
/// save has no pool.
pub fn free_star_names(doc: &Document) -> Vec<String> {
    let src = doc.original();
    pool(doc)
        .into_iter()
        .filter(|&span| !removed(doc.overlay(), Anchor::Original(span), src))
        .map(|span| String::from_utf8_lossy(scan::unquote(span.slice(src))).into_owned())
        .collect()
}

/// Each entry of the pool as loaded, as the span of its name.
fn pool(doc: &Document) -> Vec<Span> {
    asteroid_names::name_lists(doc, keys::STAR_NAMES)
        .into_iter()
        .next()
        .unwrap_or_default()
}
