//! Why a system the file held is not deleted: it holds something, or something else in the
//! save names it or a planet in it, that no deletion has been tried with in game.

use memchr::memmem::Finder;

use crate::cst::Node;
use crate::document::Document;
use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, row, rows_containing, rows_where};
use crate::format::save::dig_sites::{self, PLANET_LOCATION};
use crate::format::save::event_targets;
use crate::format::save::galaxy::bypasses::natural_wormholes;
use crate::format::save::write::fleets::present_fleets;
use crate::format::save::write::megastructure_links::MEGASTRUCTURES;
use crate::format::save::write::teardown::{some_id, some_ids};
use crate::format::save::{entity, planet_entity, system_statement};
use crate::keys;
use crate::ops::{EventTargetOf, OpError, Subject};
use crate::projections::read;
use crate::scan::{self, Value};
use crate::session::Session;

const OWNED: &str = "it has an owner";
const STARBASE: &str = "it has a starbase";
const COLONY: &str = "it has a colony";
const FLEET: &str = "it has a fleet in it";
const BYPASS: &str = "it has a wormhole, gateway or other bypass";
const MEGASTRUCTURE: &str = "it has a megastructure";
const STORM: &str = "a cosmic storm is on it or has it on its path";
const RIFT: &str = "it has an astral rift";
const AURA: &str = "it has a psionic aura";
const START: &str = "it is an empire's starting system";
const SITE: &str = "it has a dig site";
const ANOMALY: &str = "a country has found an anomaly in it";
const TARGET: &str = "a saved event target names it or something in it";
const COURSE: &str = "a fleet outside it has it in its course, its orders or its past";

/// Refuse the deletion of system `system`, whose planets are `planets`.
pub(crate) fn check(s: &Session, system: u32, planets: &[u32]) -> Result<(), OpError> {
    match holds(s, system, planets)? {
        Some(holds) => Err(OpError::SystemKept {
            system,
            reason: format!("{holds}, and that hasn't been tested in game"),
        }),
        None => Ok(()),
    }
}

/// What system `system` holds, or what names it, that keeps it.
fn holds(s: &Session, system: u32, planets: &[u32]) -> Result<Option<&'static str>, OpError> {
    let doc = &s.doc;
    let held = s.graph.systems.get(&system);
    let anchor = system_statement(doc, system).ok_or(OpError::UnknownSystem(system))?;
    let (node, src) = entity(doc, Subject::System(system), anchor)?;
    let owner = held.and_then(|system| system.owner);
    if owner.is_some() || some_id(&node, keys::SECTOR, src).is_some() {
        return Ok(Some(OWNED));
    }
    if !some_ids(&node, keys::STARBASES, src).is_empty() {
        return Ok(Some(STARBASE));
    }
    for &planet in planets {
        let (planet, src) = planet_entity(doc, planet)?;
        if read::scalar(&planet, keys::COLONY, src).is_some() {
            return Ok(Some(COLONY));
        }
    }
    if !present_fleets(s, system)?.is_empty() {
        return Ok(Some(FLEET));
    }
    let listed = held.is_some_and(|system| !system.bypass_ids.is_empty());
    // A pair added this session is in no system's `bypasses` until the game loads it.
    let mut naturals = natural_wormholes(doc, &s.graph.systems)?.into_iter();
    if listed || naturals.any(|wormhole| wormhole.system == system) {
        return Ok(Some(BYPASS));
    }
    if holds_megastructure(doc, system, &node, src)? {
        return Ok(Some(MEGASTRUCTURE));
    }
    if some_id(&node, keys::STORM, src).is_some() || stormed(doc, system)? {
        return Ok(Some(STORM));
    }
    if !some_ids(&node, keys::ASTRAL_RIFTS, src).is_empty() || rifted(doc, system)? {
        return Ok(Some(RIFT));
    }
    if some_id(&node, keys::PSIONIC_AURA, src).is_some() || in_aura(doc, system)? {
        return Ok(Some(AURA));
    }
    if starts_an_empire(doc, system) {
        return Ok(Some(START));
    }
    let sites = dig_sites::sites(doc)?;
    let dug = |site: &dig_sites::DigSite| site.planet.is_some_and(|p| planets.contains(&p));
    if sites.iter().any(|(_, site)| dug(site)) {
        return Ok(Some(SITE));
    }
    if planets.iter().any(|&p| !doc.anomaly_finders(p).is_empty()) {
        return Ok(Some(ANOMALY));
    }
    if targeted(doc, system, planets)? {
        return Ok(Some(TARGET));
    }
    if named_by_a_fleet(doc, system, planets)? {
        return Ok(Some(COURSE));
    }
    Ok(None)
}

/// Whether system `system`, whose entry is `node`, lists a megastructure or a live row
/// stands in it.
fn holds_megastructure(
    doc: &Document,
    system: u32,
    node: &Node,
    src: &[u8],
) -> Result<bool, OpError> {
    if !some_ids(node, keys::MEGASTRUCTURES, src).is_empty() {
        return Ok(true);
    }
    // A row's origin is written in decimal, so a row without the system's digits is not there.
    let digits = system.to_string();
    Ok(rows_containing(doc, MEGASTRUCTURES, digits.as_bytes())?
        .iter()
        .any(|row| read::origin(&row.node, row.src) == Some(system)))
}

/// Whether any row of the table `inner` in the top-level `section`, which no op writes,
/// answers `test`.
fn any_row(
    doc: &Document,
    section: &'static str,
    inner: &str,
    test: impl Fn(&Node, &[u8]) -> bool,
) -> Result<bool, OpError> {
    let Some(found) = doc.index().section(section) else {
        return Ok(false);
    };
    let src = doc.original();
    let root = read::section_node(section, found, src)?;
    let table = root.find(inner, src);
    Ok(table.is_some_and(|table| table.children().iter().any(|row| test(row, src))))
}

/// Whether a cosmic storm lists the system in its cluster or on its path.
fn stormed(doc: &Document, system: u32) -> Result<bool, OpError> {
    any_row(doc, keys::STORMS, keys::STORMS, |storm, src| {
        let cluster = storm.find(keys::CLUSTER, src);
        cluster.is_some_and(|c| read::ids(c, keys::OBJECTS, src).contains(&system))
            || read::ids(storm, keys::PATH, src).contains(&system)
    })
}

fn rifted(doc: &Document, system: u32) -> Result<bool, OpError> {
    any_row(doc, keys::ASTRAL_RIFTS, keys::RIFTS, |rift, src| {
        read::origin(rift, src) == Some(system)
    })
}

fn in_aura(doc: &Document, system: u32) -> Result<bool, OpError> {
    any_row(
        doc,
        keys::PSIONIC_AURAS,
        keys::PSIONIC_AURAS,
        |aura, src| read::scalar_u32(aura, keys::SYSTEM, src) == Some(system),
    )
}

/// Whether a country's `starting_system`, which no op writes, is the system.
fn starts_an_empire(doc: &Document, system: u32) -> bool {
    let src = doc.original();
    doc.index().entities(keys::COUNTRY).iter().any(|country| {
        let Value::Block { open, close } = country.value else {
            return false;
        };
        let inner = scan::scan_range(src, open + 1..close).ok();
        let start = inner.and_then(|inner| Some(inner.section(keys::STARTING_SYSTEM)?.value));
        matches!(start, Some(Value::Scalar(id)) if id.slice(src) == system.to_string().as_bytes())
    })
}

/// Whether a global event target is the system, a planet in it or an ambient object in it.
fn targeted(doc: &Document, system: u32, planets: &[u32]) -> Result<bool, OpError> {
    for (_, target) in event_targets::targets(doc) {
        let named = match target.target {
            Some(EventTargetOf::System { system: named }) => named == system,
            Some(EventTargetOf::Body { body }) => planets.contains(&body),
            Some(EventTargetOf::Country { .. }) | None => false,
        };
        if named {
            return Ok(true);
        }
        if let Some(object) = target.ambient_object
            && let Some(object) = row(doc, Table::AmbientObject, object)?
            && read::origin(&object.node, object.src) == Some(system)
        {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Whether a fleet's entry names the system or a planet in it. Fleets standing in the system
/// are in its `fleet_presence`, so any found here is elsewhere.
fn named_by_a_fleet(doc: &Document, system: u32, planets: &[u32]) -> Result<bool, OpError> {
    // Ids are written in decimal, so a fleet with none of their digits names none of them.
    let digits: Vec<String> = std::iter::once(&system)
        .chain(planets)
        .map(u32::to_string)
        .collect();
    let finders: Vec<Finder> = digits.iter().map(|id| Finder::new(id.as_bytes())).collect();
    let fleets = rows_where(doc, Table::Entity(EntityKind::Fleet), |bytes| {
        finders.iter().any(|finder| finder.find(bytes).is_some())
    })?;
    Ok(fleets
        .iter()
        .any(|fleet| names(&fleet.node, fleet.src, system, planets)))
}

/// Whether the block `node` of a fleet's entry, or any block in it, names the system or a
/// planet in it: as the `origin` of a coordinate, the `to` of the last jump, a `planet`, the
/// planet the fleet moves to by itself, or the `id` of a target of a planet's type. The
/// scopes a fleet's script runs in are left out, since the game looks those up as it uses
/// them.
fn names(node: &Node, src: &[u8], system: u32, planets: &[u32]) -> bool {
    node.children().iter().any(|child| {
        let Some(key) = child.key_str(src) else {
            return false;
        };
        let Some(id) = child.scalar_str(src) else {
            return key != keys::SCOPE && names(child, src, system, planets);
        };
        let Ok(id) = id.parse::<u32>() else {
            return false;
        };
        match key {
            keys::ORIGIN | keys::TO => id == system,
            keys::PLANET => planets.contains(&id),
            keys::AUTO_MOVE_TARGET => {
                planets.contains(&id)
                    && read::scalar(node, keys::TYPE, src) == Some(AUTO_MOVE_PLANET)
            }
            keys::ID => {
                let kind = read::scalar(node, keys::TYPE, src);
                planets.contains(&id)
                    && (kind == Some(PLANET_LOCATION) || kind == Some(PLANET_HOLDER))
            }
            _ => false,
        }
    })
}

/// `auto_movement.type` of a fleet on its way to a planet by itself.
const AUTO_MOVE_PLANET: &str = "auto_move_planet";
/// `deposit_holder.type` of an order on a planet's deposits.
const PLANET_HOLDER: &str = "0";
