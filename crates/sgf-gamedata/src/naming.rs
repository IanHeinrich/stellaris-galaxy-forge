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
    pick_where(pool, install, |name| used.contains(name), seed)
}

/// [`pick_unused`] with `used` asked of each name.
fn pick_where(
    pool: &[String],
    install: &[String],
    used: impl Fn(&str) -> bool,
    seed: u64,
) -> Option<String> {
    let mut seen = HashSet::new();
    let pooled: Vec<&String> = pool
        .iter()
        .filter(|name| !used(name.as_str()) && seen.insert(name.as_str()))
        .collect();
    if let Some(name) = pick(&pooled, seed) {
        return Some(name);
    }
    let left: Vec<&String> = install.iter().filter(|name| !used(name.as_str())).collect();
    pick(&left, seed)
}

fn pick(names: &[&String], seed: u64) -> Option<String> {
    Rng::new(seed ^ NAME_STREAM)
        .pick(names)
        .map(|name| (*name).clone())
}

/// The system names of `session`'s save, less each name as it is drawn or taken, so the
/// systems added together share no name and take none the save holds.
pub struct NameDraw<'s> {
    held: HashSet<&'s str>,
    drawn: HashSet<String>,
    pool: Vec<String>,
}

impl<'s> NameDraw<'s> {
    /// The names `session`'s save leaves for new systems: its pool of unused star names, and
    /// the install's lists less the names its systems hold.
    pub fn new(session: &'s Session) -> Self {
        Self {
            held: system_names(session),
            drawn: HashSet::new(),
            pool: free_star_names(session.doc()),
        }
    }

    /// A name for a new system drawn from `seed`: one left in the save's pool of unused star
    /// names, else one of the install's star names. `None` when neither has one left.
    pub fn system(&mut self, gd: &GameData, seed: u64) -> Option<String> {
        let name = pick_where(&self.pool, &gd.star_names, |name| self.holds(name), seed)?;
        self.take(&name);
        Some(name)
    }

    /// One of the install's black hole names drawn from `seed`, as the game names its black
    /// holes. `None` when none is left.
    pub fn black_hole(&mut self, gd: &GameData, seed: u64) -> Option<String> {
        let name = pick_where(&[], &gd.black_hole_names, |name| self.holds(name), seed)?;
        self.take(&name);
        Some(name)
    }

    /// Whether a system of the save holds `name`, or this draw has given it out.
    pub fn holds(&self, name: &str) -> bool {
        self.held.contains(name) || self.drawn.contains(name)
    }

    /// Keep `name` from being given out again by this draw.
    pub fn take(&mut self, name: &str) {
        self.drawn.insert(name.to_owned());
    }
}

/// A name for a new system in `session`'s save, drawn from `seed`: one left in the save's
/// pool of unused star names, else one of the install's star names no system of the save
/// holds. `None` when neither has one left.
pub fn pick_system_name(session: &Session, gd: &GameData, seed: u64) -> Option<String> {
    NameDraw::new(session).system(gd, seed)
}

/// One of the install's black hole names no system of `session`'s save holds, drawn from
/// `seed`, as the game names its black holes.
pub fn pick_black_hole_name(session: &Session, gd: &GameData, seed: u64) -> Option<String> {
    NameDraw::new(session).black_hole(gd, seed)
}

/// A name for a new nebula in `session`'s document, drawn from `seed`: one left in a save's
/// pool of unused nebula names, else one of the install's nebula names no nebula of the
/// document holds. `None` when neither has one left.
pub fn pick_nebula_name(session: &Session, gd: &GameData, seed: u64) -> Option<String> {
    let pool = free_nebula_names(session.doc());
    pick_unused(&pool, &gd.nebula_names, &nebula_names(session), seed)
}

/// A name left in a save's pool of unused nebula names that no nebula of the document holds,
/// drawn from `seed`; `None` when the pool has none, as a scenario's never does. Needs no
/// game data.
pub fn pick_pooled_nebula_name(session: &Session, seed: u64) -> Option<String> {
    let pool = free_nebula_names(session.doc());
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
fn system_names(session: &Session) -> HashSet<&str> {
    session
        .graph()
        .systems
        .values()
        .map(|system| system.name.key.as_str())
        .collect()
}

fn nebula_names(session: &Session) -> HashSet<&str> {
    session
        .graph()
        .nebulae
        .iter()
        .map(|nebula| nebula.name.key.as_str())
        .collect()
}
