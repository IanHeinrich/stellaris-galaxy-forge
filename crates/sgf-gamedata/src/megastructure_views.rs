//! The megastructure types as the add dialog reads them: each registry type with its empire
//! effects and the modifiers and deposits its construction writes, named from the install's
//! localisation.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::GameData;
use crate::construction::habitat::habitat;
use crate::construction::ring_world::{RingStage, quadrants, ring_world};
use crate::construction::{SummaryKind, SummaryLine, SummaryOn};
use crate::planet_views::ModifierLineView;
use crate::registries::megastructures::{MegastructureDef, Placement, Unsupported};

/// One modifier or deposit that adding a row of the type writes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConstructionLineView {
    pub on: SummaryOn,
    pub kind: SummaryKind,
    pub key: String,
    /// The localised name of the modifier or deposit.
    pub name: String,
    /// A deposit, or a modifier with no end date.
    pub permanent: bool,
    /// It lands only on the bodies that pass a condition, or only when the structure has an
    /// owner.
    pub conditional: bool,
}

/// A megastructure type with the lines the registry leaves empty because they need the
/// localisation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MegastructureView {
    #[serde(flatten)]
    #[ts(flatten)]
    pub def: MegastructureDef,
    /// What the type gives its owner, named as the game's tooltip names it.
    #[serde(default)]
    pub country_effects: Vec<ModifierLineView>,
    /// What building the type adds to its system and bodies.
    #[serde(default)]
    pub construction_summary: Vec<ConstructionLineView>,
    /// Its finished stage is a habitat beside the body it is built at, which the editor adds
    /// as a planet in place of a row.
    #[serde(default)]
    pub habitat: bool,
    /// The habitat also comes with a major orbital at its host, which the editor adds where
    /// the host holds no megastructure.
    #[serde(default)]
    pub habitat_orbital: bool,
    /// For a ring world past its site, why the editor cannot add its chain's ring whole with
    /// every quadrant finished; `None` when it can, and for any other type.
    #[serde(default)]
    pub ring_world_refused: Option<String>,
}

impl GameData {
    /// Every megastructure type in key order, with its effects and construction named.
    pub fn megastructure_views(&self) -> Vec<MegastructureView> {
        self.megastructures
            .iter()
            .map(|def| {
                let finished = habitat(self, &def.key, true, None);
                MegastructureView {
                    country_effects: modifier_lines(self, &def.country_modifier),
                    construction_summary: def
                        .construction
                        .summary()
                        .into_iter()
                        .map(|line| self.construction_line(line))
                        .collect(),
                    habitat: finished.is_some(),
                    habitat_orbital: finished.is_some_and(|habitat| habitat.orbital.is_some()),
                    ring_world_refused: self.ring_world_refused(def),
                    def: def.clone(),
                }
            })
            .collect()
    }

    fn ring_world_refused(&self, def: &MegastructureDef) -> Option<String> {
        let Placement::Unsupported {
            why: Unsupported::RingWorld,
        } = def.placement
        else {
            return None;
        };
        let stages = vec![RingStage::Finished; quadrants(self, &def.key).unwrap_or(4)];
        ring_world(self, &def.key, &stages, None, &[]).err()
    }

    fn construction_line(&self, line: SummaryLine) -> ConstructionLineView {
        ConstructionLineView {
            name: self.loc.name_or_readable(&line.key),
            on: line.on,
            kind: line.kind,
            key: line.key,
            permanent: line.permanent,
            conditional: line.conditional,
        }
    }
}

fn modifier_lines(gd: &GameData, lines: &[(String, f64)]) -> Vec<ModifierLineView> {
    lines
        .iter()
        .map(|(key, value)| ModifierLineView {
            key: key.clone(),
            value: *value,
            text: gd.loc.modifier_line(key, *value),
        })
        .collect()
}
