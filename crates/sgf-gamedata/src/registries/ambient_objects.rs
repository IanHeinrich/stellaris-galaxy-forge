//! `common/ambient_objects`: the wrecks, derelicts, debris and clouds a `create_ambient_object`
//! places in a system. Every block is an `ambient_object`, named by its own `name`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use sgf_core::cst::Node;

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::install::script::ParsedDir;
use crate::registries::registry::Registry;

pub(crate) const DIR: &str = "common/ambient_objects";

const OBJECT: &str = "ambient_object";

pub type AmbientObjects = Registry<AmbientObjectDef>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AmbientObjectDef {
    /// Its `name`, which `create_ambient_object`'s `type` names and the localisation keys.
    pub key: String,
    /// The file the winning definition was read from.
    pub source: PathBuf,
    /// The model it is drawn with.
    pub entity: Option<String>,
    /// `selectable = yes`: the player can click it in the system view.
    pub selectable: bool,
    /// `show_name = yes`: the system view labels it with its name.
    pub show_name: bool,
    /// The localisation key of its `description`.
    pub description: Option<String>,
}

/// Every object across the layout, keyed by its `name`, the last in load order winning. Vanilla
/// defines its test objects in two files, so a repeated name is not reported.
pub(crate) fn load(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> AmbientObjects {
    let dir = ParsedDir::load(layout, DIR, diagnostics);
    let mut objects: BTreeMap<String, AmbientObjectDef> = BTreeMap::new();
    for (file, root, src) in dir.files() {
        for block in root.find_all(OBJECT, src) {
            if let Some(object) = read(block, src, file) {
                objects.insert(object.key.clone(), object);
            }
        }
    }
    objects.into_iter().collect()
}

fn read(block: &Node, src: &[u8], file: &Path) -> Option<AmbientObjectDef> {
    let scalar = |field: &str| {
        block
            .find(field, src)
            .and_then(|n| n.scalar_str(src))
            .filter(|value| !value.is_empty())
    };
    Some(AmbientObjectDef {
        key: scalar("name")?.to_owned(),
        source: file.to_path_buf(),
        entity: scalar("entity").map(str::to_owned),
        selectable: scalar("selectable") == Some("yes"),
        show_name: scalar("show_name") == Some("yes"),
        description: scalar("description").map(str::to_owned),
    })
}
