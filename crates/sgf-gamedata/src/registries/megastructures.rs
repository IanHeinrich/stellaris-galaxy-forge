//! `common/megastructures`: the model each megastructure type is drawn with, where that
//! model stands against the row's coordinate, how the type is placed when built, and the
//! types it links to.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::install::script::{self, Def};
use crate::registries::registry::{FromDef, Registry};

pub type MegastructureTypes = Registry<MegastructureDef>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, rename = "MegastructureTypeView")]
pub struct MegastructureDef {
    pub key: String,
    /// The model, without the graphical culture prefix the game puts before it; `None` when
    /// the type names none or `""`.
    pub entity: Option<String>,
    /// The model shown while this stage is built, without its culture prefix.
    pub construction_entity: Option<String>,
    /// `entity_offset` x and y: where the model stands from the row's coordinate, in save
    /// units. `(0, 0)` when the type writes none.
    pub entity_offset: (f64, f64),
    pub place_entity_on_planet_plane: bool,
    /// `scales_with_planet = yes`: the model grows with the planet it is built on.
    pub scales_with_planet: bool,
    /// The construction model's scale; 1 when the type writes none.
    pub construction_scale: f64,
    pub build_type: BuildType,
    /// The `common/bypass` type a row of this type stands for.
    pub bypass_type: Option<String>,
    /// The types this one is built over, in file order.
    pub upgrade_from: Vec<String>,
}

/// Where a type is placed when it is built: `build_type`, or `outside_gravity_well` for the
/// older `build_outside_gravity_well = yes`. `around_planet` when neither is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BuildType {
    InsideGravityWell,
    OutsideGravityWell,
    #[default]
    AroundPlanet,
}

impl BuildType {
    fn of(def: &Def) -> Self {
        match def.scalar("build_type") {
            Some("inside_gravity_well") => Self::InsideGravityWell,
            Some("outside_gravity_well") => Self::OutsideGravityWell,
            _ if def.flag("build_outside_gravity_well") => Self::OutsideGravityWell,
            _ => Self::AroundPlanet,
        }
    }
}

impl FromDef for MegastructureDef {
    const DIR: &'static str = "common/megastructures";

    fn read(key: String, def: &Def) -> Self {
        let model = |field: &str| {
            def.scalar(field)
                .filter(|name| !name.is_empty())
                .map(str::to_owned)
        };
        Self {
            key,
            entity: model("entity"),
            construction_entity: model("construction_entity"),
            entity_offset: offset(def),
            place_entity_on_planet_plane: def.flag("place_entity_on_planet_plane"),
            scales_with_planet: def.flag("scales_with_planet"),
            construction_scale: def.number("construction_scale").unwrap_or(1.0),
            build_type: BuildType::of(def),
            bypass_type: model("bypass_type"),
            upgrade_from: script::list_items(&def.node, "upgrade_from", &def.src),
        }
    }
}

fn offset(def: &Def) -> (f64, f64) {
    let Some(block) = def.node.find("entity_offset", &def.src) else {
        return (0.0, 0.0);
    };
    let axis = |key: &str| {
        block
            .find(key, &def.src)
            .and_then(|n| n.scalar_str(&def.src))
            .and_then(|text| def.number_of(text))
            .unwrap_or(0.0)
    };
    (axis("x"), axis("y"))
}
