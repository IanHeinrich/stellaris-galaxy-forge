//! What a new save system is made of, fully resolved: every class, size, orbit and deposit
//! is chosen by the caller, and [`crate::ops::Op::AddSystemFromSpec`] writes it as given.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::ops::NewRingWorld;

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
    /// The star flags the layout's `flags` block sets (`unique_system`), which the game
    /// writes on the system dated as day one, as it dates the flags of a generated galaxy.
    #[serde(default)]
    pub flags: Vec<String>,
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
    /// The picture the game shows for the body in place of its class's, as
    /// `set_planet_entity = { picture = pc_junkheap }` sets it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub picture: Option<String>,
    /// No anomaly is rolled on it when it is surveyed, as `prevent_anomaly = yes` sets.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(as = "Option<bool>", optional)]
    pub prevent_anomaly: bool,
    /// Planet modifiers that never expire, `terraforming_candidate`, ….
    #[serde(default)]
    pub modifiers: Vec<String>,
    /// Drawn with a ring around it.
    #[serde(default)]
    pub ring: bool,
    /// The planet flags its layout sets, which the game writes on the body dated as day
    /// one, as it dates the star flags.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub flags: Vec<String>,
    /// Of a class the install makes a star, as a layout's extra black holes are. The
    /// system's own star is written as one whatever this says.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub star: bool,
}

/// Where `body` stands: its orbit from (x, y), at its angle in degrees.
pub(crate) fn polar(x: f64, y: f64, body: &BodySpec) -> (f64, f64) {
    let angle = body.angle.to_radians();
    (x + body.orbit * angle.cos(), y + body.orbit * angle.sin())
}

/// An asteroid belt, drawn as a ring around the star.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BeltSpec {
    /// `rocky_asteroid_belt`, `icy_asteroid_belt`, …
    pub kind: String,
    pub inner_radius: f64,
}

/// One system an add writes: its spec, and what its layout's own script makes beside its
/// bodies when the system is made, which the add writes with the op that writes each.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SystemAdd {
    pub spec: SystemSpec,
    pub extras: SystemExtras,
}

impl From<SystemSpec> for SystemAdd {
    fn from(spec: SystemSpec) -> Self {
        Self {
            spec,
            extras: SystemExtras::default(),
        }
    }
}

/// What a layout's script plants on a new system's bodies, spawns beside them and saves as
/// global event targets.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SystemExtras {
    pub anomalies: Vec<SpecAnomaly>,
    pub dig_sites: Vec<SpecDigSite>,
    pub event_targets: Vec<SpecEventTarget>,
    /// The `megastructures` rows its script spawns, in the order it spawns them.
    pub megastructures: Vec<SpecMegastructure>,
    /// The ring world whose rows its script spawns round the star.
    pub ring_world: Option<NewRingWorld>,
}

impl SystemExtras {
    pub fn is_empty(&self) -> bool {
        self.event_targets.is_empty() && !self.optional()
    }

    /// It holds something an add writes only when asked to: an anomaly, a dig site or a
    /// megastructure.
    pub fn optional(&self) -> bool {
        !(self.anomalies.is_empty()
            && self.dig_sites.is_empty()
            && self.megastructures.is_empty()
            && self.ring_world.is_none())
    }
}

/// A `megastructures` row of type `kind` the script spawns, finished, with no owner.
#[derive(Debug, Clone, PartialEq)]
pub struct SpecMegastructure {
    pub kind: String,
    pub at: SpecMegastructurePlace,
}

/// Where a [`SpecMegastructure`] stands.
#[derive(Debug, Clone, PartialEq)]
pub enum SpecMegastructurePlace {
    /// On a body of the spec, at its point: the body gets `body_flags`, and a body that is not
    /// a star is refused when `star_only`.
    Body {
        body: SpecBody,
        body_flags: Vec<String>,
        star_only: bool,
    },
    /// At its own point about the star, tied to no body.
    Free { x: f64, y: f64 },
}

/// A body of a [`SystemSpec`]: its star, the `index`th of its planets, or the `index`th moon
/// of its `of`th planet. Each is a place in a list of the spec, not an id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpecBody {
    Star,
    Planet { index: usize },
    Moon { of: usize, index: usize },
}

/// An anomaly of `category` on a body of the spec.
#[derive(Debug, Clone, PartialEq)]
pub struct SpecAnomaly {
    pub body: SpecBody,
    pub category: String,
}

/// A dig site of `site_type` on a body of the spec, starting at `difficulty`, its first
/// stage's.
#[derive(Debug, Clone, PartialEq)]
pub struct SpecDigSite {
    pub body: SpecBody,
    pub site_type: String,
    pub difficulty: i32,
}

/// What a global event target the script saves names: the system, or a body of it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpecTarget {
    System,
    Body(SpecBody),
}

/// A global event target `name` the script saves.
#[derive(Debug, Clone, PartialEq)]
pub struct SpecEventTarget {
    pub target: SpecTarget,
    pub name: String,
}
