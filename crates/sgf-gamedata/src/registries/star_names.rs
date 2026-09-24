//! `common/random_names`: the `star_names` lists a new galaxy names its systems from, and
//! the `black_hole_names` it names its black holes from. A save's pools of unused names are
//! what these lists leave once the galaxy is named.

use std::collections::HashSet;

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::install::script;

const DIR: &str = "common/random_names";
const KEY: &str = "star_names";
const BLACK_HOLES: &str = "black_hole_names";

/// Every name of every `star_names` list, in file order, each once.
pub fn load(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> Vec<String> {
    names(layout, KEY, diagnostics)
}

/// Every name of every `black_hole_names` list, in file order, each once.
pub fn load_black_holes(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> Vec<String> {
    names(layout, BLACK_HOLES, diagnostics)
}

/// Every name of every `key` list of `common/random_names`, in file order, each once.
pub(crate) fn names(layout: &Layout, key: &str, diagnostics: &mut Vec<Diagnostic>) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    for file in layout.files_in(DIR) {
        let Some((root, src)) = script::parse_file(&file, diagnostics) else {
            continue;
        };
        for name in script::list_items(&root, key, &src) {
            if seen.insert(name.clone()) {
                names.push(name);
            }
        }
    }
    names
}
