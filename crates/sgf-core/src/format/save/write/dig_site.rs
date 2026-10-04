//! `AddDigSite` and `RemoveDigSite`: one entry of `archaeological_sites.sites`. A new entry
//! is written as the game writes a site nobody has touched, less `visible_to`, which the game
//! fills in itself. A removal takes the entry alone: the order of a fleet excavating the site
//! is left as it stands.

use crate::NULL_ID;
use crate::format::save::added::Table;
use crate::format::save::alloc::{TableEnd, next_id};
use crate::format::save::dig_sites::{self, PLANET_LOCATION};
use crate::format::save::read_spec::bodies;
use crate::format::save::write::move_planet::is_star_class;
use crate::format::save::write::planet_entry::PlanetEntry;
use crate::keys;
use crate::ops::rules::{Form, check_text};
use crate::ops::{Emitted, Op, OpError, Plan, Planned, Subject};
use crate::projections::read;
use crate::session::Session;

/// `ARCHAEOLOGICAL_SITE_DISCOVERY_DAYS`, which every untouched site's `days_left` holds.
const DISCOVERY_DAYS: u32 = 90;

pub(crate) fn plan_add(
    plan: &mut Plan,
    s: &Session,
    planet: u32,
    kind: &str,
    difficulty: i32,
) -> Result<Planned, OpError> {
    check_text("a dig site type", kind, Form::Bare)?;
    let PlanetEntry { node, src, system } = PlanetEntry::open(s, planet)?;
    let primary = bodies(&s.doc, system)?.first() == Some(&planet);
    if primary || is_star_class(&read::text(&node, keys::PLANET_CLASS, src)) {
        return Err(OpError::StarDigSite(planet));
    }
    let sites = dig_sites::sites(&s.doc)?;
    if let Some((_, held)) = sites.iter().find(|(_, site)| site.planet == Some(planet)) {
        return Err(OpError::DigSitePresent {
            planet,
            site: held.id,
        });
    }
    let id = next_id(&s.doc, Table::DigSite)?;
    let mut end = TableEnd::of(&s.doc, Table::DigSite)?;
    let entry = site_entry(end.indent(), id, planet, kind, difficulty);
    plan.emit(Emitted::Record, end.at(), end.shape(entry.into_bytes()));
    plan.stale(Subject::Planet { id: planet, system });
    Ok(Planned {
        description: format!("Add dig site {kind} (#{id}) to planet #{planet}"),
        inverse: Op::RemoveDigSite { site: id },
    })
}

pub(crate) fn plan_remove(plan: &mut Plan, s: &Session, site: u32) -> Result<Planned, OpError> {
    let (anchor, found) = dig_sites::sites(&s.doc)?
        .into_iter()
        .find(|(_, each)| each.id == site)
        .ok_or(OpError::UnknownDigSite(site))?;
    let planet = found.planet.ok_or(OpError::DigSiteNotOnPlanet(site))?;
    plan.erase(&s.doc, Subject::Record(anchor), anchor)?;
    if let Ok(system) = planet_of(s, planet) {
        plan.stale(Subject::Planet { id: planet, system });
    }
    let dig = if found.excavating {
        ", which a fleet is excavating"
    } else {
        ""
    };
    Ok(Planned {
        description: format!(
            "Remove dig site {} (#{site}) from planet #{planet}{dig}",
            found.kind
        ),
        inverse: Op::AddDigSite {
            planet,
            site_type: found.kind,
            difficulty: found.difficulty,
        },
    })
}

/// The system planet `id` is a body of.
fn planet_of(s: &Session, id: u32) -> Result<u32, OpError> {
    Ok(PlanetEntry::open(s, id)?.system)
}

/// Site `id`'s entry, each line indented from `indent` and the last ending its line.
fn site_entry(indent: &[u8], id: u32, planet: u32, kind: &str, difficulty: i32) -> String {
    let lines = [
        format!("{id}="),
        "{".to_owned(),
        format!("\t{}=", keys::LOCATION),
        "\t{".to_owned(),
        format!("\t\t{}={PLANET_LOCATION}", keys::TYPE),
        format!("\t\t{}={planet}", keys::ID),
        "\t}".to_owned(),
        format!("\t{}={NULL_ID}", keys::LAST_EXCAVATOR_COUNTRY),
        format!("\t{}={NULL_ID}", keys::EXCAVATOR_FLEET),
        format!("\t{}=\"{kind}\"", keys::TYPE),
        format!("\t{}=0", keys::INDEX),
        format!("\t{}=0", keys::CLUES),
        format!("\t{}=0", keys::LAST_ROLL),
        format!("\t{}={DISCOVERY_DAYS}", keys::DAYS_LEFT),
        format!("\t{}={difficulty}", keys::DIFFICULTY),
        "}".to_owned(),
    ];
    let indent = String::from_utf8_lossy(indent);
    lines
        .iter()
        .map(|line| format!("{indent}{line}\n"))
        .collect()
}
