//! What a scenario system's `spawn_weight` says about who may be seated there.
//!
//! A modifier is script: `factor` and `add` change the weight and everything else beside
//! them is a trigger the game runs in the scope of the empire being placed. This editor
//! keeps the trigger text byte for byte and recognises only the one idiom a map relies
//! on: a system held for a country flag.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SpawnModifier {
    pub factor: Option<f64>,
    pub add: Option<f64>,
    /// The trigger as the file writes it, `factor` and `add` taken out; several triggers
    /// are joined by a space. Never rewritten, only shown.
    pub trigger: String,
    /// The flag when the trigger is `has_country_flag = X` alone: the system is held for
    /// whoever carries the flag.
    pub country_flag: Option<String>,
}

/// The recognised meaning of a scripted weight source: a `spawn_weight` whose `add`
/// names a script value rather than a number, read into the seat it stands for. A
/// system carries one or none; its `base` and `modifier` blocks are read beside it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SpawnScript {
    /// Paint a Galaxy's `add = value:painted_galaxy_spawn_weight|…|`, which its
    /// companion mod resolves to a weight: what kind of seat the parameters name, and
    /// the `RANDOM_VALUE` the mod varies the weight by.
    PaintAGalaxy {
        kind: PaintSpawnKind,
        random_value: u8,
        /// The player's seat: a `modifier = { add = 100000 }` beside the value makes it
        /// the heaviest by far, so the first empire placed, the player, draws it.
        #[serde(default)]
        player: bool,
    },
}

/// The seat a Paint a Galaxy spawn system offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum PaintSpawnKind {
    /// Any empire may be seated here.
    Enabled,
    /// `PREFERRED=yes`: seated before the enabled systems.
    Preferred,
    /// `RESERVED=<letter>`: held for the empire the letter names.
    Reserved(String),
    /// `SOL=yes`: held for an empire whose home is Sol.
    Sol,
}
