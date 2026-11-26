//! `DeleteSystem`, which inverts to `RestoreEntities`.
//!
//! A system goes as the game's `remove_system` leaves one a month on: `<id>=none` in its slot
//! and its planets', its lanes gone from the other ends and its id out of every block of
//! `clusters`, where a game loading it left in crashes. What stood in it goes first, each
//! thing as the game takes it: its colonies as `RemoveColony` takes one, its stations, its
//! starbases with their fleets and queues, its other fleets with their ships, the armies
//! aboard them and their leaders, its megastructures as `DeleteMegastructure` takes a row, a
//! natural wormhole with its other end, a pre-FTL country whose homeworld it holds, its dig
//! sites, a psionic aura or astral rift it is the source of, and its id from its sector, the
//! anomaly lists, cosmic storms and waystation networks. Everything else that names the
//! system or its planets is the game's to clear or lets stand: deposits' holders, survey
//! lists, fleets elsewhere on their way there, saved event targets, a sector's capital, the
//! rim, a nebula's member lines and the hyperlane and bypass lists among it. A system added
//! since the file was opened goes as `RemoveSystem` takes it.

use std::collections::{BTreeMap, BTreeSet};

use memchr::memmem::Finder;

use crate::Span;
use crate::cst::Node;
use crate::document::Document;
use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, row, rows_containing};
use crate::format::save::dig_sites;
use crate::format::save::galaxy::bypasses::{NaturalWormhole, natural_wormholes};
use crate::format::save::read_spec;
use crate::format::save::write::anomaly;
use crate::format::save::write::bodies::frame_bodies;
use crate::format::save::write::delete_megastructure::write_rows;
use crate::format::save::write::fleets::{fleet_owners, present_fleets};
use crate::format::save::write::id_list::{
    Emptied, drop_statements_naming, items, own_id, statements_naming, unlist, unlist_in,
};
use crate::format::save::write::leaders::{drop_leaders, leaders, ship_leaders};
use crate::format::save::write::megastructure_links::{self, Tied};
use crate::format::save::write::pre_ftl::{drop_dependents, tombstone_country};
use crate::format::save::write::remove_planet::{Deletion, Scope};
use crate::format::save::write::remove_system;
use crate::format::save::write::restore::{
    Gone, IdLines, Saved, country_edit, live, live_where, tombstone_all, tombstone_planets,
    tombstoned,
};
use crate::format::save::write::system_kept::{self, capitals, system_rows};
use crate::format::save::write::teardown::{
    StarbaseTeardown, fleet_records, some_id, some_ids, unlist_fleet,
};
use crate::format::save::write::wormhole_pair::empty_end;
use crate::format::save::{check_delete_systems, entity, planet_entity, system_statement};
use crate::keys;
use crate::ops::rules::named;
use crate::ops::{OpError, Plan, Planned, SavedTable, Subject};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::session::Session;
use crate::{and_list, plural, plural_of};

/// The `type` of the bypass a shroud tunnel's one end brings.
const SHROUD_TUNNEL: &str = "shroud_tunnel";

/// A row a deletion makes a tombstone: its table, id and statement.
type Dead = (SavedTable, u32, Anchor);

pub(crate) fn plan_delete(plan: &mut Plan, s: &Session, system: u32) -> Result<Planned, OpError> {
    let doc = &s.doc;
    if doc.added().get(EntityKind::System, system).is_some() {
        return remove_system::plan_remove(plan, s, &[system]);
    }
    check_delete_systems(doc)?;
    if !s.graph.systems.contains_key(&system) {
        return Err(OpError::UnknownSystem(system));
    }
    let planets = planets(doc, system)?;
    system_kept::check(s, system, &planets)?;
    let contents = Contents::read(s, system, &planets)?;
    let gone = Gone {
        system: Some(system),
        planets: &planets,
        bypasses: &contents.bypasses,
        ships: &contents.ships,
    };

    let removed = BTreeSet::from([system]);
    let mut saved = Saved::default();
    for &id in &s.graph.order {
        if id != system && s.graph.lane(id, system).is_some() {
            let anchor = system_statement(doc, id).ok_or(OpError::UnknownSystem(id))?;
            saved.keep(doc, SavedTable::System, id, anchor)?;
        }
    }
    remove_system::rewrite_lanes(plan, s, &removed, &BTreeMap::new())?;
    contents.write(plan, s, &mut saved, system, gone)?;
    tombstone_planets(plan, doc, &mut saved, system, &planets)?;
    let anchor = system_statement(doc, system).ok_or(OpError::UnknownSystem(system))?;
    saved.keep(doc, SavedTable::System, system, anchor)?;
    let bytes = tombstoned(doc, anchor, system)?;
    plan.replace(doc, Subject::System(system), anchor, bytes)?;
    leave_clusters(plan, doc, &mut saved, system)?;
    plan.renumber(system, None);

    let named = match remove_system::lane_count(s, &removed) {
        0 => named(&s.graph, system),
        lanes => format!("{} and {}", named(&s.graph, system), plural(lanes, "lane")),
    };
    Ok(Planned {
        description: format!("Deleted {named}{}", contents.what()),
        inverse: saved.inverse(format!("Restored {named}")),
    })
}

/// What stands in a system, or names it, that goes with it.
struct Contents {
    /// Its bodies, with their colonies and stations.
    deletion: Deletion,
    /// Its starbases but the orbital rings its colonies take.
    starbases: Vec<StarbaseTeardown>,
    /// Its other fleets, each with its ships.
    fleets: Vec<Vec<Dead>>,
    /// The country owning each fleet that goes.
    owners: BTreeMap<u32, u32>,
    /// Every ship that goes.
    ships: Vec<u32>,
    /// The armies aboard those ships but the colonies', each with its owner.
    carried: Vec<(Dead, Option<u32>)>,
    /// The leaders of the ships that go, each with its statement and country.
    leaders: Vec<(u32, Anchor, Option<u32>)>,
    rows: Vec<Tied>,
    /// Its natural wormholes and their other ends, each once.
    ends: Vec<NaturalWormhole>,
    /// The bypasses its rows and natural wormholes bring.
    bypasses: Vec<u32>,
    /// The pre-FTL countries whose homeworld it holds.
    countries: Vec<u32>,
    /// Its sector, which lists it.
    sector: Option<(u32, Anchor)>,
    /// The dig sites on its planets.
    sites: Vec<Dead>,
    /// Each country that found an anomaly on one of its planets, with the planet.
    finders: Vec<(u32, u32)>,
    /// The cosmic storms that have it in their cluster or on their path.
    storms: Vec<(u32, Anchor)>,
    /// The psionic auras it is the source of, each with its country.
    auras: Vec<(Dead, Option<u32>)>,
    /// The other systems in one of those auras, each with the aura.
    in_auras: Vec<(u32, u32)>,
    /// The astral rifts in it.
    rifts: Vec<Dead>,
    /// The waystation networks listing one of its starbases.
    networks: Vec<(u32, Anchor)>,
    /// Its starbases, the orbital rings' among them.
    all_starbases: Vec<u32>,
}

impl Contents {
    fn read(s: &Session, system: u32, planets: &[u32]) -> Result<Self, OpError> {
        let doc = &s.doc;
        let anchor = system_statement(doc, system).ok_or(OpError::UnknownSystem(system))?;
        let (node, src) = entity(doc, Subject::System(system), anchor)?;
        let mut rows = Vec::new();
        for id in system_rows(doc, system, &node, src)? {
            rows.extend(megastructure_links::read(doc, id)?);
        }
        let going: Vec<u32> = rows.iter().map(|tied| tied.id).collect();
        let frame = frame_bodies(s, system)?;
        let deletion = Deletion::read(s, system, &frame, planets.to_vec(), Scope::System, &going)?;

        let rings: Vec<u32> = deletion.ring_starbases();
        let all_starbases = some_ids(&node, keys::STARBASES, src);
        let mut starbases = Vec::new();
        for &id in all_starbases.iter().filter(|id| !rings.contains(id)) {
            starbases.extend(StarbaseTeardown::read(doc, id)?);
        }
        let mut taken = deletion.gone_fleets();
        taken.extend(starbases.iter().filter_map(|starbase| starbase.fleet));
        let mut fleets = Vec::new();
        for fleet in present_fleets(s, system)? {
            if taken.contains(&fleet) {
                continue;
            }
            // A starbase the system's `starbases` leaves out, such as an enclave's, is found
            // through its station's fleet, and goes with it.
            if let Some(starbase) = StarbaseTeardown::of_fleet(doc, fleet)? {
                taken.push(fleet);
                starbases.push(starbase);
                continue;
            }
            let records = fleet_records(doc, fleet)?;
            if !records.is_empty() {
                taken.push(fleet);
                fleets.push(records);
            }
        }
        let ships: Vec<u32> = deletion
            .dead()
            .chain(starbases.iter().flat_map(|starbase| &starbase.dead))
            .chain(fleets.iter().flatten())
            .filter(|(table, _, _)| *table == SavedTable::Ship)
            .map(|&(_, id, _)| id)
            .collect();
        let owned: Vec<u32> = starbases
            .iter()
            .filter_map(|starbase| starbase.fleet)
            .chain(
                fleets
                    .iter()
                    .filter_map(|records| records.first().map(|r| r.1)),
            )
            .collect();
        let owners = fleet_owners(s, &owned)?.into_iter().collect();
        let colonies_armies: Vec<u32> = deletion
            .teardowns
            .iter()
            .flat_map(|t| t.armies.iter().copied())
            .collect();
        let carried = carried(doc, &ships, &colonies_armies)?;
        let leaders = leaders(doc, &ship_leaders(doc, &ships)?)?;

        let mut bypasses: Vec<u32> = rows.iter().filter_map(|tied| tied.bypass).collect();
        let standing = natural_wormholes(doc, &s.graph.systems)?;
        let mut ends: Vec<NaturalWormhole> = Vec::new();
        for end in standing.iter().filter(|end| end.system == system) {
            let partner = (end.kind != SHROUD_TUNNEL)
                .then(|| {
                    standing
                        .iter()
                        .find(|other| other.id != end.id && end.linked_to == Some(other.bypass))
                })
                .flatten();
            for end in std::iter::once(end).chain(partner) {
                if !ends.iter().any(|taken| taken.id == end.id) {
                    ends.push(end.clone());
                }
            }
        }
        bypasses.extend(ends.iter().map(|end| end.bypass));

        let colonies: Vec<u32> = deletion.teardowns.iter().map(|t| t.colony).collect();
        let countries = capitals(doc, &colonies)?
            .into_iter()
            .filter(|&(_, primitive)| primitive)
            .map(|(country, _)| country)
            .collect();
        let sector = match some_id(&node, keys::SECTOR, src) {
            Some(id) => {
                row(doc, Table::Entity(EntityKind::Sector), id)?.map(|row| (id, row.anchor))
            }
            None => None,
        };
        let sites = dig_sites::sites(doc)?
            .into_iter()
            .filter(|(_, site)| site.planet.is_some_and(|p| planets.contains(&p)))
            .map(|(anchor, site)| (SavedTable::DigSite, site.id, anchor))
            .collect();
        let finders = planets
            .iter()
            .flat_map(|&planet| {
                doc.anomaly_finders(planet)
                    .into_iter()
                    .map(move |country| (country, planet))
            })
            .collect();
        let (auras, in_auras) = auras(doc, system)?;
        let listed_rifts = some_ids(&node, keys::ASTRAL_RIFTS, src);
        let rifts = live_where(
            doc,
            SavedTable::AstralRift,
            doc.inner_index(keys::ASTRAL_RIFTS)?,
            keys::RIFTS,
            |_| true,
            |rift, src| read::origin(rift, src) == Some(system),
        )?
        .into_iter()
        .map(|(id, rift)| (SavedTable::AstralRift, id, rift.anchor))
        .chain(listed_rifts.iter().filter_map(|&id| {
            live(doc, SavedTable::AstralRift, id)
                .ok()
                .flatten()
                .map(|rift| (SavedTable::AstralRift, id, rift.anchor))
        }))
        .fold(Vec::new(), |mut rifts: Vec<Dead>, rift| {
            if !rifts.iter().any(|taken| taken.1 == rift.1) {
                rifts.push(rift);
            }
            rifts
        });
        Ok(Self {
            deletion,
            starbases,
            fleets,
            owners,
            ships,
            carried,
            leaders,
            rows,
            ends,
            bypasses,
            countries,
            sector,
            sites,
            finders,
            storms: storms(doc, system)?,
            auras,
            in_auras,
            rifts,
            networks: networks(doc, &all_starbases)?,
            all_starbases,
        })
    }

    /// Write everything but the system's own entry and its planets', which `gone` names.
    fn write(
        &self,
        plan: &mut Plan,
        s: &Session,
        saved: &mut Saved,
        system: u32,
        gone: Gone,
    ) -> Result<(), OpError> {
        let doc = &s.doc;
        self.deletion.write_dependents(plan, s, saved, gone)?;
        for starbase in &self.starbases {
            tombstone_all(plan, doc, saved, &starbase.dead)?;
        }
        for records in &self.fleets {
            tombstone_all(plan, doc, saved, records)?;
        }
        for (&fleet, &owner) in &self.owners {
            unlist_fleet(country_edit(plan, doc, saved, owner)?, fleet)?;
        }
        for &(dead, owner) in &self.carried {
            tombstone_all(plan, doc, saved, &[dead])?;
            if let Some(owner) = owner {
                let edit = country_edit(plan, doc, saved, owner)?;
                unlist(edit, keys::OWNED_ARMIES, &[dead.1], Emptied::Keep)?;
            }
        }
        drop_leaders(plan, s, saved, &self.leaders)?;
        write_rows(plan, s, saved, &self.rows, system, gone)?;
        for end in &self.ends {
            empty_end(plan, s, saved, end, gone)?;
        }
        for &country in &self.countries {
            drop_dependents(plan, s, saved, country)?;
        }
        tombstone_all(plan, doc, saved, &self.sites)?;
        for &(country, planet) in &self.finders {
            anomaly::unlist(country_edit(plan, doc, saved, country)?, planet)?;
        }
        for &(id, anchor) in &self.storms {
            saved.keep(doc, SavedTable::Storm, id, anchor)?;
            leave_storm(plan.edit_record(doc, anchor)?, system)?;
        }
        for &(dead, country) in &self.auras {
            tombstone_all(plan, doc, saved, &[dead])?;
            if let Some(country) = country {
                let edit = country_edit(plan, doc, saved, country)?;
                unlist(edit, keys::PSIONIC_AURAS, &[dead.1], Emptied::Keep)?;
            }
        }
        for &(other, aura) in &self.in_auras {
            let anchor = system_statement(doc, other).ok_or(OpError::UnknownSystem(other))?;
            saved.keep(doc, SavedTable::System, other, anchor)?;
            let edit = plan.edit(doc, other)?;
            let entity = edit.entity()?.clone();
            drop_statements_naming(edit, &entity, keys::PSIONIC_AURA, &[aura], own_id);
        }
        tombstone_all(plan, doc, saved, &self.rifts)?;
        for &(id, anchor) in &self.networks {
            saved.keep(doc, SavedTable::WaystationNetwork, id, anchor)?;
            let edit = plan.edit_record(doc, anchor)?;
            unlist(edit, keys::WAYSTATIONS, &self.all_starbases, Emptied::Keep)?;
        }
        if let Some((sector, anchor)) = self.sector {
            saved.keep(doc, SavedTable::Sector, sector, anchor)?;
            let edit = plan.edit_record(doc, anchor)?;
            unlist(edit, keys::SYSTEMS, &[system], Emptied::Keep)?;
        }
        for &country in &self.countries {
            tombstone_country(plan, doc, saved, country)?;
        }
        Ok(())
    }

    /// ", with 2 colonies, 3 starbases and 5 fleets", for the description.
    fn what(&self) -> String {
        let starbases = self.starbases.len() + self.deletion.ring_starbases().len();
        let fleets = self.fleets.len() + self.deletion.station_count();
        let tunnels = self
            .ends
            .iter()
            .filter(|end| end.kind == SHROUD_TUNNEL)
            .count();
        let pairs = (self.ends.len() - tunnels).div_ceil(2);
        let mut parts = Vec::new();
        for (n, noun, nouns) in [
            (self.deletion.teardowns.len(), "colony", "colonies"),
            (starbases, "starbase", "starbases"),
            (fleets, "fleet", "fleets"),
            (self.rows.len(), "megastructure", "megastructures"),
            (pairs, "wormhole pair", "wormhole pairs"),
            (tunnels, "shroud tunnel", "shroud tunnels"),
            (self.countries.len(), "pre-FTL country", "pre-FTL countries"),
        ] {
            if n > 0 {
                parts.push(plural_of(n, noun, nouns));
            }
        }
        match parts.is_empty() {
            true => String::new(),
            false => format!(", with {}", and_list(&parts)),
        }
    }
}

/// The armies aboard `ships` but those in `colonies_armies`, each with its owner.
fn carried(
    doc: &Document,
    ships: &[u32],
    colonies_armies: &[u32],
) -> Result<Vec<(Dead, Option<u32>)>, OpError> {
    let mut carried = Vec::new();
    for &ship in ships {
        let Some(found) = live(doc, SavedTable::Ship, ship)? else {
            continue;
        };
        for army in some_ids(&found.node, keys::ARMY, found.src) {
            if colonies_armies.contains(&army) {
                continue;
            }
            if let Some(found) = live(doc, SavedTable::Army, army)? {
                let owner = some_id(&found.node, keys::OWNER, found.src);
                carried.push(((SavedTable::Army, army, found.anchor), owner));
            }
        }
    }
    Ok(carried)
}

/// The cosmic storms with system `system` in their cluster's `objects` or on their `path`.
fn storms(doc: &Document, system: u32) -> Result<Vec<(u32, Anchor)>, OpError> {
    let digits = system.to_string();
    let finder = Finder::new(digits.as_bytes());
    let rows = live_where(
        doc,
        SavedTable::Storm,
        doc.inner_index(keys::STORMS)?,
        keys::STORMS,
        |bytes| finder.find(bytes).is_some(),
        |storm, src| {
            let cluster = storm.find(keys::CLUSTER, src);
            cluster.is_some_and(|c| read::ids(c, keys::OBJECTS, src).contains(&system))
                || read::ids(storm, keys::PATH, src).contains(&system)
        },
    )?;
    Ok(rows.into_iter().map(|(id, row)| (id, row.anchor)).collect())
}

/// Take system `system` out of a storm's cluster `objects`, as 4.6.0 does, and off its `path`,
/// lowering `storm_current_path_index` by each step taken out before it, and to the last step
/// left when it stood past them.
fn leave_storm(edit: &mut crate::ops::Edit, system: u32) -> Result<(), OpError> {
    let storm = edit.entity()?.clone();
    if let Some(objects) = storm
        .find(keys::CLUSTER, &edit.buf)
        .and_then(|cluster| cluster.find(keys::OBJECTS, &edit.buf))
        .cloned()
    {
        unlist_in(edit, &objects, &[system], Emptied::Keep);
    }
    let Some(path) = storm.find(keys::PATH, &edit.buf).cloned() else {
        return Ok(());
    };
    let steps = items(edit, &path);
    let index = read::scalar_u32(&storm, keys::STORM_CURRENT_PATH_INDEX, &edit.buf);
    unlist_in(edit, &path, &[system], Emptied::Keep);
    if let Some(index) = index {
        let taken = |steps: &[(u32, Span)]| steps.iter().filter(|&&(id, _)| id == system).count();
        let before = taken(&steps[..steps.len().min(index as usize)]);
        let last = (steps.len() - taken(&steps)).saturating_sub(1);
        let left = (index as usize - before).min(last) as u32;
        if left != index {
            edit.set_scalar(&[keys::STORM_CURRENT_PATH_INDEX], left.to_string())?;
        }
    }
    Ok(())
}

/// The psionic auras whose source is system `system`, each with its country, and every other
/// system whose `psionic_aura` names one of them, with the aura.
#[allow(clippy::type_complexity)]
fn auras(
    doc: &Document,
    system: u32,
) -> Result<(Vec<(Dead, Option<u32>)>, Vec<(u32, u32)>), OpError> {
    let lines = IdLines::new(keys::SYSTEM, &[system]);
    let rows = live_where(
        doc,
        SavedTable::PsionicAura,
        doc.inner_index(keys::PSIONIC_AURAS)?,
        keys::PSIONIC_AURAS,
        |bytes| lines.found_in(bytes),
        |aura, src| read::scalar_u32(aura, keys::SYSTEM, src) == Some(system),
    )?;
    let mut auras = Vec::new();
    let mut in_auras = Vec::new();
    for (id, aura) in rows {
        let country = some_id(&aura.node, keys::COUNTRY, aura.src);
        auras.push(((SavedTable::PsionicAura, id, aura.anchor), country));
        let key = format!("{}={id}\n", keys::PSIONIC_AURA);
        for other in rows_containing(doc, Table::Entity(EntityKind::System), key.as_bytes())? {
            let naming =
                statements_naming(&other.node, other.src, keys::PSIONIC_AURA, &[id], own_id);
            if other.id != system && !naming.is_empty() {
                in_auras.push((other.id, id));
            }
        }
    }
    Ok((auras, in_auras))
}

/// The waystation networks, which no op writes, listing one of `starbases`.
fn networks(doc: &Document, starbases: &[u32]) -> Result<Vec<(u32, Anchor)>, OpError> {
    if starbases.is_empty() {
        return Ok(Vec::new());
    }
    let rows = live_where(
        doc,
        SavedTable::WaystationNetwork,
        Some(doc.index()),
        keys::WAYSTATION_NETWORKS,
        |_| true,
        |network, src| {
            read::ids(network, keys::WAYSTATIONS, src)
                .iter()
                .any(|id| starbases.contains(id))
        },
    )?;
    Ok(rows.into_iter().map(|(id, row)| (id, row.anchor)).collect())
}

/// The planets system `system` lists that the save holds.
fn planets(doc: &Document, system: u32) -> Result<Vec<u32>, OpError> {
    let mut held = Vec::new();
    for planet in read_spec::bodies(doc, system)? {
        match planet_entity(doc, planet) {
            Ok(_) => held.push(planet),
            Err(OpError::UnknownPlanet(_)) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(held)
}

/// Take `system` out of the `objects` of every block of `clusters` that lists it.
fn leave_clusters(
    plan: &mut Plan,
    doc: &Document,
    saved: &mut Saved,
    system: u32,
) -> Result<(), OpError> {
    let Some(section) = doc.index().section(keys::CLUSTERS) else {
        return Ok(());
    };
    let anchor = Anchor::Original(section.stmt);
    let edit = plan.edit_record(doc, anchor)?;
    let clusters = edit.entity()?.children().iter();
    let lists: Vec<Node> = clusters
        .filter_map(|cluster| cluster.find(keys::OBJECTS, &edit.buf).cloned())
        .collect();
    let mut left = 0;
    for list in lists {
        left += unlist_in(edit, &list, &[system], Emptied::Drop);
    }
    if left > 0 {
        saved.keep(doc, SavedTable::Clusters, 0, anchor)?;
    }
    Ok(())
}
