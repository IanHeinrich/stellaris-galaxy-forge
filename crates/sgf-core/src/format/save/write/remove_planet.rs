//! `RemoveColony`, `DeleteSavePlanet` and the `RestoreSaveEntities` they invert to.
//!
//! A deleted body is left as the game's `remove_planet` leaves one: `<id>=none` in its slot
//! and no `planet=` line in its system. Deposits, survey lists, fleets in orbit and orphaned
//! construction queues are the game's to tidy, which it does at load or lets stand. A dig
//! site on a deleted body goes as `RemoveDigSite` takes one: its entry alone.
//!
//! A colony goes as the game's `destroy_colony` takes it: the planet loses its owner,
//! controller, colonisation date and orbital defence; the colony, its pops, jobs,
//! districts, zones, buildings, defence armies and orbital ring become tombstones and leave
//! the lists of the owner, of an occupier and of the armies' owners; and their queues at the
//! planet are left with no owner. A country's capital, a species' home planet and
//! construction items naming the colony are left for the game. A colonised body is never
//! deleted with its colony standing: the game crashes on load when a colony's planet is gone.

use std::collections::BTreeMap;
use std::collections::btree_map::Entry;

use crate::Span;
use crate::cst::Node;
use crate::document::Document;
use crate::emit::system::MOON_FLAG;
use crate::format::save::alloc::{self, SlotTable};
use crate::format::save::dig_sites::{self, DigSite};
use crate::format::save::write::bodies::{frame, unlist_moon};
use crate::format::save::write::move_planet::{is_star_class, unlist_planets};
use crate::format::save::{
    check_version, entity_at, entity_in, planet_entity, planet_statement, planet_system,
    system_statement,
};
use crate::keys;
use crate::ops::rules::bodies::{Body, descendants};
use crate::ops::{Edit, Op, OpError, Plan, Planned, SavedEntity, SavedTable, Subject};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::scan::{self, Index, Value};
use crate::session::Session;

/// The null reference id.
const NULL: u32 = u32::MAX;

/// The level every orbital ring's starbase has, whatever its tier.
const ORBITAL_RING_LEVEL: &str = "starbase_level_orbital_ring";

pub(crate) fn plan_remove_colony(
    plan: &mut Plan,
    s: &Session,
    planet: u32,
) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    let (node, src) = planet_entity(&s.doc, planet)?;
    let system = planet_system(&node, src, planet)?;
    if read::scalar_u32(&node, keys::COLONY, src).is_none() {
        return Err(OpError::NoColony(planet));
    }
    let teardown = Teardown::read(s, planet, system, &node, src)?;
    let refuse = |reason: String| OpError::ColonyKept { planet, reason };
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
    check_version(&s.doc)?;
    let (node, src) = planet_entity(&s.doc, planet)?;
    let system = planet_system(&node, src, planet)?;
    let bodies: Vec<Body> = frame(s, system)?.into_iter().map(|b| b.body).collect();
    let moon = read::scalar_u32(&node, keys::BINARY_FLAGS, src).is_some_and(|f| f & MOON_FLAG != 0);
    let parent = read::scalar_u32(&node, keys::MOON_OF, src);
    let moons = descendants(&bodies, planet);
    let deleted: Vec<u32> = std::iter::once(planet)
        .chain(moons.iter().copied())
        .collect();

    let mut teardowns = Vec::new();
    let mut stations = Vec::new();
    let sites: Vec<(Anchor, DigSite)> = dig_sites::sites(&s.doc)?
        .into_iter()
        .filter(|(_, site)| site.planet.is_some_and(|p| deleted.contains(&p)))
        .collect();
    for &id in &deleted {
        let (node, src) = planet_entity(&s.doc, id)?;
        let refuse = |reason: String| OpError::PlanetKept { planet: id, reason };
        if bodies.first().is_some_and(|primary| primary.id == id)
            || is_star_class(&read::text(&node, keys::PLANET_CLASS, src))
        {
            return Err(OpError::StarNotDeleted(id));
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
    let carrying = match moons.len() {
        0 => String::new(),
        1 => " and its moon".to_owned(),
        n => format!(" and its {n} moons"),
    };
    let colonies = match teardowns.len() {
        0 => String::new(),
        1 if deleted.len() == 1 => ", with its colony".to_owned(),
        1 => ", with a colony".to_owned(),
        n => format!(", with {n} colonies"),
    };
    let dug = match sites.len() {
        0 => String::new(),
        1 => ", and a dig site".to_owned(),
        n => format!(", and {n} dig sites"),
    };
    let restored = format!("Restored {label} #{planet}{carrying}");
    // An erased site has no statement to write back over, so it is added again, as
    // `RemoveDigSite`'s inverse adds one; undo puts back the bytes as they stood.
    let inverse = match saved.inverse(restored.clone()) {
        restore if sites.is_empty() => restore,
        restore => Op::Batch {
            description: restored,
            ops: std::iter::once(restore)
                .chain(sites.into_iter().filter_map(|(_, site)| {
                    Some(Op::AddDigSite {
                        planet: site.planet?,
                        site_type: site.kind,
                        difficulty: site.difficulty,
                    })
                }))
                .collect(),
        },
    };
    Ok(Planned {
        description: format!("Deleted {label} #{planet}{carrying}{colonies}{dug}"),
        inverse,
    })
}

pub(crate) fn plan_restore(
    plan: &mut Plan,
    s: &Session,
    description: &str,
    entities: &[SavedEntity],
) -> Result<Planned, OpError> {
    check_version(&s.doc)?;
    let mut saved = Saved::default();
    for entity in entities {
        let SavedEntity { table, id, text } = entity;
        let (table, id) = (*table, *id);
        if statement_id(text) != Some(id) {
            return Err(OpError::EntityMismatch { table, id });
        }
        let anchor = locate(&s.doc, table, id)?.ok_or(OpError::UnknownEntity { table, id })?;
        let subject = match table {
            SavedTable::System => Subject::System(id),
            SavedTable::Country => Subject::Country(id),
            // A planet written back, or deleted again, re-reads the bodies of the system the
            // entity it becomes names, or else of the one it replaces.
            SavedTable::Planet => match planet_origin(text.as_bytes(), id)
                .or_else(|| planet_origin(s.doc.current(anchor).ok()?, id))
            {
                Some(system) => Subject::Planet { id, system },
                None => Subject::Record(anchor),
            },
            _ => Subject::Record(anchor),
        };
        saved.keep(&s.doc, table, id, anchor)?;
        plan.replace(&s.doc, subject, anchor, text.clone().into_bytes())?;
    }
    Ok(Planned {
        description: description.to_owned(),
        inverse: saved.inverse(format!("Undid: {description}")),
    })
}

/// The id of the one statement `text` holds, when it holds exactly one, keyed by a number:
/// an entity or a tombstone.
fn statement_id(text: &str) -> Option<u32> {
    let bytes = text.as_bytes();
    let root = crate::cst::parse(bytes, 0).ok()?;
    let [node] = root.children() else {
        return None;
    };
    let dead = node.scalar_str(bytes) == Some("none");
    if node.scalar_span().is_some() && !dead {
        return None;
    }
    node.key_str(bytes)?.parse().ok()
}

/// The system of the planet entity `bytes` hold; `None` for a tombstone.
fn planet_origin(bytes: &[u8], id: u32) -> Option<u32> {
    let node = entity_in(bytes).ok()??;
    planet_system(&node, bytes, id).ok()
}

/// The whole statement of each entity an op rewrites, as it stood before, keyed by table
/// and id: what its inverse writes back.
#[derive(Default)]
struct Saved(BTreeMap<(SavedTable, u32), String>);

impl Saved {
    fn keep(
        &mut self,
        doc: &Document,
        table: SavedTable,
        id: u32,
        anchor: Anchor,
    ) -> Result<(), OpError> {
        if let Entry::Vacant(vacant) = self.0.entry((table, id)) {
            vacant.insert(String::from_utf8_lossy(doc.current(anchor)?).into_owned());
        }
        Ok(())
    }

    fn inverse(self, description: String) -> Op {
        Op::RestoreSaveEntities {
            description,
            entities: self
                .0
                .into_iter()
                .map(|((table, id), text)| SavedEntity { table, id, text })
                .collect(),
        }
    }
}

/// Where entity `id` of `table` stands now, a tombstone included.
fn locate(doc: &Document, table: SavedTable, id: u32) -> Result<Option<Anchor>, OpError> {
    let section = match table {
        SavedTable::System => return Ok(system_statement(doc, id)),
        SavedTable::Planet => {
            if let Some(anchor) = planet_statement(doc, id)? {
                return Ok(Some(anchor));
            }
            return Ok(SlotTable::planets(doc)?.dead_slot(id));
        }
        SavedTable::Starbase => {
            let inner = doc.inner_index(keys::STARBASE_MGR)?;
            return Ok(inner.and_then(|i| entry(i, keys::STARBASES, id)));
        }
        SavedTable::ConstructionQueue => {
            return Ok(queue_index(doc).and_then(|i| entry(&i, keys::QUEUES, id)));
        }
        SavedTable::ConstructionItem => {
            return Ok(item_index(doc).and_then(|i| entry(&i, keys::ITEMS, id)));
        }
        SavedTable::Country => keys::COUNTRY,
        SavedTable::Colony => keys::COLONY,
        SavedTable::PopGroup => keys::POP_GROUPS,
        SavedTable::PopJob => keys::POP_JOBS,
        SavedTable::District => keys::DISTRICTS,
        SavedTable::Zone => keys::ZONES,
        SavedTable::Building => keys::BUILDINGS,
        SavedTable::Army => keys::ARMY,
        SavedTable::Fleet => keys::FLEET,
        SavedTable::Ship => keys::SHIPS,
    };
    Ok(entry(doc.index(), section, id))
}

/// The statement of entity `id` in `index`'s section `section`.
fn entry(index: &Index, section: &str, id: u32) -> Option<Anchor> {
    index
        .entity(section, u64::from(id))
        .map(|e| Anchor::Original(e.stmt))
}

/// The live entity entity `id` of `table` stands for now, with its statement.
fn live(doc: &Document, table: SavedTable, id: u32) -> Result<Option<Found<'_>>, OpError> {
    let Some(anchor) = locate(doc, table, id)? else {
        return Ok(None);
    };
    let found = entity_at(doc, anchor)
        .map_err(|e| Subject::Record(anchor).parse_error(e.offset, e.reason))?;
    Ok(found.map(|(node, src)| Found { anchor, node, src }))
}

struct Found<'a> {
    anchor: Anchor,
    node: Node,
    src: &'a [u8],
}

/// The bytes at `anchor` with the statement they hold made entity `id`'s tombstone, the
/// whitespace around it kept.
fn tombstoned(doc: &Document, anchor: Anchor, id: u32) -> Result<Vec<u8>, OpError> {
    let current = doc.current(anchor)?;
    let span = alloc::statement_span(current)
        .ok_or_else(|| Subject::Record(anchor).parse_error(0, "no statement stands there"))?;
    Ok([
        &current[..span.start],
        alloc::tombstone(id).as_bytes(),
        &current[span.end..],
    ]
    .concat())
}

/// Fleet `fleet` and its ships, as tombstones to write.
fn fleet_records(doc: &Document, fleet: u32) -> Result<Vec<(SavedTable, u32, Anchor)>, OpError> {
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

/// `construction.queue_mgr`, scanned so that its `queues` expose their entities.
fn queue_index(doc: &Document) -> Option<Index> {
    construction_part(doc, keys::QUEUE_MGR)
}

/// `construction.item_mgr`, scanned so that its `items` expose their entities.
fn item_index(doc: &Document) -> Option<Index> {
    construction_part(doc, keys::ITEM_MGR)
}

fn construction_part(doc: &Document, key: &str) -> Option<Index> {
    let src = doc.original();
    let Value::Block { open, close } = doc.index().section(keys::CONSTRUCTION)?.value else {
        return None;
    };
    let inner = scan::scan_range(src, open + 1..close).ok()?;
    let Value::Block { open, close } = inner.section(key)?.value else {
        return None;
    };
    scan::scan_range(src, open + 1..close).ok()
}

/// `node.<key>` as an id, `None` when it is missing or the null id.
fn some_id(node: &Node, key: &str, src: &[u8]) -> Option<u32> {
    read::scalar_u32(node, key, src).filter(|&id| id != NULL)
}

/// `node.<key>` as a list of ids, the null id left out.
fn some_ids(node: &Node, key: &str, src: &[u8]) -> Vec<u32> {
    read::ids(node, key, src)
        .into_iter()
        .filter(|&id| id != NULL)
        .collect()
}

/// What refuses both a colony's removal and a planet's deletion: a ring world segment, and a
/// megastructure on or around the body. A habitat is a planet class with no megastructure
/// entry of its own, so it passes.
fn check_planet(
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

/// A mining or research station at a deleted body: its fleet, which goes with the body.
struct Stationed {
    planet: u32,
    fleet: u32,
    /// The country the station makes the body's controller.
    controller: Option<u32>,
    /// The fleet and its ships.
    dead: Vec<(SavedTable, u32, Anchor)>,
}

impl Stationed {
    /// Tombstone the fleet and its ships, and take them out of the system's `fleet_presence`
    /// and the controller's `owned_fleets` and `controlled_planets`.
    fn write(
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
            let anchor = locate(doc, SavedTable::Country, country)?
                .ok_or(OpError::UnknownCountry(country))?;
            saved.keep(doc, SavedTable::Country, country, anchor)?;
            let edit = plan.edit_country(doc, country)?;
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

/// Write each of `dead` as its tombstone, keeping what stood there for the inverse.
fn tombstone_all(
    plan: &mut Plan,
    doc: &Document,
    saved: &mut Saved,
    dead: &[(SavedTable, u32, Anchor)],
) -> Result<(), OpError> {
    for &(table, id, anchor) in dead {
        saved.keep(doc, table, id, anchor)?;
        let bytes = tombstoned(doc, anchor, id)?;
        plan.replace(doc, Subject::Record(anchor), anchor, bytes)?;
    }
    Ok(())
}

/// A colony and everything that goes with it.
struct Teardown {
    planet: u32,
    system: u32,
    colony: u32,
    /// The owner, any other controller, and the owners of its armies: the countries whose
    /// lists name the colony, the planet, the armies or the ring.
    countries: Vec<u32>,
    /// The entities that become tombstones.
    dead: Vec<(SavedTable, u32, Anchor)>,
    /// The queues at the planet of one of `countries`, left with no owner.
    orphaned: Vec<(u32, Anchor)>,
    pops: usize,
    armies: Vec<u32>,
    /// The orbital ring's starbase and fleet.
    ring: Option<(u32, u32)>,
}

impl Teardown {
    fn read(
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
            let Some((q, qsrc)) = entity_at(doc, anchor).ok().flatten() else {
                continue;
            };
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
    fn what(&self) -> String {
        let mut parts = Vec::new();
        if self.pops > 0 {
            parts.push(counted(self.pops, "pop group"));
        }
        if !self.armies.is_empty() {
            parts.push(counted(self.armies.len(), "army"));
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
    fn write(
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
                .set_scalar(&[keys::OWNER], NULL.to_string())?;
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
            let anchor = locate(doc, SavedTable::Country, country)?
                .ok_or(OpError::UnknownCountry(country))?;
            saved.keep(doc, SavedTable::Country, country, anchor)?;
            let edit = plan.edit_country(doc, country)?;
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
        let Some((node, src)) = entity_at(doc, anchor).ok().flatten() else {
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

/// What a list left with none of its ids becomes.
#[derive(Clone, Copy)]
enum Emptied {
    /// It goes, as the game writes no empty one.
    Drop,
    /// It stays, empty.
    Keep,
    /// It holds the null id, as a system with no starbase does.
    Null,
}

/// Take `ids` out of the entity's list `key`.
fn unlist(edit: &mut Edit, key: &str, ids: &[u32], emptied: Emptied) -> Result<(), OpError> {
    let Some(block) = edit.entity()?.find(key, &edit.buf).cloned() else {
        return Ok(());
    };
    let listed: Vec<Span> = block
        .children()
        .iter()
        .filter(|item| item.key.is_none())
        .filter(|item| {
            item.scalar_str(&edit.buf)
                .and_then(|text| text.parse::<u32>().ok())
                .is_some_and(|id| ids.contains(&id))
        })
        .map(Node::span)
        .collect();
    let Some(&first) = listed.first() else {
        return Ok(());
    };
    let all = listed.len() == block.children().len();
    let mut gone = listed.as_slice();
    match emptied {
        Emptied::Drop if all => {
            edit.remove_statement(block.span());
            return Ok(());
        }
        Emptied::Null if all => {
            edit.replace_span(first, NULL.to_string());
            gone = &listed[1..];
        }
        _ => {}
    }
    for &item in gone {
        let end = item.end
            + edit.buf[item.end..]
                .iter()
                .take_while(|&&b| b == b' ' || b == b'\t')
                .count();
        edit.replace_span(Span::new(item.start, end), Vec::new());
    }
    Ok(())
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

fn counted(n: usize, noun: &str) -> String {
    match (n, noun) {
        (1, _) => format!("1 {noun}"),
        (_, "army") => format!("{n} armies"),
        _ => format!("{n} {noun}s"),
    }
}
