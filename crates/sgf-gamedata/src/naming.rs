//! Names for the nebulae the editor places, drawn the way the game names a galaxy's own:
//! from the save's pool of unused nebula names, then from the install's lists.

use std::collections::HashSet;

use sgf_core::ops::free_nebula_names;
use sgf_core::session::Session;

use crate::GameData;
use crate::generate::pick_name;

/// A name for a new nebula in `session`'s document, drawn from `seed`: one left in a save's
/// pool of unused nebula names, else one of the install's nebula names no nebula of the
/// document holds. `None` when neither has one left.
pub fn pick_nebula_name(session: &Session, gd: &GameData, seed: u64) -> Option<String> {
    if let Some(name) = pick_pooled_nebula_name(session, seed) {
        return Some(name);
    }
    let used = names_in_use(session);
    let left: Vec<String> = gd
        .nebula_names
        .iter()
        .filter(|name| !used.contains(name.as_str()))
        .cloned()
        .collect();
    pick_name(&left, seed).map(str::to_owned)
}

/// A name left in a save's pool of unused nebula names that no nebula of the document holds,
/// drawn from `seed`; `None` when the pool has none, as a scenario's never does. Needs no
/// game data.
pub fn pick_pooled_nebula_name(session: &Session, seed: u64) -> Option<String> {
    let used = names_in_use(session);
    let mut seen = HashSet::new();
    let pooled: Vec<String> = free_nebula_names(&session.doc)
        .into_iter()
        .filter(|name| !used.contains(name.as_str()) && seen.insert(name.clone()))
        .collect();
    pick_name(&pooled, seed).map(str::to_owned)
}

fn names_in_use(session: &Session) -> HashSet<&str> {
    session
        .graph
        .nebulae
        .iter()
        .map(|nebula| nebula.name.key.as_str())
        .collect()
}
