//! Names for the systems and nebulae the editor places, drawn the way the game names a
//! galaxy's own: from the save's pool of unused names, then from the install's lists, less
//! the names the document already holds.

use std::collections::HashSet;

use sgf_core::ops::{free_nebula_names, free_star_names};
use sgf_core::session::Session;

use crate::GameData;
use crate::rng::Rng;

/// Separates the name draw from the system draw of the same seed.
const NAME_STREAM: u64 = 0x6E61_6D65;
/// What a nebula is called when no pool or list has a name left for it.
const NEBULA_FALLBACK: &str = "New Nebula";

/// One of `pool` no name of `used` holds, each counted once, drawn from `seed`; else one of
/// `install` no name of `used` holds. `None` when neither has one left.
pub fn pick_unused(
    pool: &[String],
    install: &[String],
    used: &HashSet<&str>,
    seed: u64,
) -> Option<String> {
    let mut seen = HashSet::new();
    let pooled: Vec<&String> = pool
        .iter()
        .filter(|name| !used.contains(name.as_str()) && seen.insert(name.as_str()))
        .collect();
    if let Some(name) = pick(&pooled, seed) {
        return Some(name);
    }
    let left: Vec<&String> = install
        .iter()
        .filter(|name| !used.contains(name.as_str()))
        .collect();
    pick(&left, seed)
}

fn pick(names: &[&String], seed: u64) -> Option<String> {
    Rng::new(seed ^ NAME_STREAM)
        .pick(names)
        .map(|name| (*name).clone())
}

/// A name for a new system in `session`'s save, drawn from `seed`: one left in the save's
/// pool of unused star names, else one of the install's star names no system of the save
/// holds. `None` when neither has one left.
pub fn pick_system_name(session: &Session, gd: &GameData, seed: u64) -> Option<String> {
    let pool = free_star_names(&session.doc);
    pick_unused(&pool, &gd.star_names, &system_names(session), seed)
}

/// One of the install's black hole names no system of `session`'s save holds, drawn from
/// `seed`, as the game names its black holes.
pub fn pick_black_hole_name(session: &Session, gd: &GameData, seed: u64) -> Option<String> {
    pick_unused(&[], &gd.black_hole_names, &system_names(session), seed)
}

/// A name for a new nebula in `session`'s document, drawn from `seed`: one left in a save's
/// pool of unused nebula names, else one of the install's nebula names no nebula of the
/// document holds. `None` when neither has one left.
pub fn pick_nebula_name(session: &Session, gd: &GameData, seed: u64) -> Option<String> {
    let pool = free_nebula_names(&session.doc);
    pick_unused(&pool, &gd.nebula_names, &nebula_names(session), seed)
}

/// A name left in a save's pool of unused nebula names that no nebula of the document holds,
/// drawn from `seed`; `None` when the pool has none, as a scenario's never does. Needs no
/// game data.
pub fn pick_pooled_nebula_name(session: &Session, seed: u64) -> Option<String> {
    let pool = free_nebula_names(&session.doc);
    pick_unused(&pool, &[], &nebula_names(session), seed)
}

/// The name a new nebula in `session`'s document takes, drawn from `seed`: one left in a
/// save's pool of unused nebula names, else with game data one of the install's nebula names
/// no nebula holds, else `New Nebula`, numbered `New Nebula 2`, `New Nebula 3`, … when a
/// nebula already holds it.
pub fn nebula_name(session: &Session, gd: Option<&GameData>, seed: u64) -> String {
    let picked = match gd {
        Some(gd) => pick_nebula_name(session, gd, seed),
        None => pick_pooled_nebula_name(session, seed),
    };
    picked.unwrap_or_else(|| {
        let held = nebula_names(session);
        std::iter::once(NEBULA_FALLBACK.to_owned())
            .chain((2..).map(|n| format!("{NEBULA_FALLBACK} {n}")))
            .find(|name| !held.contains(name.as_str()))
            .unwrap_or_default()
    })
}

/// The names the systems of `session`'s document hold.
pub(crate) fn system_names(session: &Session) -> HashSet<&str> {
    session
        .graph
        .systems
        .values()
        .map(|system| system.name.key.as_str())
        .collect()
}

fn nebula_names(session: &Session) -> HashSet<&str> {
    session
        .graph
        .nebulae
        .iter()
        .map(|nebula| nebula.name.key.as_str())
        .collect()
}
