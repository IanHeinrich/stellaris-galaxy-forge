//! What a `planets.planet` entity says about itself.
//!
//! 4.x moved pops, districts and buildings into `colony`, so the planet names its colony
//! and the pop count is read from there; everything else is on the planet.

use crate::cst::Node;
use crate::document::Document;
use crate::entity::facts::{Sheet, count, other, reference, statement_at, system};
use crate::entity::views::{
    EntityAddr, EntityKind, PlanetPage, PlanetPageColony, PlanetPageDeposit, PlanetPageMoon,
    PlanetPageSpecies, PlanetPageTimedModifier,
};
use crate::keys;
use crate::overlay::Anchor;
use crate::projections::name::NameTemplate;
use crate::projections::read;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct PlanetFacts {
    pub class: String,
    pub size: Option<u32>,
    pub name: NameTemplate,
    pub name_key: String,
    pub owner: Option<u32>,
    pub controller: Option<u32>,
    /// `coordinate.origin`: the system the planet orbits in.
    pub origin: Option<u32>,
    pub moon_of: Option<u32>,
    pub colony: Option<u32>,
    pub colonize_date: String,
    /// Deposit ids in save order; the caller turns them into `deposit` keys.
    pub deposits: Vec<u32>,
    pub orbitals: u32,
    pub flags: u32,
}

pub(crate) fn read(node: &Node, src: &[u8]) -> PlanetFacts {
    PlanetFacts {
        class: read::text(node, keys::PLANET_CLASS, src),
        size: read::scalar_u32(node, keys::PLANET_SIZE, src),
        name: read::name(node, src),
        name_key: read::name_key(node, src),
        owner: reference(node, keys::OWNER, src),
        controller: reference(node, keys::CONTROLLER, src),
        origin: read::origin(node, src),
        moon_of: reference(node, keys::MOON_OF, src),
        colony: reference(node, keys::COLONY, src),
        colonize_date: read::text(node, keys::COLONIZE_DATE, src),
        deposits: read::ids(node, keys::DEPOSITS, src),
        orbitals: count(node, keys::PLANET_ORBITALS, src),
        flags: count(node, keys::FLAGS, src),
    }
}

pub(crate) fn sheet(facts: &PlanetFacts, doc: &Document) -> Sheet {
    let mut sheet = Sheet::default();
    sheet.fact("Class", &facts.class, &[keys::PLANET_CLASS]);
    if let Some(size) = facts.size {
        sheet.fact("Size", &size.to_string(), &[keys::PLANET_SIZE]);
    }
    if let Some(owner) = facts.owner {
        sheet.reference("Owner", EntityKind::Country, owner, &[keys::OWNER]);
    }
    // The controller is worth a row only while an owned planet is occupied; an unowned
    // star names one too, and there it says nothing.
    if let Some(controller) = facts
        .controller
        .filter(|c| facts.owner.is_some_and(|owner| owner != *c))
    {
        sheet.reference(
            "Controller",
            EntityKind::Country,
            controller,
            &[keys::CONTROLLER],
        );
    }
    if let Some(origin) = facts.origin {
        sheet.reference(
            "Orbits",
            EntityKind::System,
            origin,
            &[keys::COORDINATE, keys::ORIGIN],
        );
    }
    if let Some(moon_of) = facts.moon_of {
        sheet.reference("Moon of", EntityKind::Planet, moon_of, &[keys::MOON_OF]);
    }
    sheet.fact("Colonised", &facts.colonize_date, &[keys::COLONIZE_DATE]);
    if let Some(colony) = facts.colony {
        sheet.reference("Colony", EntityKind::Colony, colony, &[keys::COLONY]);
        if let Some(pops) = pops(doc, colony) {
            sheet.borrowed("Pops", pops.to_string());
        }
    }
    let deposits = deposit_keys(doc, &facts.deposits);
    sheet.fact("Deposits", &listed(&deposits), &[keys::DEPOSITS]);
    sheet.rows(
        "Deposits",
        crate::as_u32(facts.deposits.len()),
        &[keys::DEPOSITS],
        Some(EntityKind::Deposit),
    );
    sheet.rows("Orbitals", facts.orbitals, &[keys::PLANET_ORBITALS], None);
    sheet.rows("Flags", facts.flags, &[keys::FLAGS], None);
    sheet
}

/// `colony.<id>.num_sapient_pops`: the one fact a planet keeps in another entity.
fn pops(doc: &Document, colony: u32) -> Option<u32> {
    let (node, src) = other(doc, EntityAddr::new(EntityKind::Colony, colony))?;
    read::scalar_u32(&node, keys::NUM_SAPIENT_POPS, src)
}

/// `d_energy_5 x2, d_minerals_3`: the keys as one row, so a colony's ten features do not
/// become ten rows.
fn listed(deposits: &[(String, u32)]) -> String {
    deposits
        .iter()
        .map(|(key, count)| match count {
            1 => key.clone(),
            n => format!("{key} x{n}"),
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// The planet's deposits as `type` keys with counts, in order of first appearance.
fn deposit_keys(doc: &Document, ids: &[u32]) -> Vec<(String, u32)> {
    let mut kinds: Vec<(String, u32)> = Vec::new();
    for deposit in deposits(doc, ids) {
        match kinds.iter_mut().find(|(k, _)| *k == deposit.kind) {
            Some((_, count)) => *count += 1,
            None => kinds.push((deposit.kind, 1)),
        }
    }
    kinds
}

/// Each id is one small entity of the top-level `deposit` table, and a planet holds few.
/// An id the table lacks, or one naming no `type`, is left out.
fn deposits(doc: &Document, ids: &[u32]) -> Vec<PlanetPageDeposit> {
    ids.iter()
        .filter_map(|&id| {
            let (node, src) = other(doc, EntityAddr::new(EntityKind::Deposit, id))?;
            Some(PlanetPageDeposit {
                id,
                kind: read::scalar(&node, keys::TYPE, src)?.to_owned(),
                swap_type: read::scalar(&node, keys::SWAP_TYPE, src).map(str::to_owned),
            })
        })
        .collect()
}

/// Planet `id`'s own page, `node` being its `<id>=` statement in `src`.
pub(crate) fn page(doc: &Document, id: u32, node: &Node, src: &[u8]) -> PlanetPage {
    let facts = read(node, src);
    let addr = EntityAddr::new(EntityKind::Planet, id);
    PlanetPage {
        id,
        label: crate::entity::label(addr, Some(&facts.name)),
        parent: parent(doc, id, &facts),
        moons: moons(doc, &read::ids(node, keys::MOONS, src)),
        deposits: deposits(doc, &facts.deposits),
        colony: facts
            .colony
            .map(|colony| colony_page(doc, colony, &facts.colonize_date)),
        orbit: read::scalar(node, keys::ORBIT, src).and_then(|o| o.parse().ok()),
        planet_modifiers: node
            .find_all(keys::PLANET_MODIFIER, src)
            .filter_map(|m| Some(m.scalar_str(src)?.to_owned()))
            .collect(),
        timed_modifiers: timed_modifiers(node, src),
        surveyed_by: reference(node, keys::SURVEYED_BY, src),
        station: reference(node, keys::SHIPCLASS_ORBITAL_STATION, src),
        name: facts.name,
        name_key: facts.name_key,
        class: facts.class,
        size: facts.size,
        system: facts.origin,
        owner: facts.owner,
        controller: facts.controller,
        flags: facts.flags,
    }
}

/// A moon names the body it orbits; anything else orbits the system's primary body, the
/// first `planet=` the system lists.
fn parent(doc: &Document, id: u32, facts: &PlanetFacts) -> Option<u32> {
    facts.moon_of.or_else(|| {
        let (node, src) = other(doc, EntityAddr::new(EntityKind::System, facts.origin?))?;
        let primary = *system::read(&node, src).planets.first()?;
        (primary != id).then_some(primary)
    })
}

fn moons(doc: &Document, ids: &[u32]) -> Vec<PlanetPageMoon> {
    ids.iter()
        .filter_map(|&id| {
            let (node, src) = other(doc, EntityAddr::new(EntityKind::Planet, id))?;
            let moon = read(&node, src);
            Some(PlanetPageMoon {
                id,
                name: moon.name,
                name_key: moon.name_key,
                class: moon.class,
                size: moon.size,
            })
        })
        .collect()
}

/// `timed_modifier={ items={ { modifier=... days=... } } }`.
fn timed_modifiers(node: &Node, src: &[u8]) -> Vec<PlanetPageTimedModifier> {
    let Some(items) = node
        .find(keys::TIMED_MODIFIER, src)
        .and_then(|t| t.find(keys::ITEMS, src))
    else {
        return Vec::new();
    };
    items
        .children()
        .iter()
        .filter_map(|item| {
            Some(PlanetPageTimedModifier {
                modifier: read::scalar(item, keys::MODIFIER, src)?.to_owned(),
                days: read::scalar(item, keys::DAYS, src)?.parse().ok()?,
            })
        })
        .collect()
}

/// What `colony.<id>` says; only the id and the planet's date when the table lacks it.
fn colony_page(doc: &Document, id: u32, colonize_date: &str) -> PlanetPageColony {
    let mut colony = PlanetPageColony {
        id,
        colonised: (!colonize_date.is_empty()).then(|| colonize_date.to_owned()),
        final_designation: None,
        designation: None,
        pops: 0,
        species: Vec::new(),
    };
    let Some((node, src)) = other(doc, EntityAddr::new(EntityKind::Colony, id)) else {
        return colony;
    };
    let owned = |key: &str| read::scalar(&node, key, src).map(str::to_owned);
    colony.final_designation = owned(keys::FINAL_DESIGNATION);
    colony.designation = owned(keys::DESIGNATION);
    colony.pops = read::scalar_u32(&node, keys::NUM_SAPIENT_POPS, src).unwrap_or(0);
    colony.species = node
        .find(keys::SPECIES_INFORMATION, src)
        .map(|info| {
            info.children()
                .iter()
                .filter_map(|entry| {
                    let species = entry.key_str(src)?.parse().ok()?;
                    Some(PlanetPageSpecies {
                        id: species,
                        name: species_name(doc, species),
                        pops: read::scalar_u32(entry, keys::NUM_POPS, src).unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    colony
}

/// `species_db.<id>.name`: species are no inspector kind, so the page carries the name.
fn species_name(doc: &Document, id: u32) -> NameTemplate {
    doc.index()
        .entity(keys::SPECIES_DB, u64::from(id))
        .and_then(|entity| statement_at(doc, Anchor::Original(entity.stmt)))
        .map(|(node, src)| read::name(&node, src))
        .unwrap_or_default()
}
