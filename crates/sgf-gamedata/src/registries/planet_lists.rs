//! `common/planet_classes`' `random_list = { name = rl_… planets = { … } }` blocks: the
//! lists an initializer's `class = rl_…` body draws its planet class from.

use std::collections::BTreeMap;

use crate::install::script::ParsedDir;

/// Each list by name, its classes in file order; a later list of the same name wins.
pub type PlanetLists = BTreeMap<String, Vec<String>>;

/// The lists of `common/planet_classes`, read from its parse.
pub(crate) fn read(dir: &ParsedDir) -> PlanetLists {
    dir.random_lists("planets")
}
