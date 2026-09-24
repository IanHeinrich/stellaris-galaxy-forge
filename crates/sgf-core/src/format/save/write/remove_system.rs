//! `RemoveSystem` and `RemoveSystems` on a save, for the systems [`super::add_system`]
//! wrote since the file was opened; a system the file held when it was opened is refused.
//!
//! What the add wrote comes out again: the `galactic_object` entry, each body's entry and
//! its deposits' entries, where a tombstone's slot gets the tombstone back and an appended
//! slot below the end of its table becomes a tombstone, the lanes on
//! the other ends, the nebula member lines, the count of a capped layout, the name taken
//! from the pool of unused star or black hole names and the asteroids' names taken from the pool of
//! asteroid names. `last_created_system` goes down by one per system removed. Every system
//! added after the first one removed takes the id below its own for each removed before
//! it, so the ids stay dense: its entry's key, its bodies' `coordinate.origin`, the lanes
//! and the nebula member lines naming it. Planet and deposit ids do not change.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::as_u32;
use crate::cst::{self, Node};
use crate::document::Document;
use crate::emit::coord;
use crate::emit::system::RING_FLAG;
use crate::format::save::added::Table;
use crate::format::save::alloc::{self, Counter, SlotTable};
use crate::format::save::system_spec::{BeltSpec, BodySpec, SystemSpec};
use crate::format::save::write::add_system::polar;
use crate::format::save::write::asteroid_names::{self, Pool};
use crate::format::save::write::initializer_counter::{self, counted};
use crate::format::save::write::lanes::remove_entries;
use crate::format::save::write::name_pool::{self, SYSTEM_POOLS};
use crate::format::save::{planet_statement, system_statement};
use crate::format::scenario::index::removed as emptied;
use crate::keys;
use crate::ops::rules::each_once;
use crate::ops::{Edit, Op, OpError, Plan, Planned, Subject};
use crate::overlay::Anchor;
use crate::plural;
use crate::projections::read;
use crate::session::Session;

pub(crate) fn plan_remove(plan: &mut Plan, s: &Session, ids: &[u32]) -> Result<Planned, OpError> {
    each_once(ids, |&id| id)?;
    for &id in ids {
        check_added(s, id)?;
    }
    let removed: BTreeSet<u32> = ids.iter().copied().collect();
    let counter = alloc::system_counter(&s.doc)?;
    let renumber = renumbering(s, &removed, counter.last)?;
    let inverse = restoring(s, &removed, &renumber)?;
    let description = describe(s, &removed, &renumber);

    erase_systems(plan, &s.doc, &removed)?;
    for &id in &removed {
        plan.renumber(id, None);
    }
    for (&old, &new) in &renumber {
        plan.renumber(old, Some(new));
        for planet in bodies(&s.doc, old)? {
            plan.edit_planet(&s.doc, planet, new)?
                .set_scalar(&[keys::COORDINATE, keys::ORIGIN], new.to_string())?;
        }
    }
    rewrite_lanes(plan, s, &removed, &renumber)?;
    rewrite_members(plan, s, &removed, &renumber)?;
    let last =
        counter
            .last
            .checked_sub(as_u32(removed.len()))
            .ok_or(OpError::SystemIdsNotDense {
                last: counter.last,
                count: s.graph.systems.len(),
            })?;
    set_counter(plan, &s.doc, &counter, last)?;
    uncount(plan, s, &removed)?;
    return_names(plan, s, &removed)?;
    return_asteroid_names(plan, s, &removed)?;
    Ok(Planned {
        description,
        inverse,
    })
}

pub(crate) fn check_added(s: &Session, id: u32) -> Result<(), OpError> {
    if s.doc.added().get(Table::System, id).is_some() {
        Ok(())
    } else if s.graph.systems.contains_key(&id) {
        Err(OpError::SystemNotAdded(id))
    } else {
        Err(OpError::UnknownSystem(id))
    }
}

/// The id each system after the first removed one takes, refused unless every one of them
/// is a system an op added: the ones the file held come first, so that cannot happen while
/// the ids are dense.
fn renumbering(
    s: &Session,
    removed: &BTreeSet<u32>,
    last: u32,
) -> Result<BTreeMap<u32, u32>, OpError> {
    let not_dense = || OpError::SystemIdsNotDense {
        last,
        count: s.graph.systems.len(),
    };
    let (Some(&first), Some(&highest)) = (removed.first(), removed.last()) else {
        return Ok(BTreeMap::new());
    };
    if highest > last {
        return Err(not_dense());
    }
    let mut renumber = BTreeMap::new();
    let mut gone = 0;
    for id in first..=last {
        if removed.contains(&id) {
            gone += 1;
        } else if s.doc.added().get(Table::System, id).is_some() {
            renumber.insert(id, id - gone);
        } else {
            return Err(not_dense());
        }
    }
    Ok(renumber)
}

/// Take out each system's entry and its bodies' and their deposits' entries.
fn erase_systems(plan: &mut Plan, doc: &Document, ids: &BTreeSet<u32>) -> Result<(), OpError> {
    erase_bodies(plan, doc, ids)?;
    for &id in ids {
        let anchor = system_statement(doc, id).ok_or(OpError::UnknownSystem(id))?;
        plan.erase(doc, Subject::System(id), anchor)?;
    }
    Ok(())
}

/// Take out the entries of each system's bodies an op added, and their deposits'.
pub(crate) fn erase_bodies(
    plan: &mut Plan,
    doc: &Document,
    ids: &BTreeSet<u32>,
) -> Result<(), OpError> {
    let mut planets = BTreeMap::new();
    let mut deposits = BTreeMap::new();
    for &id in ids {
        for planet in bodies(doc, id)? {
            let Some(slot) = doc.added().get(Table::Planet, planet) else {
                continue;
            };
            let subject = Subject::Planet {
                id: planet,
                system: id,
            };
            let (node, src) = entity(doc, subject, slot)?;
            for deposit in read::ids(&node, keys::DEPOSITS, src) {
                if let Some(held) = doc.added().get(Table::Deposit, deposit) {
                    free(
                        plan,
                        doc,
                        Subject::Record(held),
                        deposit,
                        held,
                        &mut deposits,
                    )?;
                }
            }
            free(plan, doc, subject, planet, slot, &mut planets)?;
        }
    }
    if !planets.is_empty() {
        free_appended(plan, doc, SlotTable::planets(doc)?.end.at(), &planets)?;
    }
    if !deposits.is_empty() {
        free_appended(plan, doc, SlotTable::deposits(doc)?.end.at(), &deposits)?;
    }
    Ok(())
}

/// Take back what an add wrote as entity `id` in place of a tombstone: the tombstone the
/// file held, as loaded, or the one a removal wrote over an entry the file held. An entry
/// an add appended is left in `appended` for [`free_appended`].
pub(crate) fn free(
    plan: &mut Plan,
    doc: &Document,
    subject: Subject,
    id: u32,
    slot: Anchor,
    appended: &mut BTreeMap<Anchor, Subject>,
) -> Result<(), OpError> {
    match slot {
        Anchor::Inserted { .. } => {
            appended.insert(slot, subject);
            Ok(())
        }
        Anchor::Original(span) => {
            let loaded = span.slice(doc.original());
            let bytes = match alloc::tombstone_of(loaded) {
                Some(_) => loaded.to_vec(),
                None => alloc::tombstone(alloc::tombstone_id(id)).into_bytes(),
            };
            plan.replace(doc, subject, slot, bytes)
        }
    }
}

/// The entries `leaving` of the table whose appended entries go at `at`. The game leaves
/// no slot missing below the highest, so only the end of the table can shrink: from the
/// last entry back, each leaving entry, and each tombstone an earlier removal left, is
/// deleted until a live one stands. Every other leaving entry becomes a tombstone, in the
/// table's `<id>=none` form, holding the id its slot held before the add took it.
pub(crate) fn free_appended(
    plan: &mut Plan,
    doc: &Document,
    at: usize,
    leaving: &BTreeMap<Anchor, Subject>,
) -> Result<(), OpError> {
    let mut at_end = true;
    for entry in alloc::appended(doc, at).into_iter().rev() {
        let subject = leaving.get(&entry.anchor).copied();
        if at_end && (subject.is_some() || entry.dead) {
            let subject = subject.unwrap_or(Subject::Record(entry.anchor));
            plan.erase(doc, subject, entry.anchor)?;
            continue;
        }
        at_end = false;
        let Some(subject) = subject else {
            continue;
        };
        let current = doc.current(entry.anchor)?;
        let span = alloc::statement_span(current)
            .ok_or_else(|| subject.parse_error(0, "the entry holds no statement"))?;
        let tombstone = alloc::tombstone(alloc::tombstone_id(entry.id));
        let bytes = [
            &current[..span.start],
            tombstone.as_bytes(),
            &current[span.end..],
        ]
        .concat();
        plan.replace(doc, subject, entry.anchor, bytes)?;
    }
    Ok(())
}

/// Every surviving system's lanes: an entry to a removed system goes, and one to a
/// renumbered system names its new id. A renumbered system's own key changes too.
fn rewrite_lanes(
    plan: &mut Plan,
    s: &Session,
    removed: &BTreeSet<u32>,
    renumber: &BTreeMap<u32, u32>,
) -> Result<(), OpError> {
    for &id in &s.graph.order {
        if removed.contains(&id) {
            continue;
        }
        let Some(system) = s.graph.systems.get(&id) else {
            continue;
        };
        let cut: Vec<u32> = system
            .lanes
            .iter()
            .map(|lane| lane.to)
            .filter(|to| removed.contains(to))
            .collect();
        let retarget = system.lanes.iter().any(|l| renumber.contains_key(&l.to));
        let new = renumber.get(&id).copied();
        if cut.is_empty() && !retarget && new.is_none() {
            continue;
        }
        let edit = plan.edit(&s.doc, id)?;
        if !cut.is_empty() {
            remove_entries(edit, &cut)?;
        }
        if retarget {
            retarget_entries(edit, renumber)?;
        }
        if let Some(new) = new {
            let key = edit
                .entity()?
                .key
                .ok_or_else(|| edit.parse_error(0, "the system has no key"))?;
            edit.splices
                .push((key.range(), new.to_string().into_bytes()));
        }
    }
    Ok(())
}

/// Rewrite the `to` of every lane entry naming a renumbered system.
fn retarget_entries(edit: &mut Edit, renumber: &BTreeMap<u32, u32>) -> Result<(), OpError> {
    let Some(block) = edit.hyperlane()? else {
        return Ok(());
    };
    let mut splices = Vec::new();
    for entry in block.children() {
        let Some(&new) = edit.lane_to(entry).and_then(|to| renumber.get(&to)) else {
            continue;
        };
        let span = entry
            .find(keys::TO, &edit.buf)
            .and_then(Node::scalar_span)
            .ok_or_else(|| edit.parse_error(entry.span().start, "lane entry has no to"))?;
        splices.push((span.range(), new.to_string().into_bytes()));
    }
    edit.splices.extend(splices);
    Ok(())
}

/// Every nebula's member lines: a removed system's goes, and a renumbered one's names its
/// new id, which keeps the list ascending.
fn rewrite_members(
    plan: &mut Plan,
    s: &Session,
    removed: &BTreeSet<u32>,
    renumber: &BTreeMap<u32, u32>,
) -> Result<(), OpError> {
    for (index, nebula) in s.graph.nebulae.iter().enumerate() {
        let named = |id: &u32| removed.contains(id) || renumber.contains_key(id);
        if !nebula.systems.iter().any(named) {
            continue;
        }
        let edit = plan.edit_nebula(&s.doc, index)?;
        let mut cut = Vec::new();
        let mut splices = Vec::new();
        for member in edit.entity()?.find_all(keys::GALACTIC_OBJECT, &edit.buf) {
            let (Some(span), Some(id)) = (
                member.scalar_span(),
                member
                    .scalar_str(&edit.buf)
                    .and_then(|t| t.parse::<u32>().ok()),
            ) else {
                continue;
            };
            if removed.contains(&id) {
                cut.push(member.span());
            } else if let Some(new) = renumber.get(&id) {
                splices.push((span.range(), new.to_string().into_bytes()));
            }
        }
        for &span in &cut {
            edit.require_alone_on_line(span, "member line")?;
        }
        for span in cut {
            edit.remove_lines(span);
        }
        edit.splices.extend(splices);
    }
    Ok(())
}

fn set_counter(
    plan: &mut Plan,
    doc: &Document,
    counter: &Counter,
    last: u32,
) -> Result<(), OpError> {
    let edit = plan.edit_record(doc, counter.anchor)?;
    let span = edit
        .entity()?
        .scalar_span()
        .ok_or_else(|| edit.parse_error(0, "last_created_system is not a scalar"))?;
    edit.splices
        .push((span.range(), last.to_string().into_bytes()));
    Ok(())
}

/// Take one off the count of each removed system's layout that its add counted.
pub(crate) fn uncount(
    plan: &mut Plan,
    s: &Session,
    removed: &BTreeSet<u32>,
) -> Result<(), OpError> {
    let mut changes: BTreeMap<&str, i64> = BTreeMap::new();
    for id in removed {
        let Some(system) = s.graph.systems.get(id) else {
            continue;
        };
        if counted(&s.doc, &system.initializer) {
            *changes.entry(system.initializer.as_str()).or_default() -= 1;
        }
    }
    initializer_counter::count(plan, &s.doc, &changes)
}

/// Put a removed system's name back in the pool of unused star or black hole names its
/// add took it from. Adds take the pools' entries for a name first to last, so of the
/// entries taken, as many stay taken as systems of that name stay, and the rest come back,
/// last first, as the bytes they were loaded as.
fn return_names(plan: &mut Plan, s: &Session, removed: &BTreeSet<u32>) -> Result<(), OpError> {
    let name = |id: &u32| {
        s.graph
            .systems
            .get(id)
            .map(|system| system.name.key.as_str())
    };
    let names: BTreeSet<&str> = removed.iter().filter_map(name).collect();
    for pooled in names {
        let staying = s
            .doc
            .added()
            .entries(Table::System)
            .filter(|(id, _)| !removed.contains(id) && name(id) == Some(pooled))
            .count();
        name_pool::give_back(plan, &s.doc, SYSTEM_POOLS, pooled, staying)?;
    }
    Ok(())
}

/// Put a removed asteroid's name back in its prefix's block when its add took it from
/// there, as [`return_names`] does for a star name: of the entries taken for a name, as
/// many stay taken as the asteroids an add wrote that stay hold it.
pub(crate) fn return_asteroid_names(
    plan: &mut Plan,
    s: &Session,
    removed: &BTreeSet<u32>,
) -> Result<(), OpError> {
    let mut leaving_planets = BTreeSet::new();
    for &id in removed {
        leaving_planets.extend(bodies(&s.doc, id)?);
    }
    let mut leaving = BTreeSet::new();
    let mut staying: BTreeMap<(String, String), usize> = BTreeMap::new();
    for (planet, slot) in s.doc.added().entries(Table::Planet) {
        let Ok((node, src)) = entity(&s.doc, Subject::Record(slot), slot) else {
            continue;
        };
        let name = read::name(&node, src);
        let Some((prefix, suffix)) = asteroid_names::parts(&name) else {
            continue;
        };
        let held = (prefix.to_owned(), suffix.to_owned());
        if leaving_planets.contains(&planet) {
            leaving.insert(held);
        } else {
            *staying.entry(held).or_default() += 1;
        }
    }
    if leaving.is_empty() {
        return Ok(());
    }
    let pool = Pool::read(&s.doc);
    let src = s.doc.original();
    for held in leaving {
        let taken: Vec<Anchor> = pool
            .entries(&held.0, &held.1, src)
            .into_iter()
            .filter(|&entry| emptied(s.doc.overlay(), entry, src))
            .collect();
        let keep = staying.get(&held).copied().unwrap_or(0);
        name_pool::put_back(plan, &s.doc, taken.iter().skip(keep))?;
    }
    Ok(())
}

/// The belts system `id`'s entry lists, in order.
fn belts(doc: &Document, id: u32) -> Result<Vec<BeltSpec>, OpError> {
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
    Ok(node
        .find_all(keys::PLANET, src)
        .filter_map(|planet| planet.scalar_str(src)?.parse().ok())
        .collect())
}

/// The `<id>=` node the bytes standing at `anchor` hold, with those bytes.
pub(crate) fn entity(
    doc: &Document,
    subject: Subject,
    anchor: Anchor,
) -> Result<(Node, &[u8]), OpError> {
    let src = doc.current(anchor)?;
    let root = cst::parse(src, 0).map_err(|e| subject.parse_error(e.offset, e.reason))?;
    let node = root
        .children()
        .first()
        .cloned()
        .ok_or_else(|| subject.parse_error(0, "empty statement"))?;
    Ok((node, src))
}

fn describe(s: &Session, removed: &BTreeSet<u32>, renumber: &BTreeMap<u32, u32>) -> String {
    let ids: Vec<u32> = removed.iter().copied().collect();
    let what = match ids.as_slice() {
        &[id] => {
            let name = s.graph.systems.get(&id).map(|system| system.display_name());
            format!("{} (#{id})", name.unwrap_or_default())
        }
        ids => {
            let listed: Vec<String> = ids.iter().map(|id| format!("#{id}")).collect();
            format!("{} ({})", plural(ids.len(), "system"), listed.join(", "))
        }
    };
    let lanes: BTreeSet<(u32, u32)> = removed
        .iter()
        .filter_map(|id| s.graph.systems.get(id))
        .flat_map(|system| {
            system
                .lanes
                .iter()
                .map(move |lane| (system.id.min(lane.to), system.id.max(lane.to)))
        })
        .collect();
    let mut text = format!("Removed {what} and {}", plural(lanes.len(), "lane"));
    if !renumber.is_empty() {
        let moves: Vec<String> = renumber
            .iter()
            .map(|(old, new)| format!("{old} to {new}"))
            .collect();
        text.push_str(&format!("; renumbered {}", moves.join(", ")));
    }
    text
}

/// The op that adds the removed systems back: each read back as a spec, in id order, at
/// the ids that then follow the last one, with its lanes to the systems that stay (at
/// their new ids) and to the ones re-added before it. A lane's bridge flag is not kept.
fn restoring(
    s: &Session,
    removed: &BTreeSet<u32>,
    renumber: &BTreeMap<u32, u32>,
) -> Result<Op, OpError> {
    let staying = as_u32(s.graph.systems.len() - removed.len());
    let readded: HashMap<u32, u32> = removed
        .iter()
        .enumerate()
        .map(|(i, &id)| (id, staying + as_u32(i)))
        .collect();
    let mut adds = Vec::with_capacity(removed.len());
    for &id in removed {
        let system = s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
        let mut lanes = Vec::new();
        for lane in &system.lanes {
            let to = match readded.get(&lane.to) {
                Some(&again) if again < readded[&id] => again,
                Some(_) => continue,
                None if s.graph.systems.contains_key(&lane.to) => {
                    renumber.get(&lane.to).copied().unwrap_or(lane.to)
                }
                None => continue,
            };
            if !lanes.contains(&to) {
                lanes.push(to);
            }
        }
        adds.push(Op::AddSaveSystem {
            spec: spec_of(s, id, lanes)?,
        });
    }
    Ok(match adds.len() {
        1 => adds.remove(0),
        n => Op::Batch {
            description: format!("Added {}", plural(n, "system")),
            ops: adds,
        },
    })
}

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
    let modifiers = node
        .find(keys::TIMED_MODIFIER, src)
        .and_then(|block| block.find(keys::ITEMS, src))
        .map(|items| {
            items
                .children()
                .iter()
                .map(|item| read::text(item, keys::MODIFIER, src))
                .collect()
        })
        .unwrap_or_default();
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
    })
}

/// The `type` of a deposit an op added.
fn deposit_kind(doc: &Document, id: u32) -> Option<String> {
    let anchor = doc.added().get(Table::Deposit, id)?;
    let (node, src) = entity(doc, Subject::Record(anchor), anchor).ok()?;
    read::scalar(&node, keys::TYPE, src).map(str::to_owned)
}
