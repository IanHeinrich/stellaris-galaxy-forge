//! A colony taken down as the game's `destroy_colony` takes it, and a station at a deleted
//! body taken with it.

use crate::Span;
use crate::cst::Node;
use crate::document::Document;
use crate::format::save::write::id_list::{Emptied, unlist};
use crate::format::save::write::restore::{
    Found, Saved, country_edit, entry, live, queue_index, tombstone_all,
};
use crate::format::save::{entity_at, planet_statement, system_statement};
use crate::keys;
use crate::ops::{Edit, OpError, Plan, SavedTable, Subject};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::session::Session;
use crate::{NULL_ID, plural, plural_of};

/// The level every orbital ring's starbase has, whatever its tier.
const ORBITAL_RING_LEVEL: &str = "starbase_level_orbital_ring";

/// Fleet `fleet` and its ships, as tombstones to write.
pub(crate) fn fleet_records(
    doc: &Document,
    fleet: u32,
) -> Result<Vec<(SavedTable, u32, Anchor)>, OpError> {
    let Some(found) = live(doc, SavedTable::Fleet, fleet)? else {
        return Ok(Vec::new());
    };
    let mut records = vec![(SavedTable::Fleet, fleet, found.anchor)];
    for ship in some_ids(&found.node, keys::SHIPS, found.src) {
        if let Some(ship_found) = live(doc, SavedTable::Ship, ship)? {
            records.push((SavedTable::Ship, ship, ship_found.anchor));
        }
    }
    Ok(records)
}

/// Queue `queue` and the construction items it lists, as tombstones to write, so that no
/// item is left in a dead queue.
fn queue_records(doc: &Document, queue: u32) -> Result<Vec<(SavedTable, u32, Anchor)>, OpError> {
    let Some(found) = live(doc, SavedTable::ConstructionQueue, queue)? else {
        return Ok(Vec::new());
    };
    let mut records = vec![(SavedTable::ConstructionQueue, queue, found.anchor)];
    for item in some_ids(&found.node, keys::ITEMS, found.src) {
        if let Some(item_found) = live(doc, SavedTable::ConstructionItem, item)? {
            records.push((SavedTable::ConstructionItem, item, item_found.anchor));
        }
    }
    Ok(records)
}

/// `node.<key>` as an id, `None` when it is missing or the null id.
pub(crate) fn some_id(node: &Node, key: &str, src: &[u8]) -> Option<u32> {
    read::scalar_u32(node, key, src).filter(|&id| id != NULL_ID)
}

/// `node.<key>` as a list of ids, the null id left out.
fn some_ids(node: &Node, key: &str, src: &[u8]) -> Vec<u32> {
    read::ids(node, key, src)
        .into_iter()
        .filter(|&id| id != NULL_ID)
        .collect()
}

/// A mining or research station at a deleted body: its fleet, which goes with the body.
pub(crate) struct Stationed {
    pub(crate) planet: u32,
    pub(crate) fleet: u32,
    /// The country the station makes the body's controller.
    pub(crate) controller: Option<u32>,
    /// The fleet and its ships.
    pub(crate) dead: Vec<(SavedTable, u32, Anchor)>,
}

impl Stationed {
    /// Tombstone the fleet and its ships, and take them out of the system's `fleet_presence`
    /// and the controller's `owned_fleets` and `controlled_planets`.
    pub(crate) fn write(
        &self,
        plan: &mut Plan,
        s: &Session,
        saved: &mut Saved,
        system: u32,
    ) -> Result<(), OpError> {
        let doc = &s.doc;
        tombstone_all(plan, doc, saved, &self.dead)?;
        let anchor = system_statement(doc, system).ok_or(OpError::UnknownSystem(system))?;
        saved.keep(doc, SavedTable::System, system, anchor)?;
        unlist(
            plan.edit(doc, system)?,
            keys::FLEET_PRESENCE,
            &[self.fleet],
            Emptied::Drop,
        )?;
        if let Some(country) = self.controller {
            let edit = country_edit(plan, doc, saved, country)?;
            unlist_fleet(edit, self.fleet)?;
            unlist(
                edit,
                keys::CONTROLLED_PLANETS,
                &[self.planet],
                Emptied::Keep,
            )?;
        }
        Ok(())
    }
}

/// A colony and everything that goes with it.
pub(crate) struct Teardown {
    pub(crate) planet: u32,
    pub(crate) system: u32,
    pub(crate) colony: u32,
    /// The owner, any other controller, and the owners of its armies: the countries whose
    /// lists name the colony, the planet, the armies or the ring.
    pub(crate) countries: Vec<u32>,
    /// The entities that become tombstones.
    pub(crate) dead: Vec<(SavedTable, u32, Anchor)>,
    /// The queues at the planet of one of `countries`, left with no owner.
    pub(crate) orphaned: Vec<(u32, Anchor)>,
    pub(crate) pops: usize,
    pub(crate) armies: Vec<u32>,
    /// The orbital ring's starbase and fleet.
    pub(crate) ring: Option<(u32, u32)>,
}

impl Teardown {
    pub(crate) fn read(
        s: &Session,
        planet: u32,
        system: u32,
        node: &Node,
        src: &[u8],
    ) -> Result<Self, OpError> {
        let doc = &s.doc;
        let refuse = |reason: String| OpError::ColonyKept { planet, reason };
        let colony = read::scalar_u32(node, keys::COLONY, src).ok_or(OpError::NoColony(planet))?;
        let owner = some_id(node, keys::OWNER, src)
            .ok_or_else(|| refuse("the planet has no owner".to_owned()))?;
        let mut countries = vec![owner];
        countries.extend(some_id(node, keys::CONTROLLER, src));
        let entity = live(doc, SavedTable::Colony, colony)?
            .ok_or_else(|| refuse(format!("colony #{colony} is not in the save")))?;
        let (col, csrc) = (&entity.node, entity.src);
        let mut dead = vec![(SavedTable::Colony, colony, entity.anchor)];
        let mut found = |table: SavedTable, ids: &[u32]| -> Result<Vec<Found<'_>>, OpError> {
            let mut out = Vec::new();
            for &id in ids {
                if let Some(found) = live(doc, table, id)? {
                    dead.push((table, id, found.anchor));
                    out.push(found);
                }
            }
            Ok(out)
        };
        let pops = found(SavedTable::PopGroup, &some_ids(col, keys::POP_GROUPS, csrc))?.len();
        found(SavedTable::PopJob, &some_ids(col, keys::POP_JOBS, csrc))?;
        let mut zones = Vec::new();
        for district in found(SavedTable::District, &some_ids(col, keys::DISTRICTS, csrc))? {
            zones.extend(some_ids(&district.node, keys::ZONES, district.src));
        }
        let mut buildings = Vec::new();
        for zone in found(SavedTable::Zone, &zones)? {
            buildings.extend(some_ids(&zone.node, keys::BUILDINGS, zone.src));
        }
        found(SavedTable::Building, &buildings)?;
        let armies = some_ids(col, keys::ARMY, csrc);
        for army in found(SavedTable::Army, &armies)? {
            if army.node.find(keys::SHIP, army.src).is_some() {
                return Err(refuse("one of its armies is aboard a ship".to_owned()));
            }
            countries.extend(some_id(&army.node, keys::OWNER, army.src));
        }
        countries.sort_unstable();
        countries.dedup();

        let queues = queue_index(doc);
        let queue = |id: u32| queues.as_ref().and_then(|q| entry(q, keys::QUEUES, id));
        let mut orphaned = Vec::new();
        for id in [
            some_id(node, keys::BUILD_QUEUE, src),
            some_id(col, keys::ARMY_BUILD_QUEUE, csrc),
        ]
        .into_iter()
        .flatten()
        {
            let Some(anchor) = queue(id) else { continue };
            let found = entity_at(doc, anchor)
                .map_err(|e| Subject::Record(anchor).parse_error(e.offset, e.reason))?;
            let Some((q, qsrc)) = found else { continue };
            if read::scalar_u32(&q, keys::OWNER, qsrc).is_some_and(|o| countries.contains(&o)) {
                orphaned.push((id, anchor));
            }
        }

        // `orbital_defence` names the planet's orbital ring, or the system's own starbase when
        // that orbits the planet; only a ring goes with the colony.
        let mut ring = None;
        if let Some(fleet) = some_id(node, keys::ORBITAL_DEFENCE, src)
            && let Some(entity) = live(doc, SavedTable::Fleet, fleet)?
            && let Some(station) =
                station_of(doc, &some_ids(&entity.node, keys::SHIPS, entity.src))?
            && station.level.starts_with(ORBITAL_RING_LEVEL)
        {
            dead.push((SavedTable::Starbase, station.id, station.anchor));
            dead.extend(fleet_records(doc, fleet)?);
            for id in station.queues {
                dead.extend(queue_records(doc, id)?);
            }
            ring = Some((station.id, fleet));
        }
        Ok(Self {
            planet,
            system,
            colony,
            countries,
            dead,
            orphaned,
            pops,
            armies,
            ring,
        })
    }

    /// The pops, armies and ring that go, for the description.
    pub(crate) fn what(&self) -> String {
        let mut parts = Vec::new();
        if self.pops > 0 {
            parts.push(plural(self.pops, "pop group"));
        }
        if !self.armies.is_empty() {
            parts.push(plural_of(self.armies.len(), "army", "armies"));
        }
        if self.ring.is_some() {
            parts.push("its orbital ring".to_owned());
        }
        match parts.split_last() {
            None => String::new(),
            Some((last, [])) => format!(", with {last}"),
            Some((last, rest)) => format!(", with {} and {last}", rest.join(", ")),
        }
    }

    /// Write the removal; with `keep_planet`, the planet's own keys too, which a deletion
    /// leaves to the planet's tombstone.
    pub(crate) fn write(
        &self,
        plan: &mut Plan,
        s: &Session,
        saved: &mut Saved,
        keep_planet: bool,
    ) -> Result<(), OpError> {
        let doc = &s.doc;
        tombstone_all(plan, doc, saved, &self.dead)?;
        for &(id, anchor) in &self.orphaned {
            saved.keep(doc, SavedTable::ConstructionQueue, id, anchor)?;
            plan.edit_record(doc, anchor)?
                .set_scalar(&[keys::OWNER], NULL_ID.to_string())?;
        }

        let anchor =
            system_statement(doc, self.system).ok_or(OpError::UnknownSystem(self.system))?;
        saved.keep(doc, SavedTable::System, self.system, anchor)?;
        let edit = plan.edit(doc, self.system)?;
        unlist(edit, keys::COLONIES, &[self.colony], Emptied::Drop)?;
        if let Some((starbase, fleet)) = self.ring {
            unlist(edit, keys::STARBASES, &[starbase], Emptied::Null)?;
            unlist(edit, keys::FLEET_PRESENCE, &[fleet], Emptied::Drop)?;
        }

        for &country in &self.countries {
            let edit = country_edit(plan, doc, saved, country)?;
            unlist(edit, keys::OWNED_PLANETS, &[self.colony], Emptied::Keep)?;
            unlist(
                edit,
                keys::CONTROLLED_COLONIES,
                &[self.colony],
                Emptied::Keep,
            )?;
            unlist(
                edit,
                keys::CONTROLLED_PLANETS,
                &[self.planet],
                Emptied::Keep,
            )?;
            unlist(edit, keys::OWNED_ARMIES, &self.armies, Emptied::Keep)?;
            if let Some((_, fleet)) = self.ring {
                unlist_fleet(edit, fleet)?;
            }
        }

        if keep_planet {
            let anchor =
                planet_statement(doc, self.planet)?.ok_or(OpError::UnknownPlanet(self.planet))?;
            saved.keep(doc, SavedTable::Planet, self.planet, anchor)?;
            let edit = plan.edit_planet(doc, self.planet, self.system)?;
            let entity = edit.entity()?;
            let spans: Vec<Span> = [
                keys::COLONY,
                keys::OWNER,
                keys::CONTROLLER,
                keys::COLONIZE_DATE,
                keys::ORBITAL_DEFENCE,
            ]
            .into_iter()
            .flat_map(|key| {
                entity
                    .find_all(key, &edit.buf)
                    .map(Node::span)
                    .collect::<Vec<_>>()
            })
            .collect();
            for span in spans {
                edit.remove_statement(span);
            }
        }
        Ok(())
    }
}

/// A starbase: its id, statement, level and construction queues.
struct Station {
    id: u32,
    anchor: Anchor,
    level: String,
    queues: Vec<u32>,
}

/// The starbase whose station is one of `ships`.
fn station_of(doc: &Document, ships: &[u32]) -> Result<Option<Station>, OpError> {
    let Some(inner) = doc.inner_index(keys::STARBASE_MGR)? else {
        return Ok(None);
    };
    for starbase in inner.entities(keys::STARBASES) {
        let Ok(id) = u32::try_from(starbase.id) else {
            continue;
        };
        let anchor = Anchor::Original(starbase.stmt);
        let Ok(Some((node, src))) = entity_at(doc, anchor) else {
            continue;
        };
        if some_id(&node, keys::STATION, src).is_some_and(|station| ships.contains(&station)) {
            let queues = [keys::BUILD_QUEUE, keys::SHIPYARD_BUILD_QUEUE]
                .into_iter()
                .filter_map(|key| some_id(&node, key, src))
                .collect();
            return Ok(Some(Station {
                id,
                anchor,
                level: read::text(&node, keys::LEVEL, src),
                queues,
            }));
        }
    }
    Ok(None)
}

/// Take fleet `fleet`'s entry out of the country's `fleets_manager.owned_fleets`.
fn unlist_fleet(edit: &mut Edit, fleet: u32) -> Result<(), OpError> {
    let Some(list) = edit
        .entity()?
        .find(keys::FLEETS_MANAGER, &edit.buf)
        .and_then(|manager| manager.find(keys::OWNED_FLEETS, &edit.buf))
    else {
        return Ok(());
    };
    let entries: Vec<Span> = list
        .children()
        .iter()
        .filter(|entry| {
            entry.key.is_none() && read::scalar_u32(entry, keys::FLEET, &edit.buf) == Some(fleet)
        })
        .map(Node::span)
        .collect();
    for span in entries {
        edit.remove_lines(span);
    }
    Ok(())
}
