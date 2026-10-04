//! A random star system rolled from the install's own rules: the initializer, star class,
//! planet classes, rings, asteroid belts and deposits a fresh galaxy would draw, as the
//! spec [`sgf_core::ops::Op::AddSaveSystem`] writes. The same seed, star class or layout,
//! abundance and install give the same spec.

use sgf_core::ops::{BeltSpec, BodySpec, SystemSpec};

use crate::GameData;
use crate::body_effects;
use crate::deposit_roll::{self, Kind, RollBody};
use crate::initializers::{BodyClass, InitAsteroidBelt, InitPlanet, Initializer, body_size};
use crate::install::script::Range;
use crate::layouts::{
    Dlc, Eligibility, SaveFacts, StarSource, USAGE, Unsupported, converted, eligibility, generic,
    layout_stars, odds, plain_initializers, special_initializers, star_body, star_source,
};
use crate::orbit_walk::{self, Placed, Walk, draw};
use crate::registries::planet_classes::PlanetClassDef;
use crate::registries::star_classes::StarClass;
use crate::rng::Rng;

mod save;

pub use save::{ForSaveError, Pick, added_among, body_for_save, for_save, reroll, settle_name};

/// Separates the deposit draw from the system draw of the same seed.
const DEPOSIT_STREAM: u64 = 0x6465_706F;
/// Separates the ring draw from the system draw of the same seed.
const RING_STREAM: u64 = 0x7269_6E67;
/// The classes the game never spawns, each with the scripted effect that sets its deposits
/// wherever the game makes one (`common/scripted_effects/archaeology_event_effects.txt`). A
/// class of no spawn odds that is not listed gets no deposits.
const DEPOSIT_EFFECTS: [(&str, &str); 1] = [("pc_relic", "relic_world_deposits")];
/// The `class` of the star classes the game names from its black hole names.
const BLACK_HOLE: &str = "black_hole";

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum GenerateError {
    #[error("the install has no plain {USAGE} initializer to roll a system from")]
    NoInitializer,
    #[error("no {USAGE} initializer of the install can make a system of star class {0}")]
    NoLayoutFor(String),
    #[error("{0} is no solar system initializer of the install")]
    UnknownLayout(String),
    #[error("{0} cannot be generated: {1}")]
    Unsupported(String, Unsupported),
    #[error("{0} is neither a star list nor a star class")]
    UnknownStar(String),
    #[error("no star class in {0} can spawn")]
    NoStar(String),
    #[error("{0} names no planet class for its star")]
    NoStarBody(String),
    #[error("{0} is not a planet class")]
    UnknownPlanetClass(String),
    #[error("no planet class spawns at orbit {0}")]
    NoPlanetClass(f64),
    #[error("{0} has no size to draw from")]
    NoSize(String),
}

/// The star classes [`generate`] can give a system: each class a plain initializer fixes
/// or draws from its list with odds above zero, in the order the initializers and their
/// lists name them, and then each one only generic special layouts make (a black hole, a
/// pulsar).
pub fn star_classes(gd: &GameData) -> Vec<String> {
    let mut classes: Vec<String> = Vec::new();
    for init in plain_initializers(gd)
        .into_iter()
        .chain(generic_specials(gd))
    {
        for star in layout_stars(gd, init) {
            let class = star.key.as_str();
            if share(gd, init, class) > 0.0 && !classes.iter().any(|held| held == class) {
                classes.push(class.to_owned());
            }
        }
    }
    classes
}

/// Every layout a star-class pick of [`generate`] can draw, for any class of
/// [`star_classes`]: the plain ones, and the [`generic`] special ones a class only they make
/// draws from.
pub(crate) fn star_pick_layouts(gd: &GameData) -> Vec<&Initializer> {
    let mut layouts: Vec<&Initializer> = Vec::new();
    for class in star_classes(gd) {
        for (init, _) in layouts_for(gd, Some(&class)) {
            if !layouts.iter().any(|held| held.name == init.name) {
                layouts.push(init);
            }
        }
    }
    layouts
}

/// A system named `name` at (`x`, `y`) with no lanes, rolled from `seed`. Without a
/// `star_class` it is drawn from the plain layouts. With one, the star is that class and
/// each layout that makes it is drawn as often as it would roll it: its odds times the
/// class's share of its star list. The plain layouts are drawn for a class they make, and
/// the [`generic`] special layouts for a class only they make, so a draw never gives a
/// named or capped layout. Every body rolls its deposits at
/// `abundance`, the save's Resource Abundance, and then runs its layout's deposit effects.
/// A layout with a fixed system name gives the system that name in place of `name`.
pub fn generate(
    gd: &GameData,
    seed: u64,
    name: &str,
    at: (f64, f64),
    star_class: Option<&str>,
    abundance: f64,
) -> Result<SystemSpec, GenerateError> {
    if let Some(class) = star_class
        && gd.star_classes.get(class).is_none()
    {
        return Err(GenerateError::UnknownStar(class.to_owned()));
    }
    let mut rng = Rng::new(seed);
    let layouts = layouts_for(gd, star_class);
    let Some(&init) = rng.weighted(&layouts) else {
        return Err(match star_class {
            Some(class) => GenerateError::NoLayoutFor(class.to_owned()),
            None => GenerateError::NoInitializer,
        });
    };
    let draw = Draw {
        seed,
        star_class,
        abundance,
        save: None,
    };
    build(gd, init, rng, &draw, name, at)
}

/// A system of the plain or special layout `layout` for `save`, rolled as [`generate`]
/// rolls one, whose DLC answers an `if` of its bodies' effects: Larionessi Refuge's relic
/// world stays one only with Ancient Relics.
pub fn generate_layout_for(
    gd: &GameData,
    save: &SaveFacts,
    seed: u64,
    name: &str,
    at: (f64, f64),
    layout: &str,
    abundance: f64,
) -> Result<SystemSpec, GenerateError> {
    let init = gd
        .initializers
        .get(layout)
        .ok_or_else(|| GenerateError::UnknownLayout(layout.to_owned()))?;
    if let Eligibility::Unsupported(why) = eligibility(gd, init) {
        return Err(GenerateError::Unsupported(layout.to_owned(), why));
    }
    let draw = Draw {
        seed,
        star_class: None,
        abundance,
        save: Some(save),
    };
    build(gd, init, Rng::new(seed), &draw, name, at)
}

/// The layouts a draw is made among, each with its weight: the plain ones, or for a star
/// class, the plain ones that make it, else the generic special ones that do.
pub(crate) fn layouts_for<'g>(
    gd: &'g GameData,
    star_class: Option<&str>,
) -> Vec<(&'g Initializer, f64)> {
    let weigh = |layouts: Vec<&'g Initializer>| -> Vec<(&'g Initializer, f64)> {
        layouts
            .into_iter()
            .map(|i| {
                let odds = odds(gd, i, None);
                (
                    i,
                    star_class.map_or(odds, |class| odds * share(gd, i, class)),
                )
            })
            .filter(|(_, weight)| *weight > 0.0)
            .collect()
    };
    let plain = weigh(plain_initializers(gd));
    match star_class {
        Some(_) if plain.is_empty() => weigh(generic_specials(gd)),
        _ => plain,
    }
}

fn generic_specials(gd: &GameData) -> Vec<&Initializer> {
    special_initializers(gd)
        .into_iter()
        .filter(|init| generic(init))
        .collect()
}

/// What a system is rolled from beside its layout: the seed, the star class asked for, the
/// save's Resource Abundance, and the save whose DLC answers the bodies' `if`s.
struct Draw<'a> {
    seed: u64,
    star_class: Option<&'a str>,
    abundance: f64,
    save: Option<&'a SaveFacts>,
}

fn build(
    gd: &GameData,
    init: &Initializer,
    mut rng: Rng,
    draw: &Draw<'_>,
    name: &str,
    (x, y): (f64, f64),
) -> Result<SystemSpec, GenerateError> {
    let seed = draw.seed;
    let star_class = match draw.star_class.and_then(|class| gd.star_classes.get(class)) {
        Some(fixed) => fixed,
        None => roll_star(gd, init, &mut rng)?,
    };
    let mut roller = Roller {
        gd,
        star_class,
        rng,
        rings: Rng::new(seed ^ RING_STREAM),
        star_named_by_class: false,
    };
    let (rolled_star, rolled_planets) = roller.bodies(&init.planets)?;
    let (star, planets) = Deposits {
        gd,
        abundance: draw.abundance,
        rng: Rng::new(seed ^ DEPOSIT_STREAM),
        save: draw.save,
    }
    .give(rolled_star, rolled_planets);
    Ok(SystemSpec {
        name: init.display_name.as_deref().unwrap_or(name).to_owned(),
        x,
        y,
        star_class: star_class.key.clone(),
        initializer: init.name.clone(),
        capped: init.max_instances.is_some(),
        star_named_by_class: roller.star_named_by_class,
        star,
        planets,
        belts: init.asteroid_belts.iter().filter_map(belt).collect(),
        flags: init
            .flags
            .iter()
            .filter(|flag| converted(init).is_none_or(|layout| layout.keeps(flag)))
            .cloned()
            .collect(),
        lanes: Vec::new(),
    })
}

/// How often `init` gives a system of star class `class`: always for its one class, else
/// the class's odds over those of every class its list can give.
fn share(gd: &GameData, init: &Initializer, class: &str) -> f64 {
    let stars = layout_stars(gd, init);
    let Some(star) = stars.iter().find(|star| star.key == class) else {
        return 0.0;
    };
    if init.class.as_deref() == Some(class) || stars.len() == 1 {
        return 1.0;
    }
    let total: f64 = stars.iter().map(|listed| listed.spawn_odds.max(0.0)).sum();
    match total > 0.0 {
        true => star.spawn_odds.max(0.0) / total,
        false => 0.0,
    }
}

/// A belt as the save writes it: its `radius` is the `inner_radius`.
pub(crate) fn belt(belt: &InitAsteroidBelt) -> Option<BeltSpec> {
    (!belt.kind.is_empty()).then_some(())?;
    Some(BeltSpec {
        kind: belt.kind.clone(),
        inner_radius: belt.radius?,
    })
}

/// The layout's fixed star class, or one of those its list can give, drawn by their odds;
/// either as [`layout_stars`] makes it agree with a star written as a class.
fn roll_star<'g>(
    gd: &'g GameData,
    init: &Initializer,
    rng: &mut Rng,
) -> Result<&'g StarClass, GenerateError> {
    let key = init.class.as_deref().unwrap_or_default();
    let stars = layout_stars(gd, init);
    let drawn = match star_source(gd, init) {
        StarSource::Fixed(_) => stars.first().copied(),
        StarSource::List(_) => {
            let weighted: Vec<(&StarClass, f64)> = stars
                .into_iter()
                .map(|star| (star, star.spawn_odds))
                .collect();
            rng.weighted(&weighted).copied()
        }
        StarSource::Unknown => return Err(GenerateError::UnknownStar(key.to_owned())),
    };
    drawn.ok_or_else(|| GenerateError::NoStar(key.to_owned()))
}

/// Rolls an initializer's bodies along [`orbit_walk::walk`], drawing each range and each
/// count as [`InitPlanet::count`] gives it, so `class = star` spawns once. The first block
/// whose class is a star's gives the star; one written as a class (`class = pc_m_star`)
/// keeps that class and is named after the system. A planet's moons walk as the planets
/// do. Approximated where the engine's code decides: the turn of a body whose block gives
/// no angle is drawn at random; a drawn class is any with odds whose
/// `min/max_distance_from_sun` holds the orbit (a moon's, its planet's orbit, with classes
/// marked `can_be_moon = no` left out), weighted by `spawn_odds` times the star's factor
/// for it; and a planet list draws each of its classes alike.
struct Roller<'g> {
    gd: &'g GameData,
    star_class: &'g StarClass,
    rng: Rng,
    /// Each planet's ring, drawn apart so the bodies a seed gives stay as they were.
    rings: Rng,
    star_named_by_class: bool,
}

/// A body just rolled, beside the block it came from, so [`Deposits`] can roll its deposits
/// and effects without assuming where in the walk it fell.
struct Rolled<'g> {
    spec: BodySpec,
    block: &'g InitPlanet,
}

/// A rolled planet, beside its own block and its moons, each still beside its own.
struct RolledPlanet<'g> {
    spec: BodySpec,
    block: &'g InitPlanet,
    moons: Vec<Rolled<'g>>,
}

impl<'g> Roller<'g> {
    fn bodies(
        &mut self,
        blocks: &'g [InitPlanet],
    ) -> Result<(Rolled<'g>, Vec<RolledPlanet<'g>>), GenerateError> {
        let mut walk = Walker {
            roller: self,
            bodies: Planets::default(),
        };
        orbit_walk::walk(blocks, &mut walk)?;
        let Planets { star, planets } = walk.bodies;
        let star = star.ok_or_else(|| GenerateError::NoStarBody(self.star_class.key.clone()))?;
        Ok((star, planets))
    }

    fn star(
        &mut self,
        block: &InitPlanet,
        orbit: f64,
        angle: f64,
    ) -> Result<BodySpec, GenerateError> {
        let key = match &block.class {
            BodyClass::Named(key) => {
                self.star_named_by_class = true;
                key.as_str()
            }
            _ => self
                .star_class
                .planet_keys()
                .next()
                .ok_or_else(|| GenerateError::NoStarBody(self.star_class.key.clone()))?,
        };
        let class = self
            .gd
            .planet_classes
            .get(key)
            .ok_or_else(|| GenerateError::UnknownPlanetClass(key.to_owned()))?;
        let size = self.size(block, class, false)?;
        Ok(BodySpec {
            name: None,
            star: true,
            ..body(class, size, orbit, angle, block)
        })
    }

    fn moons(
        &mut self,
        blocks: &'g [InitPlanet],
        planet_orbit: f64,
    ) -> Result<Vec<Rolled<'g>>, GenerateError> {
        let mut walk = Walker {
            roller: self,
            bodies: Moons {
                planet_orbit,
                moons: Vec::new(),
            },
        };
        orbit_walk::walk(blocks, &mut walk)?;
        Ok(walk.bodies.moons)
    }

    fn ring(&mut self, block: &InitPlanet, class: &PlanetClassDef) -> bool {
        draw_ring(&mut self.rings, Some(block), class)
    }

    fn class(
        &mut self,
        class: &BodyClass,
        orbit: f64,
        moon: bool,
    ) -> Result<&'g PlanetClassDef, GenerateError> {
        let colonizable = match class {
            BodyClass::Random(colonizable) => *colonizable,
            BodyClass::Named(key) => return self.fixed_or_listed(key, moon),
            BodyClass::Star => {
                return Err(GenerateError::UnknownPlanetClass(
                    class.written().to_owned(),
                ));
            }
        };
        let weighted = drawable_at(self.gd, self.star_class, moon, colonizable, orbit);
        self.rng
            .weighted(&weighted)
            .copied()
            .ok_or(GenerateError::NoPlanetClass(orbit))
    }

    /// A class of the install, or one drawn alike among a planet list's; for a moon, among
    /// those that can be one when any can.
    fn fixed_or_listed(
        &mut self,
        class: &str,
        moon: bool,
    ) -> Result<&'g PlanetClassDef, GenerateError> {
        let classes = &self.gd.planet_classes;
        let Some(list) = self.gd.planet_lists.get(class) else {
            return classes
                .get(class)
                .ok_or_else(|| GenerateError::UnknownPlanetClass(class.to_owned()));
        };
        let listed: Vec<&PlanetClassDef> = list.iter().filter_map(|key| classes.get(key)).collect();
        let moons: Vec<&PlanetClassDef> = listed
            .iter()
            .copied()
            .filter(|c| c.moon_size.is_some() && c.can_be_moon)
            .collect();
        let pool = match moon && !moons.is_empty() {
            true => moons,
            false => listed,
        };
        self.rng
            .pick(&pool)
            .copied()
            .ok_or_else(|| GenerateError::UnknownPlanetClass(class.to_owned()))
    }

    fn size(
        &mut self,
        block: &InitPlanet,
        class: &PlanetClassDef,
        moon: bool,
    ) -> Result<u32, GenerateError> {
        draw_size(&mut self.rng, Some(block), class, moon)
    }

    /// Drawn from the block's [`InitPlanet::count`].
    fn count(&mut self, block: &InitPlanet) -> u32 {
        let count = block.count();
        let drawn = self
            .rng
            .int(count.min.round() as i64, count.max.round() as i64);
        u32::try_from(drawn).unwrap_or(0)
    }
}

/// Each class a random body about a star of `star` can be drawn as, with its weight: those at
/// `orbit` when one is given, and those `colonizable` or not when it says.
fn drawable<'g>(
    gd: &'g GameData,
    star: &StarClass,
    moon: bool,
    colonizable: Option<bool>,
    orbit: Option<f64>,
) -> Vec<(&'g PlanetClassDef, f64)> {
    gd.planet_classes
        .drawable(colonizable)
        .filter(|c| {
            c.distance_from_sun
                .is_some_and(|band| orbit.is_none_or(|orbit| band.contains(orbit)))
        })
        .filter(|c| can_be(c, moon))
        .map(|c| (c, c.spawn_odds * star.planet_odds(&c.key)))
        .collect()
}

/// The classes [`drawable`] gives at `orbit`, or at any orbit when none spawns there.
fn drawable_at<'g>(
    gd: &'g GameData,
    star: &StarClass,
    moon: bool,
    colonizable: Option<bool>,
    orbit: f64,
) -> Vec<(&'g PlanetClassDef, f64)> {
    let banded = drawable(gd, star, moon, colonizable, Some(orbit));
    match banded.iter().any(|(_, weight)| *weight > 0.0) {
        true => banded,
        false => drawable(gd, star, moon, colonizable, None),
    }
}

/// A body's size, drawn from [`body_size`].
fn draw_size(
    rng: &mut Rng,
    block: Option<&InitPlanet>,
    class: &PlanetClassDef,
    moon: bool,
) -> Result<u32, GenerateError> {
    let range = body_size(block, Some(class), moon)
        .ok_or_else(|| GenerateError::NoSize(class.key.clone()))?;
    let size = rng.int(range.min.round() as i64, range.max.round() as i64);
    Ok(u32::try_from(size).unwrap_or(0))
}

/// Whether a planet has a ring: the layout's `has_ring` when it says, else a roll against the
/// class's `chance_of_ring`, drawn from `rings` either way.
fn draw_ring(rings: &mut Rng, block: Option<&InitPlanet>, class: &PlanetClassDef) -> bool {
    let roll = rings.unit();
    block
        .and_then(|b| b.has_ring)
        .unwrap_or(roll < class.chance_of_ring)
}

/// Whether a random draw can give a body of `class` as a moon, or as a planet.
fn can_be(class: &PlanetClassDef, moon: bool) -> bool {
    match moon {
        true => class.moon_size.is_some() && class.can_be_moon,
        false => class.planet_size.is_some(),
    }
}

/// The classes a body added to a save may be, as a moon or as a planet: every class a random
/// draw can give one, by key.
pub fn body_classes(gd: &GameData, moon: bool) -> Vec<&PlanetClassDef> {
    gd.planet_classes
        .drawable(None)
        .filter(|c| can_be(c, moon))
        .collect()
}

/// What [`roll_body`] rolls a lone body from.
#[derive(Debug, Clone, Copy)]
pub struct BodyRoll<'a> {
    /// The star class of the system it joins, which weighs a drawn class.
    pub star_class: &'a str,
    /// Drawn at random when `None`.
    pub class: Option<&'a str>,
    /// Drawn from the class's range when `None`.
    pub size: Option<u32>,
    pub moon: bool,
    /// How far from the star it orbits, a moon its planet's, which bands a drawn class.
    pub orbit: f64,
    /// The save's Resource Abundance.
    pub abundance: f64,
}

/// One planet or moon rolled from `seed` as the game's roll gives a body of a new system: a
/// class drawn at its orbit when none is given, or anywhere when none spawns there, a size
/// drawn from the class's range when none is given, a planet's ring, and its deposits. Where
/// it stands is the caller's, so its orbit and angle are 0.
pub fn roll_body(gd: &GameData, seed: u64, roll: &BodyRoll<'_>) -> Result<BodySpec, GenerateError> {
    let mut rng = Rng::new(seed);
    let class = match roll.class {
        Some(key) => gd
            .planet_classes
            .get(key)
            .ok_or_else(|| GenerateError::UnknownPlanetClass(key.to_owned()))?,
        None => {
            let star = gd
                .star_classes
                .get(roll.star_class)
                .ok_or_else(|| GenerateError::UnknownStar(roll.star_class.to_owned()))?;
            let weighted = drawable_at(gd, star, roll.moon, None, roll.orbit);
            rng.weighted(&weighted)
                .copied()
                .ok_or(GenerateError::NoPlanetClass(roll.orbit))?
        }
    };
    let size = match roll.size {
        Some(size) => size,
        None => draw_size(&mut rng, None, class, roll.moon)?,
    };
    let ring = !roll.moon && draw_ring(&mut Rng::new(seed ^ RING_STREAM), None, class);
    let rolled = RollBody {
        class: &class.key,
        size,
        kind: match roll.moon {
            true => Kind::Moon,
            false => Kind::Planet,
        },
    };
    let mut spec = BodySpec {
        class: class.key.clone(),
        size,
        ring,
        ..BodySpec::default()
    };
    if class.spawn_odds > 0.0 {
        let mut deposits = Rng::new(seed ^ DEPOSIT_STREAM);
        spec.deposits = deposit_roll::roll(gd, &rolled, roll.abundance, &mut deposits, true);
    } else if let Some(effect) = deposit_effect(gd, &class.key) {
        body_effects::apply(gd, &effect, &mut spec, &Dlc::of(gd, None));
    }
    Ok(spec)
}

/// What the install's scripted effect for a class the game never spawns runs on its body.
fn deposit_effect(gd: &GameData, class: &str) -> Option<Vec<body_effects::BodyEffect>> {
    let (_, effect) = DEPOSIT_EFFECTS.iter().find(|(key, _)| *key == class)?;
    gd.scripts.effect(effect).map(body_effects::read_effect)
}

/// The roller walking a list of blocks, drawing each count, distance and angle from its
/// stream, with what it does with each placed body left to `P`.
struct Walker<'r, 'g, P> {
    roller: &'r mut Roller<'g>,
    bodies: P,
}

/// What a [`Walker`] does with each body it places.
trait Bodies<'g> {
    fn body(
        &mut self,
        roller: &mut Roller<'g>,
        block: &'g InitPlanet,
        placed: Placed<f64>,
    ) -> Result<(), GenerateError>;
}

impl<'g, P: Bodies<'g>> Walk<'g> for Walker<'_, 'g, P> {
    type Number = f64;
    type Error = GenerateError;

    fn count(&mut self, block: &'g InitPlanet) -> u32 {
        self.roller.count(block)
    }

    fn distance(&mut self, distance: Range) -> f64 {
        draw::distance(&mut self.roller.rng, distance)
    }

    fn angle(&mut self, angle: Range) -> f64 {
        draw::angle(&mut self.roller.rng, angle)
    }

    fn no_angle(&mut self) -> f64 {
        draw::any_angle(&mut self.roller.rng)
    }

    fn body(&mut self, block: &'g InitPlanet, placed: Placed<f64>) -> Result<(), GenerateError> {
        self.bodies.body(self.roller, block, placed)
    }
}

/// The system's own bodies. The first block whose class is a star's gives the star.
#[derive(Default)]
struct Planets<'g> {
    star: Option<Rolled<'g>>,
    planets: Vec<RolledPlanet<'g>>,
}

impl<'g> Bodies<'g> for Planets<'g> {
    fn body(
        &mut self,
        roller: &mut Roller<'g>,
        block: &'g InitPlanet,
        placed: Placed<f64>,
    ) -> Result<(), GenerateError> {
        let Placed { orbit, angle, .. } = placed;
        if self.star.is_none() && star_body(roller.gd, &block.class) {
            let spec = roller.star(block, orbit, angle)?;
            self.star = Some(Rolled { spec, block });
            return Ok(());
        }
        let class = roller.class(&block.class, orbit, false)?;
        let size = roller.size(block, class, false)?;
        let moons = roller.moons(&block.moons, orbit)?;
        let ring = roller.ring(block, class);
        self.planets.push(RolledPlanet {
            spec: BodySpec {
                ring,
                ..body(class, size, orbit, angle, block)
            },
            block,
            moons,
        });
        Ok(())
    }
}

/// A planet's moons, each class drawn for the planet's orbit.
struct Moons<'g> {
    planet_orbit: f64,
    moons: Vec<Rolled<'g>>,
}

impl<'g> Bodies<'g> for Moons<'g> {
    fn body(
        &mut self,
        roller: &mut Roller<'g>,
        block: &'g InitPlanet,
        placed: Placed<f64>,
    ) -> Result<(), GenerateError> {
        let class = roller.class(&block.class, self.planet_orbit, true)?;
        let size = roller.size(block, class, true)?;
        let spec = BodySpec {
            asteroid: false,
            ..body(class, size, placed.orbit, placed.angle, block)
        };
        self.moons.push(Rolled { spec, block });
        Ok(())
    }
}

/// A body of `class` as `block` writes it: its fixed name and model, and whether the
/// install makes its class a star. An asteroid with no fixed name is named from the save's
/// pool, unless it is a moon, which is lettered after its planet.
fn body(class: &PlanetClassDef, size: u32, orbit: f64, angle: f64, block: &InitPlanet) -> BodySpec {
    BodySpec {
        class: class.key.clone(),
        size,
        orbit,
        angle: (angle.rem_euclid(360.0) * 100.0).round() / 100.0,
        entity: 0,
        asteroid: class.asteroid && block.name.is_none(),
        name: block.name.clone(),
        entity_name: block.entity.clone(),
        star: class.star,
        ..Default::default()
    }
}

/// Rolls each body's deposits from a stream of its own, so the bodies a seed gives stay
/// the same whatever the abundance, then runs the effects of its block, with the save's
/// DLC, when there is one, answering their `if`s.
struct Deposits<'g> {
    gd: &'g GameData,
    abundance: f64,
    rng: Rng,
    save: Option<&'g SaveFacts>,
}

impl Deposits<'_> {
    /// Finishes the star and every planet and moon of a roll, each beside the block it was
    /// rolled from.
    fn give(
        &mut self,
        star: Rolled<'_>,
        planets: Vec<RolledPlanet<'_>>,
    ) -> (BodySpec, Vec<BodySpec>) {
        let Rolled { mut spec, block } = star;
        self.roll(&mut spec, block, Kind::Star);
        let planets = planets
            .into_iter()
            .map(|planet| self.planet(planet))
            .collect();
        (spec, planets)
    }

    fn planet(&mut self, planet: RolledPlanet<'_>) -> BodySpec {
        let RolledPlanet {
            mut spec,
            block,
            moons,
        } = planet;
        self.roll(&mut spec, block, Kind::Planet);
        spec.moons = moons.into_iter().map(|moon| self.moon(moon)).collect();
        spec
    }

    fn moon(&mut self, moon: Rolled<'_>) -> BodySpec {
        let Rolled { mut spec, block } = moon;
        self.roll(&mut spec, block, Kind::Moon);
        spec
    }

    fn roll(&mut self, body: &mut BodySpec, block: &InitPlanet, kind: Kind) {
        let rolled = RollBody {
            class: &body.class,
            size: body.size,
            kind,
        };
        body.deposits = deposit_roll::roll(
            self.gd,
            &rolled,
            self.abundance,
            &mut self.rng,
            block.blockers,
        );
        body_effects::apply(self.gd, &block.effects, body, &Dlc::of(self.gd, self.save));
    }
}
