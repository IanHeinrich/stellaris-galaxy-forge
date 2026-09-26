//! `common/planet_classes`: what a `planets.planet_class` (or one of a
//! `galactic_object.star_class`'s `planet_keys`) looks like, whether it
//! can be colonised, and where and how large a random draw spawns it.

use crate::install::script::{Def, Range};
use crate::registries::colors;
use crate::registries::registry::{FromDef, Registry};

pub type PlanetClasses = Registry<PlanetClassDef>;

#[derive(Debug, Clone, PartialEq)]
pub struct PlanetClassDef {
    pub key: String,
    pub icon: Option<String>,
    /// The 76×76 `GFX_` sprite, beside `icon`'s 38×38 one.
    pub icon_large: Option<String>,
    /// The model name in `gfx/models/planets/*.asset`, without its `_01_entity` suffix.
    pub entity: Option<String>,
    /// `atmosphere_color`, `atmosphere_intensity` and `atmosphere_width`, written together or
    /// not at all.
    pub atmosphere: Option<Atmosphere>,
    pub colonizable: bool,
    pub star: bool,
    /// `asteroid = yes`: named outside the planet numbering and never given moons.
    pub asteroid: bool,
    /// `star_gfx = no`: this class is not drawn with the star shader (vanilla: `pc_t_star`,
    /// `pc_rift_star`, `pc_protostar`). Meaningless off a star class.
    pub star_gfx: bool,
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

/// `atmosphere_color`, `atmosphere_intensity` and `atmosphere_width`, written as a set.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Atmosphere {
    pub colour: [u8; 3],
    pub intensity: f64,
    pub width: f64,
}

impl PlanetClasses {
    /// The classes a random body can be drawn as: no star or asteroid, with a distance from
    /// the star it spawns at, and colonisable or not when `colonizable` says.
    pub fn drawable(&self, colonizable: Option<bool>) -> impl Iterator<Item = &PlanetClassDef> {
        self.iter().filter(move |c| {
            !c.star
                && !c.asteroid
                && c.distance_from_sun.is_some()
                && colonizable.is_none_or(|wanted| c.colonizable == wanted)
        })
    }
}

impl FromDef for PlanetClassDef {
    const DIR: &'static str = "common/planet_classes";

    /// The planet lists beside the classes (`random_list = { name = rl_… planets = { … } }`).
    fn skip(def: &Def) -> bool {
        def.node.find("planets", &def.src).is_some()
    }

    fn read(key: String, def: &Def) -> Self {
        let distance = |key: &str| def.number(key);
        let atmosphere = colors::read_rgb(&def.node, "atmosphere_color", &def.src)
            .zip(def.number("atmosphere_intensity"))
            .zip(def.number("atmosphere_width"))
            .map(|((colour, intensity), width)| Atmosphere {
                colour,
                intensity,
                width,
            });
        Self {
            icon: def.scalar("icon").map(str::to_owned),
            icon_large: def.scalar("icon_large").map(str::to_owned),
            entity: def.scalar("entity").map(str::to_owned),
            atmosphere,
            colonizable: def.flag("colonizable"),
            star: def.flag("star"),
            asteroid: def.flag("asteroid"),
            star_gfx: def.scalar("star_gfx") != Some("no"),
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
