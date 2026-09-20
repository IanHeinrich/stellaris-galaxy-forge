//! What a scenario system's `spawn_weight` says about who may be seated there.
//!
//! A modifier is script: `factor` and `add` change the weight and everything else beside
//! them is a trigger the game runs in the scope of the empire being placed. This editor
//! keeps the trigger text byte for byte and recognises only the two idioms a map relies
//! on: a system kept from the AI or given to it, and one held for a country flag.

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
    pub reservation: Option<SpawnReservation>,
}

/// What a modifier a map author would write means: who the generator may seat here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SpawnReservation {
    /// `factor = 0 is_ai = yes`, or a weight added for `is_ai = no`: the AI is kept out,
    /// so the system is the player's to start in. A modifier that bars and favours at
    /// once (`factor = 0 add = 10 is_ai = yes`) favours: it adds to the weight.
    Human,
    /// The mirror: `factor = 0 is_ai = no`, or a weight added for `is_ai = yes`.
    Ai,
    /// `has_country_flag = X` alone: the system is held for whoever carries the flag.
    CountryFlag(String),
}

/// The two modifiers this editor writes itself, each barring one kind of empire from the
/// system: `factor = 0 is_ai = yes` keeps it for a human player, `factor = 0 is_ai = no`
/// for the AI. A system carries one of them or neither.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SpawnReservationPreset {
    Human,
    Ai,
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
