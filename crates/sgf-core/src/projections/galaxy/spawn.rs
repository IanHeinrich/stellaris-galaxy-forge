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
