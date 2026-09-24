//! What a new save system is made of, fully resolved: every class, size, orbit and deposit
//! is chosen by the caller, and [`crate::ops::Op::AddSaveSystem`] writes it as given.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One star system to add to a save.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
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
    /// The layout has `max_instances`, so the game counts it in
    /// `system_initializer_counter`, and so does the add.
    #[serde(default)]
    pub capped: bool,
    /// The star is named with the system's name key itself, as the game names a star its
    /// layout writes as a class (`class = pc_m_star`), rather than `STAR_NAME_1_OF_1`.
    #[serde(default)]
    pub star_named_by_class: bool,
    /// The body at the centre, or off it at its orbit.
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
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
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
    /// Lettered a, b, … in this order, but for those with a fixed name. Only a planet has
    /// moons.
    #[serde(default)]
    pub moons: Vec<BodySpec>,
    /// Named from the save's pool of asteroid names and left out of the numbering.
    #[serde(default)]
    pub asteroid: bool,
    /// A fixed name key, `NAME_Vermilion`, written as it is and left out of the numbering.
    /// Its moons are lettered after it.
    #[serde(default)]
    pub name: Option<String>,
    /// The model the game draws in place of the class's own,
    /// `previously_terraformed_planet_entity`, ….
    #[serde(default)]
    pub entity_name: Option<String>,
    /// Planet modifiers that never expire, `terraforming_candidate`, ….
    #[serde(default)]
    pub modifiers: Vec<String>,
    /// Drawn with a ring around it.
    #[serde(default)]
    pub ring: bool,
}

/// An asteroid belt, drawn as a ring around the star.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BeltSpec {
    /// `rocky_asteroid_belt`, `icy_asteroid_belt`, …
    pub kind: String,
    pub inner_radius: f64,
}
