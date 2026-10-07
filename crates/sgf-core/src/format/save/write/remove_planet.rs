//! `RemoveColony` and `DeleteBody`, which invert to `RestoreEntities`.
//!
//! A deleted body is left as the game's `remove_planet` leaves one: `<id>=none` in its slot
//! and no `planet=` line in its system. Deposits, survey lists, fleets in orbit and orphaned
//! construction queues are the game's to tidy, which it does at load or lets stand. A dig
//! site on a deleted body goes as `RemoveDigSite` takes one: its entry alone. The body
//! leaves each country's `events.anomalies` as `RemoveAnomaly` takes one out. A body added
//! since the file was opened goes as `RemoveBody` takes it, its slots given back.
//!
//! A colony goes as the game's `destroy_colony` takes it: the planet loses its owner,
//! controller, colonisation date and orbital defence; the colony, its pops, jobs,
//! districts, zones, buildings, defence armies and orbital ring become tombstones and leave
//! the lists of the owner, of an occupier and of the armies' owners; and their queues at the
//! planet are left with no owner. A country's capital, a species' home planet and
//! construction items naming the colony are left for the game. A colonised body is never
//! deleted with its colony standing: the game crashes on load when a colony's planet is gone.

use crate::Span;
use crate::cst::Node;
use crate::document::Document;
use crate::emit::system::MOON_FLAG;
use crate::entity::views::EntityKind;
use crate::format::save::dig_sites::{self, DigSite};
use crate::format::save::write::bodies::frame_bodies;
use crate::format::save::write::id_list::unlist_planets;
use crate::format::save::write::planet_entry::{PlanetEntry, and_its_moons, unlist_moon};
use crate::format::save::write::planet_entry::{is_star, role};
use crate::format::save::write::restore::{Saved, country_edit, tombstoned};
use crate::format::save::write::teardown::{Stationed, Teardown, fleet_records, some_id};
use crate::format::save::write::{add_body, anomaly};
use crate::format::save::{
    entity_at, entity_in, planet_entity, planet_statement, system_statement,
};
use crate::keys;
use crate::ops::{Op, OpError, Plan, Planned, SavedTable, StarEdit, Subject};
use crate::overlay::Anchor;
use crate::projections::geometry::descendants;
use crate::projections::read;
use crate::session::Session;

pub(crate) fn plan_remove_colony(
    plan: &mut Plan,
    s: &Session,
    planet: u32,
) -> Result<Planned, OpError> {
    let PlanetEntry { node, src, system } = PlanetEntry::open(s, planet)?;
    if read::scalar_u32(&node, keys::COLONY, src).is_none() {
        return Err(OpError::NoColony(planet));
    }
    let teardown = Teardown::read(s, planet, system, &node, src)?;
    let refuse = |reason: String| OpError::ColonyKept {
        body: planet,
        reason,
    };
    check_planet(s, planet, &node, src, refuse)?;
    let mut saved = Saved::default();
    teardown.write(plan, s, &mut saved, true)?;
    let description = format!(
        "Removed colony #{} from planet #{planet}{}",
        teardown.colony,
        teardown.what()
    );
    Ok(Planned {
        inverse: saved.inverse(format!(
            "Restored colony #{} on planet #{planet}",
            teardown.colony
        )),
        description,
    })
}

pub(crate) fn plan_delete(plan: &mut Plan, s: &Session, planet: u32) -> Result<Planned, OpError> {
    if s.doc.added().get(EntityKind::Planet, planet).is_some() {
        return plan_delete_added(plan, s, planet);
    }
    let PlanetEntry { node, src, system } = PlanetEntry::open(s, planet)?;
    let bodies = frame_bodies(s, system)?;
    let moon = is_moon(&node, src);
    let parent = read::scalar_u32(&node, keys::MOON_OF, src);
    let moons = descendants(&bodies, planet);
    let deleted: Vec<u32> = std::iter::once(planet)
        .chain(moons.iter().copied())
        .collect();

    let mut teardowns = Vec::new();
    let mut stations = Vec::new();
    let sites = sites_on(s, &deleted)?;
    for &id in &deleted {
        let (node, src) = planet_entity(&s.doc, id)?;
        let refuse = |reason: String| OpError::PlanetKept { body: id, reason };
        let primary = bodies.first().is_some_and(|primary| primary.id == id);
        if is_star(role(&node, src, primary, s.star_classes())) {
            return Err(OpError::StarRefused {
                body: id,
                edit: StarEdit::Delete,
            });
        }
        if read::scalar_u32(&node, keys::COLONY, src).is_some() {
            teardowns.push(Teardown::read(s, id, system, &node, src)?);
        } else if some_id(&node, keys::ORBITAL_DEFENCE, src).is_some() {
            return Err(refuse("a starbase orbits it".to_owned()));
        }
        check_planet(s, id, &node, src, refuse)?;
        if let Some(fleet) = some_id(&node, keys::SHIPCLASS_ORBITAL_STATION, src) {
            stations.push(Stationed {
                planet: id,
                fleet,
                controller: some_id(&node, keys::CONTROLLER, src),
                dead: fleet_records(&s.doc, fleet)?,
            });
        }
    }

    let mut saved = Saved::default();
    for teardown in &teardowns {
        teardown.write(plan, s, &mut saved, false)?;
    }
    for station in &stations {
        station.write(plan, s, &mut saved, system)?;
    }
    // A site goes as `RemoveDigSite` takes it, the entry alone: the game drops an
    // excavating fleet's order on its first day.
    for (anchor, _) in &sites {
        plan.erase(&s.doc, Subject::Record(*anchor), *anchor)?;
    }
    for &id in &deleted {
        for country in s.doc.anomaly_finders(id) {
            anomaly::unlist(country_edit(plan, &s.doc, &mut saved, country)?, id)?;
        }
    }
    let anchor = system_statement(&s.doc, system).ok_or(OpError::UnknownSystem(system))?;
    saved.keep(&s.doc, SavedTable::System, system, anchor)?;
    unlist_planets(plan.edit(&s.doc, system)?, &deleted)?;
    if let Some(parent) = parent.filter(|p| !deleted.contains(p))
        && let Some(anchor) = planet_statement(&s.doc, parent)?
        && entity_at(&s.doc, anchor).is_ok_and(|found| found.is_some())
    {
        saved.keep(&s.doc, SavedTable::Planet, parent, anchor)?;
        unlist_moon(plan.edit_planet(&s.doc, parent, system)?, planet)?;
    }
    for &id in &deleted {
        let anchor = planet_statement(&s.doc, id)?.ok_or(OpError::UnknownPlanet(id))?;
        saved.keep(&s.doc, SavedTable::Planet, id, anchor)?;
        let bytes = tombstoned(&s.doc, anchor, id)?;
        plan.replace(&s.doc, Subject::Planet { id, system }, anchor, bytes)?;
    }

    let label = if moon { "moon" } else { "planet" };
    let carrying = and_its_moons(moons.len());
    let colonies = match teardowns.len() {
        0 => String::new(),
        1 if deleted.len() == 1 => ", with its colony".to_owned(),
        1 => ", with a colony".to_owned(),
        n => format!(", with {n} colonies"),
    };
    let dug = dug(sites.len());
    let restored = format!("Restored {label} #{planet}{carrying}");
    // An erased site has no statement to write back over, so it is added again, as
    // `RemoveDigSite`'s inverse adds one; undo puts back the bytes as they stood.
    let inverse = then(saved.inverse(restored.clone()), restored, site_adds(sites));
    Ok(Planned {
        description: format!("Deleted {label} #{planet}{carrying}{colonies}{dug}"),
        inverse,
    })
}

/// A body added since the file was opened goes as [`Op::RemoveBody`] takes it, its
/// slots given back, once its dig site and its place in the finders' anomaly lists have
/// gone. The inverse adds the body back, then its site and anomaly.
fn plan_delete_added(plan: &mut Plan, s: &Session, planet: u32) -> Result<Planned, OpError> {
    let (node, src) = planet_entity(&s.doc, planet)?;
    let moon = is_moon(&node, src);
    let category = read::scalar(&node, keys::ANOMALY, src).map(str::to_owned);
    let finders = s.doc.anomaly_finders(planet);
    let sites = sites_on(s, &[planet])?;
    for (anchor, _) in &sites {
        plan.erase(&s.doc, Subject::Record(*anchor), *anchor)?;
    }
    for &country in &finders {
        anomaly::unlist(plan.edit_country(&s.doc, country)?, planet)?;
    }
    let removed = add_body::plan_remove(plan, s, planet)?;

    let label = if moon { "moon" } else { "planet" };
    let dug = dug(sites.len());
    let found = category.map(|category| Op::AddAnomaly {
        body: planet,
        category,
        found_by: Some(finders),
    });
    let restored = format!("Restored {label} #{planet}");
    let inverse = then(removed.inverse, restored, site_adds(sites).chain(found));
    Ok(Planned {
        description: format!("Deleted {label} #{planet}{dug}"),
        inverse,
    })
}

fn is_moon(node: &Node, src: &[u8]) -> bool {
    read::scalar_u32(node, keys::BINARY_FLAGS, src).is_some_and(|f| f & MOON_FLAG != 0)
}

/// The dig sites on any of `planets`.
fn sites_on(s: &Session, planets: &[u32]) -> Result<Vec<(Anchor, DigSite)>, OpError> {
    Ok(dig_sites::sites(&s.doc)?
        .into_iter()
        .filter(|(_, site)| site.planet.is_some_and(|p| planets.contains(&p)))
        .collect())
}

/// The ops that add each of `sites` back.
fn site_adds(sites: Vec<(Anchor, DigSite)>) -> impl Iterator<Item = Op> {
    sites.into_iter().filter_map(|(_, site)| {
        Some(Op::AddDigSite {
            body: site.planet?,
            site_type: site.kind,
            difficulty: site.difficulty,
        })
    })
}

/// ", and a dig site", for the description.
fn dug(sites: usize) -> String {
    match sites {
        0 => String::new(),
        1 => ", and a dig site".to_owned(),
        n => format!(", and {n} dig sites"),
    }
}

/// `first`, batched with `rest` when there is any.
fn then(first: Op, description: String, rest: impl Iterator<Item = Op>) -> Op {
    let mut rest = rest.peekable();
    if rest.peek().is_none() {
        return first;
    }
    Op::Batch {
        description,
        ops: std::iter::once(first).chain(rest).collect(),
    }
}

/// What refuses both a colony's removal and a planet's deletion: a ring world segment, and a
/// megastructure on or around the body. A habitat is a planet class with no megastructure
/// entry of its own, so it passes.
pub(crate) fn check_planet(
    s: &Session,
    planet: u32,
    node: &Node,
    src: &[u8],
    refuse: impl Fn(String) -> OpError,
) -> Result<(), OpError> {
    let class = read::text(node, keys::PLANET_CLASS, src);
    if class.starts_with("pc_ringworld") || class.starts_with("pc_shattered_ring") {
        return Err(refuse(
            "it is a ring world segment, which has not been tried in game".to_owned(),
        ));
    }
    if some_id(node, keys::MEGASTRUCTURE, src).is_some() || megastructure_at(&s.doc, planet) {
        return Err(refuse(
            "a megastructure stands on or around it, which has not been tried in game".to_owned(),
        ));
    }
    Ok(())
}

/// Whether an entry of `megastructures` names `planet`.
fn megastructure_at(doc: &Document, planet: u32) -> bool {
    doc.index()
        .entities(keys::MEGASTRUCTURES)
        .iter()
        .any(|e| parsed_scalar(doc, e.stmt, keys::PLANET) == Some(planet))
}

/// The scalar `key` of the one entity the original bytes at `stmt` hold.
fn parsed_scalar(doc: &Document, stmt: Span, key: &str) -> Option<u32> {
    let bytes = stmt.slice(doc.original());
    let node = entity_in(bytes).ok()??;
    read::scalar_u32(&node, key, bytes)
}
