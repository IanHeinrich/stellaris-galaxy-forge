//! `common/random_names`: the `nebula_names` lists a new galaxy names its nebulae from. A
//! save's pool of unused nebula names is what these lists leave once the galaxy is named.

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::registries::star_names;

const KEY: &str = "nebula_names";

/// Every name of every `nebula_names` list, in file order, each once.
pub fn load(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> Vec<String> {
    star_names::names(layout, KEY, diagnostics)
}
