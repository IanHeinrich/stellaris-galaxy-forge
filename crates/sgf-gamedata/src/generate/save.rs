//! The save's side of a rolled system: what a system or body added to a save, or one
//! rolled again, is built from, named after its pool and given its Resource Abundance.

use sgf_core::ops::{BodySpec, SystemSpec};
use sgf_core::session::Session;

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

/// A body for system `system` of `session`'s save, rolled from `seed` as [`roll_body`] rolls
/// one about the system's star at the save's Resource Abundance: a moon of `parent` when given,
/// banded by how far that planet stands from the star, else a planet banded by `radius`.
#[allow(clippy::too_many_arguments)]
pub fn body_for_save(
    gd: &GameData,
    session: &Session,
    seed: u64,
    system: u32,
    parent: Option<u32>,
    class: Option<&str>,
    size: Option<u32>,
    radius: f64,
) -> Result<BodySpec, ForSaveError> {
    let node = session
        .system(system)
        .ok_or(ForSaveError::NoSystem(system))?;
    let orbit = match parent {
        Some(parent) => standing(session, system, parent).unwrap_or(radius),
        None => radius,
    };
    let roll = BodyRoll {
        star_class: &node.star_class,
        class,
        size,
        moon: parent.is_some(),
        orbit,
        abundance: gd.deposit_defines.abundance(session.resource_abundance()),
    };
    Ok(roll_body(gd, seed, &roll)?)
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
