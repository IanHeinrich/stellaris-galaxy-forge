//! The ambient objects as a scenario system's browser reads them: each registry object named
//! from the install's localisation, with the model the system view would draw it with.

use std::collections::{BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::GameData;
use crate::report::on_every_core;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AmbientObjectView {
    /// Its `name`, which `create_ambient_object`'s `type` names.
    pub key: String,
    /// Its localised name, or the key made readable.
    pub name: String,
    /// The model it is drawn with.
    pub entity: Option<String>,
    pub selectable: bool,
    pub show_name: bool,
    /// The localised text of its `description`, when it names one that has any.
    pub description: Option<String>,
    /// The `model:none:<entity>` texture key of its model drawn bare; `None` when it has no
    /// model, or one with nothing to draw, such as a cloud or a particle effect, and no other
    /// picture.
    pub portrait: Option<String>,
}

impl GameData {
    /// Every ambient object in key order. The first call reads each model's meshes to find
    /// its portrait.
    pub fn ambient_object_views(&self) -> Vec<AmbientObjectView> {
        let portraits = self.ambient_portraits();
        self.ambient_objects
            .iter()
            .map(|def| AmbientObjectView {
                key: def.key.clone(),
                name: self.loc.name_or_readable(&def.key),
                entity: def.entity.clone(),
                selectable: def.selectable,
                show_name: def.show_name,
                description: def
                    .description
                    .as_deref()
                    .and_then(|key| self.loc.description(key)),
                portrait: def
                    .entity
                    .as_deref()
                    .and_then(|entity| portraits.get(entity).cloned()),
            })
            .collect()
    }

    fn ambient_portraits(&self) -> &HashMap<String, String> {
        self.ambient_portraits.get_or_init(|| {
            let entities: Vec<&str> = self
                .ambient_objects
                .iter()
                .filter_map(|def| def.entity.as_deref())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            let keys = on_every_core(&entities, |entity| self.bare_model_key(entity));
            entities
                .into_iter()
                .zip(keys)
                .filter_map(|(entity, key)| Some((entity.to_owned(), key?)))
                .collect()
        })
    }
}
