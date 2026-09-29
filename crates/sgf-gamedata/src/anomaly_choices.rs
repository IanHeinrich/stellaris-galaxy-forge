//! The anomaly categories a save planet's page offers to add: every category but those
//! that run `on_spawn`, which the game runs only when its survey roll places one, the AI's
//! own (`AIANOM_*`) and those an event chain gates. Each says whether its `spawn_chance`
//! could place it on the planet asked about.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::GameData;
use crate::deposit_choices::AskedBody;
use crate::deposit_roll::{NewBody, RollBody};
use crate::registries::anomalies::AnomalyCategoryDef;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AnomalyChoice {
    /// The category's key, which the planet's `anomaly` names.
    pub key: String,
    /// Its localised name; the key when the install has none.
    pub name: String,
    /// How hard it is to research, 1 to 10.
    pub level: Option<u32>,
    pub description: Option<String>,
    /// Its `spawn_chance` is above zero for the planet asked about.
    pub usual: bool,
}

impl GameData {
    /// Every category a planet's page offers, by key.
    pub fn anomaly_choices(&self, asked: &AskedBody<'_>) -> Vec<AnomalyChoice> {
        self.anomaly_categories
            .iter()
            .filter(|def| def.offered())
            .map(|def| AnomalyChoice {
                key: def.key.clone(),
                name: self.loc.name(&def.key).unwrap_or_else(|| def.key.clone()),
                level: def.level,
                description: self.loc.name(&def.desc),
                usual: self.anomaly_usual(def, asked),
            })
            .collect()
    }

    /// Whether `def`'s `spawn_chance` is above zero for `asked`, judged as a body the
    /// generator has just made; a modifier asking about the surveying ship or its empire
    /// cannot be judged and counts for nothing.
    fn anomaly_usual(&self, def: &AnomalyCategoryDef, asked: &AskedBody<'_>) -> bool {
        let Some(class) = asked.class else {
            return false;
        };
        let class_def = self.planet_classes.get(class);
        let body = RollBody {
            class,
            size: asked.size.unwrap_or(0),
            star: class_def.is_some_and(|c| c.star),
            moon: asked.moon,
        };
        def.spawn_chance.evaluate(&NewBody::new(self, &body, &[])) > 0.0
    }
}
