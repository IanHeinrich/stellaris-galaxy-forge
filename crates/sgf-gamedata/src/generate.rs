//! A random star system rolled from the install's own rules: the initializer, star class,
//! planet classes, rings, asteroid belts and deposits a fresh galaxy would draw, as the
//! spec [`sgf_core::ops::Op::AddSaveSystem`] writes. The same seed, star class or layout,
//! abundance and install give the same spec.

use sgf_core::ops::{BeltSpec, BodySpec, SystemSpec};
use sgf_core::session::Session;

use crate::GameData;
use crate::body_effects;
use crate::deposit_roll::{RollBody, roll_deposits};
use crate::initializers::{BodyClass, InitAsteroidBelt, InitPlanet, Initializer};
use crate::install::script::Range;
use crate::layouts::{
    Dlc, Eligibility, SaveFacts, StarSource, USAGE, Unsupported, eligibility, generic,
    layout_stars, odds, plain_initializers, special_initializers, star_body, star_source,
};
use crate::naming;
use crate::registries::planet_classes::PlanetClassDef;
use crate::registries::star_classes::StarClass;
use crate::rng::Rng;

pub use crate::naming::pick_system_name;

/// Separates the deposit draw from the system draw of the same seed.
const DEPOSIT_STREAM: u64 = 0x6465_706F;
/// Separates the ring draw from the system draw of the same seed.
const RING_STREAM: u64 = 0x7269_6E67;
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
pub fn star_pick_layouts(gd: &GameData) -> Vec<&Initializer> {
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
pub fn layouts_for<'g>(gd: &'g GameData, star_class: Option<&str>) -> Vec<(&'g Initializer, f64)> {
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
        blocks: Vec::new(),
        star_named_by_class: false,
    };
    let (mut star, mut planets) = roller.bodies(&init.planets)?;
    Deposits {
        gd,
        abundance: draw.abundance,
        rng: Rng::new(seed ^ DEPOSIT_STREAM),
        save: draw.save,
    }
    .give(&mut star, &mut planets, &roller.blocks);
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
        flags: init.flags.clone(),
        lanes: Vec::new(),
    })
}

/// Settle the name of a system rolled from `seed` for `session`'s save. A layout's fixed
/// system name gives way to `fallback`, a name from the pool, when a system of the save
/// already holds it. A black hole with no fixed name takes one of the install's black hole
/// names no system of the save holds, as the game names its black holes, and keeps its
/// name when none is left.
pub fn settle_name(
    session: &Session,
    gd: &GameData,
    spec: &mut SystemSpec,
    fallback: &str,
    seed: u64,
) {
    let fixed = gd
        .initializers
        .get(&spec.initializer)
        .and_then(|init| init.display_name.as_deref());
    if fixed == Some(spec.name.as_str()) {
        if naming::system_names(session).contains(spec.name.as_str()) {
            spec.name = fallback.to_owned();
        }
        return;
    }
    let black_hole = gd
        .star_classes
        .get(&spec.star_class)
        .is_some_and(|class| class.class == BLACK_HOLE);
    if black_hole && let Some(name) = naming::pick_black_hole_name(session, gd, seed) {
        spec.name = name;
    }
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
fn belt(belt: &InitAsteroidBelt) -> Option<BeltSpec> {
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

/// Walks an initializer's bodies as the engine does, as far as the script says: each
/// block adds its `change_orbit` to a running orbit, then each instance its
/// `orbit_distance`, and each instance turns its `orbit_angle` on from the one before.
/// The first star block gives the star, once however many it counts; one written as a
/// class (`class = pc_m_star`) keeps that class and is named after the system. Approximated
/// where the engine's code decides: the first body's angle is drawn at random, a moon's
/// angle is absolute around its planet, a drawn class is any with odds whose
/// `min/max_distance_from_sun` holds the orbit (a moon's, its planet's orbit, with classes
/// marked `can_be_moon = no` left out), weighted by `spawn_odds` times the star's factor
/// for it, and a planet list draws each of its classes alike.
struct Roller<'g> {
    gd: &'g GameData,
    star_class: &'g StarClass,
    rng: Rng,
    /// Each planet's ring, drawn apart so the bodies a seed gives stay as they were.
    rings: Rng,
    /// The block each body was rolled from, the star first and then in spec order.
    blocks: Vec<&'g InitPlanet>,
    star_named_by_class: bool,
}

impl<'g> Roller<'g> {
    fn bodies(
        &mut self,
        blocks: &'g [InitPlanet],
    ) -> Result<(BodySpec, Vec<BodySpec>), GenerateError> {
        let mut star = None;
        let mut planets = Vec::new();
        let mut orbit = 0.0;
        let mut angle = self.rng.between(Range {
            min: 0.0,
            max: 360.0,
        });
        for block in blocks {
            orbit += block.change_orbit;
            let star_block = star.is_none() && star_body(self.gd, &block.class);
            let count = match star_block {
                true => 1,
                false => self.count(block.count),
            };
            for _ in 0..count {
                orbit += self.distance(block.orbit_distance);
                angle += self.angle(block.orbit_angle);
                if star_block {
                    star = Some(self.star(block, orbit, angle)?);
                    self.blocks.insert(0, block);
                    continue;
                }
                let class = self.class(&block.class, orbit, false)?;
                let size = self.size(block, class, class.planet_size)?;
                self.blocks.push(block);
                let moons = self.moons(&block.moons, orbit)?;
                let ring = self.ring(block, class);
                planets.push(BodySpec {
                    moons,
                    ring,
                    ..body(class, size, orbit, angle, block)
                });
            }
        }
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
                key
            }
            _ => self
                .star_class
                .planet_keys
                .first()
                .ok_or_else(|| GenerateError::NoStarBody(self.star_class.key.clone()))?,
        };
        let class = self
            .gd
            .planet_classes
            .get(key)
            .ok_or_else(|| GenerateError::UnknownPlanetClass(key.clone()))?;
        let size = self.size(block, class, class.planet_size)?;
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
    ) -> Result<Vec<BodySpec>, GenerateError> {
        let mut moons = Vec::new();
        let mut orbit = 0.0;
        for block in blocks {
            orbit += block.change_orbit;
            for _ in 0..self.count(block.count) {
                orbit += self.distance(block.orbit_distance);
                let angle = self.angle(block.orbit_angle);
                let class = self.class(&block.class, planet_orbit, true)?;
                let size = self.size(block, class, class.moon_size)?;
                self.blocks.push(block);
                moons.push(BodySpec {
                    asteroid: false,
                    ..body(class, size, orbit, angle, block)
                });
            }
        }
        Ok(moons)
    }

    /// The layout's `has_ring` when it says, else the class's `chance_of_ring`.
    fn ring(&mut self, block: &InitPlanet, class: &PlanetClassDef) -> bool {
        let roll = self.rings.unit();
        block.has_ring.unwrap_or(roll < class.chance_of_ring)
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
        let banded = self.drawable(moon, colonizable, Some(orbit));
        let none_banded = banded.iter().all(|(_, weight)| *weight <= 0.0);
        let weighted = match none_banded && colonizable.is_some() {
            true => self.drawable(moon, colonizable, None),
            false => banded,
        };
        self.rng
            .weighted(&weighted)
            .copied()
            .ok_or(GenerateError::NoPlanetClass(orbit))
    }

    /// Each class a random draw can give, with its weight: those at `orbit` when one is
    /// given, and those `colonizable` or not when it says.
    fn drawable(
        &self,
        moon: bool,
        colonizable: Option<bool>,
        orbit: Option<f64>,
    ) -> Vec<(&'g PlanetClassDef, f64)> {
        let star = self.star_class;
        self.gd
            .planet_classes
            .drawable(colonizable)
            .filter(|c| {
                c.distance_from_sun
                    .is_some_and(|band| orbit.is_none_or(|orbit| band.contains(orbit)))
            })
            .filter(|c| match moon {
                true => c.moon_size.is_some() && c.can_be_moon,
                false => c.planet_size.is_some(),
            })
            .map(|c| (c, c.spawn_odds * star.planet_odds(&c.key)))
            .collect()
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

    /// The block's own `size` when it fixes one, else the class's.
    fn size(
        &mut self,
        block: &InitPlanet,
        class: &PlanetClassDef,
        own: Option<Range>,
    ) -> Result<u32, GenerateError> {
        let range = block
            .size
            .map(|(min, max)| Range {
                min: f64::from(min),
                max: f64::from(max),
            })
            .or(own)
            .ok_or_else(|| GenerateError::NoSize(class.key.clone()))?;
        let size = self
            .rng
            .int(range.min.round() as i64, range.max.round() as i64);
        Ok(u32::try_from(size).unwrap_or(0))
    }

    fn count(&mut self, count: Range) -> i64 {
        self.rng
            .int(count.min.round() as i64, count.max.round() as i64)
    }

    /// A whole number between whole bounds, as the game writes orbits.
    fn distance(&mut self, distance: Option<Range>) -> f64 {
        let Some(range) = distance else {
            return 0.0;
        };
        if range.min.fract() == 0.0 && range.max.fract() == 0.0 {
            return self.rng.int(range.min as i64, range.max as i64) as f64;
        }
        self.rng.between(range)
    }

    fn angle(&mut self, angle: Option<Range>) -> f64 {
        angle.map_or(0.0, |range| self.rng.between(range))
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
    /// `blocks` holds the star's block, then each planet's and moon's in spec order.
    fn give(&mut self, star: &mut BodySpec, planets: &mut [BodySpec], blocks: &[&InitPlanet]) {
        let mut blocks = blocks.iter().copied();
        self.roll(star, blocks.next(), true, false);
        for planet in planets {
            self.roll(planet, blocks.next(), false, false);
            for moon in &mut planet.moons {
                self.roll(moon, blocks.next(), false, true);
            }
        }
    }

    fn roll(&mut self, body: &mut BodySpec, block: Option<&InitPlanet>, star: bool, moon: bool) {
        let rolled = RollBody {
            class: &body.class,
            size: body.size,
            star,
            moon,
        };
        body.deposits = roll_deposits(self.gd, &rolled, self.abundance, &mut self.rng);
        if let Some(block) = block {
            body_effects::apply(self.gd, &block.effects, body, &Dlc::of(self.gd, self.save));
        }
    }
}
