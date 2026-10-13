//! The save's reader for a [`ConstructionSite`]: each body's class, whether it is a star, a
//! moon or a colony, and the deposits, timed modifiers and planet flags it has, with the
//! system's own timed modifiers and flags.

use crate::entity::views::EntityKind;
use crate::format::save::added::{Table, row};
use crate::format::save::galaxy::bodies::planet_ids;
use crate::format::save::galaxy::systems::timed_modifiers;
use crate::format::save::write::planet_entry::{is_star, role};
use crate::format::save::{entity, planet_entity, system_statement};
use crate::keys;
use crate::ops::{OpError, Subject};
use crate::projections::read;
use crate::session::Session;
use crate::views::details::{ConstructionSite, SiteBody};

pub(crate) fn read(s: &Session, system: u32) -> Result<ConstructionSite, OpError> {
    let doc = &s.doc;
    let anchor = system_statement(doc, system).ok_or(OpError::UnknownSystem(system))?;
    let (node, src) = entity(doc, Subject::System(system), anchor)?;
    let mut site = ConstructionSite {
        system,
        modifiers: owned(timed_modifiers(&node, src)),
        flags: owned(read::flags(&node, src)),
        bodies: Vec::new(),
    };
    for (i, id) in planet_ids(&node, src).into_iter().enumerate() {
        let (planet, src) = match planet_entity(doc, id) {
            Ok(found) => found,
            Err(OpError::UnknownPlanet(_)) => continue,
            Err(error) => return Err(error),
        };
        let mut deposits = Vec::new();
        for deposit in read::ids(&planet, keys::DEPOSITS, src) {
            if let Some(entry) = row(doc, Table::Entity(EntityKind::Deposit), deposit)?
                && let Some(kind) = read::scalar(&entry.node, keys::TYPE, entry.src)
            {
                deposits.push(kind.to_owned());
            }
        }
        site.bodies.push(SiteBody {
            id,
            class: read::text(&planet, keys::PLANET_CLASS, src),
            star: is_star(role(&planet, src, i == 0, s.star_classes())),
            moon: planet.find(keys::MOON_OF, src).is_some(),
            colony: read::scalar_u32(&planet, keys::OWNER, src)
                .is_some_and(|owner| owner != crate::NULL_ID),
            deposits,
            modifiers: owned(timed_modifiers(&planet, src)),
            flags: owned(read::flags(&planet, src)),
        });
    }
    Ok(site)
}

fn owned<'a>(items: impl Iterator<Item = &'a str>) -> Vec<String> {
    items.map(str::to_owned).collect()
}
