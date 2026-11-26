//! Why a system the file held is not deleted: an empire's capital or starting system is in
//! it, or it holds a row added since the file was opened, which undo could not put back.

use memchr::memmem::Finder;

use crate::cst::Node;
use crate::document::Document;
use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, row, rows_containing, rows_where};
use crate::format::save::galaxy::bypasses::{NATURAL, natural_wormholes};
use crate::format::save::write::fleets::present_fleets;
use crate::format::save::write::megastructure_links::MEGASTRUCTURES;
use crate::format::save::write::teardown::{StarbaseTeardown, some_id, some_ids};
use crate::format::save::{entity, planet_entity, system_statement};
use crate::keys;
use crate::ops::{OpError, Subject};
use crate::projections::read;
use crate::scan::{self, Value};
use crate::session::Session;

/// The `type` of a pre-FTL country, which goes with its homeworld.
pub(crate) const PRIMITIVE: &str = "primitive";

const CAPITAL: &str = "it holds an empire's capital";
const ADDED_WORMHOLE: &str =
    "it has a wormhole added since the file was opened, so remove the wormhole first";
const ADDED_MEGASTRUCTURE: &str =
    "it has a megastructure added since the file was opened, so remove it first";
const START: &str = "it is an empire's starting system";
/// The starbase `type` of a nomad empire's capital arkship.
const CAPITAL_ARKSHIP: &str = "sarkship_capital";

/// Why a system is kept.
enum Kept {
    /// Deleting it would leave the save broken, or undo could not put it back.
    Refused(&'static str),
    /// No deletion of a system holding it has been tried in game.
    Untried(&'static str),
}

/// Refuse the deletion of system `system`, whose planets are `planets`.
pub(crate) fn check(s: &Session, system: u32, planets: &[u32]) -> Result<(), OpError> {
    let reason = match holds(s, system, planets)? {
        Some(Kept::Refused(reason)) => reason.to_owned(),
        Some(Kept::Untried(reason)) => format!("{reason}, and that hasn't been tested in game"),
        None => return Ok(()),
    };
    Err(OpError::SystemKept { system, reason })
}

/// What system `system` holds, or what names it, that keeps it.
fn holds(s: &Session, system: u32, planets: &[u32]) -> Result<Option<Kept>, OpError> {
    let doc = &s.doc;
    let anchor = system_statement(doc, system).ok_or(OpError::UnknownSystem(system))?;
    let (node, src) = entity(doc, Subject::System(system), anchor)?;
    let colonies = colonies(doc, planets)?;
    if capitals(doc, &colonies)?
        .iter()
        .any(|&(_, primitive)| !primitive)
        || holds_capital_arkship(s, system, &some_ids(&node, keys::STARBASES, src))?
    {
        return Ok(Some(Kept::Refused(CAPITAL)));
    }
    let naturals = natural_wormholes(doc, &s.graph.systems)?;
    let added = |id| doc.added().get(NATURAL, id).is_some();
    if naturals
        .iter()
        .any(|end| end.system == system && added(end.id))
    {
        return Ok(Some(Kept::Refused(ADDED_WORMHOLE)));
    }
    let rows = system_rows(doc, system, &node, src)?;
    if rows
        .iter()
        .any(|&id| doc.added().get(MEGASTRUCTURES, id).is_some())
    {
        return Ok(Some(Kept::Refused(ADDED_MEGASTRUCTURE)));
    }
    if starts_an_empire(doc, system) {
        return Ok(Some(Kept::Untried(START)));
    }
    Ok(None)
}

/// Whether a nomad empire's capital arkship stands in system `system`: one of its listed
/// `starbases`, or a starbase whose station's fleet is in its `fleet_presence`.
fn holds_capital_arkship(s: &Session, system: u32, starbases: &[u32]) -> Result<bool, OpError> {
    let doc = &s.doc;
    let mut found = Vec::new();
    for &id in starbases {
        found.extend(StarbaseTeardown::read(doc, id)?);
    }
    for fleet in present_fleets(s, system)? {
        found.extend(StarbaseTeardown::of_fleet(doc, fleet)?);
    }
    Ok(found
        .iter()
        .any(|starbase| starbase.kind == CAPITAL_ARKSHIP))
}

/// The colonies on `planets`.
fn colonies(doc: &Document, planets: &[u32]) -> Result<Vec<u32>, OpError> {
    let mut colonies = Vec::new();
    for &planet in planets {
        let (node, src) = planet_entity(doc, planet)?;
        colonies.extend(some_id(&node, keys::COLONY, src));
    }
    Ok(colonies)
}

/// The countries whose `capital` is one of `colonies`, each with whether it is pre-FTL.
pub(crate) fn capitals(doc: &Document, colonies: &[u32]) -> Result<Vec<(u32, bool)>, OpError> {
    if colonies.is_empty() {
        return Ok(Vec::new());
    }
    let lines: Vec<String> = colonies
        .iter()
        .map(|colony| format!("{}={colony}", keys::CAPITAL))
        .collect();
    let finders: Vec<Finder> = lines
        .iter()
        .map(|line| Finder::new(line.as_bytes()))
        .collect();
    let countries = rows_where(doc, Table::Entity(EntityKind::Country), |bytes| {
        finders.iter().any(|finder| finder.find(bytes).is_some())
    })?;
    Ok(countries
        .iter()
        .filter(|country| {
            some_id(&country.node, keys::CAPITAL, country.src)
                .is_some_and(|c| colonies.contains(&c))
        })
        .map(|country| {
            let kind = read::text(&country.node, keys::TYPE, country.src);
            (country.id, kind == PRIMITIVE)
        })
        .collect())
}

/// The live `megastructures` rows of system `system`, whose entry is `node`: those its list
/// names and those whose origin is the system.
pub(crate) fn system_rows(
    doc: &Document,
    system: u32,
    node: &Node,
    src: &[u8],
) -> Result<Vec<u32>, OpError> {
    let mut ids: Vec<u32> = Vec::new();
    for id in some_ids(node, keys::MEGASTRUCTURES, src) {
        if row(doc, MEGASTRUCTURES, id)?.is_some() {
            ids.push(id);
        }
    }
    // A row's origin is written in decimal, so a row without the system's digits is not there.
    let digits = system.to_string();
    for found in rows_containing(doc, MEGASTRUCTURES, digits.as_bytes())? {
        if read::origin(&found.node, found.src) == Some(system) && !ids.contains(&found.id) {
            ids.push(found.id);
        }
    }
    Ok(ids)
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
