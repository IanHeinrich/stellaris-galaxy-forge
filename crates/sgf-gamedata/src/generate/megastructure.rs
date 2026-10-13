//! The save's side of an added megastructure: the op that adds a finished row of any type the
//! install defines, the habitat a type finishes as, or a whole ring world to a system of a
//! save. Each is owned by the system's owner and drawn in that owner's graphical culture. The
//! add dialog asks [`megastructure_fits`] which types go at a spot, and why the save would
//! refuse each.

use std::borrow::Cow;

use serde::{Deserialize, Serialize};
use sgf_core::entity::{EntityError, get_planet_page};
use sgf_core::ops::{
    MegastructureConstruction, MegastructurePlace, MegastructureRefusal, NewBypass,
    NewMegastructure, NewMegastructurePlace, Op, OpError,
};
use sgf_core::session::{SaveQueries, Session};
use sgf_core::views::details::{MegastructureSummary, SiteBody};
use sgf_core::views::{ErrorKind, SgfError};
use ts_rs::TS;

use crate::GameData;
use crate::construction::PlanetChange;
use crate::construction::habitat::habitat;
use crate::construction::ring_world::{RingStage, ring_world};
use crate::construction::spawned::{AtHost, at_host, spawns_beside};
use crate::registries::megastructure_swaps::made_at;
use crate::registries::megastructures::{MegastructureDef, Placement, Unsupported};

/// An add's op, with what the type's construction does that the op leaves out.
#[derive(Debug, Clone, PartialEq)]
pub struct Planned {
    pub op: Op,
    /// Each effect the editor could not tell applies, or where.
    pub unsure: Vec<String>,
    /// Each effect that applies but that the editor does not write, such as a modifier the
    /// construction removes.
    pub unwritten: Vec<String>,
}

impl Planned {
    fn whole(op: Op) -> Self {
        Self {
            op,
            unsure: Vec::new(),
            unwritten: Vec::new(),
        }
    }
}

/// Why an add could not be built, in the player's words: a type and a planet class are named
/// as the game names them.
#[derive(Debug, thiserror::Error)]
pub enum Refusal {
    #[error("the install and its mods define no megastructure {0}")]
    NoType(String),
    /// The editor does not add type `kind`, or not at the place asked; `reason` says why.
    #[error("{reason}")]
    NotAdded { kind: String, reason: String },
    #[error("{0} doesn't become a habitat when it's finished.")]
    NoHabitat(String),
    #[error("planet {body} is not a body of system {system}")]
    NotInSystem { body: u32, system: u32 },
    #[error("Galaxy Forge can't add {name} yet, because {reason}.")]
    NoRingWorld { name: String, reason: String },
    #[error("the install has no planet class {0}")]
    NoClass(String),
    #[error(transparent)]
    Planet(#[from] EntityError),
    #[error(transparent)]
    Op(#[from] OpError),
}

impl From<Refusal> for SgfError {
    fn from(e: Refusal) -> Self {
        match e {
            Refusal::Op(e) => e.into(),
            e => Self::new(ErrorKind::Op, e.to_string()),
        }
    }
}

/// What an add does with the moons of the planet its row stands on, when its build chain
/// removes them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HostMoons {
    Keep,
    /// Delete them, as the game's build does.
    Remove,
}

/// The op that adds a finished megastructure of type `kind` to system `system` of `session`'s
/// save at `place`, as the game makes it on load: one `AddMegastructure`, with what its build
/// chain adds in that system. A gateway, relay or L-Gate gets its bypass, open when the type
/// opens it or its kind is always open, a type whose build marks its planet marks it, and an
/// Orbital Ring ruin flags its planet. A type whose chain spawns a planet round the body it
/// stands on, its row left standing, writes that planet with no owner, and what the planet's
/// own spawn does beyond it is listed as unwritten, in place of what the construction's walk
/// could not follow in the spawn. A type whose chain changes the class or size of its planet
/// changes the planet too, in the same edit, unless `keep_planet`, and one whose chain removes
/// the planet's moons deletes them first when `moons` is [`HostMoons::Remove`]. A type the
/// install does not define, one the editor does not add, one whose placement `place` does not
/// match and one whose spawned planet the editor cannot write are refused with the reason.
pub fn megastructure_op(
    gd: &GameData,
    session: &Session,
    system: u32,
    kind: &str,
    place: MegastructurePlace,
    keep_planet: bool,
    moons: HostMoons,
) -> Result<Planned, Refusal> {
    let def = defined(gd, kind)?;
    check_place(gd, def, place)?;
    let save = session.save("adding a megastructure")?;
    let host = match place {
        MegastructurePlace::Body { body } | MegastructurePlace::Beside { body, .. } => Some(body),
        MegastructurePlace::Free { .. } => None,
    };
    let change = match (host, &def.planet_change) {
        (Some(_), Some(change)) if !keep_planet => Some(change),
        _ => None,
    };
    let owner = owner(session, system);
    let culture = culture(session, owner);
    let at_host = match host {
        Some(_) => at_host(gd, kind, culture.as_deref()),
        None => AtHost::default(),
    };
    if at_host.planet.is_none() && spawns_beside(gd, kind) {
        return Err(Refusal::NotAdded {
            kind: def.key.clone(),
            reason: WHOLE_STRUCTURE.to_owned(),
        });
    }
    let site = save.construction_site(system)?;
    let construction = match &at_host.planet {
        Some(_) => Cow::Owned(def.construction.without_spawned()),
        None => Cow::Borrowed(&def.construction),
    };
    let built = match change {
        Some(_) => construction.replay_changing_planet(gd, &site, host, owner.is_some()),
        None => construction.replay(gd, &site, host, owner.is_some()),
    };
    let mut unwritten = built.unwritten;
    unwritten.extend(at_host.unwritten);
    let left_out = built.unsure.len() + unwritten.len();
    let mut add = add_op(gd, def, system, place, owner, built.construction, left_out);
    if let Op::AddMegastructure { spec, .. } = &mut add {
        spec.planet = at_host.planet;
    }
    let op = match host {
        Some(body) => {
            let moons = match moons {
                HostMoons::Remove if at_host.removes_moons => host_moons(session, body)?,
                _ => Vec::new(),
            };
            with_host_edits(session, save, gd, kind, body, change, &moons, add)?
        }
        None => add,
    };
    Ok(Planned {
        op,
        unsure: built.unsure,
        unwritten,
    })
}

/// The moons of planet `body`, in the order it lists them.
fn host_moons(session: &Session, body: u32) -> Result<Vec<u32>, Refusal> {
    let planet = get_planet_page(session.doc(), body)?;
    Ok(planet.moons.iter().map(|moon| moon.id).collect())
}

/// The op that adds the habitat finishing a megastructure of type `kind` at body `body` of
/// system `system` leaves: one `AddHabitat`, a planet round the body placed as the install's
/// habitat effect places one round a star or round any other body, with no owner. The orbital
/// a restored complex leaves is owned by the system's owner. A type whose finished stage is
/// not a habitat, and one the install does not define, are refused.
pub fn habitat_op(
    gd: &GameData,
    session: &Session,
    system: u32,
    body: u32,
    kind: &str,
) -> Result<Planned, Refusal> {
    defined(gd, kind)?;
    let site = session
        .save("adding a habitat")?
        .construction_site(system)?;
    let host = site
        .bodies
        .iter()
        .find(|b| b.id == body)
        .ok_or(Refusal::NotInSystem { body, system })?;
    let owner = owner(session, system);
    let culture = culture(session, owner);
    let mut habitat = habitat(gd, kind, host.star, culture.as_deref())
        .ok_or_else(|| Refusal::NoHabitat(gd.loc.name_or_readable(kind)))?;
    if let Some(orbital) = &mut habitat.orbital {
        orbital.owner = owner;
    }
    Ok(Planned::whole(Op::AddHabitat { body, habitat }))
}

/// The op that adds the ring world of megastructure type `kind`, any stage of its chain,
/// round the star of system `system`, each quadrant at its stage in `stages`, in the order the
/// chain spawns them; its habitable sections are named on from the system's flags. With
/// `clear`, every body that is not a star and every belt go first, in the same edit, as the
/// game's frame clears the system. A type the install does not define, a chain that lays out
/// no ring of as many quadrants as `stages` holds, and a clearing that would delete a planet a
/// starbase orbits are refused.
pub fn ring_world_op(
    gd: &GameData,
    session: &Session,
    system: u32,
    kind: &str,
    stages: &[RingStage],
    clear: bool,
) -> Result<Planned, Refusal> {
    defined(gd, kind)?;
    let save = session.save("adding a ring world")?;
    let owner = owner(session, system);
    let culture = culture(session, owner);
    let held = save.construction_site(system)?.flags;
    let ring = ring_world(gd, kind, stages, culture.as_deref(), &held).map_err(|reason| {
        Refusal::NoRingWorld {
            name: gd.loc.name_or_readable(kind),
            reason,
        }
    })?;
    Ok(Planned::whole(
        save.ring_world_op(system, owner, ring, clear)?,
    ))
}

/// Where in a system the Add megastructure dialog was opened.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AddSpot {
    /// On a body of the system.
    Body { body: u32 },
    /// At a point in empty space, about the star.
    Space { x: f64, y: f64 },
}

/// One type the add dialog offers at a spot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MegastructureFit {
    pub kind: String,
    /// The type Add writes: the one the game swaps a finished row of `kind` for at the spot,
    /// else `kind`.
    pub variant: String,
    /// Where a row of `variant` stands: on the body, or at the point pressed.
    pub place: MegastructurePlace,
    /// Why the save would refuse `variant` there, as the add would say it; `None` when it goes.
    pub refusal: Option<String>,
    /// What the add can do with the moons of the body, which `variant`'s build removes.
    pub host_moons: HostMoonsFit,
}

/// Whether an add's [`HostMoons::Remove`] would delete the moons of the body it stands on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum HostMoonsFit {
    /// The type removes no moons, or the body has none: the moons stay whatever is asked.
    Kept,
    /// The body's `count` moons can be deleted.
    Removable { count: usize },
    /// A moon cannot be deleted: `reason` names it and says why, as [`moons_fit`] words it.
    Refused { reason: String },
}

/// Each type the install defines that goes at `spot` of system `system` of `session`'s save,
/// in the install's order. In empty space, one placed at a point of its own goes; on a star,
/// one placed on a body that is not kept off stars and does not change its planet, a ring world
/// and a whole structure; on a planet, one not built only round a star. A type whose build
/// changes its planet in a way the editor cannot tell, or makes it a class it gives no planet,
/// goes on any body. A bypass the editor has not tried and a type that becomes a starbase go
/// nowhere. Each one's variant is the type the game makes of it at the body's class with the
/// save's global flags, and its refusal is the add's own: the op [`megastructure_op`],
/// [`habitat_op`] or [`ring_world_op`] builds, a ring world with every quadrant finished and
/// the system kept, checked against the session without applying it. A refusal the core gives
/// is worded for the player from the reason it names: a second bypass of its kind, a body that
/// has a megastructure, a habitat round a body that orbits a planet, a ring world in a system of
/// other than one star or over another ring. A body that is not in the system is refused.
pub fn megastructure_fits(
    gd: &GameData,
    session: &Session,
    system: u32,
    spot: AddSpot,
) -> Result<Vec<MegastructureFit>, Refusal> {
    let site = session
        .save("adding a megastructure")?
        .construction_site(system)?;
    let body = match spot {
        AddSpot::Body { body } => Some(
            site.bodies
                .iter()
                .find(|b| b.id == body)
                .ok_or(Refusal::NotInSystem { body, system })?,
        ),
        AddSpot::Space { .. } => None,
    };
    let flags = &session.graph().global_flags;
    let class = body.map(|b| b.class.as_str());
    let raw = session.details().ok();
    let raw = raw.as_ref().and_then(|details| details.raw(system));
    let rows = raw.map_or(&[][..], |raw| raw.megastructures.as_slice());
    Ok(gd
        .megastructures
        .iter()
        .filter(|def| goes(def, body))
        .map(|def| {
            let variant = made_at(&gd.megastructures, &def.key, class, flags);
            let made = gd.megastructures.get(&variant).unwrap_or(def);
            let place = place_at(spot);
            MegastructureFit {
                kind: def.key.clone(),
                refusal: fit_refusal(gd, session, system, made, place, rows),
                host_moons: moons_fit(gd, session, made, body, rows),
                variant,
                place,
            }
        })
        .collect())
}

/// Whether a type goes at `body`, or in empty space for none.
fn goes(def: &MegastructureDef, body: Option<&SiteBody>) -> bool {
    let Some(body) = body else {
        return matches!(def.placement, Placement::Free { .. });
    };
    match &def.placement {
        Placement::Free { .. } => false,
        Placement::Body { .. } if body.star => !def.planet_only && def.planet_change.is_none(),
        Placement::Body { star_only } => !star_only,
        Placement::Unsupported { why } => match why {
            Unsupported::ChangesBody | Unsupported::FixedClass { .. } => true,
            Unsupported::WholeStructure { star_only } => !star_only || body.star,
            Unsupported::RingWorld => body.star,
            Unsupported::Bypass { .. } | Unsupported::BecomesStarbase => false,
        },
    }
}

/// What an add of `def` on `body` can do with the body's moons, each checked for the deletion
/// against the session as it is, in a system whose rows are `rows`. The first moon the core
/// refuses to delete is named in the reason, as [`moon_kept`] words it.
fn moons_fit(
    gd: &GameData,
    session: &Session,
    def: &MegastructureDef,
    body: Option<&SiteBody>,
    rows: &[MegastructureSummary],
) -> HostMoonsFit {
    let Some(body) = body else {
        return HostMoonsFit::Kept;
    };
    let removes = matches!(def.placement, Placement::Body { .. })
        && at_host(gd, &def.key, None).removes_moons;
    if !removes {
        return HostMoonsFit::Kept;
    }
    let moons = match host_moons(session, body.id) {
        Ok(moons) => moons,
        Err(refused) => {
            return HostMoonsFit::Refused {
                reason: refused.to_string(),
            };
        }
    };
    if moons.is_empty() {
        return HostMoonsFit::Kept;
    }
    let refused = moons
        .iter()
        .find_map(|&moon| Some((moon, session.refusal(&Op::DeleteBody { body: moon })?)));
    match refused {
        Some((moon, refused)) => HostMoonsFit::Refused {
            reason: moon_kept(gd, session, moon, &refused, rows),
        },
        None => HostMoonsFit::Removable { count: moons.len() },
    }
}

/// `refused`, the core's refusal to delete moon `moon` of a system whose rows are `rows`, in
/// the player's words, naming the moon: "Kel has a megastructure." for a row on it, and
/// "Kel can't be removed, because a starbase orbits it." for another reason the core gives.
/// A refusal of any other kind keeps the core's text.
fn moon_kept(
    gd: &GameData,
    session: &Session,
    moon: u32,
    refused: &OpError,
    rows: &[MegastructureSummary],
) -> String {
    let (OpError::PlanetKept { reason, .. } | OpError::ColonyKept { reason, .. }) = refused else {
        return refused.to_string();
    };
    let name = get_planet_page(session.doc(), moon)
        .map(|page| gd.loc.resolve_template(&page.name))
        .ok()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| format!("Moon #{moon}"));
    if rows.iter().any(|row| row.planet == Some(moon)) {
        return format!("{name} has a megastructure.");
    }
    format!("{name} can't be removed, because {reason}.")
}

/// Where a row added at `spot` stands: at the body, or at the clicked point.
fn place_at(spot: AddSpot) -> MegastructurePlace {
    match spot {
        AddSpot::Body { body } => MegastructurePlace::Body { body },
        AddSpot::Space { x, y } => MegastructurePlace::Free { x, y },
    }
}

/// Why the add of `def` at `place` would be refused, in a system whose rows are `rows`, the
/// body's moons kept: [`moons_fit`] says whether they can go. Each op of a planet-change batch
/// is checked against the planet as it is, not as the batch's class and size ops leave it. The
/// core decides whether an add is refused, and [`worded`] says why.
fn fit_refusal(
    gd: &GameData,
    session: &Session,
    system: u32,
    def: &MegastructureDef,
    place: MegastructurePlace,
    rows: &[MegastructureSummary],
) -> Option<String> {
    let key = &def.key;
    let planned = match place {
        _ if is_ring_world(def) => {
            ring_world_op(gd, session, system, key, &[RingStage::Finished; 4], false)
        }
        MegastructurePlace::Body { body } if habitat(gd, key, true, None).is_some() => {
            habitat_op(gd, session, system, body, key)
        }
        _ => megastructure_op(gd, session, system, key, place, false, HostMoons::Keep),
    };
    let refused = match planned {
        Err(refused) => return Some(refused.to_string()),
        Ok(Planned {
            op: Op::Batch { ops, .. },
            ..
        }) => ops.iter().find_map(|op| session.refusal(op)),
        Ok(planned) => session.refusal(&planned.op),
    }?;
    Some(worded(gd, def, &refused, rows))
}

fn is_ring_world(def: &MegastructureDef) -> bool {
    matches!(
        def.placement,
        Placement::Unsupported {
            why: Unsupported::RingWorld
        }
    )
}

/// `refused`, the core's refusal of an add of `def` in a system whose rows are `rows`, in the
/// player's words: a bypass already there named by the type of the row that stands for it, as the
/// game names it. A reason the core names no part for keeps the core's text.
fn worded(
    gd: &GameData,
    def: &MegastructureDef,
    refused: &OpError,
    rows: &[MegastructureSummary],
) -> String {
    let OpError::MegastructureRefused { reason, .. } = refused else {
        return refused.to_string();
    };
    match reason {
        MegastructureRefusal::BypassPresent { kind, .. } => {
            let held = rows
                .iter()
                .find(|row| {
                    gd.megastructures
                        .get(&row.kind)
                        .is_some_and(|other| other.bypass_type.as_deref() == Some(kind))
                })
                .map_or(&def.key, |row| &row.kind);
            format!(
                "The system already has a {}.",
                gd.loc.name_or_readable(held)
            )
        }
        MegastructureRefusal::HoldsMegastructure { .. } => BODY_HAS_MEGASTRUCTURE.to_owned(),
        MegastructureRefusal::RoundSatellite { .. } => ROUND_SATELLITE.to_owned(),
        MegastructureRefusal::NoStar { .. } => RING_WORLD_NO_STAR.to_owned(),
        MegastructureRefusal::ManyStars { count, .. } => match count {
            2 => "Can't place a ring world in a binary system.".to_owned(),
            3 => "Can't place a ring world in a trinary system.".to_owned(),
            _ => format!("Can't place a ring world in a system with {count} stars."),
        },
        MegastructureRefusal::RingOverlap { orbit, .. } => format!(
            "This ring would overlap the ring world at orbit {}.",
            orbit.round()
        ),
        MegastructureRefusal::Other(_) => refused.to_string(),
    }
}

fn defined<'g>(gd: &'g GameData, kind: &str) -> Result<&'g MegastructureDef, Refusal> {
    gd.megastructures
        .get(kind)
        .ok_or_else(|| Refusal::NoType(kind.to_owned()))
}

/// Who an added structure in system `system` goes to: the system's owner.
fn owner(session: &Session, system: u32) -> Option<u32> {
    session
        .graph()
        .systems
        .get(&system)
        .and_then(|node| node.owner)
}

/// The graphical culture of `owner`, which an added structure's models are drawn in.
fn culture(session: &Session, owner: Option<u32>) -> Option<String> {
    let owner = owner?;
    session
        .graph()
        .countries
        .iter()
        .find(|c| c.id == owner)
        .and_then(|country| country.graphical_culture.clone())
}

/// `add` with planet `body` given the class and size `change` names and its moons `moons`
/// deleted, as one edit. The class and size go first: the core changes no class of a planet
/// that has a megastructure, and the planet ends the same either way. The moons go before the
/// row, as the game removes them before the stage that spawns its planet. A class or size the
/// planet has already is left out, and so is the batch when nothing else is left.
#[allow(clippy::too_many_arguments)]
fn with_host_edits(
    session: &Session,
    save: SaveQueries<'_>,
    gd: &GameData,
    kind: &str,
    body: u32,
    change: Option<&PlanetChange>,
    moons: &[u32],
    add: Op,
) -> Result<Op, Refusal> {
    let mut ops = Vec::new();
    let mut class = None;
    let mut size = None;
    if let Some(change) = change {
        let planet = get_planet_page(session.doc(), body)?;
        let rule = |class: &str| {
            gd.planet_class_rule(class)
                .ok_or_else(|| Refusal::NoClass(class.to_owned()))
        };
        class = change
            .class
            .as_deref()
            .filter(|&class| class != planet.class);
        if let Some(class) = class {
            ops.push(Op::SetBodyClass {
                body,
                from: rule(&planet.class)?,
                to: rule(class)?,
                look: None,
            });
        }
        size = change.size.filter(|&size| planet.size != Some(size));
        if let Some(size) = size {
            ops.push(Op::SetBodySize { body, size });
        }
    }
    ops.extend(moons.iter().map(|&moon| Op::DeleteBody { body: moon }));
    if ops.is_empty() {
        return Ok(add);
    }
    ops.push(add);
    let class_name = class.map(|class| gd.loc.name_or_readable(class));
    let description = save.megastructure_planet_change_description(
        &gd.loc.name_or_readable(kind),
        body,
        class_name.as_deref(),
        size,
        moons.len(),
    )?;
    Ok(Op::Batch { description, ops })
}

/// Refuse a type the editor does not add, or one whose placement `place` does not match.
fn check_place(
    gd: &GameData,
    def: &MegastructureDef,
    place: MegastructurePlace,
) -> Result<(), Refusal> {
    let name = gd.loc.name_or_readable(&def.key);
    let reason = match (&def.placement, place) {
        (Placement::Unsupported { why }, _) => unsupported(gd, &name, why),
        (Placement::Body { .. }, MegastructurePlace::Free { .. }) => {
            format!("{name} goes on a planet or star, not in empty space.")
        }
        (
            Placement::Free { .. },
            MegastructurePlace::Body { .. } | MegastructurePlace::Beside { .. },
        ) => format!("{name} goes in empty space, not on a planet or star."),
        _ => return Ok(()),
    };
    Err(Refusal::NotAdded {
        kind: def.key.clone(),
        reason,
    })
}

/// The op that adds a row of type `def` at `place`, with what its construction adds and how
/// many of its effects were left out. Its bypass is open when the type opens it or the
/// bypass's own kind is always open.
fn add_op(
    gd: &GameData,
    def: &MegastructureDef,
    system: u32,
    place: MegastructurePlace,
    owner: Option<u32>,
    construction: MegastructureConstruction,
    left_out: usize,
) -> Op {
    let bypass = def.bypass_type.as_ref().map(|kind| NewBypass {
        kind: kind.clone(),
        active: def.activates_gateway || gd.bypasses.get(kind).is_some_and(|b| b.always_active),
    });
    let mut body_flags = Vec::new();
    if def.sets_has_megastructure {
        body_flags.push("has_megastructure".to_owned());
    }
    if def.ruined_orbital_ring {
        body_flags.push("ruined_orbital_ring_planet".to_owned());
    }
    let star_only = matches!(def.placement, Placement::Body { star_only: true });
    let at = match place {
        MegastructurePlace::Body { body } => NewMegastructurePlace::Body {
            body,
            body_flags,
            star_only,
        },
        MegastructurePlace::Beside { body, x, y } => NewMegastructurePlace::Beside {
            body,
            x,
            y,
            body_flags,
            star_only,
        },
        MegastructurePlace::Free { x, y } => NewMegastructurePlace::Free { x, y },
    };
    Op::AddMegastructure {
        system,
        spec: NewMegastructure {
            kind: def.key.clone(),
            name: None,
            at,
            owner,
            bypass,
            construction: (!construction.is_empty()).then_some(construction),
            planet: None,
            left_out: u32::try_from(left_out).unwrap_or(u32::MAX),
        },
    }
}

/// Why the editor does not add type `name`.
fn unsupported(gd: &GameData, name: &str, why: &Unsupported) -> String {
    match why {
        Unsupported::Bypass { .. } => {
            format!(
                "Galaxy Forge can't add {name} yet, because adding it hasn't been tested in game."
            )
        }
        Unsupported::RingWorld => {
            format!(
                "{name} is a stage of a ring world. Add the ring world to build the whole ring."
            )
        }
        Unsupported::BecomesStarbase => {
            format!("Galaxy Forge can't add {name} yet, because building it creates a starbase.")
        }
        Unsupported::ChangesBody => CHANGES_BODY.to_owned(),
        Unsupported::FixedClass { class } => format!(
            "Galaxy Forge can't add this yet, because it can't turn a planet into a {}.",
            gd.loc.name_or_readable(class)
        ),
        Unsupported::WholeStructure { .. } => WHOLE_STRUCTURE.to_owned(),
    }
}

const CHANGES_BODY: &str =
    "Galaxy Forge can't add this yet, because it can't tell how building it changes the planet.";
const WHOLE_STRUCTURE: &str =
    "Galaxy Forge can't add this yet, because building it also creates other planets or sections.";
const BODY_HAS_MEGASTRUCTURE: &str = "It already has a megastructure.";
const ROUND_SATELLITE: &str =
    "Galaxy Forge can't add this round anything that orbits a planet, such as a moon.";
const RING_WORLD_NO_STAR: &str = "Can't place a ring world in a system with no star.";
