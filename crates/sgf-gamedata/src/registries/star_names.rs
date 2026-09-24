//! `common/random_names`: the `star_names` lists a new galaxy names its systems from. A
//! save's pool of unused star names is what these lists leave once the galaxy is named.

use std::collections::HashSet;

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::install::script;

const DIR: &str = "common/random_names";
const KEY: &str = "star_names";

/// Every name of every `star_names` list, in file order, each once.
pub fn load(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    for file in layout.files_in(DIR) {
        let Some((root, src)) = script::parse_file(&file, diagnostics) else {
            continue;
        };
        for name in script::list_items(&root, KEY, &src) {
            if seen.insert(name.clone()) {
                names.push(name);
            }
        }
    }
    names
}
