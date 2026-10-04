use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::GameData;
use crate::registries::galaxy_shapes::GalaxyShape;
use crate::registries::galaxy_sizes::GalaxySize;
use crate::registries::precursors::PrecursorDef;

/// One galaxy size the new game screen offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GalaxySizeView {
    /// The `name` its `setup_scenario` gives (`huge`).
    pub name: String,
    /// What the new game screen calls it: the name's localisation, or the name capitalised.
    pub label: String,
    pub num_stars: u32,
}

impl GalaxySizeView {
    pub(super) fn new(size: &GalaxySize, gd: &GameData) -> Self {
        let label = gd
            .loc
            .get(&size.name)
            .filter(|text| !text.is_empty())
            .unwrap_or_else(|| capitalised(&size.name));
        Self {
            name: size.name.clone(),
            label,
            num_stars: size.num_stars,
        }
    }
}

fn capitalised(name: &str) -> String {
    let mut chars = name.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

/// One `map/galaxy` shape a scenario can list itself under with `supports_shape`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GalaxyShapeView {
    pub name: String,
    /// The definition file it was read from.
    pub source: String,
}

impl From<&GalaxyShape> for GalaxyShapeView {
    fn from(shape: &GalaxyShape) -> Self {
        Self {
            name: shape.name.clone(),
            source: shape.source.display().to_string(),
        }
    }
}

/// A precursor the install defines: the star flag that marks its region, and its localised
/// name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PrecursorView {
    pub key: String,
    pub name: String,
}

impl PrecursorView {
    fn new(def: &PrecursorDef, gd: &GameData) -> Self {
        Self {
            key: def.key.clone(),
            name: gd.loc.name_or_readable(&def.key),
        }
    }
}

impl GameData {
    /// Every galaxy shape, in file order.
    pub fn galaxy_shape_views(&self) -> Vec<GalaxyShapeView> {
        self.galaxy_shapes
            .iter()
            .map(GalaxyShapeView::from)
            .collect()
    }

    /// Every precursor, in definition order.
    pub fn precursor_views(&self) -> Vec<PrecursorView> {
        self.precursors
            .iter()
            .map(|def| PrecursorView::new(def, self))
            .collect()
    }
}
