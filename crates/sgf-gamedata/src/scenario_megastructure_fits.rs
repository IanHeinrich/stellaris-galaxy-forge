//! The scenario's side of an added megastructure: which ruins a scenario system can be given
//! at a spot. The types offered are those the install's initializers spawn with no owner,
//! less those a scenario's spawn cannot stand alone: a type the initializers only ever spawn
//! on a planet, a ring world, a bypass whose connection the script decides, and the Shroud
//! seal. What a save's add leaves out does not count here: in a scenario the game builds a
//! ruin's bypass itself.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::GameData;
use crate::initializer_placements::{InitializerRuin, RuinPlacement};
use crate::registries::megastructures::{BuildType, MegastructureDef, Placement};

/// Where in a scenario system the Add megastructure dialog was opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ScenarioSpot {
    /// At a point in empty space.
    Space,
    /// On the system's star.
    Star,
    /// On a planet or moon.
    Planet,
}

/// Where a type goes at a scenario spot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ScenarioFit {
    /// At the point pressed, a spawn at its own point.
    Point,
    /// Only on the star, `planet = star`.
    StarOnly,
    /// Not at this spot.
    NotHere,
}

/// One type the scenario's add dialog offers at a spot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScenarioMegastructureFit {
    pub kind: String,
    pub fit: ScenarioFit,
}

/// The `common/megastructures` flag of the Shroud seal, which the game ties to the Shroud's
/// storms and scripts rather than to a spot. Vanilla's seal is always owned, so this guards a
/// mod's initializer that spawns one without an owner.
const SHROUD_SEAL: &str = "is_shroud_seal";

/// Each ruin a scenario system can be given, in key order, with where it goes at `spot`. In
/// empty space a type that stands at its own point goes there, and any other only on the star.
/// On the star a type goes when it does not stand at its own point, or when an initializer
/// places it on a star; one that floats free and is never placed on a star is added in empty
/// space instead. On a planet none goes.
pub fn scenario_megastructure_fits(
    gd: &GameData,
    spot: ScenarioSpot,
) -> Vec<ScenarioMegastructureFit> {
    gd.initializer_ruins()
        .iter()
        .filter(|ruin| !planet_tied(ruin))
        .filter_map(|ruin| Some((ruin, gd.megastructures.get(&ruin.kind)?)))
        .filter(|(_, def)| offered(gd, def))
        .map(|(ruin, def)| {
            let on_star = ruin.placements.contains(&RuinPlacement::Star);
            ScenarioMegastructureFit {
                kind: def.key.clone(),
                fit: match spot {
                    ScenarioSpot::Space if floats(def) => ScenarioFit::Point,
                    ScenarioSpot::Space => ScenarioFit::StarOnly,
                    ScenarioSpot::Star if !floats(def) || on_star => ScenarioFit::StarOnly,
                    ScenarioSpot::Star | ScenarioSpot::Planet => ScenarioFit::NotHere,
                },
            }
        })
        .collect()
}

/// Whether a scenario's spawn of `def` can stand alone on the star or at a point.
fn offered(gd: &GameData, def: &MegastructureDef) -> bool {
    let scripted_bypass = def
        .bypass_type
        .as_deref()
        .and_then(|bypass| gd.bypasses.get(bypass))
        .is_some_and(|bypass| bypass.scripted_connection);
    let shroud_seal = gd
        .megastructure_defs
        .get(&def.key)
        .is_some_and(|read| read.flag(SHROUD_SEAL));
    !def.ring_world && !scripted_bypass && !shroud_seal
}

/// A type the initializers spawn only on planets: never on the star, at a point or at random.
fn planet_tied(ruin: &InitializerRuin) -> bool {
    ruin.placements.iter().all(|p| *p == RuinPlacement::Planet)
}

/// A type the game draws at its own point: placed at a point, built outside the gravity well,
/// or standing on its star with an offset.
fn floats(def: &MegastructureDef) -> bool {
    matches!(def.placement, Placement::Free { .. })
        || def.build_type == BuildType::OutsideGravityWell
        || def.floats_free(true)
}
