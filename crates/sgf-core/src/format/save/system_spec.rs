//! What a new save system is made of, fully resolved: every class, size, orbit and deposit
//! is chosen by the caller, and [`crate::ops::Op::AddSaveSystem`] writes it as given.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One star system to add to a save.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemSpec {
    /// The system's name key, which its star and planets are named after.
    pub name: String,
    pub x: f64,
    pub y: f64,
    /// `sc_g`, `sc_m`, …
    pub star_class: String,
    /// `basic_init_01`, …
    pub initializer: String,
    /// The body at the centre, orbit 0.
    pub star: BodySpec,
    /// The bodies orbiting the star, in this order: the planets numbered I, II, …, and the
    /// asteroids named from the save's pool among them.
    #[serde(default)]
    pub planets: Vec<BodySpec>,
    /// In the order the initializer lists them.
    #[serde(default)]
    pub belts: Vec<BeltSpec>,
    /// The systems a hyperlane joins it to.
    #[serde(default)]
    pub lanes: Vec<u32>,
}

/// A star, planet or moon.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BodySpec {
    /// `pc_g_star`, `pc_gas_giant`, …
    pub class: String,
    pub size: u32,
    /// Distance from the body it orbits: the star, or a moon's planet.
    pub orbit: f64,
    /// Degrees.
    pub angle: f64,
    /// Which of the class's models the game draws.
    pub entity: u32,
    /// Deposit keys, `d_energy_5`, …
    #[serde(default)]
    pub deposits: Vec<String>,
    /// Lettered a, b, … in this order. Only a planet has moons.
    #[serde(default)]
    pub moons: Vec<BodySpec>,
    /// Named from the save's pool of asteroid names and left out of the numbering.
    #[serde(default)]
    pub asteroid: bool,
}

/// An asteroid belt, drawn as a ring around the star.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BeltSpec {
    /// `rocky_asteroid_belt`, `icy_asteroid_belt`, …
    pub kind: String,
    pub inner_radius: f64,
}
