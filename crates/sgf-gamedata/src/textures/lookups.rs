//! How a texture key's names are looked up in the install: sprites, flag colours and planet
//! classes.

use std::collections::BTreeSet;

use super::{StarAtmosphere, TextureError, TextureView, Textures, planet_disc};
use crate::GameData;
use crate::registries::gfx::Sprites;

/// A flag colour by its `flags/colors.txt` name.
pub(crate) type ColourLookup<'a> = &'a dyn Fn(&str) -> Option<[u8; 3]>;

/// The surface map, relative to a layer root, of a planet class that is drawn as a disc:
/// neither a star nor an asteroid.
pub(crate) type SurfaceLookup<'a> = &'a dyn Fn(&str) -> Option<String>;

/// What a star planet class's disc is baked from.
#[derive(Debug, Clone, PartialEq)]
pub struct StarBody {
    /// Its entity's own surface map, relative to a layer root.
    pub surface: Option<String>,
    /// The `class` its star class lights it as, which names its `gfx/worldgfx` settings.
    pub lighting: Option<String>,
    pub atmosphere: Option<StarAtmosphere>,
}

/// The map of the pieces, relative to a layer root, of a planet class whose model is a planet
/// broken into pieces.
pub(crate) type PiecesLookup<'a> = &'a dyn Fn(&str) -> Option<String>;

/// The surface map, relative to a layer root, of a planet model by its entity name.
pub(crate) type ModelLookup<'a> = &'a dyn Fn(&str) -> Option<String>;

/// The star planet classes by key.
pub(crate) type StarLookup<'a> = &'a dyn Fn(&str) -> Option<StarBody>;

/// How a key's names are looked up in the install: an install's own, or [`Lookups::none`]'s
/// stand-ins for a caller that only cares about one of them.
pub struct Lookups<'a> {
    pub sprites: &'a Sprites,
    pub colour: ColourLookup<'a>,
    pub planet_surface: SurfaceLookup<'a>,
    pub planet_pieces: PiecesLookup<'a>,
    pub model_surface: ModelLookup<'a>,
    pub star_body: StarLookup<'a>,
}

impl<'a> Lookups<'a> {
    /// No flag colour, planet surface or pieces, model surface or star body: every one of those
    /// keys fails, and only `sprites` resolves.
    pub fn none(sprites: &'a Sprites) -> Self {
        fn no_colour(_: &str) -> Option<[u8; 3]> {
            None
        }
        fn no_surface(_: &str) -> Option<String> {
            None
        }
        fn no_star(_: &str) -> Option<StarBody> {
            None
        }
        Self {
            sprites,
            colour: &no_colour,
            planet_surface: &no_surface,
            planet_pieces: &no_surface,
            model_surface: &no_surface,
            star_body: &no_star,
        }
    }
}

impl GameData {
    /// `key` decoded through this install's sprites, flag colours and planet classes.
    pub fn texture(&self, textures: &Textures, key: &str) -> TextureView {
        self.with_lookups(|lookups| textures.load(&self.layout, lookups, key))
    }

    pub fn texture_png(&self, textures: &Textures, key: &str) -> Result<Vec<u8>, TextureError> {
        self.with_lookups(|lookups| textures.png(&self.layout, lookups, key))
    }

    /// This install's own lookups, built once and handed to `use_lookups`.
    fn with_lookups<T>(&self, use_lookups: impl FnOnce(&Lookups<'_>) -> T) -> T {
        let colour = |name: &str| self.colors.entries.get(name).map(|c| c.flag);
        let surface = |class: &str| self.planet_surface(class);
        let pieces = |class: &str| self.planet_pieces(class);
        let model = |entity: &str| self.entity_surface(entity);
        let star = |class: &str| self.star_disc_inputs(class);
        use_lookups(&Lookups {
            sprites: &self.sprites,
            colour: &colour,
            planet_surface: &surface,
            planet_pieces: &pieces,
            model_surface: &model,
            star_body: &star,
        })
    }

    fn star_disc_inputs(&self, class: &str) -> Option<StarBody> {
        let def = self.planet_classes.get(class).filter(|c| c.star)?;
        let atmosphere = def.atmosphere.map(|a| StarAtmosphere {
            colour: a.colour,
            intensity: a.intensity,
            width: a.width,
        });
        Some(StarBody {
            surface: def.entity.as_deref().and_then(|e| self.entity_surface(e)),
            lighting: self.star_lighting(class),
            atmosphere,
        })
    }

    /// The class a star body of `class` is lit as: as the single star of its own star class,
    /// else as a member of the first system that names it.
    fn star_lighting(&self, class: &str) -> Option<String> {
        let lit_as = |sc: &crate::StarClass| {
            sc.planets
                .iter()
                .find(|p| p.key == class)
                .map(|p| p.lighting.clone())
        };
        let classes = || self.star_classes.iter();
        classes()
            .filter(|sc| sc.planets.len() == 1)
            .find_map(lit_as)
            .or_else(|| classes().find_map(lit_as))
    }

    fn planet_surface(&self, class: &str) -> Option<String> {
        self.entity_surface(self.planet_entity(class)?)
    }

    fn planet_pieces(&self, class: &str) -> Option<String> {
        let entity = self.planet_entity(class)?;
        match planet_disc::surface(&self.layout, self.surface_maps(), entity) {
            planet_disc::Surface::Pieces(rel) => Some(rel),
            _ => None,
        }
    }

    /// The model family of `class`, when it is neither a star nor an asteroid.
    fn planet_entity(&self, class: &str) -> Option<&str> {
        self.planet_classes
            .get(class)
            .filter(|c| !c.star && !c.asteroid)?
            .entity
            .as_deref()
    }

    fn surface_maps(&self) -> &planet_disc::SurfaceMaps {
        self.surface_maps
            .get_or_init(|| planet_disc::surface_maps(&self.layout))
    }

    /// How many models the install numbers for a planet of `class`; 0 when it names none.
    pub(crate) fn class_models(&self, class: &str) -> u32 {
        self.planet_classes
            .get(class)
            .and_then(|c| c.entity.as_deref())
            .map_or(0, |entity| self.surface_maps().model_count(entity))
    }

    fn entity_surface(&self, entity: &str) -> Option<String> {
        planet_disc::diffuse(&self.layout, self.surface_maps(), entity)
    }

    /// Whether a planet of `class` is drawn from its icon alone: neither a star nor an
    /// asteroid, and its entity's model read and found to have no planet surface, as a
    /// habitat's or a ring world's.
    pub(crate) fn flat_art(&self, class: &str) -> bool {
        self.flat_art
            .get_or_init(|| self.classes_whose_surface(|s| *s == planet_disc::Surface::Flat))
            .contains(class)
    }

    /// Whether a planet of `class` is drawn broken apart: its entity's model is a planet in
    /// pieces, as the shattered world's.
    pub(crate) fn shattered(&self, class: &str) -> bool {
        self.shattered
            .get_or_init(|| {
                self.classes_whose_surface(|s| matches!(s, planet_disc::Surface::Pieces(_)))
            })
            .contains(class)
    }

    /// The planet classes, neither stars nor asteroids, whose entity's model has a surface
    /// `wanted` accepts.
    fn classes_whose_surface(
        &self,
        wanted: impl Fn(&planet_disc::Surface) -> bool,
    ) -> BTreeSet<String> {
        self.planet_classes
            .iter()
            .filter(|c| !c.star && !c.asteroid)
            .filter(|c| {
                c.entity.as_deref().is_some_and(|e| {
                    wanted(&planet_disc::surface(&self.layout, self.surface_maps(), e))
                })
            })
            .map(|c| c.key.clone())
            .collect()
    }
}
