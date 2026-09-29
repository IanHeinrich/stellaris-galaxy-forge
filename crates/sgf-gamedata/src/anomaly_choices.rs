//! The anomaly categories a save planet's page offers to add: every category but those
//! that run `on_spawn`, which the game runs only when its survey roll places one, the AI's
//! own (`AIANOM_*`) and those an event chain gates. Each says whether its `spawn_chance`
//! could place it on the planet asked about.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::GameData;
use crate::condition::{Condition, Subject};
use crate::deposit_choices::AskedBody;
use crate::deposit_roll::{NewBody, RollBody};
use crate::registries::anomalies::AnomalyCategoryDef;
use crate::registries::scripted_triggers::ScriptedTriggers;
use crate::weight::Weight;

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
    /// Its `spawn_chance` could be above zero for the planet asked about.
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

    /// Whether `def`'s `spawn_chance` could be above zero for `asked`, judged as a body the
    /// generator has just made. A modifier asking what the body cannot answer, such as the
    /// surveying ship, its empire or the body's strategic resources, adds as if it held but
    /// never multiplies or sets the chance.
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
        let subject = SurveyedBody {
            gd: self,
            body: NewBody::new(self, &body, &[]),
        };
        could_be_positive(&def.spawn_chance, &subject)
    }
}

/// A body as an anomaly's `spawn_chance` judges it: its class, size and kind as a new body's,
/// the class of its system's star when it is a star, and nothing of its flags, modifiers,
/// owner or system, which a save's body may have and a new one has not.
struct SurveyedBody<'a> {
    gd: &'a GameData,
    body: NewBody<'a>,
}

impl Subject for SurveyedBody<'_> {
    fn leaf(&self, leaf: &Condition) -> Option<bool> {
        match leaf {
            Condition::StarClass(key) if self.body.body.star => {
                let class = self.body.body.class;
                Some(
                    self.gd
                        .star_classes
                        .get(key)
                        .is_some_and(|sc| sc.planets.iter().any(|p| p.key == class)),
                )
            }
            Condition::StarFlag(_)
            | Condition::Exists(_)
            | Condition::InsideNebula(_)
            | Condition::StarClass(_)
            | Condition::Unknown(_) => None,
            _ => self.body.leaf(leaf),
        }
    }

    fn triggers(&self) -> Option<&ScriptedTriggers> {
        self.body.triggers()
    }
}

/// `weight` for `subject` with every modifier that could hold adding, and only those that
/// surely hold multiplying or setting it: whether some body like it could draw a chance.
fn could_be_positive(weight: &Weight, subject: &dyn Subject) -> bool {
    let mut chance = weight.base * weight.factor;
    for modifier in &weight.modifiers {
        match modifier.when.evaluate(subject) {
            Some(false) => {}
            Some(true) => {
                chance = chance * modifier.factor.unwrap_or(1.0) + modifier.add.unwrap_or(0.0);
                if let Some(set) = modifier.weight {
                    chance = set;
                }
            }
            None => chance += modifier.add.unwrap_or(0.0),
        }
    }
    chance > 0.0
}
