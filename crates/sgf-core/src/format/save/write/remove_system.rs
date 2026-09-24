//! `RemoveSystem` and `RemoveSystems` on a save, for the systems [`super::add_system`]
//! wrote since the file was opened; a system the file held when it was opened is refused.
//!
//! What the add wrote comes out again: the `galactic_object` entry, each body's entry and
//! its deposits' entries, where a tombstone's slot gets the tombstone back, the lanes on
//! the other ends, the nebula member lines, and the name taken from the pool of unused
//! star names. `last_created_system` goes down by one per system removed. Every system
//! added after the first one removed takes the id below its own for each removed before
//! it, so the ids stay dense: its entry's key, its bodies' `coordinate.origin`, the lanes
//! and the nebula member lines naming it. Planet and deposit ids do not change.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::as_u32;
use crate::cst::{self, Node};
use crate::document::Document;
use crate::format::save::added::Table;
use crate::format::save::alloc::{self, Counter};
use crate::format::save::system_spec::{BodySpec, SystemSpec};
use crate::format::save::write::add_system::pool_entries;
use crate::format::save::write::lanes::remove_entries;
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

    for &id in &removed {
        erase_system(plan, &s.doc, id)?;
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
    return_names(plan, s, &removed)?;
    Ok(Planned {
        description,
        inverse,
    })
}

fn check_added(s: &Session, id: u32) -> Result<(), OpError> {
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

/// Take out system `id`'s entry and its bodies' and their deposits' entries.
fn erase_system(plan: &mut Plan, doc: &Document, id: u32) -> Result<(), OpError> {
    let anchor = system_statement(doc, id).ok_or(OpError::UnknownSystem(id))?;
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
                free(plan, doc, Subject::Record(held), held)?;
            }
        }
        free(plan, doc, subject, slot)?;
    }
    plan.erase(doc, Subject::System(id), anchor)
}

/// Take back what an add wrote at `slot`: an inserted entry goes, and a tombstone's slot
/// holds its tombstone again, as loaded.
fn free(plan: &mut Plan, doc: &Document, subject: Subject, slot: Anchor) -> Result<(), OpError> {
    match slot {
        Anchor::Inserted { .. } => plan.erase(doc, subject, slot),
        Anchor::Original(span) => {
            plan.replace(doc, subject, slot, span.slice(doc.original()).to_vec())
        }
    }
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

/// Put a removed system's name back in the pool of unused star names when its add took it
/// from there. Adds take the pool's entries for a name first to last, so of the entries
/// taken, as many stay taken as systems of that name stay, and the rest come back, last
/// first, as the bytes they were loaded as.
fn return_names(plan: &mut Plan, s: &Session, removed: &BTreeSet<u32>) -> Result<(), OpError> {
    let name = |id: &u32| {
        s.graph
            .systems
            .get(id)
            .map(|system| system.name.key.as_str())
    };
    let names: BTreeSet<&str> = removed.iter().filter_map(name).collect();
    let src = s.doc.original();
    for pooled in names {
        let staying = s
            .doc
            .added()
            .entries(Table::System)
            .filter(|(id, _)| !removed.contains(id) && name(id) == Some(pooled))
            .count();
        let taken: Vec<Anchor> = pool_entries(&s.doc, pooled)
            .into_iter()
            .filter(|&entry| emptied(s.doc.overlay(), entry, src))
            .collect();
        for &entry in taken.iter().skip(staying) {
            let Some(slot @ Anchor::Original(span)) = slot_holding(&s.doc, entry) else {
                continue;
            };
            plan.replace(
                &s.doc,
                Subject::Record(slot),
                slot,
                span.slice(src).to_vec(),
            )?;
        }
    }
    Ok(())
}

/// The original slot an erasure left `entry` in: its own span, or its line.
fn slot_holding(doc: &Document, entry: Anchor) -> Option<Anchor> {
    doc.overlay().slots().map(|(slot, _)| slot).find(|slot| {
        matches!(slot, Anchor::Original(span)
            if span.start <= entry.start() && entry.end() <= span.end)
    })
}

/// The planets system `id`'s entry lists, star first.
fn bodies(doc: &Document, id: u32) -> Result<Vec<u32>, OpError> {
    let anchor = system_statement(doc, id).ok_or(OpError::UnknownSystem(id))?;
    let (node, src) = entity(doc, Subject::System(id), anchor)?;
    Ok(node
        .find_all(keys::PLANET, src)
        .filter_map(|planet| planet.scalar_str(src)?.parse().ok())
        .collect())
}

/// The `<id>=` node the bytes standing at `anchor` hold, with those bytes.
fn entity(doc: &Document, subject: Subject, anchor: Anchor) -> Result<(Node, &[u8]), OpError> {
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
/// angle measured from the star, or from its planet for a moon.
fn spec_of(s: &Session, id: u32, lanes: Vec<u32>) -> Result<SystemSpec, OpError> {
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
    let mut planet_at: HashMap<u32, (usize, f64, f64)> = HashMap::new();
    for (planet, body) in rest {
        match body.moon_of.and_then(|parent| planet_at.get(&parent)) {
            Some(&(at, x, y)) => planets[at].moons.push(body.spec(x, y)),
            None => {
                planet_at.insert(*planet, (planets.len(), body.x, body.y));
                planets.push(body.spec(0.0, 0.0));
            }
        }
    }
    Ok(SystemSpec {
        name: system.name.key.clone(),
        x: system.x,
        y: system.y,
        star_class: system.star_class.clone(),
        initializer: system.initializer.clone(),
        star: star.spec(0.0, 0.0),
        planets,
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
}

impl ReadBody {
    /// The body as it orbits (`x`, `y`).
    fn spec(&self, x: f64, y: f64) -> BodySpec {
        let angle = (self.y - y)
            .atan2(self.x - x)
            .to_degrees()
            .rem_euclid(360.0)
            + 0.0;
        BodySpec {
            class: self.class.clone(),
            size: self.size,
            orbit: self.orbit,
            angle,
            entity: self.entity,
            deposits: self.deposits.clone(),
            moons: Vec::new(),
        }
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
    Ok(ReadBody {
        class: read::text(&node, keys::PLANET_CLASS, src),
        size: read::required(&node, keys::PLANET_SIZE, src).map_err(field)?,
        orbit: read::required(&node, keys::ORBIT, src).map_err(field)?,
        x,
        y,
        entity: read::scalar_u32(&node, keys::ENTITY, src).unwrap_or(0),
        moon_of: read::scalar_u32(&node, keys::MOON_OF, src),
        deposits,
    })
}

/// The `type` of a deposit an op added.
fn deposit_kind(doc: &Document, id: u32) -> Option<String> {
    let anchor = doc.added().get(Table::Deposit, id)?;
    let (node, src) = entity(doc, Subject::Record(anchor), anchor).ok()?;
    read::scalar(&node, keys::TYPE, src).map(str::to_owned)
}
