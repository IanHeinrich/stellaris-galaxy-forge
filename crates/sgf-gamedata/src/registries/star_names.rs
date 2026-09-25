//! `common/random_names`: the `star_names` lists a new galaxy names its systems from, the
//! `nebula_names` it names its nebulae from and the `black_hole_names` it names its black
//! holes from. A save's pools of unused names are what these lists leave once the galaxy is
//! named.

use std::collections::HashSet;

use crate::install::script::{self, ParsedDir};

pub(crate) const DIR: &str = "common/random_names";
pub(crate) const STARS: &str = "star_names";
pub(crate) const NEBULAE: &str = "nebula_names";
pub(crate) const BLACK_HOLES: &str = "black_hole_names";

/// Every name of every `key` list of `common/random_names`, in file order, each once.
pub(crate) fn names(dir: &ParsedDir, key: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    for (root, src) in dir.roots() {
        for name in script::list_items(root, key, src) {
            if seen.insert(name.clone()) {
                names.push(name);
            }
        }
    }
    names
}
