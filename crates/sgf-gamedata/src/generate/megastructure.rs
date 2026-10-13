//! The save's side of an added megastructure: the op that adds a finished row of any type the
//! install defines, the habitat a type finishes as, or a whole ring world to a system of a
//! save. Each is owned by the system's owner and drawn in that owner's graphical culture.

use sgf_core::entity::{EntityError, get_planet_page};
use sgf_core::ops::{
    MegastructureConstruction, MegastructurePlace, NewBypass, NewMegastructure,
    NewMegastructurePlace, Op, OpError,
};
use sgf_core::session::{SaveQueries, Session};
use sgf_core::views::{ErrorKind, SgfError};

use crate::GameData;
use crate::construction::PlanetChange;
use crate::construction::habitat::habitat;
use crate::construction::ring_world::{RingStage, ring_world};
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

/// Why an add could not be built.
#[derive(Debug, thiserror::Error)]
pub enum Refusal {
    #[error("the install and its mods define no megastructure {0}")]
    NoType(String),
    #[error("a {kind} cannot be added: {reason}")]
    NotAdded { kind: String, reason: String },
    #[error("a {0} is not finished as a habitat")]
    NoHabitat(String),
    #[error("planet {body} is not a body of system {system}")]
    NotInSystem { body: u32, system: u32 },
    #[error("a ring world of {kind} cannot be added: {reason}")]
    NoRingWorld { kind: String, reason: String },
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
/// chain adds in that system. A gateway or relay gets its bypass, open when the type opens it,
/// a type whose build marks its planet marks it, and an Orbital Ring ruin flags its planet. A
/// type whose chain changes the class or size of its planet changes the planet too, in the
/// same edit, unless `keep_planet`. A type the install does not define, one the editor does
/// not add, and one whose placement `place` does not match are refused with the reason.
pub fn megastructure_op(
    gd: &GameData,
    session: &Session,
    system: u32,
    kind: &str,
    place: MegastructurePlace,
    keep_planet: bool,
) -> Result<Planned, Refusal> {
    let def = defined(gd, kind)?;
    check_place(def, place)?;
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
        .ok_or_else(|| Refusal::NoHabitat(kind.to_owned()))?;
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
            kind: kind.to_owned(),
            reason,
        }
    })?;
    Ok(Planned::whole(
        save.ring_world_op(system, owner, ring, clear)?,
    ))
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
fn check_place(def: &MegastructureDef, place: MegastructurePlace) -> Result<(), Refusal> {
    let reason = match (&def.placement, place) {
        (Placement::Unsupported { why }, _) => unsupported(why),
        (Placement::Body { .. }, MegastructurePlace::Free { .. }) => {
            "it stands on or around a planet or star".to_owned()
        }
        (
            Placement::Free { .. },
            MegastructurePlace::Body { .. } | MegastructurePlace::Beside { .. },
        ) => "it stands at a point of its own".to_owned(),
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

fn unsupported(why: &Unsupported) -> String {
    match why {
        Unsupported::Bypass { bypass } => {
            format!("it stands for a {bypass} bypass, which has not been tried in game")
        }
        Unsupported::RingWorld => {
            "a ring world past its site is several rows and planets, added as a whole ring world"
                .to_owned()
        }
        Unsupported::BecomesStarbase => {
            "building it makes a starbase, which the editor does not write".to_owned()
        }
        Unsupported::ChangesBody => {
            "it changes the class or size of its planet in a way the editor cannot tell".to_owned()
        }
        Unsupported::FixedClass { class } => {
            format!("it makes its planet a {class}, which the editor gives no planet")
        }
        Unsupported::WholeStructure { .. } => {
            "it is built with more planets or sections, which the editor does not write".to_owned()
        }
    }
}
