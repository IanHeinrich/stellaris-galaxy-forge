//! `common/planet_classes`' `random_list = { name = rl_… planets = { … } }` blocks: the
//! lists an initializer's `class = rl_…` body draws its planet class from.

use std::collections::BTreeMap;

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::install::script;

const DIR: &str = "common/planet_classes";
const KEY: &str = "random_list";

/// Each list by name, its classes in file order; a later list of the same name wins.
pub type PlanetLists = BTreeMap<String, Vec<String>>;

pub fn load(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> PlanetLists {
    let mut lists = PlanetLists::new();
    for file in layout.files_in(DIR) {
        let Some((root, src)) = script::parse_file(&file, diagnostics) else {
            continue;
        };
        for block in root.find_all(KEY, &src) {
            let Some(name) = block.find("name", &src).and_then(|n| n.scalar_str(&src)) else {
                continue;
            };
            lists.insert(name.to_owned(), script::list_items(block, "planets", &src));
        }
    }
    lists
}
