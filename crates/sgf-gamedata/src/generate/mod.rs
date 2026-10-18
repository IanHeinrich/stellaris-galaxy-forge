//! A random star system rolled from the install's own rules: the initializer, star class,
//! planet classes, rings, asteroid belts and deposits a fresh galaxy would draw, as the
//! spec [`sgf_core::ops::Op::AddSystemFromSpec`] writes. The same seed, star class or layout,
//! abundance and install give the same spec.

use sgf_core::ops::{
    BeltSpec, BodyKind, BodySpec, PrimaryName, SpecAnomaly, SpecBody, SpecDigSite, SpecEventTarget,
    SpecStar, SpecTarget, SystemAdd, SystemExtras, SystemSpec,
};

use crate::GameData;
use crate::body_effects::{self, Planted};
use crate::deposit_roll::{self, Kind, RollBody};
use crate::initializers::{BodyClass, InitAsteroidBelt, InitPlanet, Initializer, body_size};
use crate::install::script::Range;
use crate::layouts::{
    Dlc, Eligibility, SaveFacts, StarSource, USAGE, Unsupported, converted, eligibility, generic,
    layout_stars, odds, plain_initializers, special_initializers, star_blocks, star_body,
    star_source, unplaced,
};
use crate::multi_star::{Filed, file_star_class, own_class};
use crate::orbit_walk::{self, Placed, Walk, draw};
use crate::registries::planet_classes::PlanetClassDef;
use crate::registries::star_classes::StarClass;
use crate::rng::Rng;
use crate::rolls::{ClassDraw, RingRoll, can_be, fixed_name, list_members, ring_roll};

mod cluster;
mod megastructure;
mod save;

pub use cluster::{ClusterMember, ClusterRoll, RolledCluster, cluster_op, roll_cluster};
pub use megastructure::{
    AddSpot, HostMoons, HostMoonsFit, MegastructureFit, Planned, Refusal, habitat_op,
    megastructure_fits, megastructure_op, ring_world_op,
};
pub(crate) use megastructure::{SpawnedAt, layout_structures, spawned_row};
pub use save::{
    BodyAsk, BuiltSystem, ClassRulesError, ForSaveError, Pick, PickAt, StarCount, SystemAsk,
    SystemPick, added_among, body_for_save, for_save, for_save_many, joined_op, pick_op, reroll,
    settle_name, special_op, systems_op,
};

/// Separates the deposit draw from the system draw of the same seed.
const DEPOSIT_STREAM: u64 = 0x6465_706F;
/// Separates the ring draw from the system draw of the same seed.
const RING_STREAM: u64 = 0x7269_6E67;
/// Separates the draw of a ranged belt radius from the system draw of the same seed.
const BELT_STREAM: u64 = 0x6265_6C74;
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
    #[error("{0} is not a plain layout the builder arranges stars in")]
    NotPlain(String),
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
    #[error("no star was chosen")]
    NoStars,
    #[error("{0} is not a star")]
    NotAStar(String),
    #[error("the install has no star class of {} to file them under", star_count(*.0))]
    NoClassFor(usize),
    #[error("{0} is no star class a system can be filed under")]
    NotFileable(String),
    #[error("{layout} places {}, not {stars}", star_count(*blocks))]
    StarCount {
        layout: String,
        blocks: usize,
        stars: usize,
    },
    #[error("no plain {USAGE} initializer of the install places {}", star_count(*.0))]
    NoArrangement(usize),
}

/// `1 star`, `3 stars`.
fn star_count(n: usize) -> String {
    match n {
        1 => "1 star".to_owned(),
        n => format!("{n} stars"),
    }
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

/// How often [`generate`] gives `class`: first as each layout that makes it is drawn for a
/// pick of that class, then as a pick of no class rolls it, which only the plain layouts
/// make. Both are weights, comparable among classes and not shares.
pub fn star_class_odds(gd: &GameData, class: &str) -> (f64, f64) {
    let odds = layouts_for(gd, Some(class))
        .iter()
        .map(|(_, weight)| weight)
        .sum();
    let random_odds = layouts_for(gd, None)
        .iter()
        .map(|(init, weight)| weight * share(gd, init, class))
        .sum();
    (odds, random_odds)
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
    let missing = || match star_class {
        Some(class) => GenerateError::NoLayoutFor(class.to_owned()),
        None => GenerateError::NoInitializer,
    };
    let draw = Draw {
        seed,
        star_class,
        stars: None,
        stars_only: false,
        abundance,
        save: None,
    };
    draw_among(gd, layouts_for(gd, star_class), &draw, name, at, missing).map(|add| add.spec)
}

/// A system of `stars` stars named `name` at `at`, rolled from `seed` as [`generate`] rolls one
/// of no class, drawn among the plain layouts that place that many stars at their odds, its
/// class drawn from the layout's list.
pub fn generate_stars(
    gd: &GameData,
    seed: u64,
    name: &str,
    at: (f64, f64),
    stars: usize,
    abundance: f64,
) -> Result<SystemAdd, GenerateError> {
    let layouts = layouts_for(gd, None)
        .into_iter()
        .filter(|(init, _)| star_blocks(init) == stars)
        .collect();
    let draw = Draw {
        seed,
        star_class: None,
        stars: None,
        stars_only: false,
        abundance,
        save: None,
    };
    draw_among(gd, layouts, &draw, name, at, || {
        GenerateError::NoArrangement(stars)
    })
}

/// A system built from one of `layouts`, drawn by weight from `draw`'s seed; `missing` when
/// there is none to draw.
fn draw_among(
    gd: &GameData,
    layouts: Vec<(&Initializer, f64)>,
    draw: &Draw<'_>,
    name: &str,
    at: (f64, f64),
    missing: impl FnOnce() -> GenerateError,
) -> Result<SystemAdd, GenerateError> {
    let mut rng = Rng::new(draw.seed);
    let Some(&init) = rng.weighted(&layouts) else {
        return Err(missing());
    };
    build(gd, init, rng, draw, name, at)
}

/// A system the builder makes: the plain layout `built.layout` with the planet classes
/// `built.stars` in its `class = star` blocks, in order, named `name` at `at` and rolled from
/// `seed` as [`generate`] rolls a layout. Its star class is `built.star_class` when given,
/// else the one [`file_star_class`] files the stars under. Without `built.planets` it holds its
/// stars alone; with them, each star keeps as many of its planets as its own class's range draws
/// and draws their classes at that class's odds. Each star rolls its deposits as its
/// own class. Refused for a layout that is not plain, a count of stars other than its star blocks, and as [`file_star_class`] refuses.
pub fn generate_built(
    gd: &GameData,
    seed: u64,
    name: &str,
    at: (f64, f64),
    built: &BuiltSystem,
    abundance: f64,
) -> Result<(SystemAdd, Filed), GenerateError> {
    let init = gd
        .initializers
        .get(&built.layout)
        .ok_or_else(|| GenerateError::UnknownLayout(built.layout.clone()))?;
    if eligibility(gd, init) != Eligibility::Plain {
        return Err(GenerateError::NotPlain(built.layout.clone()));
    }
    let blocks = star_blocks(init);
    if blocks != built.stars.len() {
        return Err(GenerateError::StarCount {
            layout: built.layout.clone(),
            blocks,
            stars: built.stars.len(),
        });
    }
    let filed = file_star_class(gd, &built.stars, built.star_class.as_deref())?;
    let draw = Draw {
        seed,
        star_class: Some(&filed.class),
        stars: Some(&built.stars),
        stars_only: !built.planets,
        abundance,
        save: None,
    };
    let add = build(gd, init, Rng::new(seed), &draw, name, at)?;
    Ok((add, filed))
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
    layout_system_for(gd, save, seed, name, at, layout, abundance).map(|add| add.spec)
}

/// [`generate_layout_for`]'s system with what the layout's script plants beside its
/// bodies: the anomalies and dig sites its bodies' effects make and the global event targets
/// they and the system's own `init_effect` save.
pub fn layout_system_for(
    gd: &GameData,
    save: &SaveFacts,
    seed: u64,
    name: &str,
    at: (f64, f64),
    layout: &str,
    abundance: f64,
) -> Result<SystemAdd, GenerateError> {
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
        stars: None,
        stars_only: false,
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
        .filter(|init| generic(init) && !unplaced(gd, init))
        .collect()
}

/// What a system is rolled from beside its layout: the seed, the star class asked for, the
/// planet classes of its `class = star` blocks when they are chosen, the save's Resource
/// Abundance, and the save whose DLC answers the bodies' `if`s.
struct Draw<'a> {
    seed: u64,
    star_class: Option<&'a str>,
    stars: Option<&'a [String]>,
    /// Only the star bodies are placed: no planets, moons or belts.
    stars_only: bool,
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
) -> Result<SystemAdd, GenerateError> {
    let seed = draw.seed;
    let star_class = match draw.star_class.and_then(|class| gd.star_classes.get(class)) {
        Some(fixed) => fixed,
        None => roll_star(gd, init, &mut rng)?,
    };
    let mut roller = Roller {
        gd,
        star_class,
        stars: draw.stars.map(<[String]>::to_vec),
        stars_only: draw.stars_only,
        shares: draw.stars.map(|_| Vec::new()),
        about: 0,
        rng,
        rings: Rng::new(seed ^ RING_STREAM),
        star_blocks: 0,
        star_named_by_class: false,
    };
    let Planets {
        star: rolled_star,
        star_name,
        planets: rolled_planets,
    } = roller.bodies(&init.planets)?;
    let mut deposits = Deposits {
        gd,
        abundance: draw.abundance,
        rng: Rng::new(seed ^ DEPOSIT_STREAM),
        save: draw.save,
        planted: Vec::new(),
        saved: Vec::new(),
    };
    let (star, planets) = deposits.give(rolled_star, rolled_planets);
    let spec = SystemSpec {
        name: init.display_name.as_deref().unwrap_or(name).to_owned(),
        x,
        y,
        star_class: star_class.key.clone(),
        initializer: init.name.clone(),
        capped: init.max_instances.is_some(),
        star_name: match (star_name, roller.star_named_by_class) {
            (Some(name), _) => PrimaryName::Fixed(name),
            (None, true) => PrimaryName::System,
            (None, false) => PrimaryName::Lettered,
        },
        star,
        planets,
        belts: {
            let mut radii = Rng::new(seed ^ BELT_STREAM);
            init.asteroid_belts
                .iter()
                .filter(|_| !roller.stars_only)
                .filter_map(|b| rolled_belt(b, &mut radii))
                .collect()
        },
        flags: init
            .flags
            .iter()
            .filter(|flag| converted(init).is_none_or(|layout| layout.keeps(flag)))
            .cloned()
            .collect(),
        lanes: Vec::new(),
    };
    let extras = extras(gd, init, deposits.planted, &deposits.saved)?;
    Ok(SystemAdd { spec, extras })
}

/// What `init`'s script plants beside the system's bodies, `planted` holding what each
/// body's effects planted and whether its block is a star's: its anomalies, its dig sites
/// but those of a type the install gives no first stage and those on a star, which takes
/// none, the global event targets its bodies and the system's own `init_effect` save, and the
/// megastructures its own `init_effect` spawns, a row on a saved event target standing on the
/// last body of `saved` that saves it. Refused as the judge refuses the layout when it spawns
/// a row the add cannot write, or one on an event target no body of the roll saves.
fn extras(
    gd: &GameData,
    init: &Initializer,
    planted: Vec<(SpecBody, bool, Planted)>,
    saved: &[(SpecBody, Vec<String>)],
) -> Result<SystemExtras, GenerateError> {
    let refused = |why| GenerateError::Unsupported(init.name.clone(), why);
    let structures = layout_structures(gd, init).map_err(refused)?;
    let mut extras = SystemExtras::default();
    for (def, at) in structures.rows {
        let body = match at {
            SpawnedAt::Star => Some(SpecBody::Star),
            SpawnedAt::Saved(token) => saved
                .iter()
                .rev()
                .find(|(_, names)| names.iter().any(|name| name == token))
                .map(|(body, _)| Some(*body))
                .ok_or_else(|| refused(Unsupported::Megastructure))?,
            SpawnedAt::Centre => None,
        };
        extras.megastructures.push(spawned_row(def, body));
    }
    extras.ring_world = structures.ring.map(|(_, ring)| ring);
    for (body, star, planted) in planted {
        extras.anomalies.extend(
            planted
                .anomalies
                .into_iter()
                .map(|category| SpecAnomaly { body, category }),
        );
        if !star {
            extras
                .dig_sites
                .extend(planted.dig_sites.into_iter().filter_map(|site_type| {
                    let difficulty = gd.dig_site_start(&site_type)?;
                    Some(SpecDigSite {
                        body,
                        site_type,
                        difficulty,
                    })
                }));
        }
        extras
            .event_targets
            .extend(
                planted
                    .event_targets
                    .into_iter()
                    .map(|name| SpecEventTarget {
                        target: SpecTarget::Body(body),
                        name,
                    }),
            );
    }
    extras
        .event_targets
        .extend(init.saves_targets.iter().map(|name| SpecEventTarget {
            target: SpecTarget::System,
            name: name.clone(),
        }));
    Ok(extras)
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

/// A belt as the details list it: its `radius` is the `inner_radius`, a ranged one its
/// midpoint, as a ranged count is shown.
pub(crate) fn belt(belt: &InitAsteroidBelt) -> Option<BeltSpec> {
    (!belt.kind.is_empty()).then_some(())?;
    Some(BeltSpec {
        kind: belt.kind.clone(),
        inner_radius: belt.radius?.midpoint(),
    })
}

/// A belt as the save writes it, a ranged `radius` drawn from `rng` as an orbit distance is
/// (assumed: no game file says how the game draws it).
fn rolled_belt(belt: &InitAsteroidBelt, rng: &mut Rng) -> Option<BeltSpec> {
    (!belt.kind.is_empty()).then_some(())?;
    let radius = belt.radius?;
    Some(BeltSpec {
        kind: belt.kind.clone(),
        inner_radius: match radius.min == radius.max {
            true => radius.min,
            false => draw::distance(rng, radius),
        },
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
/// count as [`InitPlanet::count`] gives it, so `class = star` spawns once. Each block whose
/// class is a star's gives a star: the first the system's own, each later one a companion.
/// The kth `class = star` block takes the kth star of the star class; one written as a class
/// (`class = pc_f_star`) keeps that class, and as the system's own star is named after the
/// system unless it has a fixed name. A star's planets walk about it as the planets walk about
/// the centre, and a planet's moons walk as the planets do. Approximated where the engine's code decides: the turn of a body whose block gives
/// no angle is drawn at random; a drawn class is any with odds whose
/// `min/max_distance_from_sun` holds the orbit (a moon's, its planet's orbit, with classes
/// marked `can_be_moon = no` left out), weighted by `spawn_odds` times the star's factor
/// for it; and a planet list draws each of its classes alike, wherever the body lands. A
/// random body no class fits is not spawned, as the game's own files say of a failed draw,
/// and nor are its moons ([`ClassDraw`]).
struct Roller<'g> {
    gd: &'g GameData,
    star_class: &'g StarClass,
    /// The planet class of each `class = star` block, in order, when they are chosen rather
    /// than the star class's.
    stars: Option<Vec<String>>,
    /// Only the star bodies are placed: no planets, moons or belts.
    stars_only: bool,
    /// Each star placed so far with its share of the planets, when the stars are chosen.
    shares: Option<Vec<Share<'g>>>,
    /// The star of `shares` whose planets the walk is at: the system's own about the centre.
    about: usize,
    rng: Rng,
    /// Each planet's ring, drawn apart so the bodies a seed gives stay as they were.
    rings: Rng,
    /// The `class = star` blocks placed so far.
    star_blocks: usize,
    star_named_by_class: bool,
}

/// A chosen star's planets: its own class, or the system's when it has none, whose odds they
/// are drawn at, and how many more of the layout's places for them it keeps, drawn from that
/// class's `num_planets`. The system's own star takes the planets about the centre with its
/// own, a companion its own alone, each the first the walk reaches.
struct Share<'g> {
    class: &'g StarClass,
    left: u32,
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

/// A rolled star, beside its own block and its planets, each still beside its own.
struct RolledStar<'g> {
    spec: BodySpec,
    block: &'g InitPlanet,
    planets: Vec<RolledPlanet<'g>>,
}

/// A rolled body about the centre: a planet, or a companion star.
enum Orbiter<'g> {
    Planet(RolledPlanet<'g>),
    Star(RolledStar<'g>),
}

impl<'g> Roller<'g> {
    fn bodies(
        &mut self,
        blocks: &'g [InitPlanet],
    ) -> Result<Planets<'g, RolledStar<'g>>, GenerateError> {
        let mut walk = Walker {
            roller: self,
            bodies: Planets::default(),
        };
        orbit_walk::walk(blocks, &mut walk)?;
        let Planets {
            star,
            star_name,
            planets,
        } = walk.bodies;
        let star = star.ok_or_else(|| GenerateError::NoStarBody(self.star_class.key.clone()))?;
        Ok(Planets {
            star,
            star_name,
            planets,
        })
    }

    /// A star of `block` with its planets; the system's own when `primary`. No star, the
    /// system's own or a companion, draws a ring.
    fn star(
        &mut self,
        block: &'g InitPlanet,
        placed: Placed<f64>,
        primary: bool,
    ) -> Result<RolledStar<'g>, GenerateError> {
        let key = match &block.class {
            BodyClass::Named(key) => {
                self.star_named_by_class |= primary;
                key.clone()
            }
            _ => {
                let chosen = self
                    .stars
                    .as_ref()
                    .map(|stars| stars.get(self.star_blocks).cloned());
                let key = match chosen {
                    Some(chosen) => chosen,
                    None => self
                        .star_class
                        .planet_keys()
                        .nth(self.star_blocks)
                        .map(str::to_owned),
                }
                .ok_or_else(|| GenerateError::NoStarBody(self.star_class.key.clone()))?;
                self.star_blocks += 1;
                key
            }
        };
        let class = self
            .gd
            .planet_classes
            .get(&key)
            .ok_or_else(|| GenerateError::UnknownPlanetClass(key.clone()))?;
        let size = self.size(block, class, false)?;
        let spec = BodySpec {
            kind: BodyKind::Star,
            ..body(class, size, placed.orbit, placed.angle, block)
        };
        let about = self.about;
        if let Some(share) = self.share(&key) {
            self.about = share;
        }
        let mut walk = Walker {
            roller: self,
            bodies: Satellites(Vec::new()),
        };
        if !walk.roller.stars_only {
            orbit_walk::walk(&block.moons, &mut walk)?;
        }
        let planets = walk.bodies.0;
        self.about = about;
        Ok(RolledStar {
            spec,
            block,
            planets,
        })
    }

    /// For a chosen star `key` of a system with planets, its [`Share`], drawn from the roll's
    /// stream, and its place among the shares.
    fn share(&mut self, key: &str) -> Option<usize> {
        if self.stars_only || self.shares.is_none() {
            return None;
        }
        let class = own_class(self.gd, key).unwrap_or(self.star_class);
        let left = match class.num_planets {
            Some(range) => {
                let drawn = self
                    .rng
                    .int(range.min.round() as i64, range.max.round() as i64);
                u32::try_from(drawn).unwrap_or(0)
            }
            None => u32::MAX,
        };
        let shares = self.shares.as_mut()?;
        shares.push(Share { class, left });
        Some(shares.len() - 1)
    }

    /// The star class a planet where the walk is now is drawn at: its star's [`Share`], which it
    /// takes a place of, else the system's. `None` when that share is used up.
    fn planet_star(&mut self) -> Option<&'g StarClass> {
        let Some(share) = self.shares.as_mut().and_then(|s| s.get_mut(self.about)) else {
            return Some(self.star_class);
        };
        share.left = share.left.checked_sub(1)?;
        Some(share.class)
    }

    /// A planet of `block` where the walk placed it about the centre or a star, its class
    /// drawn at that orbit, with its moons; `None` when no class fits there, or its star keeps
    /// no more planets.
    fn planet(
        &mut self,
        block: &'g InitPlanet,
        placed: Placed<f64>,
    ) -> Result<Option<RolledPlanet<'g>>, GenerateError> {
        let Placed { orbit, angle, .. } = placed;
        let Some(star) = self.planet_star() else {
            return Ok(None);
        };
        let Some(class) = self.class(star, &block.class, orbit, false)? else {
            return Ok(None);
        };
        let size = self.size(block, class, false)?;
        let moons = self.moons(star, &block.moons, orbit)?;
        let ring = self.ring(block, class);
        Ok(Some(RolledPlanet {
            spec: BodySpec {
                ring,
                ..body(class, size, orbit, angle, block)
            },
            block,
            moons,
        }))
    }

    fn moons(
        &mut self,
        star: &'g StarClass,
        blocks: &'g [InitPlanet],
        planet_orbit: f64,
    ) -> Result<Vec<Rolled<'g>>, GenerateError> {
        let mut walk = Walker {
            roller: self,
            bodies: Moons {
                star,
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

    /// The class of a body written as `class` at `orbit` from a star of `star`: one drawn alike
    /// among a planet list's, a class of the install, or one drawn there; `None` when no class
    /// a random draw can give fits the orbit.
    fn class(
        &mut self,
        star: &StarClass,
        class: &BodyClass,
        orbit: f64,
        moon: bool,
    ) -> Result<Option<&'g PlanetClassDef>, GenerateError> {
        let unknown = || GenerateError::UnknownPlanetClass(class.written().to_owned());
        if let Some(key) = class.named() {
            if let Some(listed) = list_members(self.gd, key, moon) {
                return self
                    .rng
                    .pick(&listed)
                    .copied()
                    .map(Some)
                    .ok_or_else(unknown);
            }
            if let Some(fixed) = self.gd.planet_classes.get(key) {
                return Ok(Some(fixed));
            }
        }
        let draw = ClassDraw::of(self.gd, star, class, moon).ok_or_else(unknown)?;
        let mut weighted = draw.at(orbit).0;
        // Both samples' orbital ring systems hold their random_colonizable world at 125, past
        // the habitable classes' 60 to 100, while example.txt says one too near the star fails.
        // A moon no class fits is still not spawned.
        let colonizable = *class == BodyClass::Random(Some(true)) && !moon;
        if colonizable && weighted.iter().all(|(_, w)| *w <= 0.0) {
            weighted = draw
                .0
                .into_iter()
                .filter(|(c, _)| c.distance_from_sun.is_none_or(|band| band.min <= orbit))
                .collect();
        }
        Ok(self.rng.weighted(&weighted).copied())
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

/// The classes a random body about a star of `star` is drawn among at `orbit`, or at any
/// orbit when none spawns there: a body added to a save goes where the player puts it.
fn drawable_at<'g>(
    gd: &'g GameData,
    star: &StarClass,
    moon: bool,
    orbit: f64,
) -> Vec<(&'g PlanetClassDef, f64)> {
    let Some(draw) = ClassDraw::of(gd, star, &BodyClass::Random(None), moon) else {
        return Vec::new();
    };
    let banded = draw.at(orbit).0;
    let any = draw.0;
    match banded.iter().any(|(_, weight)| *weight > 0.0) {
        true => banded,
        false => any,
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
/// class's `chance_of_ring`, drawn from `rings` either way. A `has_ring` written in a shape the
/// reader does not take (`No`) is left to the roll, where a scenario's details call the ring
/// unknown.
fn draw_ring(rings: &mut Rng, block: Option<&InitPlanet>, class: &PlanetClassDef) -> bool {
    let roll = rings.unit();
    match ring_roll(block.and_then(|b| b.has_ring), class) {
        RingRoll::Fixed(ring) => ring,
        RingRoll::Chance(chance) => roll < chance,
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
            let weighted = drawable_at(gd, star, roll.moon, roll.orbit);
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
        body_effects::apply(
            gd,
            &effect,
            &mut spec,
            rolled.kind,
            &Dlc::of(gd, None),
            &mut Rng::new(seed ^ DEPOSIT_STREAM),
            &mut Planted::default(),
        );
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

    /// The orbit to the two decimals the game writes, without the noise of summing its steps.
    fn body(&mut self, block: &'g InitPlanet, placed: Placed<f64>) -> Result<(), GenerateError> {
        let orbit = (placed.orbit * 100.0).round() / 100.0;
        self.bodies
            .body(self.roller, block, Placed { orbit, ..placed })
    }
}

/// The system's own bodies: its star `S`, the fixed name its block gives it, and what orbits
/// the centre. The first block whose class is a star's gives the star.
struct Planets<'g, S> {
    star: S,
    star_name: Option<String>,
    planets: Vec<Orbiter<'g>>,
}

impl Default for Planets<'_, Option<RolledStar<'_>>> {
    fn default() -> Self {
        Self {
            star: None,
            star_name: None,
            planets: Vec::new(),
        }
    }
}

impl<'g> Bodies<'g> for Planets<'g, Option<RolledStar<'g>>> {
    fn body(
        &mut self,
        roller: &mut Roller<'g>,
        block: &'g InitPlanet,
        placed: Placed<f64>,
    ) -> Result<(), GenerateError> {
        if star_body(roller.gd, &block.class) {
            let primary = self.star.is_none();
            let mut star = roller.star(block, placed, primary)?;
            if primary {
                self.star_name = star.spec.name.take();
                self.star = Some(star);
            } else {
                self.planets.push(Orbiter::Star(star));
            }
            return Ok(());
        }
        if roller.stars_only {
            return Ok(());
        }
        if let Some(planet) = roller.planet(block, placed)? {
            self.planets.push(Orbiter::Planet(planet));
        }
        Ok(())
    }
}

/// A star's planets, each class drawn at its orbit about the star.
struct Satellites<'g>(Vec<RolledPlanet<'g>>);

impl<'g> Bodies<'g> for Satellites<'g> {
    fn body(
        &mut self,
        roller: &mut Roller<'g>,
        block: &'g InitPlanet,
        placed: Placed<f64>,
    ) -> Result<(), GenerateError> {
        if let Some(planet) = roller.planet(block, placed)? {
            self.0.push(planet);
        }
        Ok(())
    }
}

/// A planet's moons, each class drawn for the planet's orbit about a star of `star`.
struct Moons<'g> {
    star: &'g StarClass,
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
        let Some(class) = roller.class(self.star, &block.class, self.planet_orbit, true)? else {
            return Ok(());
        };
        let size = roller.size(block, class, true)?;
        let mut spec = body(class, size, placed.orbit, placed.angle, block);
        if spec.kind == BodyKind::Asteroid {
            spec.kind = BodyKind::Planet;
        }
        self.moons.push(Rolled { spec, block });
        Ok(())
    }
}

/// A body of `class` as `block` writes it: its fixed name and model, and whether the
/// install makes its class a star. An asteroid with no fixed name is named from the save's
/// pool, unless it is a moon, which is lettered after its planet.
fn body(class: &PlanetClassDef, size: u32, orbit: f64, angle: f64, block: &InitPlanet) -> BodySpec {
    let name = fixed_name(block).map(str::to_owned);
    BodySpec {
        class: class.key.clone(),
        size,
        orbit,
        angle: (angle.rem_euclid(360.0) * 100.0).round() / 100.0,
        entity: 0,
        kind: match (class.star, class.asteroid && name.is_none()) {
            (true, _) => BodyKind::Star,
            (false, true) => BodyKind::Asteroid,
            (false, false) => BodyKind::Planet,
        },
        name,
        entity_name: block.entity.clone(),
        ..Default::default()
    }
}

/// Rolls each body's deposits from a stream of its own, so the bodies a seed gives stay
/// the same whatever the abundance, then runs the effects of its block, with the save's
/// DLC, when there is one, answering their `if`s, and keeps what they plant on each body.
struct Deposits<'g> {
    gd: &'g GameData,
    abundance: f64,
    rng: Rng,
    save: Option<&'g SaveFacts>,
    /// Each body that planted something, whether its block is a star's, and what it planted.
    planted: Vec<(SpecBody, bool, Planted)>,
    /// Each body whose block saves event targets, and their names.
    saved: Vec<(SpecBody, Vec<String>)>,
}

impl Deposits<'_> {
    /// Finishes every star, planet and moon of a roll, each beside the block it was rolled
    /// from, in the order the game lists them: each body before what orbits it.
    fn give(
        &mut self,
        star: RolledStar<'_>,
        planets: Vec<Orbiter<'_>>,
    ) -> (BodySpec, Vec<BodySpec>) {
        let star = self.star(SpecStar::Primary, star);
        let planets = planets
            .into_iter()
            .enumerate()
            .map(|(index, orbiter)| match orbiter {
                Orbiter::Planet(planet) => {
                    self.planet(SpecBody::Planet { index }, planet, |moon| SpecBody::Moon {
                        of: index,
                        index: moon,
                    })
                }
                Orbiter::Star(star) => self.star(SpecStar::Companion(index), star),
            })
            .collect();
        (star, planets)
    }

    /// A star and its planets. Every star rolls its deposits as a star, the system's own or
    /// not: each star body of the 4.5 sample's multi-star systems holds one star deposit.
    fn star(&mut self, at: SpecStar, star: RolledStar<'_>) -> BodySpec {
        let RolledStar {
            mut spec,
            block,
            planets,
        } = star;
        let body = match at {
            SpecStar::Primary => SpecBody::Star,
            SpecStar::Companion(index) => SpecBody::Planet { index },
        };
        self.roll(&mut spec, block, Kind::Star, body);
        spec.moons = planets
            .into_iter()
            .enumerate()
            .map(|(index, planet)| {
                self.planet(SpecBody::Satellite { star: at, index }, planet, |moon| {
                    SpecBody::SatelliteMoon {
                        star: at,
                        satellite: index,
                        index: moon,
                    }
                })
            })
            .collect();
        spec
    }

    /// A planet at `at` and its moons, the `index`th at `moon_at(index)`.
    fn planet(
        &mut self,
        at: SpecBody,
        planet: RolledPlanet<'_>,
        moon_at: impl Fn(usize) -> SpecBody,
    ) -> BodySpec {
        let RolledPlanet {
            mut spec,
            block,
            moons,
        } = planet;
        self.roll(&mut spec, block, Kind::Planet, at);
        spec.moons = moons
            .into_iter()
            .enumerate()
            .map(|(moon, rolled)| self.moon(moon_at(moon), rolled))
            .collect();
        spec
    }

    fn moon(&mut self, at: SpecBody, moon: Rolled<'_>) -> BodySpec {
        let Rolled { mut spec, block } = moon;
        self.roll(&mut spec, block, Kind::Moon, at);
        spec
    }

    fn roll(&mut self, body: &mut BodySpec, block: &InitPlanet, kind: Kind, at: SpecBody) {
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
        if !block.saves_target.is_empty() {
            self.saved.push((at, block.saves_target.clone()));
        }
        let mut planted = Planted::default();
        let dlc = Dlc::of(self.gd, self.save);
        body_effects::apply(
            self.gd,
            &block.effects,
            body,
            kind,
            &dlc,
            &mut self.rng,
            &mut planted,
        );
        if planted != Planted::default() {
            self.planted
                .push((at, star_body(self.gd, &block.class), planted));
        }
    }
}
