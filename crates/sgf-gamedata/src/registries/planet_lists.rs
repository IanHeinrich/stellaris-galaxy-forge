//! `common/planet_classes`' `random_list = { name = rl_… planets = { … } }` blocks: the
//! lists an initializer's `class = rl_…` body draws its planet class from.

use std::collections::BTreeMap;

use crate::install::script::{self, ParsedDir};

/// The key every planet list is written under, in every file of the directory.
pub(crate) const KEY: &str = "random_list";

/// Each list by name, its classes in file order; a later list of the same name wins.
pub type PlanetLists = BTreeMap<String, Vec<String>>;

/// The lists of `common/planet_classes`, read from its parse.
pub(crate) fn read(dir: &ParsedDir) -> PlanetLists {
    let mut lists = PlanetLists::new();
    for (root, src) in dir.roots() {
        for block in root.find_all(KEY, src) {
            let Some(name) = block.find("name", src).and_then(|n| n.scalar_str(src)) else {
                continue;
            };
            lists.insert(name.to_owned(), script::list_items(block, "planets", src));
        }
    }
    lists
}
