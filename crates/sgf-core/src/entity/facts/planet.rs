//! What a `planets.planet` entity says about itself.
//!
//! 4.x moved pops, districts and buildings into `colony`, so the planet names its colony
//! and the pop count is read from there; everything else is on the planet.

use crate::cst::Node;
use crate::entity::facts::{Sheet, count, other, reference};
use crate::entity::views::{EntityAddr, EntityKind};
use crate::keys;
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

pub(crate) fn sheet(facts: &PlanetFacts, doc: &crate::document::Document) -> Sheet {
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
fn pops(doc: &crate::document::Document, colony: u32) -> Option<u32> {
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

/// The planet's deposits as `type` keys with counts, in order of first appearance. Each
/// id is one small entity of the top-level `deposit` table, and a planet holds few.
fn deposit_keys(doc: &crate::document::Document, ids: &[u32]) -> Vec<(String, u32)> {
    let mut kinds: Vec<(String, u32)> = Vec::new();
    for &id in ids {
        let Some((node, src)) = other(doc, EntityAddr::new(EntityKind::Deposit, id)) else {
            continue;
        };
        let Some(kind) = read::scalar(&node, keys::TYPE, src) else {
            continue;
        };
        match kinds.iter_mut().find(|(k, _)| k == kind) {
            Some((_, count)) => *count += 1,
            None => kinds.push((kind.to_owned(), 1)),
        }
    }
    kinds
}
