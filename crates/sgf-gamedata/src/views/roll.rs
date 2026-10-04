use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One example roll of a system: where each body its details list lands, and the planets
/// that stand for the game's own roll when it rolls the system's planets. A save's bodies
/// stand where the save puts them, so a save system's roll is empty.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemRoll {
    pub system: u32,
    pub roll: u32,
    /// Each body of the system's details, by the same id, in the same order.
    pub bodies: Vec<RolledBody>,
    /// The game rolls the system's planets when it generates the galaxy: its initializer is
    /// `random`, empty or one the install does not define, or it places its bodies only
    /// through an `inline_script`.
    pub rolls_planets: bool,
    /// Planets rolled for the system's star class to show the game's roll: no body of the
    /// system, each about the centre and inside the radius asked for. Empty unless
    /// `rolls_planets`.
    pub placeholders: Vec<PlaceholderBody>,
}

impl SystemRoll {
    /// A roll that places nothing.
    pub fn none(system: u32, roll: u32) -> Self {
        Self {
            system,
            roll,
            bodies: Vec::new(),
            rolls_planets: false,
            placeholders: Vec::new(),
        }
    }
}

/// Where one roll puts a scenario body, about its details' `parent`, or about the centre
/// without one: the frame its layout's bounds use.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RolledBody {
    pub id: u32,
    pub orbit: f64,
    /// Degrees in `[0, 360)`.
    pub angle: f64,
    /// The running orbit it stepped out from.
    pub base: f64,
    /// The angle it turned on from: its layout's `turns_from` body's, or the walk's start.
    /// Degrees in `[0, 360)`.
    pub from: f64,
}

/// A planet drawn only to show that the game rolls the system's planets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlaceholderBody {
    pub class: String,
    pub size: u32,
    /// About the system's centre.
    pub orbit: f64,
    /// Degrees in `[0, 360)`.
    pub angle: f64,
}
