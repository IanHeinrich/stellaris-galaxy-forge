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

use crate::cst::Node;
use crate::document::Document;
use crate::emit::system::MOON_FLAG;
use crate::entity::views::EntityKind;
use crate::format::save::added::rows;
use crate::format::save::dig_sites::{self, DigSite};
use crate::format::save::ring_world;
use crate::format::save::write::bodies::frame_bodies;
use crate::format::save::write::id_list::{Emptied, unlist, unlist_planets};
use crate::format::save::write::megastructure_links::{MEGASTRUCTURES, drop_flags};
use crate::format::save::write::planet_entry::{PlanetEntry, and_its_moons};
use crate::format::save::write::planet_entry::{is_star, role};
use crate::format::save::write::restore::{Saved, country_edit, tombstoned};
use crate::format::save::write::teardown::{Stationed, Teardown, fleet_records, some_id};
use crate::format::save::write::{add_body, anomaly};
use crate::format::save::{entity_at, planet_entity, planet_statement, system_statement};
use crate::keys;
use crate::ops::{Edit, Op, OpError, Plan, Planned, SavedTable, StarEdit, Subject};
use crate::overlay::Anchor;
use crate::projections::geometry::{Body, descendants};
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
    let moons = descendants(&bodies, planet);
    let deleted: Vec<u32> = std::iter::once(planet)
        .chain(moons.iter().copied())
        .collect();
    let deletion = Deletion::read(s, system, &bodies, deleted, Segments::Refused, &[])?;
    let mut saved = Saved::default();
    deletion.write(plan, s, &mut saved, &[])?;

    let label = if moon { "moon" } else { "planet" };
    let carrying = and_its_moons(moons.len());
    let colonies = match deletion.teardowns.len() {
        0 => String::new(),
        1 if deletion.bodies.len() == 1 => ", with its colony".to_owned(),
        1 => ", with a colony".to_owned(),
        n => format!(", with {n} colonies"),
    };
    let dug = dug(deletion.sites.len());
    let restored = format!("Restored {label} #{planet}{carrying}");
    Ok(Planned {
        description: format!("Deleted {label} #{planet}{carrying}{colonies}{dug}"),
        inverse: deletion.inverse(saved, restored),
    })
}

/// Whether a deletion takes ring world segments.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Segments {
    /// A segment refuses the deletion: it goes only with its whole ring.
    Refused,
    /// The deletion is the whole ring's. An uncolonised segment a starbase orbits goes too:
    /// a fallen empire's deep-space citadels orbit its home ring, and the ring's deletion
    /// points them at the star.
    Taken,
}

/// Bodies of one system the file held, deleted together as [`plan_delete`] deletes a body
/// and its moons, with what goes first.
pub(crate) struct Deletion {
    system: u32,
    /// The system's bodies before the deletion.
    frame: Vec<Body>,
    pub(crate) bodies: Vec<u32>,
    pub(crate) teardowns: Vec<Teardown>,
    stations: Vec<Stationed>,
    /// Uncolonised bodies with no station that a country controls, as a fallen empire
    /// controls its home ring's segments: each country and body.
    controlled: Vec<(u32, u32)>,
    pub(crate) sites: Vec<(Anchor, DigSite)>,
}

impl Deletion {
    /// `bodies` of `system`, whose bodies are `frame`, refused for a star, a megastructure
    /// row other than those in `going` on or around one, an uncolonised body a starbase
    /// orbits and a segment unless `segments` takes segments, and any colony the teardown
    /// refuses.
    pub(crate) fn read(
        s: &Session,
        system: u32,
        frame: &[Body],
        bodies: Vec<u32>,
        segments: Segments,
        going: &[u32],
    ) -> Result<Self, OpError> {
        let mut teardowns = Vec::new();
        let mut stations = Vec::new();
        let mut controlled = Vec::new();
        let sites = sites_on(s, &bodies)?;
        for &id in &bodies {
            let (node, src) = planet_entity(&s.doc, id)?;
            let refuse = |reason: String| OpError::PlanetKept { body: id, reason };
            let primary = frame.first().is_some_and(|primary| primary.id == id);
            if is_star(role(&node, src, primary, s.star_classes())) {
                return Err(OpError::StarRefused {
                    body: id,
                    edit: StarEdit::Delete,
                });
            }
            if read::scalar_u32(&node, keys::COLONY, src).is_some() {
                teardowns.push(Teardown::read(s, id, system, &node, src)?);
            } else if segments == Segments::Refused
                && some_id(&node, keys::ORBITAL_DEFENCE, src).is_some()
            {
                return Err(refuse("a starbase orbits it".to_owned()));
            }
            if segments == Segments::Refused {
                check_segment(&node, src, SEGMENT_GOES_WHOLE, refuse)?;
            }
            check_megastructures(&s.doc, id, going, refuse)?;
            let controller = some_id(&node, keys::CONTROLLER, src);
            if let Some(fleet) = some_id(&node, keys::SHIPCLASS_ORBITAL_STATION, src) {
                stations.push(Stationed {
                    planet: id,
                    fleet,
                    controller,
                    dead: fleet_records(&s.doc, fleet)?,
                });
            } else if let Some(country) = controller
                && read::scalar_u32(&node, keys::COLONY, src).is_none()
            {
                controlled.push((country, id));
            }
        }
        Ok(Self {
            system,
            frame: frame.to_vec(),
            bodies,
            teardowns,
            stations,
            controlled,
            sites,
        })
    }

    /// Write the deletion: the colonies, the stations, the controllers' `controlled_planets`,
    /// the dig sites, the finders' anomaly lists, the system's lists, a surviving parent's
    /// `moons` and habitat flag, the system's `system_flags` and its `has_habitat` once no
    /// habitat is left, and each body's tombstone.
    pub(crate) fn write(
        &self,
        plan: &mut Plan,
        s: &Session,
        saved: &mut Saved,
        system_flags: &[&str],
    ) -> Result<(), OpError> {
        let doc = &s.doc;
        for teardown in &self.teardowns {
            teardown.write_unlisted(plan, s, saved, false)?;
        }
        for station in &self.stations {
            station.write(plan, s, saved)?;
        }
        for &(country, body) in &self.controlled {
            let edit = country_edit(plan, doc, saved, country)?;
            unlist(edit, keys::CONTROLLED_PLANETS, &[body], Emptied::Keep)?;
        }
        // A site goes as `RemoveDigSite` takes it, the entry alone: the game drops an
        // excavating fleet's order on its first day.
        for (anchor, _) in &self.sites {
            plan.erase(doc, Subject::Record(*anchor), *anchor)?;
        }
        for &id in &self.bodies {
            for country in doc.anomaly_finders(id) {
                anomaly::unlist(country_edit(plan, doc, saved, country)?, id)?;
            }
        }
        let anchor =
            system_statement(doc, self.system).ok_or(OpError::UnknownSystem(self.system))?;
        saved.keep(doc, SavedTable::System, self.system, anchor)?;
        self.unlist_from_system(plan.edit(doc, self.system)?)?;
        self.write_parents(plan, s, saved)?;
        let last_habitat = self.last_habitat(s)?;
        drop_flags(plan.edit(doc, self.system)?, |flag| {
            system_flags.contains(&flag) || (last_habitat && flag == HAS_HABITAT)
        })?;
        for &id in &self.bodies {
            let anchor = planet_statement(doc, id)?.ok_or(OpError::UnknownPlanet(id))?;
            saved.keep(doc, SavedTable::Planet, id, anchor)?;
            let bytes = tombstoned(doc, anchor, id)?;
            let subject = Subject::Planet {
                id,
                system: self.system,
            };
            plan.replace(doc, subject, anchor, bytes)?;
        }
        Ok(())
    }

    /// Take the deleted bodies, their colonies, their orbital rings' starbases and fleets and
    /// their stations' fleets out of the system's lists, each list once, so that a list
    /// left with none goes as the game writes it.
    fn unlist_from_system(&self, edit: &mut Edit) -> Result<(), OpError> {
        unlist_planets(edit, &self.bodies)?;
        let colonies: Vec<u32> = self.teardowns.iter().map(|t| t.colony).collect();
        unlist(edit, keys::COLONIES, &colonies, Emptied::Drop)?;
        let starbases: Vec<u32> = self
            .teardowns
            .iter()
            .filter_map(|t| t.ring.map(|(starbase, _)| starbase))
            .collect();
        unlist(edit, keys::STARBASES, &starbases, Emptied::Null)?;
        unlist(
            edit,
            keys::FLEET_PRESENCE,
            &self.gone_fleets(),
            Emptied::Drop,
        )?;
        Ok(())
    }

    /// The fleets that go: the orbital rings' and the stations'.
    pub(crate) fn gone_fleets(&self) -> Vec<u32> {
        self.teardowns
            .iter()
            .filter_map(|t| t.ring.map(|(_, fleet)| fleet))
            .chain(self.stations.iter().map(|station| station.fleet))
            .collect()
    }

    /// Take each deleted body out of the `moons` of a parent that stays, with the parent's
    /// `habitat<id>` flag for it.
    fn write_parents(
        &self,
        plan: &mut Plan,
        s: &Session,
        saved: &mut Saved,
    ) -> Result<(), OpError> {
        let doc = &s.doc;
        let mut parents: Vec<u32> = self
            .frame
            .iter()
            .filter(|body| self.bodies.contains(&body.id))
            .filter_map(|body| body.parent)
            .filter(|parent| !self.bodies.contains(parent))
            .collect();
        parents.sort_unstable();
        parents.dedup();
        for parent in parents {
            let Some(anchor) = planet_statement(doc, parent)? else {
                continue;
            };
            if !entity_at(doc, anchor).is_ok_and(|found| found.is_some()) {
                continue;
            }
            let children: Vec<u32> = self
                .frame
                .iter()
                .filter(|body| body.parent == Some(parent) && self.bodies.contains(&body.id))
                .map(|body| body.id)
                .collect();
            let flags: Vec<String> = children.iter().map(|id| format!("{HABITAT}{id}")).collect();
            saved.keep(doc, SavedTable::Planet, parent, anchor)?;
            let edit = plan.edit_planet(doc, parent, self.system)?;
            unlist(edit, keys::MOONS, &children, Emptied::Drop)?;
            drop_flags(edit, |flag| flags.iter().any(|f| f == flag))?;
        }
        Ok(())
    }

    /// Whether a habitat goes and none of the system's other bodies is one.
    fn last_habitat(&self, s: &Session) -> Result<bool, OpError> {
        let mut going = false;
        for body in &self.frame {
            let (node, src) = planet_entity(&s.doc, body.id)?;
            match (is_habitat(&node, src), self.bodies.contains(&body.id)) {
                (true, true) => going = true,
                (true, false) => return Ok(false),
                _ => {}
            }
        }
        Ok(going)
    }

    /// The op that writes back `saved`, what [`Self::write`] rewrote, described as
    /// `description`, then adds each dig site back.
    pub(crate) fn inverse(self, saved: Saved, description: String) -> Op {
        // An erased site has no statement to write back over, so it is added again, as
        // `RemoveDigSite`'s inverse adds one; undo puts back the bytes as they stood.
        then(
            saved.inverse(description.clone()),
            description,
            site_adds(self.sites),
        )
    }
}

/// The planet flag a habitat has, and what its host's flag for it starts with.
const HABITAT: &str = "habitat";

/// The system flag the game sets when a habitat is built there.
const HAS_HABITAT: &str = "has_habitat";

/// The class of a habitat.
const PC_HABITAT: &str = "pc_habitat";

/// Whether planet `node` is a habitat: by its class, or the flag the game sets on one.
fn is_habitat(node: &Node, src: &[u8]) -> bool {
    read::text(node, keys::PLANET_CLASS, src) == PC_HABITAT
        || node
            .find(keys::FLAGS, src)
            .is_some_and(|flags| flags.find(HABITAT, src).is_some())
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
pub(crate) fn dug(sites: usize) -> String {
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

/// Why a ring world segment is not deleted alone.
pub(crate) const SEGMENT_GOES_WHOLE: &str = "it is a ring world segment: delete the ring world";

/// Why a ring world segment keeps its colony.
pub(crate) const SEGMENT_KEEPS_COLONY: &str =
    "it is a ring world segment, which has not been tried in game";

/// What refuses a colony's removal and a copy: a ring world segment, and a megastructure on
/// or around the body, which is a live row naming it. The body's own `megastructure` key can
/// name a row the save no longer holds, and then refuses nothing. A habitat is a planet class
/// with no megastructure entry of its own, so it passes.
pub(crate) fn check_planet(
    s: &Session,
    planet: u32,
    node: &Node,
    src: &[u8],
    refuse: impl Fn(String) -> OpError,
) -> Result<(), OpError> {
    check_segment(node, src, SEGMENT_KEEPS_COLONY, &refuse)?;
    check_megastructures(&s.doc, planet, &[], refuse)
}

/// Refuse a ring world segment, for `reason`.
pub(crate) fn check_segment(
    node: &Node,
    src: &[u8],
    reason: &str,
    refuse: impl Fn(String) -> OpError,
) -> Result<(), OpError> {
    if ring_world::is_segment(&read::text(node, keys::PLANET_CLASS, src)) {
        return Err(refuse(reason.to_owned()));
    }
    Ok(())
}

/// Refuse moving or copying ring world segment `body` on its own.
pub(crate) fn check_segment_stays(node: &Node, src: &[u8], body: u32) -> Result<(), OpError> {
    if ring_world::is_segment(&read::text(node, keys::PLANET_CLASS, src)) {
        return Err(OpError::RingSegment(body));
    }
    Ok(())
}

/// Refuse `planet` when a live row of `megastructures` other than those in `going` names it.
fn check_megastructures(
    doc: &Document,
    planet: u32,
    going: &[u32],
    refuse: impl Fn(String) -> OpError,
) -> Result<(), OpError> {
    let named = rows(doc, MEGASTRUCTURES)?.iter().any(|row| {
        !going.contains(&row.id)
            && read::scalar_u32(&row.node, keys::PLANET, row.src) == Some(planet)
    });
    if named {
        return Err(refuse(
            "a megastructure stands on or around it: delete the megastructure first".to_owned(),
        ));
    }
    Ok(())
}
