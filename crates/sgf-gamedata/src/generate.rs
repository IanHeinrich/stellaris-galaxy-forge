//! A random star system rolled from the install's own rules: the initializer, star class
//! and planet classes a fresh galaxy would draw, as the spec
//! [`sgf_core::ops::Op::AddSaveSystem`] writes. The same seed and install give the same
//! spec.

use sgf_core::ops::{BodySpec, SystemSpec};

use crate::GameData;
use crate::initializers::{InitPlanet, Initializer};
use crate::install::script::Range;
use crate::registries::planet_classes::PlanetClassDef;
use crate::registries::star_classes::StarClass;

/// The `usage` of the initializers a galaxy fills its ordinary systems with.
pub const USAGE: &str = "misc_system_init";
/// The body written as `class = star`, which takes the star class's own planet class.
const STAR: &str = "star";
/// A body whose class the engine draws.
const RANDOM: &str = "random";
/// Separates the name draw from the system draw of the same seed.
const NAME_STREAM: u64 = 0x6E61_6D65;

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum GenerateError {
    #[error("the install has no plain {USAGE} initializer to roll a system from")]
    NoInitializer,
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

/// The initializers [`generate`] draws from: an ordinary system of one star, drawn from a
/// star list, with no effects, belts, flags, countries, asteroids or special bodies.
pub fn plain_initializers(gd: &GameData) -> Vec<&Initializer> {
    gd.initializers.iter().filter(|i| plain(gd, i)).collect()
}

/// A system named `name` at (`x`, `y`) with no lanes, rolled from `seed`.
pub fn generate(
    gd: &GameData,
    seed: u64,
    name: &str,
    x: f64,
    y: f64,
) -> Result<SystemSpec, GenerateError> {
    let mut rng = Rng(seed);
    let plain: Vec<(&Initializer, f64)> = plain_initializers(gd)
        .into_iter()
        .map(|i| (i, i.usage_odds.unwrap_or(0.0)))
        .collect();
    let init = *rng.weighted(&plain).ok_or(GenerateError::NoInitializer)?;
    let star_class = roll_star(gd, init.class.as_deref().unwrap_or_default(), &mut rng)?;
    let mut roller = Roller {
        gd,
        star_class,
        rng,
    };
    let (star, planets) = roller.bodies(&init.planets)?;
    Ok(SystemSpec {
        name: name.to_owned(),
        x,
        y,
        star_class: star_class.key.clone(),
        initializer: init.name.clone(),
        star,
        planets,
        lanes: Vec::new(),
    })
}

/// One of `names`, drawn from `seed`; `None` when there are none.
pub fn pick_name(names: &[String], seed: u64) -> Option<&str> {
    let last = i64::try_from(names.len()).ok()?.checked_sub(1)?;
    let index = Rng(seed ^ NAME_STREAM).int(0, last);
    names.get(usize::try_from(index).ok()?).map(String::as_str)
}

fn plain(gd: &GameData, init: &Initializer) -> bool {
    let Some((star, rest)) = init.planets.split_first() else {
        return false;
    };
    init.usage.as_deref() == Some(USAGE)
        && init.usage_odds.is_some_and(|odds| odds > 0.0)
        && !init.init_effect
        && init.countries.is_empty()
        && init.asteroid_belts.is_empty()
        && init.flags.is_empty()
        && init.max_instances.is_none()
        && init.spawns.is_empty()
        && init.starbase.is_none()
        && init
            .class
            .as_deref()
            .is_some_and(|list| single_stars(gd, list))
        && star.class == STAR
        && star.count == Range::fixed(1.0)
        && star.orbit_distance.is_none_or(|d| d == Range::fixed(0.0))
        && rest.iter().all(|planet| {
            plain_body(gd, planet)
                && planet
                    .moons
                    .iter()
                    .all(|moon| plain_body(gd, moon) && moon.moons.is_empty())
        })
}

/// A star list whose every class has one star body.
fn single_stars(gd: &GameData, list: &str) -> bool {
    gd.star_lists.get(list).is_some_and(|list| {
        list.stars.iter().all(|key| {
            gd.star_classes
                .get(key)
                .is_some_and(|class| class.planet_keys.len() == 1)
        })
    })
}

fn plain_body(gd: &GameData, body: &InitPlanet) -> bool {
    let class = body.class == RANDOM
        || gd
            .planet_classes
            .get(&body.class)
            .is_some_and(|class| !class.star && !class.asteroid);
    class && !body.colonised && !body.pre_ftl && body.sites.is_empty()
}

fn roll_star<'g>(
    gd: &'g GameData,
    class: &str,
    rng: &mut Rng,
) -> Result<&'g StarClass, GenerateError> {
    if let Some(fixed) = gd.star_classes.get(class) {
        return Ok(fixed);
    }
    let list = gd
        .star_lists
        .get(class)
        .ok_or_else(|| GenerateError::UnknownStar(class.to_owned()))?;
    let weighted: Vec<(&StarClass, f64)> = list
        .stars
        .iter()
        .filter_map(|key| gd.star_classes.get(key))
        .map(|star| (star, star.spawn_odds))
        .collect();
    rng.weighted(&weighted)
        .copied()
        .ok_or_else(|| GenerateError::NoStar(class.to_owned()))
}

/// Walks an initializer's bodies as the engine does, as far as the script says: each
/// block adds its `change_orbit` to a running orbit, then each instance its
/// `orbit_distance`, and each instance turns its `orbit_angle` on from the one before.
/// Approximated where the engine's code decides: the first body's angle is drawn at
/// random, a moon's angle is absolute around its planet, and a drawn class is any with
/// odds whose `min/max_distance_from_sun` holds the orbit (a moon's, its planet's orbit,
/// with classes marked `can_be_moon = no` left out), weighted by `spawn_odds` times the
/// star's factor for it.
struct Roller<'g> {
    gd: &'g GameData,
    star_class: &'g StarClass,
    rng: Rng,
}

impl<'g> Roller<'g> {
    fn bodies(
        &mut self,
        blocks: &[InitPlanet],
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
            for _ in 0..self.count(block.count) {
                orbit += self.distance(block.orbit_distance);
                angle += self.angle(block.orbit_angle);
                if block.class == STAR && star.is_none() {
                    star = Some(self.star(block, orbit, angle)?);
                    continue;
                }
                let class = self.class(&block.class, orbit, false)?;
                let size = self.size(block, class, class.planet_size)?;
                let moons = self.moons(&block.moons, orbit)?;
                planets.push(body(class, size, orbit, angle, block, moons));
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
        let key = self
            .star_class
            .planet_keys
            .first()
            .ok_or_else(|| GenerateError::NoStarBody(self.star_class.key.clone()))?;
        let class = self
            .gd
            .planet_classes
            .get(key)
            .ok_or_else(|| GenerateError::UnknownPlanetClass(key.clone()))?;
        let size = self.size(block, class, class.planet_size)?;
        Ok(body(class, size, orbit, angle, block, Vec::new()))
    }

    fn moons(
        &mut self,
        blocks: &[InitPlanet],
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
                moons.push(body(class, size, orbit, angle, block, Vec::new()));
            }
        }
        Ok(moons)
    }

    fn class(
        &mut self,
        class: &str,
        orbit: f64,
        moon: bool,
    ) -> Result<&'g PlanetClassDef, GenerateError> {
        if class != RANDOM {
            return self
                .gd
                .planet_classes
                .get(class)
                .ok_or_else(|| GenerateError::UnknownPlanetClass(class.to_owned()));
        }
        let star = self.star_class;
        let weighted: Vec<(&PlanetClassDef, f64)> = self
            .gd
            .planet_classes
            .iter()
            .filter(|c| {
                !c.star
                    && !c.asteroid
                    && c.distance_from_sun.is_some_and(|band| band.contains(orbit))
            })
            .filter(|c| match moon {
                true => c.moon_size.is_some() && c.can_be_moon,
                false => c.planet_size.is_some(),
            })
            .map(|c| (c, c.spawn_odds * star.planet_odds(&c.key)))
            .collect();
        self.rng
            .weighted(&weighted)
            .copied()
            .ok_or(GenerateError::NoPlanetClass(orbit))
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

fn body(
    class: &PlanetClassDef,
    size: u32,
    orbit: f64,
    angle: f64,
    block: &InitPlanet,
    moons: Vec<BodySpec>,
) -> BodySpec {
    BodySpec {
        class: class.key.clone(),
        size,
        orbit,
        angle: (angle.rem_euclid(360.0) * 100.0).round() / 100.0,
        entity: 0,
        deposits: block.deposits.clone(),
        moons,
    }
}

/// SplitMix64: small, fast and fixed, so a seed means the same system whatever crate
/// versions build it.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// In `[0, 1)`.
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// In `[min, max]`; `min` when the bounds cross.
    fn int(&mut self, min: i64, max: i64) -> i64 {
        if max <= min {
            return min;
        }
        let span = max.abs_diff(min) + 1;
        min + (self.next() % span) as i64
    }

    fn between(&mut self, range: Range) -> f64 {
        range.min + (range.max - range.min) * self.unit()
    }

    /// One item, each as likely as its weight; `None` when no weight is above zero.
    fn weighted<'a, T>(&mut self, items: &'a [(T, f64)]) -> Option<&'a T> {
        let total: f64 = items.iter().map(|(_, w)| w.max(0.0)).sum();
        if total <= 0.0 {
            return None;
        }
        let mut pick = self.unit() * total;
        for (item, weight) in items {
            let weight = weight.max(0.0);
            if pick < weight {
                return Some(item);
            }
            pick -= weight;
        }
        items
            .iter()
            .rev()
            .find(|(_, w)| *w > 0.0)
            .map(|(item, _)| item)
    }
}
