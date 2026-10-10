//! What the game can roll for each body of a scenario system beside what its initializer
//! states: the classes a drawn class can be at the body's orbit, whether it spawns at all, its
//! ring, the deposits and planet features its own roll can give it, its name and the system's
//! inner radius. The draws are add-system's ([`crate::rolls`], [`crate::deposit_roll`]).

use std::collections::HashMap;
use std::convert::Infallible;

use sgf_core::emit::roman;
use sgf_core::format::save::details::{
    BodyRole, Bounds, ClassPool, DepositStep, OrbitFit, PlanetSummary, PoolClass, PoolEntry,
    SpawnClass, SpawnName, SpawnPool, SpawnRing,
};

use crate::GameData;
use crate::deposit_roll::{self, Kind, RollBody};
use crate::feature_roll;
use crate::initializers::{Body, BodyClass, InitPlanet, Initializer, body_size};
use crate::install::script::{Range, whole};
use crate::layouts::{StarSource, star_body, star_source};
use crate::orbit_walk::{self, Placed, Walk};
use crate::registries::planet_classes::PlanetClassDef;
use crate::registries::star_classes::StarClass;
use crate::rolls::{
    ClassDraw, RANDOM_ASTEROID, covered, drawn_by_orbit, fit_within, fixed_name, list_members,
};

const PLANET_NAME: &str = "PLANET_NAME_FORMAT";
const SATELLITE_NAME: &str = "SUBPLANET_NAME_FORMAT";
/// `satellite_naming_policy` values, and how each numbers the bodies around its body.
const ROMAN_POLICY: &str = "upper_case_roman_numerals";
const LETTER_POLICY: &str = "lower_case_latin_letters";

/// The rolls of one initializer's bodies, with what is shared between them.
pub(crate) struct Rolls<'g> {
    gd: &'g GameData,
    /// The star classes the system can be; `None` when its class is not one the install
    /// defines.
    stars: Option<Vec<&'g StarClass>>,
    deposits: HashMap<DrawKey, Vec<DrawnDeposit>>,
    features: HashMap<DrawKey, Vec<(String, Option<f64>)>>,
}

/// A body as the first draw of a roll sees it: its class, size and kind, and whether it may
/// draw blockers.
type DrawKey = (String, u32, KindKey, bool);
/// A deposit a draw can give, with its category and weight.
type DrawnDeposit = (String, Option<String>, f64);
/// A [`Kind`] as a cache key.
type KindKey = u8;

fn kind_key(kind: Kind) -> KindKey {
    match kind {
        Kind::Star => 0,
        Kind::Planet => 1,
        Kind::Moon => 2,
    }
}

/// Whether a drawn class fits around one star, or around every star the system can draw.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Fit {
    Never,
    Unknown,
    Sometimes,
    Always,
}

impl Fit {
    fn shown(self) -> OrbitFit {
        match self {
            Self::Never => OrbitFit::Never,
            Self::Unknown => OrbitFit::Unknown,
            Self::Sometimes => OrbitFit::Sometimes,
            Self::Always => OrbitFit::Always,
        }
    }

    /// The fit of a body whose own fit is `self` around a body whose fit is `other`: the
    /// less certain of the two, never spawning first.
    fn and(self, other: Self) -> Self {
        let rank = |fit: Self| match fit {
            Self::Never => 0,
            Self::Unknown => 1,
            Self::Sometimes => 2,
            Self::Always => 3,
        };
        match rank(self) <= rank(other) {
            true => self,
            false => other,
        }
    }
}

/// What a drawn body's class can be at its orbit.
struct Drawn<'g> {
    fit: Fit,
    /// Each class it can be somewhere in its orbit's range, with its weight when that is the
    /// same around every star.
    classes: Vec<(&'g PlanetClassDef, Option<f64>)>,
    /// Every class fits at every orbit of the range around every star alike, so the chances
    /// over `classes` hold wherever it lands.
    settled: bool,
}

impl<'g> Rolls<'g> {
    pub(crate) fn new(gd: &'g GameData, init: &Initializer) -> Self {
        let stars = match star_source(gd, init) {
            StarSource::Fixed(class) => Some(vec![class]),
            StarSource::List(list) => Some(
                list.stars
                    .iter()
                    .filter_map(|key| gd.star_classes.get(key))
                    .collect(),
            ),
            StarSource::Unknown => None,
        }
        .filter(|stars: &Vec<&StarClass>| !stars.is_empty());
        Self {
            gd,
            stars,
            deposits: HashMap::new(),
            features: HashMap::new(),
        }
    }

    /// Fills each of `planets`' spawn with what the game can roll for it, `bodies` the bodies
    /// they were expanded from, in the same order.
    pub(crate) fn fill(&mut self, bodies: &[Body<'_>], planets: &mut [PlanetSummary]) {
        let draw_orbits = draw_orbits(bodies, planets);
        let mut fits: Vec<Option<Fit>> = Vec::with_capacity(planets.len());
        for (i, body) in bodies.iter().enumerate() {
            let moon = planets[i].role == BodyRole::Moon;
            let drawn = self.drawn(body.block, draw_orbits[i], moon);
            let own = drawn.as_ref().map(|d| d.fit);
            let parent = body.parent.and_then(|p| fits[p]);
            let fit = match (own, parent) {
                (Some(own), Some(parent)) => Some(own.and(parent)),
                (own, parent) => own.or(parent),
            };
            fits.push(fit);
            let class = planets[i].class.clone();
            let Some(spawn) = planets[i].spawn.as_mut() else {
                continue;
            };
            spawn.orbit_fit = fit.map(Fit::shown);
            if let SpawnClass::Rolled { pool } = &mut spawn.class {
                let at_orbit = drawn.as_ref().filter(|d| d.fit != Fit::Unknown).map(|d| {
                    d.classes
                        .iter()
                        .map(|(class, weight)| PoolClass {
                            class: class.key.clone(),
                            weight: *weight,
                        })
                        .collect()
                });
                if let ClassPool::Random { at_orbit: slot, .. } = pool {
                    *slot = at_orbit;
                }
            }
            let classes = self.classes(&spawn.class, &class, drawn.as_ref(), moon);
            let never = fit == Some(Fit::Never);
            spawn.ring = Some(ring(
                body.block,
                moon,
                &spawn.class,
                &classes,
                drawn.as_ref(),
            ));
            let kind = self.kind(&classes, moon);
            spawn.rolled_deposits = Some(match never {
                true => SpawnPool::Fixed,
                false => self.deposit_pool(body.block, &spawn.deposits, &classes, kind),
            });
            spawn.rolled_features = Some(match never {
                true => SpawnPool::Fixed,
                false => self.feature_pool(body.block, &classes, kind),
            });
        }
        self.name(bodies, planets, &fits);
    }

    /// What a drawn body of `block` can be at `orbit` from the star, a moon among the classes
    /// that can be one; `None` when its class is not drawn by orbit.
    fn drawn(&self, block: &InitPlanet, orbit: Range, moon: bool) -> Option<Drawn<'g>> {
        let gd = self.gd;
        if !drawn_by_orbit(gd, &block.class) {
            return None;
        }
        let Some(stars) = &self.stars else {
            return Some(Drawn {
                fit: Fit::Unknown,
                classes: Vec::new(),
                settled: false,
            });
        };
        let mut fit: Option<Fit> = None;
        let mut classes: Vec<(&'g PlanetClassDef, Option<f64>)> = Vec::new();
        let mut seen: Vec<Vec<(&str, Option<f64>)>> = Vec::new();
        let mut settled = true;
        for star in stars {
            let draw = ClassDraw::of(gd, star, &block.class, moon)?;
            let mut somewhere: Vec<&'g PlanetClassDef> = Vec::new();
            let mut here: Vec<(&str, Option<f64>)> = Vec::new();
            for (class, weight) in draw.classes() {
                let (some, every) = fit_within(class, orbit);
                if !some {
                    continue;
                }
                settled &= every;
                somewhere.push(class);
                let weight = Some(weight);
                here.push((class.key.as_str(), weight));
                match classes.iter_mut().find(|(held, _)| held.key == class.key) {
                    Some((_, held)) if *held != weight => *held = None,
                    Some(_) => {}
                    None => classes.push((class, weight)),
                }
            }
            let this = match (somewhere.is_empty(), covered(&somewhere, orbit)) {
                (true, _) => Fit::Never,
                (false, true) => Fit::Always,
                (false, false) => Fit::Sometimes,
            };
            fit = Some(match fit {
                None => this,
                Some(Fit::Never) if this == Fit::Never => Fit::Never,
                Some(Fit::Always) if this == Fit::Always => Fit::Always,
                Some(_) => Fit::Sometimes,
            });
            seen.push(here);
        }
        if seen.windows(2).any(|pair| pair[0] != pair[1]) {
            settled = false;
            for (class, weight) in &mut classes {
                let everywhere = seen
                    .iter()
                    .all(|here| here.iter().any(|(k, _)| *k == class.key));
                if !everywhere {
                    *weight = None;
                }
            }
        }
        Some(Drawn {
            fit: fit?,
            classes,
            settled,
        })
    }

    /// The classes a body can spawn as, each with its weight when its class is drawn.
    fn classes(
        &self,
        spawn: &SpawnClass,
        resolved: &str,
        drawn: Option<&Drawn<'g>>,
        moon: bool,
    ) -> Option<Vec<(&'g PlanetClassDef, Option<f64>)>> {
        let gd = self.gd;
        match spawn {
            SpawnClass::Fixed { .. } => Some(
                gd.planet_classes
                    .get(resolved)
                    .into_iter()
                    .map(|c| (c, None))
                    .collect(),
            ),
            SpawnClass::Rolled {
                pool: ClassPool::StarList { list },
            } => {
                let list = gd.star_lists.get(list)?;
                let mut out: Vec<(&'g PlanetClassDef, Option<f64>)> = Vec::new();
                for star in list.stars.iter().filter_map(|key| gd.star_classes.get(key)) {
                    for key in star.planet_keys() {
                        if let Some(class) = gd.planet_classes.get(key)
                            && !out.iter().any(|(held, _)| held.key == class.key)
                        {
                            out.push((class, None));
                        }
                    }
                }
                Some(out)
            }
            SpawnClass::Rolled {
                pool: ClassPool::PlanetList { list, .. },
            } => Some(
                list_members(gd, list, moon)?
                    .into_iter()
                    .map(|c| (c, None))
                    .collect(),
            ),
            SpawnClass::Rolled {
                pool: ClassPool::Random { .. },
            } => drawn
                .filter(|d| d.fit != Fit::Unknown)
                .map(|d| d.classes.clone()),
            SpawnClass::Unknown { .. } => None,
        }
    }

    /// What a body of `classes` is to the deposit roll.
    fn kind(&self, classes: &Option<Vec<(&PlanetClassDef, Option<f64>)>>, moon: bool) -> Kind {
        let star = classes
            .as_ref()
            .is_some_and(|c| !c.is_empty() && c.iter().all(|(class, _)| class.star));
        match (star, moon) {
            (true, _) => Kind::Star,
            (false, true) => Kind::Moon,
            (false, false) => Kind::Planet,
        }
    }

    /// The deposits a body's own roll can give it once its `init_effect`'s `steps` have run on
    /// what it rolled.
    fn deposit_pool(
        &mut self,
        block: &InitPlanet,
        steps: &[DepositStep],
        classes: &Option<Vec<(&'g PlanetClassDef, Option<f64>)>>,
        kind: Kind,
    ) -> SpawnPool {
        if steps
            .iter()
            .any(|step| matches!(step, DepositStep::Clear { category: None }))
        {
            return SpawnPool::Fixed;
        }
        let Some(classes) = classes else {
            return SpawnPool::Unknown;
        };
        let blockers = !block.stated.no_blockers && !steps.contains(&DepositStep::ClearBlockers);
        let cleared: Vec<&str> = steps
            .iter()
            .filter_map(|step| match step {
                DepositStep::Clear {
                    category: Some(category),
                } => Some(category.as_str()),
                _ => None,
            })
            .collect();
        let mut draws: Vec<Vec<(String, f64)>> = Vec::new();
        for (class, size) in self.combinations(block, classes, kind) {
            let drawn = self.first_deposits(class, size, kind, blockers);
            draws.push(
                drawn
                    .iter()
                    .filter(|(_, category, _)| {
                        category
                            .as_deref()
                            .is_none_or(|category| !cleared.contains(&category))
                    })
                    .map(|(key, _, weight)| (key.clone(), *weight))
                    .collect(),
            );
        }
        SpawnPool::Rolled {
            entries: entries(&draws, |weights| {
                let total: f64 = weights.iter().map(|(_, w)| w).sum();
                weights
                    .iter()
                    .map(|(key, w)| (key.clone(), (total > 0.0).then(|| w / total)))
                    .collect()
            }),
        }
    }

    /// The planet features a body's own roll can give it. `modifiers = none` blocks the roll,
    /// and an unconditional `clear_planet_modifiers` takes away what it rolled. A block's
    /// `modifier = pm_…` is assumed to be given beside the roll, not in place of it.
    fn feature_pool(
        &mut self,
        block: &InitPlanet,
        classes: &Option<Vec<(&'g PlanetClassDef, Option<f64>)>>,
        kind: Kind,
    ) -> SpawnPool {
        let stated = &block.stated;
        if stated.no_modifiers || stated.clears_modifiers {
            return SpawnPool::Fixed;
        }
        let Some(classes) = classes else {
            return SpawnPool::Unknown;
        };
        let mut draws: Vec<Vec<(String, Option<f64>)>> = Vec::new();
        for (class, size) in self.combinations(block, classes, kind) {
            draws.push(self.first_features(class, size, kind));
        }
        SpawnPool::Rolled {
            entries: entries(&draws, |chances| chances.to_vec()),
        }
    }

    /// Each class a body can be with the fewest and the most tiles it can have as that class.
    fn combinations(
        &self,
        block: &InitPlanet,
        classes: &[(&'g PlanetClassDef, Option<f64>)],
        kind: Kind,
    ) -> Vec<(&'g PlanetClassDef, u32)> {
        let mut out = Vec::new();
        for (class, _) in classes {
            let range = body_size(Some(block), Some(class), kind == Kind::Moon)
                .unwrap_or(Range::fixed(0.0));
            out.push((*class, whole(range.min)));
            if range.max != range.min {
                out.push((*class, whole(range.max)));
            }
        }
        out
    }

    fn first_deposits(
        &mut self,
        class: &PlanetClassDef,
        size: u32,
        kind: Kind,
        blockers: bool,
    ) -> &Vec<DrawnDeposit> {
        let gd = self.gd;
        self.deposits
            .entry((class.key.clone(), size, kind_key(kind), blockers))
            .or_insert_with(|| {
                let body = RollBody {
                    class: &class.key,
                    size,
                    kind,
                };
                deposit_roll::first_draw(gd, &body, blockers)
                    .into_iter()
                    .map(|(d, weight)| (d.key.clone(), d.category.clone(), weight))
                    .collect()
            })
    }

    fn first_features(
        &mut self,
        class: &PlanetClassDef,
        size: u32,
        kind: Kind,
    ) -> Vec<(String, Option<f64>)> {
        let gd = self.gd;
        self.features
            .entry((class.key.clone(), size, kind_key(kind), true))
            .or_insert_with(|| {
                let body = RollBody {
                    class: &class.key,
                    size,
                    kind,
                };
                feature_roll::first_draw(gd, &body)
                    .into_iter()
                    .map(|(pm, chance)| (pm.key.clone(), chance))
                    .collect()
            })
            .clone()
    }

    /// Names each of `planets` as the game does, `fits` whether each spawns. The 4.5 sample
    /// save numbers a system's planets in roman numerals after the system, and a body's
    /// satellites after it: a companion star's in roman numerals, a planet's or moon's in
    /// letters. Assumed beyond that:
    /// - a block's own `name` takes no numeral and uses none up, while a body `set_name`
    ///   renames still uses one;
    /// - a star's satellites are numbered in roman numerals unless its
    ///   `satellite_naming_policy` says otherwise, as every one in the sample save is;
    /// - a body the game may not spawn makes the numerals after it a range.
    fn name(&self, bodies: &[Body<'_>], planets: &mut [PlanetSummary], fits: &[Option<Fit>]) {
        let gd = self.gd;
        let star = |i: usize| {
            star_body(gd, &bodies[i].block.class)
                || gd
                    .planet_classes
                    .get(&planets[i].class)
                    .is_some_and(|c| c.star)
        };
        let stars: Vec<usize> = (0..bodies.len()).filter(|&i| star(i)).collect();
        let mut counters: HashMap<Option<usize>, (u32, u32)> = HashMap::new();
        let ids: Vec<u32> = planets.iter().map(|p| p.id).collect();
        for (i, body) in bodies.iter().enumerate() {
            let fit = fits[i];
            let block = body.block;
            let Some(spawn) = planets[i].spawn.as_mut() else {
                continue;
            };
            if fit == Some(Fit::Never) {
                spawn.naming = None;
                continue;
            }
            let fixed = fixed_name(block).map(|name| SpawnName::Fixed {
                name: name.to_owned(),
            });
            if let Some(nth) = stars.iter().position(|&s| s == i) {
                let format = format!("STAR_NAME_{}_OF_{}", nth + 1, stars.len());
                spawn.naming = Some(fixed.unwrap_or(SpawnName::Template {
                    format,
                    parent: None,
                    numerals: Vec::new(),
                }));
                continue;
            }
            if block.name.is_some() {
                spawn.naming = fixed;
                continue;
            }
            let asteroid = self.asteroid(&spawn.class, &planets[i].class);
            if asteroid == Some(true) {
                spawn.naming = Some(fixed.unwrap_or(SpawnName::Unknown));
                continue;
            }
            let certain =
                spawn.always && fit.is_none_or(|f| f == Fit::Always) && asteroid == Some(false);
            let counter = counters.entry(body.parent).or_insert((0, 0));
            let (low, high) = *counter;
            *counter = (low + u32::from(certain), high + 1);
            let numbered = match body.parent {
                None => Some((PLANET_NAME, true)),
                Some(p) => {
                    let policy = bodies[p].block.stated.satellite_naming.as_deref();
                    match (policy, stars.contains(&p)) {
                        (Some(ROMAN_POLICY), _) | (None, true) => Some((SATELLITE_NAME, true)),
                        (Some(LETTER_POLICY), _) | (None, false) => Some((SATELLITE_NAME, false)),
                        (Some(_), _) => None,
                    }
                }
            };
            spawn.naming = Some(match (fixed, numbered) {
                (Some(fixed), _) => fixed,
                (None, None) => SpawnName::Unknown,
                (None, Some((format, roman_numerals))) => SpawnName::Template {
                    format: format.to_owned(),
                    parent: body.parent.map(|p| ids[p]),
                    numerals: (low + 1..=high + 1)
                        .map(|n| numeral(n, roman_numerals))
                        .collect(),
                },
            });
        }
    }

    /// Whether a body of `class` is an asteroid, named from the asteroid lists and given no
    /// numeral; `None` when it may or may not be.
    fn asteroid(&self, class: &SpawnClass, resolved: &str) -> Option<bool> {
        let gd = self.gd;
        let asteroid = |key: &str| gd.planet_classes.get(key).is_some_and(|c| c.asteroid);
        match class {
            SpawnClass::Fixed { .. } => Some(asteroid(resolved)),
            SpawnClass::Rolled {
                pool: ClassPool::Random { at_orbit, .. },
            } => {
                let classes: Vec<&str> = at_orbit
                    .as_ref()?
                    .iter()
                    .map(|c| c.class.as_str())
                    .collect();
                let asteroids = classes.iter().filter(|c| asteroid(c)).count();
                match asteroids {
                    0 => Some(false),
                    n if n == classes.len() => Some(true),
                    _ => None,
                }
            }
            SpawnClass::Rolled {
                pool: ClassPool::PlanetList { members, .. },
            } => {
                let asteroids = members.iter().filter(|m| asteroid(&m.key)).count();
                match asteroids {
                    0 => Some(false),
                    n if n == members.len() => Some(true),
                    _ => None,
                }
            }
            SpawnClass::Rolled {
                pool: ClassPool::StarList { .. },
            } => Some(false),
            SpawnClass::Unknown { .. } => Some(false),
        }
    }

    /// The bounds of the system's `inner_radius`, from the bodies of `init` the game places:
    /// at fewest, those certain to spawn walked with every count, distance and `change_orbit`
    /// at its fewest; at most, every body that can spawn walked at its most. A body counts as
    /// far as its orbit and those of the bodies it orbits reach.
    pub(crate) fn inner_radius(&self, init: &Initializer) -> Option<Bounds> {
        if init.inline_script {
            return None;
        }
        let reach = |low: bool| {
            let mut walker = Reach {
                rolls: self,
                low,
                offset: 0.0,
                draw_orbit: None,
                moon: false,
                reach: 0.0,
            };
            let Ok(()) = orbit_walk::walk(&init.planets, &mut walker);
            walker.reach
        };
        let radii = self.gd.system_radii;
        let (low, high) = (
            radii.inner_about(reach(true)),
            radii.inner_about(reach(false)),
        );
        Some(Bounds {
            min: low.min(high),
            max: low.max(high),
        })
    }

    /// Whether a body of `block` spawns at `orbit` from the star: around every star the system
    /// can draw when `certain`, else around some.
    fn spawns_at(&self, block: &InitPlanet, orbit: f64, moon: bool, certain: bool) -> bool {
        let gd = self.gd;
        if let BodyClass::Named(key) = &block.class
            && gd.planet_classes.get(key).is_none()
            && gd.planet_lists.get(key).is_none()
            && key != RANDOM_ASTEROID
            && gd.star_classes.get(key).is_none()
        {
            return !certain;
        }
        if !drawn_by_orbit(gd, &block.class) {
            return true;
        }
        let Some(stars) = &self.stars else {
            return !certain;
        };
        let fits = |star: &&StarClass| match ClassDraw::of(gd, star, &block.class, moon) {
            None => true,
            Some(draw) => !draw.at(orbit).classes().is_empty(),
        };
        match certain {
            true => stars.iter().all(fits),
            false => stars.iter().any(fits),
        }
    }
}

/// The orbit from the star at which each body's class is drawn: its own for a body about the
/// centre, else that of the outermost body it is around, as the generator draws a moon's.
fn draw_orbits(bodies: &[Body<'_>], planets: &[PlanetSummary]) -> Vec<Range> {
    let mut out: Vec<Range> = Vec::with_capacity(bodies.len());
    for (i, body) in bodies.iter().enumerate() {
        let orbit =
            match body.parent {
                Some(parent) => out[parent],
                None => planets[i].layout.as_ref().and_then(|l| l.orbit).map_or(
                    Range::fixed(0.0),
                    |b| Range {
                        min: b.min,
                        max: b.max,
                    },
                ),
            };
        out.push(orbit);
    }
    out
}

/// A body's ring, as the generator rolls it.
fn ring(
    block: &InitPlanet,
    moon: bool,
    spawn: &SpawnClass,
    classes: &Option<Vec<(&PlanetClassDef, Option<f64>)>>,
    drawn: Option<&Drawn<'_>>,
) -> SpawnRing {
    if moon || block.class == BodyClass::Star {
        return SpawnRing::Fixed { ring: false };
    }
    if block.stated.unread_ring {
        return SpawnRing::Unknown;
    }
    if let Some(ring) = block.has_ring {
        return SpawnRing::Fixed { ring };
    }
    let Some(classes) = classes else {
        return SpawnRing::Unknown;
    };
    if classes.iter().all(|(class, _)| class.chance_of_ring <= 0.0) {
        return SpawnRing::Fixed { ring: false };
    }
    let weighed = |classes: &[(&PlanetClassDef, Option<f64>)]| {
        let weights: Option<Vec<f64>> = classes.iter().map(|(_, w)| *w).collect();
        let weights = weights?;
        let total: f64 = weights.iter().sum();
        (total > 0.0).then(|| {
            classes
                .iter()
                .zip(&weights)
                .map(|((class, _), w)| class.chance_of_ring * w)
                .sum::<f64>()
                / total
        })
    };
    let chance = match spawn {
        SpawnClass::Rolled {
            pool: ClassPool::Random { .. },
        } => drawn
            .filter(|d| d.settled)
            .and_then(|d| weighed(&d.classes)),
        SpawnClass::Rolled {
            pool: ClassPool::PlanetList { .. },
        } => {
            let even: Vec<(&PlanetClassDef, Option<f64>)> = classes
                .iter()
                .map(|(class, _)| (*class, Some(1.0)))
                .collect();
            weighed(&even)
        }
        _ => classes.first().map(|(class, _)| class.chance_of_ring),
    };
    SpawnRing::Rolled { chance }
}

/// Each key of `draws` in first-seen order, with the chance `chances` gives it when every draw
/// gives the same pool, else none.
fn entries<T: Clone + PartialEq>(
    draws: &[Vec<(String, T)>],
    chances: impl Fn(&[(String, T)]) -> Vec<(String, Option<f64>)>,
) -> Vec<PoolEntry> {
    let alike = draws.windows(2).all(|pair| pair[0] == pair[1]);
    let mut out: Vec<PoolEntry> = Vec::new();
    match (alike, draws.first()) {
        (true, Some(only)) => {
            for (key, chance) in chances(only) {
                out.push(PoolEntry { key, chance });
            }
        }
        _ => {
            for (key, _) in draws.iter().flatten() {
                if !out.iter().any(|e| e.key == *key) {
                    out.push(PoolEntry {
                        key: key.clone(),
                        chance: None,
                    });
                }
            }
        }
    }
    out
}

/// The `n`th numeral, from 1: `II` or `b`.
fn numeral(n: u32, roman_numerals: bool) -> String {
    let n = usize::try_from(n).unwrap_or(usize::MAX);
    match roman_numerals {
        true => roman(n),
        false => letter(n.saturating_sub(1)),
    }
}

/// `a`, `b`, … `z`, `aa`, `ab`, … from 0.
fn letter(index: usize) -> String {
    let this = char::from(b'a' + (index % 26) as u8);
    match index / 26 {
        0 => this.to_string(),
        n => format!("{}{this}", letter(n - 1)),
    }
}

/// The walk that finds how far the bodies of a system reach, at their fewest or their most.
struct Reach<'r, 'g> {
    rolls: &'r Rolls<'g>,
    /// Every count, distance and `change_orbit` at its fewest, and only the bodies certain to
    /// spawn; else every one at its most, and every body that can.
    low: bool,
    /// The orbit about the centre of the body the walk is around.
    offset: f64,
    /// The orbit from the star its bodies' classes are drawn at; `None` about the centre.
    draw_orbit: Option<f64>,
    moon: bool,
    reach: f64,
}

impl<'p> Walk<'p> for Reach<'_, '_> {
    type Number = f64;
    type Error = Infallible;

    fn count(&mut self, block: &'p InitPlanet) -> u32 {
        let copies = block.copies();
        match self.low {
            true => copies.min,
            false => copies.max,
        }
    }

    fn distance(&mut self, distance: Range) -> f64 {
        match self.low {
            true => distance.min,
            false => distance.max,
        }
    }

    fn angle(&mut self, _: Range) -> f64 {
        0.0
    }

    fn body(&mut self, block: &'p InitPlanet, placed: Placed<f64>) -> Result<(), Infallible> {
        let at = self.draw_orbit.unwrap_or(placed.orbit);
        if !self.rolls.spawns_at(block, at, self.moon, self.low) {
            return Ok(());
        }
        let reached = self.offset + placed.orbit;
        self.reach = self.reach.max(reached);
        let before = (self.offset, self.draw_orbit, self.moon);
        self.offset = reached;
        self.draw_orbit = Some(at);
        self.moon = !star_body(self.rolls.gd, &block.class)
            && !block
                .class
                .named()
                .is_some_and(|key| self.rolls.gd.star_classes.get(key).is_some());
        orbit_walk::walk(&block.moons, self)?;
        (self.offset, self.draw_orbit, self.moon) = before;
        Ok(())
    }
}
