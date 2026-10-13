//! The save's side of an added megastructure: the op that adds a finished row of any type the
//! install defines, the habitat a type finishes as, or a whole ring world to a system of a
//! save. Each is owned by the system's owner and drawn in that owner's graphical culture. The
//! add dialog asks [`megastructure_fits`] which types go at a spot, and why the save would
//! refuse each.

use serde::{Deserialize, Serialize};
use sgf_core::entity::{EntityError, get_planet_page};
use sgf_core::ops::rules::RELAY_RADIUS_FACTOR;
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
    #[error("{0} is not finished as a habitat.")]
    NoHabitat(String),
    #[error("planet {body} is not a body of system {system}")]
    NotInSystem { body: u32, system: u32 },
    #[error("Galaxy Forge can't build {name} from the game data: {reason}.")]
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

/// The op that adds a finished megastructure of type `kind` to system `system` of `session`'s
/// save at `place`, as the game makes it on load: one `AddMegastructure`, with what its build
/// chain adds in that system. A gateway, relay or L-Gate gets its bypass, open when the type
/// opens it or its kind is always open, a type whose build marks its planet marks it, and an
/// Orbital Ring ruin flags its planet. A type whose chain changes the class or size of its
/// planet changes the planet too, in the same edit, unless `keep_planet`. A type the install
/// does not define, one the editor does not add, and one whose placement `place` does not
/// match are refused with the reason.
pub fn megastructure_op(
    gd: &GameData,
    session: &Session,
    system: u32,
    kind: &str,
    place: MegastructurePlace,
    keep_planet: bool,
) -> Result<Planned, Refusal> {
    let def = defined(gd, kind)?;
    check_place(gd, def, place)?;
    let save = session.save("adding a megastructure")?;
    let host = match place {
        MegastructurePlace::Body { body } | MegastructurePlace::Beside { body, .. } => Some(body),
        MegastructurePlace::Free { .. } => None,
    };
    let change = match (host, &def.planet_change) {
        (Some(body), Some(change)) if !keep_planet => Some((body, change)),
        _ => None,
    };
    let owner = owner(session, system);
    let site = save.construction_site(system)?;
    let built = match change {
        Some(_) => def
            .construction
            .replay_changing_planet(gd, &site, host, owner.is_some()),
        None => def.construction.replay(gd, &site, host, owner.is_some()),
    };
    let left_out = built.unsure.len() + built.unwritten.len();
    let add = add_op(gd, def, system, place, owner, built.construction, left_out);
    let op = match change {
        Some((body, change)) => with_planet_change(session, save, gd, kind, body, change, add)?,
        None => add,
    };
    Ok(Planned {
        op,
        unsure: built.unsure,
        unwritten: built.unwritten,
    })
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
    /// Where a row of `variant` stands: on the body, at the point pressed, or for a type built
    /// outside the gravity well, just outside the system's inner radius in the pressed
    /// direction.
    pub place: MegastructurePlace,
    /// Why the save would refuse `variant` there, as the add would say it; `None` when it goes.
    pub refusal: Option<String>,
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
    let inner = raw.and_then(|raw| raw.inner_radius).unwrap_or(0.0);
    Ok(gd
        .megastructures
        .iter()
        .filter(|def| goes(def, body))
        .map(|def| {
            let variant = made_at(&gd.megastructures, &def.key, class, flags);
            let made = gd.megastructures.get(&variant).unwrap_or(def);
            let place = place_at(made, spot, inner);
            MegastructureFit {
                kind: def.key.clone(),
                refusal: fit_refusal(gd, session, system, made, place, rows),
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

/// Where a row of `def` added at `spot` stands, in a system of `inner_radius`.
fn place_at(def: &MegastructureDef, spot: AddSpot, inner_radius: f64) -> MegastructurePlace {
    match (spot, &def.placement) {
        (AddSpot::Body { body }, _) => MegastructurePlace::Body { body },
        (
            AddSpot::Space { x, y },
            Placement::Free {
                outside_gravity_well: true,
            },
        ) => {
            let radius = RELAY_RADIUS_FACTOR * inner_radius;
            let angle = y.atan2(x);
            MegastructurePlace::Free {
                x: radius * angle.cos(),
                y: radius * angle.sin(),
            }
        }
        (AddSpot::Space { x, y }, _) => MegastructurePlace::Free { x, y },
    }
}

/// Why the add of `def` at `place` would be refused, in a system whose rows are `rows`. Each
/// op of a planet-change batch is checked against the planet as it is, not as the batch's class
/// and size ops leave it. The core decides whether an add is refused, and [`worded`] says why.
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
        _ => megastructure_op(gd, session, system, key, place, false),
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
        MegastructureRefusal::HabitatRoundSatellite { .. } => HABITAT_ROUND_SATELLITE.to_owned(),
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

/// `add` with planet `body` given the class and size `change` names, as one edit. The class
/// and size go first: the core changes no class of a planet that has a megastructure, and
/// the planet ends the same either way. A class or size the planet has already is left out,
/// and so is the batch when nothing else is left.
fn with_planet_change(
    session: &Session,
    save: SaveQueries<'_>,
    gd: &GameData,
    kind: &str,
    body: u32,
    change: &PlanetChange,
    add: Op,
) -> Result<Op, Refusal> {
    let planet = get_planet_page(session.doc(), body)?;
    let rule = |class: &str| {
        gd.planet_class_rule(class)
            .ok_or_else(|| Refusal::NoClass(class.to_owned()))
    };
    let mut ops = Vec::new();
    let class = change
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
    let size = change.size.filter(|&size| planet.size != Some(size));
    if let Some(size) = size {
        ops.push(Op::SetBodySize { body, size });
    }
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
            format!("{name} stands on or around a planet or star.")
        }
        (
            Placement::Free { .. },
            MegastructurePlace::Body { .. } | MegastructurePlace::Beside { .. },
        ) => format!("{name} stands at a point of its own."),
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
            left_out: u32::try_from(left_out).unwrap_or(u32::MAX),
        },
    }
}

/// Why the editor does not add type `name`.
fn unsupported(gd: &GameData, name: &str, why: &Unsupported) -> String {
    match why {
        Unsupported::Bypass { bypass } => format!(
            "{name} stands for a {} bypass, which hasn't been tried in game.",
            gd.loc.name_or_readable(bypass)
        ),
        Unsupported::RingWorld => {
            format!("{name} is part of a ring world, which is added as a whole ring world.")
        }
        Unsupported::BecomesStarbase => {
            format!("Building {name} makes a starbase, which Galaxy Forge can't add yet.")
        }
        Unsupported::ChangesBody => CHANGES_BODY.to_owned(),
        Unsupported::FixedClass { class } => format!(
            "Makes the planet a {}, a class Galaxy Forge doesn't give a planet.",
            gd.loc.name_or_readable(class)
        ),
        Unsupported::WholeStructure { .. } => WHOLE_STRUCTURE.to_owned(),
    }
}

const CHANGES_BODY: &str =
    "Changes the planet's class or size in a way Galaxy Forge can't work out from the game data.";
const WHOLE_STRUCTURE: &str =
    "Builds more planets or sections with it, which Galaxy Forge can't add yet.";
const BODY_HAS_MEGASTRUCTURE: &str = "It already has a megastructure.";
const HABITAT_ROUND_SATELLITE: &str =
    "It orbits a planet, and Galaxy Forge puts no habitat round a body that orbits a planet.";
const RING_WORLD_NO_STAR: &str = "The system has no star for a ring world to stand round.";
