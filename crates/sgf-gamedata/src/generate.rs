//! A random star system rolled from the install's own rules: the initializer, star class,
//! planet classes, asteroid belts and deposits a fresh galaxy would draw, as the spec
//! [`sgf_core::ops::Op::AddSaveSystem`] writes. The same seed, star class, abundance and
//! install give the same spec.

use std::collections::HashSet;

use sgf_core::ops::{BeltSpec, BodySpec, SystemSpec, free_star_names};
use sgf_core::session::Session;

use crate::GameData;
use crate::deposit_roll::{RollBody, roll_deposits};
use crate::initializers::{DepositEffect, InitAsteroidBelt, InitPlanet, Initializer};
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
/// Separates the deposit draw from the system draw of the same seed.
const DEPOSIT_STREAM: u64 = 0x6465_706F;

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum GenerateError {
    #[error("the install has no plain {USAGE} initializer to roll a system from")]
    NoInitializer,
    #[error("no plain {USAGE} initializer of the install can make a system of star class {0}")]
    NoLayoutFor(String),
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
/// star list, with no effects, flags, countries or special bodies. Its belts and fixed
/// asteroids are kept.
pub fn plain_initializers(gd: &GameData) -> Vec<&Initializer> {
    gd.initializers.iter().filter(|i| plain(gd, i)).collect()
}

/// The star classes [`generate`] can give a system: each class a plain initializer fixes
/// or draws from its list with odds above zero, in the order the initializers and their
/// lists name them.
pub fn star_classes(gd: &GameData) -> Vec<String> {
    let mut classes: Vec<String> = Vec::new();
    for init in plain_initializers(gd) {
        let key = init.class.as_deref().unwrap_or_default();
        let listed = gd
            .star_lists
            .get(key)
            .map_or(&[][..], |list| &list.stars[..]);
        for class in std::iter::once(key).chain(listed.iter().map(String::as_str)) {
            if produces(gd, init, class) && !classes.iter().any(|held| held == class) {
                classes.push(class.to_owned());
            }
        }
    }
    classes
}

/// A system named `name` at (`x`, `y`) with no lanes, rolled from `seed`. With a
/// `star_class`, the star is that class and each initializer is drawn as often as it
/// would roll a system of that class: its odds times the class's share of its star list.
/// Every body rolls its deposits at `abundance`, the save's Resource Abundance, and then
/// runs its layout's deposit effects.
pub fn generate(
    gd: &GameData,
    seed: u64,
    name: &str,
    (x, y): (f64, f64),
    star_class: Option<&str>,
    abundance: f64,
) -> Result<SystemSpec, GenerateError> {
    if let Some(class) = star_class
        && gd.star_classes.get(class).is_none()
    {
        return Err(GenerateError::UnknownStar(class.to_owned()));
    }
    let mut rng = Rng(seed);
    let plain: Vec<(&Initializer, f64)> = plain_initializers(gd)
        .into_iter()
        .map(|i| {
            let odds = i.usage_odds.unwrap_or(0.0);
            (
                i,
                star_class.map_or(odds, |class| odds * share(gd, i, class)),
            )
        })
        .collect();
    let init = *rng.weighted(&plain).ok_or_else(|| match star_class {
        Some(class) => GenerateError::NoLayoutFor(class.to_owned()),
        None => GenerateError::NoInitializer,
    })?;
    let star_class = match star_class.and_then(|class| gd.star_classes.get(class)) {
        Some(fixed) => fixed,
        None => roll_star(gd, init.class.as_deref().unwrap_or_default(), &mut rng)?,
    };
    let mut roller = Roller {
        gd,
        star_class,
        rng,
        blocks: Vec::new(),
    };
    let (mut star, mut planets) = roller.bodies(&init.planets)?;
    Deposits {
        gd,
        abundance,
        rng: Rng(seed ^ DEPOSIT_STREAM),
    }
    .give(&mut star, &mut planets, &roller.blocks);
    Ok(SystemSpec {
        name: name.to_owned(),
        x,
        y,
        star_class: star_class.key.clone(),
        initializer: init.name.clone(),
        star,
        planets,
        belts: init.asteroid_belts.iter().filter_map(belt).collect(),
        lanes: Vec::new(),
        ..Default::default()
    })
}

/// A name for a new system in `session`'s save, drawn from `seed`: one left in the save's
/// pool of unused star names, else one of the install's star names no system of the save
/// holds. `None` when neither has one left.
pub fn pick_system_name(session: &Session, gd: &GameData, seed: u64) -> Option<String> {
    let used: HashSet<&str> = session
        .graph
        .systems
        .values()
        .map(|system| system.name.key.as_str())
        .collect();
    let mut seen = HashSet::new();
    let pooled: Vec<String> = free_star_names(&session.doc)
        .into_iter()
        .filter(|name| !used.contains(name.as_str()) && seen.insert(name.clone()))
        .collect();
    if let Some(name) = pick_name(&pooled, seed) {
        return Some(name.to_owned());
    }
    let left: Vec<String> = gd
        .star_names
        .iter()
        .filter(|name| !used.contains(name.as_str()))
        .cloned()
        .collect();
    pick_name(&left, seed).map(str::to_owned)
}

/// One of `names`, drawn from `seed`; `None` when there are none.
pub fn pick_name(names: &[String], seed: u64) -> Option<&str> {
    let last = i64::try_from(names.len()).ok()?.checked_sub(1)?;
    let index = Rng(seed ^ NAME_STREAM).int(0, last);
    names.get(usize::try_from(index).ok()?).map(String::as_str)
}

/// Whether `init` can give a system of star class `class`.
fn produces(gd: &GameData, init: &Initializer, class: &str) -> bool {
    share(gd, init, class) > 0.0
}

/// How often `init` gives a system of star class `class`: always for its fixed class,
/// else the class's odds over those of every class its list names.
fn share(gd: &GameData, init: &Initializer, class: &str) -> f64 {
    let (Some(key), Some(star)) = (init.class.as_deref(), gd.star_classes.get(class)) else {
        return 0.0;
    };
    if key == class {
        return 1.0;
    }
    let Some(list) = gd.star_lists.get(key) else {
        return 0.0;
    };
    if !list.stars.iter().any(|listed| listed == class) {
        return 0.0;
    }
    let total: f64 = list
        .stars
        .iter()
        .filter_map(|listed| gd.star_classes.get(listed))
        .map(|listed| listed.spawn_odds.max(0.0))
        .sum();
    match total > 0.0 {
        true => star.spawn_odds.max(0.0) / total,
        false => 0.0,
    }
}

fn plain(gd: &GameData, init: &Initializer) -> bool {
    let Some((star, rest)) = init.planets.split_first() else {
        return false;
    };
    init.usage.as_deref() == Some(USAGE)
        && init.usage_odds.is_some_and(|odds| odds > 0.0)
        && !init.init_effect
        && init.countries.is_empty()
        && init.asteroid_belts.iter().all(|b| belt(b).is_some())
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
            plain_body(gd, planet, true)
                && (planet.moons.is_empty() || !asteroid(gd, &planet.class))
                && planet
                    .moons
                    .iter()
                    .all(|moon| plain_body(gd, moon, false) && moon.moons.is_empty())
        })
}

/// A belt as the save writes it: its `radius` is the `inner_radius`.
fn belt(belt: &InitAsteroidBelt) -> Option<BeltSpec> {
    (!belt.kind.is_empty()).then_some(())?;
    Some(BeltSpec {
        kind: belt.kind.clone(),
        inner_radius: belt.radius?,
    })
}

fn asteroid(gd: &GameData, class: &str) -> bool {
    gd.planet_classes.get(class).is_some_and(|c| c.asteroid)
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

/// A random body, or one of a fixed class that is no star; an asteroid only when
/// `asteroids` allows it.
fn plain_body(gd: &GameData, body: &InitPlanet, asteroids: bool) -> bool {
    let class = body.class == RANDOM
        || gd
            .planet_classes
            .get(&body.class)
            .is_some_and(|class| !class.star && (asteroids || !class.asteroid));
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
    /// The block each body was rolled from, the star first and then in spec order.
    blocks: Vec<&'g InitPlanet>,
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
            for _ in 0..self.count(block.count) {
                orbit += self.distance(block.orbit_distance);
                angle += self.angle(block.orbit_angle);
                if block.class == STAR && star.is_none() {
                    star = Some(self.star(block, orbit, angle)?);
                    self.blocks.insert(0, block);
                    continue;
                }
                let class = self.class(&block.class, orbit, false)?;
                let size = self.size(block, class, class.planet_size)?;
                self.blocks.push(block);
                let moons = self.moons(&block.moons, orbit)?;
                planets.push(body(class, size, orbit, angle, moons));
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
        Ok(body(class, size, orbit, angle, Vec::new()))
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
                moons.push(body(class, size, orbit, angle, Vec::new()));
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
    moons: Vec<BodySpec>,
) -> BodySpec {
    BodySpec {
        class: class.key.clone(),
        size,
        orbit,
        angle: (angle.rem_euclid(360.0) * 100.0).round() / 100.0,
        entity: 0,
        deposits: Vec::new(),
        moons,
        asteroid: class.asteroid,
        ..Default::default()
    }
}

/// Rolls each body's deposits from a stream of its own, so the bodies a seed gives stay
/// the same whatever the abundance, then runs the deposit effects of its block.
struct Deposits<'g> {
    gd: &'g GameData,
    abundance: f64,
    rng: Rng,
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
        let rng = &mut self.rng;
        body.deposits = roll_deposits(self.gd, &rolled, self.abundance, &mut || rng.unit());
        if let Some(block) = block {
            DepositEffect::apply_all(&block.deposit_effects, &mut body.deposits);
        }
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
