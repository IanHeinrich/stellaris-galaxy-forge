//! A binary or trinary built star by star: the star types a slot may take, the plain layouts
//! that arrange the stars, and the star class the chosen stars are filed under, which sets
//! the system's galaxy-map icon, its effects and the odds its planets are drawn at.

use std::cmp::Ordering;
use std::convert::Infallible;

use serde::{Deserialize, Serialize};
use sgf_core::projections::geometry::point;
use ts_rs::TS;

use crate::GameData;
use crate::generate::{GenerateError, layouts_for};
use crate::initializers::{InitPlanet, Initializer};
use crate::install::script::Range;
use crate::layouts::{star_blocks, star_body};
use crate::orbit_walk::{self, Placed, Walk};
use crate::registries::star_classes::StarClass;

/// How far from the centre a star stands and still makes a close group.
const CLOSE: f64 = 60.0;

/// The star class chosen stars are filed under, and why. The app shows the class alone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Filed {
    pub class: String,
    pub reason: FiledReason,
}

/// Which step of [`file_star_class`] chose the class.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FiledReason {
    /// The class's stars are the chosen ones, in some order.
    Exact,
    /// `star` has effects, and the class, of as many stars as were chosen, has it among them.
    EffectStar { star: String },
    /// `star` has effects, and no class of as many stars has it: its own class.
    EffectStarAlone { star: String },
    /// Of the classes of as many stars, the one sharing the most with the chosen, `shared`.
    MostShared { shared: u32 },
    /// No class of as many stars shares one: the first star's own class.
    FirstStar,
    /// Nothing shared, and the first star has no class of its own: the class of as many stars
    /// a galaxy draws most often.
    Commonest,
    /// The player chose the class.
    Chosen,
}

/// The class a system of `stars`, in slot order, is filed under: `chosen` when given, else the
/// first of these that applies.
///
/// 1. A spawnable or crisis class whose stars are `stars` in any order, a spawnable one first.
/// 2. A star whose own class has effects ([`effect_star`]), the first in slot order: a
///    spawnable or crisis class of as many stars that has it, a spawnable one first; else the
///    star's own class.
/// 3. The spawnable class of as many stars without effects that shares the most stars, at
///    least one; ties go to a class whose first star is slot 1's, then the higher odds.
/// 4. Slot 1's own class; else the spawnable class of as many stars without effects with the
///    highest odds.
///
/// A class only a special layout or an event gives (neither spawnable nor a crisis class) is
/// never taken for its stars. A tie left after these goes to the class the game reads first.
/// Refused for no stars, a slot that is no star, and a `chosen` class the install does not
/// define or that gives a system no star bodies of its own ([`fileable`]).
pub fn file_star_class(
    gd: &GameData,
    stars: &[String],
    chosen: Option<&str>,
) -> Result<Filed, GenerateError> {
    let Some(first) = stars.first() else {
        return Err(GenerateError::NoStars);
    };
    if let Some(key) = stars.iter().find(|key| !is_star(gd, key)) {
        return Err(GenerateError::NotAStar(key.clone()));
    }
    if let Some(class) = chosen {
        return match gd.star_classes.get(class) {
            Some(def) if fileable(def) => Ok(filed(class, FiledReason::Chosen)),
            Some(_) => Err(GenerateError::NotFileable(class.to_owned())),
            None => Err(GenerateError::UnknownStar(class.to_owned())),
        };
    }
    let classes = in_order(gd);
    let crisis = |c: &StarClass| {
        gd.star_classes
            .iter()
            .any(|other| other.crisis_star_class.as_deref() == Some(c.key.as_str()))
    };
    let spawnable = |c: &StarClass| c.spawn_odds > 0.0;
    let tier = |c: &StarClass| u8::from(!spawnable(c));
    let same_count: Vec<&StarClass> = classes
        .iter()
        .copied()
        .filter(|c| c.planets.len() == stars.len())
        .collect();
    let rolled: Vec<&StarClass> = same_count
        .iter()
        .copied()
        .filter(|c| spawnable(c) || crisis(c))
        .collect();

    let exact = rolled
        .iter()
        .copied()
        .filter(|c| shared(c, stars) == stars.len())
        .min_by(|a, b| tier(a).cmp(&tier(b)).then(odds_first(a, b)));
    if let Some(class) = exact {
        return Ok(filed(&class.key, FiledReason::Exact));
    }

    if let Some(star) = stars.iter().find(|star| effect_star(gd, star)) {
        let with = rolled
            .iter()
            .copied()
            .filter(|c| c.planet_keys().any(|key| key == star.as_str()))
            .min_by(|a, b| {
                tier(a)
                    .cmp(&tier(b))
                    .then(shared(b, stars).cmp(&shared(a, stars)))
                    .then(odds_first(a, b))
            });
        if let Some(class) = with {
            let reason = FiledReason::EffectStar { star: star.clone() };
            return Ok(filed(&class.key, reason));
        }
        if let Some(own) = own_class(gd, star) {
            let reason = FiledReason::EffectStarAlone { star: star.clone() };
            return Ok(filed(&own.key, reason));
        }
    }

    let plain: Vec<&StarClass> = same_count
        .iter()
        .copied()
        .filter(|c| spawnable(c) && !c.effects())
        .collect();
    let leads = |c: &StarClass| c.planet_keys().next() == Some(first.as_str());
    let most = plain
        .iter()
        .copied()
        .filter(|c| shared(c, stars) > 0)
        .min_by(|a, b| {
            shared(b, stars)
                .cmp(&shared(a, stars))
                .then(leads(b).cmp(&leads(a)))
                .then(odds_first(a, b))
        });
    if let Some(class) = most {
        let reason = FiledReason::MostShared {
            shared: shared(class, stars) as u32,
        };
        return Ok(filed(&class.key, reason));
    }

    if let Some(own) = own_class(gd, first) {
        return Ok(filed(&own.key, FiledReason::FirstStar));
    }
    plain
        .into_iter()
        .min_by(|a, b| odds_first(a, b))
        .map(|class| filed(&class.key, FiledReason::Commonest))
        .ok_or(GenerateError::NoClassFor(stars.len()))
}

fn filed(class: &str, reason: FiledReason) -> Filed {
    Filed {
        class: class.to_owned(),
        reason,
    }
}

/// A class a system can be filed under: one that gives it star bodies of its own, not a
/// placeholder nor a list of alternatives.
pub fn fileable(class: &StarClass) -> bool {
    !class.planets.is_empty() && !class.placeholder && !class.alternatives
}

/// The [`fileable`] classes in the order the game reads them.
fn in_order(gd: &GameData) -> Vec<&StarClass> {
    let mut classes: Vec<&StarClass> = gd.star_classes.iter().filter(|c| fileable(c)).collect();
    classes.sort_by_key(|c| c.order);
    classes
}

/// The higher spawn odds first.
fn odds_first(a: &StarClass, b: &StarClass) -> Ordering {
    b.spawn_odds
        .partial_cmp(&a.spawn_odds)
        .unwrap_or(Ordering::Equal)
}

/// How many of `stars` the class's stars hold, each star counted as often as both have it.
fn shared(class: &StarClass, stars: &[String]) -> usize {
    let mut left: Vec<&str> = class.planet_keys().collect();
    stars
        .iter()
        .filter(
            |star| match left.iter().position(|key| *key == star.as_str()) {
                Some(at) => {
                    left.swap_remove(at);
                    true
                }
                None => false,
            },
        )
        .count()
}

/// `key` is a planet class the install makes a star.
fn is_star(gd: &GameData, key: &str) -> bool {
    gd.planet_classes.get(key).is_some_and(|class| class.star)
}

/// The class of one star that is `star` alone, the higher odds first.
fn own_class<'g>(gd: &'g GameData, star: &str) -> Option<&'g StarClass> {
    in_order(gd)
        .into_iter()
        .filter(|c| c.planet_keys().eq([star]))
        .min_by(|a, b| odds_first(a, b))
}

/// `star`'s own class has effects; a star with no class of its own has them when every class
/// that has it does.
pub fn effect_star(gd: &GameData, star: &str) -> bool {
    if let Some(own) = own_class(gd, star) {
        return own.effects();
    }
    let mut with = gd
        .star_classes
        .iter()
        .filter(|c| fileable(c) && c.planet_keys().any(|key| key == star))
        .peekable();
    with.peek().is_some() && with.all(|c| c.effects())
}

/// A star type a slot of the builder offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StarType {
    /// Its planet class.
    pub key: String,
    pub name: String,
    /// A class a galaxy draws has it.
    pub usual: bool,
    /// Its own class has effects, as [`effect_star`] judges.
    pub effects: bool,
}

/// Every planet class the install makes a star, the usual ones first, each group by name.
pub fn star_types(gd: &GameData) -> Vec<StarType> {
    let usual = |key: &str| {
        gd.star_classes
            .iter()
            .any(|c| fileable(c) && c.spawn_odds > 0.0 && c.planet_keys().any(|star| star == key))
    };
    let mut types: Vec<StarType> = gd
        .planet_classes
        .iter()
        .filter(|class| class.star)
        .map(|class| StarType {
            name: gd.loc.name_or_readable(&class.key),
            usual: usual(&class.key),
            effects: effect_star(gd, &class.key),
            key: class.key.clone(),
        })
        .collect();
    types.sort_by(|a, b| b.usual.cmp(&a.usual).then_with(|| a.name.cmp(&b.name)));
    types
}

/// What a layout does with its stars, which names it in the builder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum Shape {
    /// Two stars, each within [`CLOSE`] of the centre.
    ClosePair,
    /// Three stars, each within [`CLOSE`] of the centre.
    CloseTrio,
    /// One star far out with planets of its own.
    DistantCompanion,
    /// Two stars far out, each with planets of its own.
    TwoDistantCompanions,
    Other,
}

impl Shape {
    /// The shape of `stars`, each beside whether it has planets of its own.
    fn of(stars: &[(DiagramStar, bool)]) -> Self {
        let far: Vec<bool> = stars
            .iter()
            .filter(|(star, _)| star.orbit > CLOSE)
            .map(|&(_, planets)| planets)
            .collect();
        let with_planets = far.iter().all(|&planets| planets);
        match (stars.len(), far.len(), with_planets) {
            (2, 0, _) => Self::ClosePair,
            (3, 0, _) => Self::CloseTrio,
            (_, 1, true) => Self::DistantCompanion,
            (_, 2, true) => Self::TwoDistantCompanions,
            _ => Self::Other,
        }
    }

    /// What the builder calls it.
    pub fn name(self) -> &'static str {
        match self {
            Self::ClosePair => "Close pair",
            Self::CloseTrio => "Close trio",
            Self::DistantCompanion => "Distant companion",
            Self::TwoDistantCompanions => "Two distant companions",
            Self::Other => "Other",
        }
    }
}

/// A plain layout of several stars the builder offers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Arrangement {
    pub layout: String,
    /// Its `class = star` blocks, one per slot.
    pub stars: u32,
    pub shape: Shape,
    /// [`Shape::name`].
    pub name: String,
    /// The weight a galaxy draws it with.
    pub odds: f64,
    /// Its share of the draw among the plain layouts of as many stars: 0.6 for six in ten.
    pub share: f64,
    pub diagram: LayoutDiagram,
}

/// A layout drawn with each range at its middle: where its stars stand.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LayoutDiagram {
    /// Each star body, the system's own first, in the order the layout places them.
    pub stars: Vec<DiagramStar>,
}

/// A star of a [`LayoutDiagram`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DiagramStar {
    pub x: f64,
    pub y: f64,
    /// The radius of its path about the centre; 0 at the centre.
    pub orbit: f64,
}

/// The plain layouts of more than one star, in the install's key order.
pub fn arrangements(gd: &GameData) -> Vec<Arrangement> {
    let plain: Vec<(&Initializer, f64)> = layouts_for(gd, None)
        .into_iter()
        .filter(|(init, _)| star_blocks(init) > 1)
        .collect();
    plain
        .iter()
        .map(|&(init, odds)| {
            let stars = star_blocks(init);
            let total: f64 = plain
                .iter()
                .filter(|(other, _)| star_blocks(other) == stars)
                .map(|(_, odds)| odds)
                .sum();
            let walked = walk_middle(gd, init);
            let shape = Shape::of(&walked);
            Arrangement {
                layout: init.name.clone(),
                stars: stars as u32,
                shape,
                name: shape.name().to_owned(),
                odds,
                share: odds / total,
                diagram: LayoutDiagram {
                    stars: walked.into_iter().map(|(star, _)| star).collect(),
                },
            }
        })
        .collect()
}

/// `init` walked with each range, count and turn at its middle.
pub fn diagram(gd: &GameData, init: &Initializer) -> LayoutDiagram {
    LayoutDiagram {
        stars: walk_middle(gd, init)
            .into_iter()
            .map(|(star, _)| star)
            .collect(),
    }
}

/// Each star of `init` walked at the middle, beside whether it has planets of its own.
fn walk_middle(gd: &GameData, init: &Initializer) -> Vec<(DiagramStar, bool)> {
    let mut walk = Middle {
        gd,
        stars: Vec::new(),
        about: None,
    };
    let Ok(()) = orbit_walk::walk(&init.planets, &mut walk);
    walk.stars
}

/// The walk of [`walk_middle`]; `about` the star whose planets it is walking.
struct Middle<'g> {
    gd: &'g GameData,
    stars: Vec<(DiagramStar, bool)>,
    about: Option<usize>,
}

impl<'p> Walk<'p> for Middle<'_> {
    type Number = f64;
    type Error = Infallible;

    fn count(&mut self, block: &'p InitPlanet) -> u32 {
        block.count().midpoint().round() as u32
    }

    fn distance(&mut self, distance: Range) -> f64 {
        distance.midpoint()
    }

    fn angle(&mut self, angle: Range) -> f64 {
        angle.midpoint()
    }

    /// Anywhere on its orbit, at the middle: half a turn.
    fn no_angle(&mut self) -> f64 {
        180.0
    }

    fn body(&mut self, block: &'p InitPlanet, placed: Placed<f64>) -> Result<(), Infallible> {
        if let Some(star) = self.about {
            self.stars[star].1 = true;
            return Ok(());
        }
        if !star_body(self.gd, &block.class) {
            return Ok(());
        }
        let (x, y) = point((0.0, 0.0), placed.orbit, placed.angle);
        let orbit = placed.orbit.abs();
        self.stars.push((DiagramStar { x, y, orbit }, false));
        self.about = Some(self.stars.len() - 1);
        let planets = orbit_walk::walk(&block.moons, self);
        self.about = None;
        planets
    }
}
