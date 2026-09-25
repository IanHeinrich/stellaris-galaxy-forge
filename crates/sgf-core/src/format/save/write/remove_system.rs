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
//! and the nebula member lines naming it, and the nebula cloud it lists. Planet and deposit
//! ids do not change. A removed system's nebula cloud gives its slot back.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::as_u32;
use crate::cst::Node;
use crate::document::Document;
use crate::format::save::added::Table;
use crate::format::save::alloc::{self, SlotTable};
use crate::format::save::read_spec::{bodies, spec_of};
use crate::format::save::write::asteroid_names::{self, Pool};
use crate::format::save::write::footprint::{Footprints, is_bare};
use crate::format::save::write::initializer_counter::{self, counted};
use crate::format::save::write::lanes::remove_entries;
use crate::format::save::write::name_pool::{self, SYSTEM_POOLS};
use crate::format::save::{check_version, entity, system_statement};
use crate::keys;
use crate::ops::rules::each_once;
use crate::ops::{Edit, LaneLength, NebulaFootprint, Op, OpError, Plan, Planned, Subject};
use crate::overlay::Anchor;
use crate::plural;
use crate::projections::galaxy::lane_length;
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
    rewrite_clouds(plan, s, &removed, &renumber)?;
    let last =
        counter
            .last
            .checked_sub(as_u32(removed.len()))
            .ok_or(OpError::SystemIdsNotDense {
                last: counter.last,
                count: s.graph.systems.len(),
            })?;
    counter.set(plan, &s.doc, last)?;
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
    let mut planets = SlotTable::planets(doc)?;
    let mut deposits: Option<SlotTable> = None;
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
                    let table = match &mut deposits {
                        Some(table) => table,
                        None => deposits.insert(SlotTable::deposits(doc)?),
                    };
                    table.free(plan, doc, Subject::Record(held), deposit, held)?;
                }
            }
            planets.free(plan, doc, subject, planet, slot)?;
        }
    }
    planets.settle(plan, doc)?;
    if let Some(deposits) = deposits {
        deposits.settle(plan, doc)?;
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
            edit.replace_span(key, new.to_string());
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
        splices.push((span, new));
    }
    for (span, new) in splices {
        edit.replace_span(span, new.to_string());
    }
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
                splices.push((span, *new));
            }
        }
        for &span in &cut {
            edit.require_alone_on_line(span, "member line")?;
        }
        for span in cut {
            edit.remove_lines(span);
        }
        for (span, new) in splices {
            edit.replace_span(span, new.to_string());
        }
    }
    Ok(())
}

/// Give back the nebula cloud of each removed system, and point a renumbered system's at
/// its new id.
fn rewrite_clouds(
    plan: &mut Plan,
    s: &Session,
    removed: &BTreeSet<u32>,
    renumber: &BTreeMap<u32, u32>,
) -> Result<(), OpError> {
    if check_version(&s.doc).is_err() {
        return Ok(());
    }
    let mut footprints = Footprints::new(&s.doc, &s.graph);
    for &id in removed {
        if let Some((cloud, at)) = footprints.read(id)?.cloud() {
            footprints.release(plan, cloud, at)?;
        }
    }
    for (&old, &new) in renumber {
        if let Some((_, at)) = footprints.read(old)?.cloud() {
            footprints.renumber(plan, at, new)?;
        }
    }
    footprints.finish(plan)
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
    let leaving: Vec<u32> = removed.iter().copied().collect();
    for pooled in names {
        let staying = name_pool::holders(s, pooled, &leaving);
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
            .filter(|&entry| s.doc.overlay().removed(entry, src))
            .collect();
        let keep = staying.get(&held).copied().unwrap_or(0);
        name_pool::put_back(plan, &s.doc, taken.iter().skip(keep))?;
    }
    Ok(())
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
/// their new ids) and to the ones re-added before it. The spec's lanes run up to the
/// first bridge, and an `AddLanes` after the add writes the rest in order, bridges
/// included. A `SetLaneLengths` puts back each length that is not `floor(distance)`, and a
/// `SetNebulaFootprints` each footprint, the join the add makes aside. What this leaves
/// different from the bytes removed is listed on [`Op::RemoveSystem`].
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
    let mut footprints = check_version(&s.doc)
        .is_ok()
        .then(|| Footprints::new(&s.doc, &s.graph));
    let mut ops = Vec::with_capacity(removed.len());
    let mut lengths = Vec::new();
    let mut dressed = Vec::new();
    for &id in removed {
        let system = s.graph.systems.get(&id).ok_or(OpError::UnknownSystem(id))?;
        let again = readded[&id];
        let mut lanes: Vec<(u32, bool)> = Vec::new();
        for lane in &system.lanes {
            let to = match readded.get(&lane.to) {
                Some(&other) if other < again => other,
                Some(_) => continue,
                None if s.graph.systems.contains_key(&lane.to) => {
                    renumber.get(&lane.to).copied().unwrap_or(lane.to)
                }
                None => continue,
            };
            if lanes.iter().any(|&(seen, _)| seen == to) {
                continue;
            }
            lanes.push((to, lane.bridge));
            let other = &s.graph.systems[&lane.to];
            if lane.length != lane_length(system, other) {
                lengths.push(LaneLength {
                    a: again,
                    b: to,
                    length: lane.length,
                });
            }
        }
        let plain = lanes.iter().take_while(|&&(_, bridge)| !bridge).count();
        let rest = lanes.split_off(plain);
        let spec_lanes = lanes.into_iter().map(|(to, _)| to).collect();
        ops.push(Op::AddSaveSystem {
            spec: spec_of(s, id, spec_lanes)?,
        });
        if !rest.is_empty() {
            ops.push(Op::AddLanes {
                from: again,
                to: rest,
            });
        }
        if let Some(footprints) = &mut footprints {
            let footprint = footprints.read(id)?.footprint;
            if !is_bare(&footprint) {
                dressed.push(NebulaFootprint {
                    system: again,
                    ..footprint
                });
            }
        }
    }
    if !lengths.is_empty() {
        ops.push(Op::SetLaneLengths { lanes: lengths });
    }
    if !dressed.is_empty() {
        ops.push(Op::SetNebulaFootprints {
            footprints: dressed,
        });
    }
    Ok(match ops.len() {
        1 => ops.remove(0),
        _ => Op::Batch {
            description: format!("Added {}", plural(removed.len(), "system")),
            ops,
        },
    })
}
