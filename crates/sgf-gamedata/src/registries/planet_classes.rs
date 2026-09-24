//! `common/planet_classes`: what a `planets.planet_class` (or one of a
//! `galactic_object.star_class`'s `planet_keys`) looks like, whether it
//! can be colonised, and where and how large a random draw spawns it.

use crate::install::script::{Def, Range};
use crate::registries::registry::{FromDef, Registry};

pub type PlanetClasses = Registry<PlanetClassDef>;

#[derive(Debug, Clone, PartialEq)]
pub struct PlanetClassDef {
    pub key: String,
    pub icon: Option<String>,
    pub colonizable: bool,
    pub star: bool,
    /// `asteroid = yes`: named outside the planet numbering and never given moons.
    pub asteroid: bool,
    /// Whether a random draw may make it a moon; `can_be_moon = no` says it may not.
    pub can_be_moon: bool,
    pub climate: Option<String>,
    /// The weight a random planet draws this class with; `0` when the definition omits it.
    pub spawn_odds: f64,
    /// How far from the star a random draw may place it, `min_distance_from_sun` to
    /// `max_distance_from_sun`; `None` unless both are written.
    pub distance_from_sun: Option<Range>,
    pub planet_size: Option<Range>,
    pub moon_size: Option<Range>,
    /// The chance, 0 to 1, that a random draw gives it a ring.
    pub chance_of_ring: f64,
    pub extra_orbit_size: f64,
    pub extra_planet_count: f64,
}

impl FromDef for PlanetClassDef {
    const DIR: &'static str = "common/planet_classes";

    fn read(key: String, def: &Def) -> Self {
        let distance = |key: &str| def.number(key);
        Self {
            icon: def.scalar("icon").map(str::to_owned),
            colonizable: def.flag("colonizable"),
            star: def.flag("star"),
            asteroid: def.flag("asteroid"),
            can_be_moon: def.scalar("can_be_moon") != Some("no"),
            climate: def.scalar("climate").map(str::to_owned),
            spawn_odds: def.number("spawn_odds").unwrap_or(0.0),
            distance_from_sun: distance("min_distance_from_sun")
                .zip(distance("max_distance_from_sun"))
                .map(|(min, max)| Range { min, max }),
            planet_size: def.range("planet_size"),
            moon_size: def.range("moon_size"),
            chance_of_ring: def.number("chance_of_ring").unwrap_or(0.0),
            extra_orbit_size: def.number("extra_orbit_size").unwrap_or(0.0),
            extra_planet_count: def.number("extra_planet_count").unwrap_or(0.0),
            key,
        }
    }
}
