//! The rolls the game makes for a body of an initializer, as add-system's generator draws them
//! and a scenario's details show them: the classes a drawn class is drawn from at an orbit,
//! and whether a ring is fixed or rolled.

use crate::GameData;
use crate::initializers::{BodyClass, InitPlanet};
use crate::install::script::Range;
use crate::registries::planet_classes::PlanetClassDef;
use crate::registries::star_classes::StarClass;

/// The class a body written `random_asteroid` is drawn from: an asteroid class.
pub(crate) const RANDOM_ASTEROID: &str = "random_asteroid";

/// What the engine's random draw gives a body among, before the orbit is known: each class
/// weighted by its `spawn_odds` times the star's factor for it, and kept to the distances from
/// the star its class names (`example.txt`: a randomized class that fails at an orbit is no
/// planet).
pub(crate) struct ClassDraw<'g>(pub Vec<(&'g PlanetClassDef, f64)>);

impl<'g> ClassDraw<'g> {
    /// What a body written as `class` is drawn among around a star of `star`, a moon among
    /// the classes that can be one; `None` when its class is not one the engine draws by
    /// orbit: `random`, `random_colonizable`, `random_non_colonizable` or `random_asteroid`.
    pub(crate) fn of(
        gd: &'g GameData,
        star: &StarClass,
        class: &BodyClass,
        moon: bool,
    ) -> Option<Self> {
        let weigh = |c: &PlanetClassDef| c.spawn_odds * star.planet_odds(&c.key);
        match class {
            BodyClass::Random(colonizable) => Some(Self(
                gd.planet_classes
                    .drawable(*colonizable)
                    .filter(|c| can_be(c, moon))
                    .map(|c| (c, weigh(c)))
                    .collect(),
            )),
            BodyClass::Named(key) if drawn_by_orbit(gd, class) && key == RANDOM_ASTEROID => {
                Some(Self(
                    gd.planet_classes
                        .iter()
                        .filter(|c| c.asteroid && c.spawn_odds > 0.0)
                        .map(|c| (c, weigh(c)))
                        .collect(),
                ))
            }
            _ => None,
        }
    }

    /// Each class the draw can give, with its weight. A class of no weight is left out.
    pub(crate) fn classes(&self) -> Vec<(&'g PlanetClassDef, f64)> {
        self.0
            .iter()
            .filter(|(_, weight)| *weight > 0.0)
            .copied()
            .collect()
    }

    /// The draw at `orbit`, the body's distance from the star: the classes that fit there.
    pub(crate) fn at(&self, orbit: f64) -> Self {
        Self(
            self.0
                .iter()
                .filter(|(class, _)| fits(class, orbit))
                .copied()
                .collect(),
        )
    }
}

/// The classes a body written as the planet list `key` is drawn among, evenly as the generator
/// draws them (assumed); a moon among those that can be one, when any can. Whether the game
/// holds a list's draw to the body's orbit, as it does a random draw, is unknown. `None` when
/// the install has no such list.
pub(crate) fn list_members<'g>(
    gd: &'g GameData,
    key: &str,
    moon: bool,
) -> Option<Vec<&'g PlanetClassDef>> {
    let list = gd.planet_lists.get(key)?;
    let listed: Vec<&PlanetClassDef> = list
        .iter()
        .filter_map(|key| gd.planet_classes.get(key))
        .collect();
    let moons: Vec<&PlanetClassDef> = listed
        .iter()
        .copied()
        .filter(|c| c.moon_size.is_some() && c.can_be_moon)
        .collect();
    Some(match moon && !moons.is_empty() {
        true => moons,
        false => listed,
    })
}

/// Whether a body written as `class` has its class drawn among those that fit its orbit: a
/// random draw or a random asteroid.
pub(crate) fn drawn_by_orbit(gd: &GameData, class: &BodyClass) -> bool {
    match class {
        BodyClass::Star => false,
        BodyClass::Random(_) => true,
        BodyClass::Named(key) => key == RANDOM_ASTEROID && gd.planet_classes.get(key).is_none(),
    }
}

/// Whether a class may spawn at `orbit` from the star: within its `min/max_distance_from_sun`,
/// or anywhere when it names none.
pub(crate) fn fits(class: &PlanetClassDef, orbit: f64) -> bool {
    class
        .distance_from_sun
        .is_none_or(|band| band.contains(orbit))
}

/// Whether `class` can spawn somewhere between the bounds of `orbit`, and whether at every
/// orbit between them.
pub(crate) fn fit_within(class: &PlanetClassDef, orbit: Range) -> (bool, bool) {
    match class.distance_from_sun {
        None => (true, true),
        Some(band) => (
            band.min <= orbit.max && orbit.min <= band.max,
            band.min <= orbit.min && orbit.max <= band.max,
        ),
    }
}

/// Whether the bands of `classes` together cover every orbit between the bounds of `orbit`.
pub(crate) fn covered(classes: &[&PlanetClassDef], orbit: Range) -> bool {
    let mut bands: Vec<Range> = Vec::new();
    for class in classes {
        match class.distance_from_sun {
            None => return true,
            Some(band) => bands.push(band),
        }
    }
    bands.sort_by(|a, b| a.min.total_cmp(&b.min));
    let mut reached: Option<f64> = None;
    for band in bands.into_iter().filter(|band| band.max >= orbit.min) {
        if band.min > reached.unwrap_or(orbit.min) {
            return false;
        }
        let to = reached.map_or(band.max, |r| r.max(band.max));
        if to >= orbit.max {
            return true;
        }
        reached = Some(to);
    }
    false
}

/// Whether a random draw can give a body of `class` as a moon, or as a planet.
pub(crate) fn can_be(class: &PlanetClassDef, moon: bool) -> bool {
    match moon {
        true => class.moon_size.is_some() && class.can_be_moon,
        false => class.planet_size.is_some(),
    }
}

/// Whether a planet has a ring.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum RingRoll {
    /// `has_ring` says.
    Fixed(bool),
    /// Rolled against its class's `chance_of_ring`, 0 to 1.
    Chance(f64),
}

/// A planet's ring: its layout's `has_ring` when it says, else a roll on `class`'s
/// `chance_of_ring`.
pub(crate) fn ring_roll(has_ring: Option<bool>, class: &PlanetClassDef) -> RingRoll {
    match has_ring {
        Some(ring) => RingRoll::Fixed(ring),
        None => RingRoll::Chance(class.chance_of_ring),
    }
}

/// The name a block fixes for its body: an unconditional `set_name`, which runs once the body
/// is made and so wins, else the block's own `name`.
pub(crate) fn fixed_name(block: &InitPlanet) -> Option<&str> {
    block.stated.set_name.as_deref().or(block.name.as_deref())
}
