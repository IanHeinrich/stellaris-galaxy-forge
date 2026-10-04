//! The save's side of a rolled system: what a system or body added to a save, or one
//! rolled again, is built from, named after its pool and given its Resource Abundance. And
//! the planet class rules a class change in a save takes from the install.

use sgf_core::ops::{NewBody, Op, PlanetClassRule, SystemSpec};
use sgf_core::session::Session;
use sgf_core::views::{ErrorKind, OrbitPlacement, SgfError};

use super::{BLACK_HOLE, BodyRoll, GenerateError, generate, generate_layout_for, roll_body};
use crate::GameData;
use crate::layouts::SaveFacts;
use crate::menu::menu_initializers;
use crate::naming;

/// Settle the name of a system rolled from `seed` for `session`'s save. A layout's fixed
/// system name gives way to `fallback`, a name from the pool, when a system of the save
/// already holds it. A black hole with no fixed name takes one of the install's black hole
/// names no system of the save holds, as the game names its black holes, and keeps its
/// name when none is left.
pub fn settle_name(
    session: &Session,
    gd: &GameData,
    spec: &mut SystemSpec,
    fallback: &str,
    seed: u64,
) {
    let fixed = gd
        .initializers
        .get(&spec.initializer)
        .and_then(|init| init.display_name.as_deref());
    if fixed == Some(spec.name.as_str()) {
        if naming::system_names(session).contains(spec.name.as_str()) {
            spec.name = fallback.to_owned();
        }
        return;
    }
    let black_hole = gd
        .star_classes
        .get(&spec.star_class)
        .is_some_and(|class| class.class == BLACK_HOLE);
    if black_hole && let Some(name) = naming::pick_black_hole_name(session, gd, seed) {
        spec.name = name;
    }
}

/// What a system added to a save is built from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Pick {
    /// Rolled from the plain layouts, around the star class when one is given.
    Random(Option<String>),
    /// Built from this plain or special layout.
    Layout(String),
}

/// Why no system could be built for a save.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ForSaveError {
    #[error("the save and the install have no unused star names left")]
    NoNames,
    #[error("system {0} does not exist")]
    NoSystem(u32),
    #[error(transparent)]
    Generate(#[from] GenerateError),
}

impl From<ForSaveError> for SgfError {
    fn from(e: ForSaveError) -> Self {
        match e {
            ForSaveError::NoSystem(id) => Self::not_found(format!("system {id}")),
            e => Self::new(ErrorKind::Op, e.to_string()),
        }
    }
}

impl Pick {
    /// How the added system `system` of `session`'s save is rolled again: from its own
    /// layout when `keep_special` and the Special menu offers that layout, else at random
    /// around `star_class`, or any class without one.
    pub fn of_added(
        session: &Session,
        gd: &GameData,
        system: u32,
        keep_special: bool,
        star_class: Option<String>,
    ) -> Result<Self, ForSaveError> {
        let node = session
            .system(system)
            .ok_or(ForSaveError::NoSystem(system))?;
        let special = keep_special
            && menu_initializers(gd)
                .iter()
                .any(|init| init.name == node.initializer);
        Ok(match special {
            true => Self::Layout(node.initializer.clone()),
            false => Self::Random(star_class),
        })
    }

    /// The system this pick gives for `session`'s save, named `name` at `at`: its deposits
    /// at the Resource Abundance the save was set up with, and a layout's DLC branches as
    /// the save was played.
    pub fn spec(
        &self,
        gd: &GameData,
        session: &Session,
        seed: u64,
        name: &str,
        at: (f64, f64),
    ) -> Result<SystemSpec, GenerateError> {
        let abundance = gd.deposit_defines.abundance(session.resource_abundance());
        match self {
            Self::Random(class) => generate(gd, seed, name, at, class.as_deref(), abundance),
            Self::Layout(layout) => generate_layout_for(
                gd,
                &SaveFacts::read(session),
                seed,
                name,
                at,
                layout,
                abundance,
            ),
        }
    }
}

/// A system for `session`'s save at `at` from `seed`, as `pick` gives it, named from the
/// save's pool of unused star names and then as [`settle_name`] settles it.
pub fn for_save(
    gd: &GameData,
    session: &Session,
    seed: u64,
    at: (f64, f64),
    pick: &Pick,
) -> Result<SystemSpec, ForSaveError> {
    let name = naming::pick_system_name(session, gd, seed).ok_or(ForSaveError::NoNames)?;
    let mut spec = pick.spec(gd, session, seed, &name, at)?;
    settle_name(session, gd, &mut spec, &name, seed);
    Ok(spec)
}

/// A body asked of a save's system: what is fixed of it, the rest drawn by the roll.
#[derive(Debug, Clone, PartialEq)]
pub struct BodyAsk {
    pub system: u32,
    /// The planet it is a moon of; a planet when `None`.
    pub parent: Option<u32>,
    /// Drawn at its orbit when `None`.
    pub class: Option<String>,
    /// Drawn from its class's range when `None`.
    pub size: Option<u32>,
    /// Where it stands from what it orbits.
    pub at: OrbitPlacement,
    /// Named as the game names a new body when `None`.
    pub name: Option<String>,
}

/// The `AddBody` that adds `ask` to `session`'s save, rolled from `seed` as [`roll_body`]
/// rolls a body about the system's star at the save's Resource Abundance: a moon banded by how
/// far its planet stands from the star, else a planet banded by its own radius.
pub fn body_for_save(
    gd: &GameData,
    session: &Session,
    seed: u64,
    ask: BodyAsk,
) -> Result<Op, ForSaveError> {
    let node = session
        .system(ask.system)
        .ok_or(ForSaveError::NoSystem(ask.system))?;
    let radius = ask.at.radius;
    let orbit = match ask.parent {
        Some(parent) => standing(session, ask.system, parent).unwrap_or(radius),
        None => radius,
    };
    let roll = BodyRoll {
        star_class: &node.star_class,
        class: ask.class.as_deref(),
        size: ask.size,
        moon: ask.parent.is_some(),
        orbit,
        abundance: gd.deposit_defines.abundance(session.resource_abundance()),
    };
    let body = roll_body(gd, seed, &roll)?;
    Ok(Op::AddBody {
        system: ask.system,
        spec: NewBody {
            class: body.class,
            size: body.size,
            moon_of: ask.parent,
            name: ask.name,
            deposits: body.deposits,
            ring: body.ring,
        },
        at: ask.at,
    })
}

/// Why a planet class change could not take the install's rules.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ClassRulesError {
    #[error("load game data to change a planet class")]
    NoGameData,
    #[error("the install has no planet class {0}")]
    NoClass(String),
}

impl From<ClassRulesError> for SgfError {
    fn from(e: ClassRulesError) -> Self {
        match e {
            ClassRulesError::NoGameData => Self::no_game_data("change a planet class"),
            e => Self::new(ErrorKind::Op, e.to_string()),
        }
    }
}

impl GameData {
    /// `op` with the rules of every planet class change in it read from `gd`, whatever the
    /// caller sent: the core takes the rules as given, and only the install knows them. An op
    /// that changes no class passes through without game data.
    pub fn with_class_rules(gd: Option<&Self>, op: Op) -> Result<Op, ClassRulesError> {
        match op {
            Op::SetBodyClass {
                body,
                from,
                to,
                look,
            } => {
                let gd = gd.ok_or(ClassRulesError::NoGameData)?;
                let rule = |given: &PlanetClassRule| {
                    gd.planet_class_rule(&given.class)
                        .ok_or_else(|| ClassRulesError::NoClass(given.class.clone()))
                };
                Ok(Op::SetBodyClass {
                    body,
                    from: rule(&from)?,
                    to: rule(&to)?,
                    look,
                })
            }
            Op::Batch { description, ops } => Ok(Op::Batch {
                description,
                ops: ops
                    .into_iter()
                    .map(|op| Self::with_class_rules(gd, op))
                    .collect::<Result<_, _>>()?,
            }),
            op => Ok(op),
        }
    }
}

/// How far planet `id` of `system` stands from the system's centre.
fn standing(session: &Session, system: u32, id: u32) -> Option<f64> {
    let details = session.details().ok()?;
    let planet = details.raw(system)?.planets.iter().find(|p| p.id == id)?;
    planet.at.map(|(x, y)| x.hypot(y)).or(planet.orbit)
}

/// The system `system` of `session`'s save rolled again from `seed` as `pick`, keeping its
/// name and position.
pub fn reroll(
    gd: &GameData,
    session: &Session,
    seed: u64,
    system: u32,
    pick: &Pick,
) -> Result<SystemSpec, ForSaveError> {
    let node = session
        .system(system)
        .ok_or(ForSaveError::NoSystem(system))?;
    let (name, at) = (node.name.key.clone(), (node.x, node.y));
    let mut spec = pick.spec(gd, session, seed, &name, at)?;
    spec.name = name;
    Ok(spec)
}

/// The systems among `ids` that were added to `session`'s save since it was opened, which
/// are the only ones a save can delete, each once and in id order.
pub fn added_among(session: &Session, ids: impl IntoIterator<Item = u32>) -> Vec<u32> {
    let added: std::collections::BTreeSet<u32> = ids
        .into_iter()
        .filter(|&id| session.system(id).is_some_and(|s| s.added))
        .collect();
    added.into_iter().collect()
}
