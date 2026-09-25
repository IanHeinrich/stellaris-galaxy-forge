//! Which of the install's `misc_system_init` layouts the generator can build once their
//! script is dropped: the plain ones it rolls at random, the special ones a user picks by
//! name, and the rest. The rules read what a layout is made of, so a mod's layouts fall
//! into the same groups as the game's.

use std::collections::{HashMap, HashSet};
use std::fmt;

use serde::{Deserialize, Serialize};
use sgf_core::archive;
use sgf_core::session::Session;
use ts_rs::TS;

use crate::GameData;
use crate::body_effects;
use crate::condition::{Condition, Subject};
use crate::initializers::{BodyClass, InitAsteroidBelt, InitPlanet, Initializer};
use crate::install::script::Range;
use crate::registries::scripted_triggers::ScriptedTriggers;
use crate::registries::star_classes::{StarClass, StarList};

pub use crate::menu::{SpecialLayout, menu_initializers, special_layouts};

/// The `usage` of the initializers a galaxy fills its ordinary systems with.
pub const USAGE: &str = "misc_system_init";
/// The star flag of the game's unique systems, which its timeline reads when an empire
/// takes control of one.
pub const UNIQUE_SYSTEM: &str = "unique_system";

/// What the generator makes of a layout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Eligibility {
    /// One star from a list, ordinary bodies and belts, no script: rolled at random.
    Plain,
    /// Built from its star, bodies and belts, with their deposit and modifier effects, and
    /// its other script dropped: picked by name.
    Special,
    Unsupported(Unsupported),
}

/// Why the generator cannot build a layout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unsupported {
    /// Its `usage` is not [`USAGE`].
    Usage,
    /// Its odds are 0 or absent, so only an event places it.
    EventOnly,
    /// Its `class` names no star class or list.
    NoStar,
    MultiStar,
    /// Its star is written as this planet class, which none of its star classes has.
    StarMismatch(String),
    /// Flagged `guardian`: events find it to spawn or wake its guardian.
    Guardian,
    /// It places other systems beside it.
    Linked,
    Megastructure,
    Bypass,
    Starbase,
    /// A body is a colony or an empire's home.
    Colonised,
    PreFtl,
    /// A belt without a type or radius.
    Belt,
    /// A body's class, as written, is none the generator can draw.
    Body(String),
    /// A moon has moons, or an asteroid has.
    Moons,
    /// An effect it can neither write nor drop, by its key.
    Effect(String),
}

impl fmt::Display for Unsupported {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Usage => write!(f, "its usage is not {USAGE}"),
            Self::EventOnly => write!(f, "only an event places it"),
            Self::NoStar => write!(f, "it names no star class"),
            Self::MultiStar => write!(f, "it has more than one star"),
            Self::StarMismatch(class) => {
                write!(f, "its star is a {class}, which its star class is not")
            }
            Self::Guardian => write!(f, "it is a guardian's system"),
            Self::Linked => write!(f, "it places other systems beside it"),
            Self::Megastructure => write!(f, "it spawns a megastructure"),
            Self::Bypass => write!(f, "it spawns a bypass"),
            Self::Starbase => write!(f, "it spawns a starbase"),
            Self::Colonised => write!(f, "it has a colonised planet"),
            Self::PreFtl => write!(f, "it has a pre-FTL civilisation"),
            Self::Belt => write!(f, "it has a belt without a type or radius"),
            Self::Body(class) => write!(f, "it has a body of class {class}"),
            Self::Moons => write!(f, "it has a moon or an asteroid with moons"),
            Self::Effect(key) => write!(f, "its script runs {key} where it cannot be written"),
        }
    }
}

/// What the generator makes of `init`.
pub fn eligibility(gd: &GameData, init: &Initializer) -> Eligibility {
    match gd.eligibility().get(&init.name) {
        Some(known) => known.clone(),
        None => judge(gd, init),
    }
}

/// The layouts [`crate::generate::generate`] rolls at random.
pub fn plain_initializers(gd: &GameData) -> Vec<&Initializer> {
    gd.initializers
        .iter()
        .filter(|i| eligibility(gd, i) == Eligibility::Plain)
        .collect()
}

pub(crate) fn judge(gd: &GameData, init: &Initializer) -> Eligibility {
    if plain(gd, init) {
        return Eligibility::Plain;
    }
    match unsupported(gd, init) {
        Some(why) => Eligibility::Unsupported(why),
        None => Eligibility::Special,
    }
}

/// The layouts a user picks by name, in the install's key order.
pub fn special_initializers(gd: &GameData) -> Vec<&Initializer> {
    gd.initializers
        .iter()
        .filter(|i| eligibility(gd, i) == Eligibility::Special)
        .collect()
}

/// What the Special menu knows of a save: the DLC it was played with and how many systems
/// of its galaxy each layout made.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SaveFacts {
    /// The save's `required_dlcs`.
    pub dlcs: HashSet<String>,
    /// Systems by their `initializer`.
    pub layouts: HashMap<String, u32>,
}

impl SaveFacts {
    pub fn read(session: &Session) -> Self {
        let dlcs = archive::parse_meta(session.doc.meta())
            .map(|meta| meta.required_dlcs.into_iter().collect())
            .unwrap_or_default();
        let mut layouts: HashMap<String, u32> = HashMap::new();
        for system in session.graph.systems.values() {
            *layouts.entry(system.initializer.clone()).or_default() += 1;
        }
        Self { dlcs, layouts }
    }

    /// How many systems of the galaxy record `layout` as their initializer.
    pub fn in_galaxy(&self, layout: &str) -> u32 {
        self.layouts.get(layout).copied().unwrap_or(0)
    }

    /// The DLC `init`'s odds need, and whether this save has it.
    pub fn dlc_need(&self, gd: &GameData, init: &Initializer) -> Option<DlcNeed> {
        required_dlc(gd, init).map(|name| DlcNeed {
            met: self.has_dlc(&name),
            name,
        })
    }

    /// The save's `required_dlcs` lists `dlc`.
    pub fn has_dlc(&self, dlc: &str) -> bool {
        self.dlcs.contains(dlc)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DlcNeed {
    /// As `host_has_dlc` and the save's `required_dlcs` name it.
    pub name: String,
    /// The save's `required_dlcs` lists it.
    pub met: bool,
}

/// A condition judged by the DLC alone, as a layout's odds and a body's `if`s are.
pub(crate) struct Dlc<'a> {
    has: Box<dyn Fn(&str) -> bool + 'a>,
    triggers: &'a ScriptedTriggers,
}

impl<'a> Dlc<'a> {
    /// The DLC of `save`, or every DLC without one.
    pub(crate) fn of(gd: &'a GameData, save: Option<&'a SaveFacts>) -> Self {
        Self {
            has: Box::new(move |dlc| save.is_none_or(|save| save.has_dlc(dlc))),
            triggers: &gd.scripted_triggers,
        }
    }

    /// Every DLC but `missing`.
    fn without(gd: &'a GameData, missing: &'a str) -> Self {
        Self {
            has: Box::new(move |dlc| dlc != missing),
            triggers: &gd.scripted_triggers,
        }
    }
}

impl Subject for Dlc<'_> {
    fn leaf(&self, leaf: &Condition) -> Option<bool> {
        match leaf {
            Condition::HostDlc(dlc) => Some((self.has)(dlc)),
            _ => None,
        }
    }

    fn triggers(&self) -> Option<&ScriptedTriggers> {
        Some(self.triggers)
    }
}

/// The weight a galaxy draws `init` with: its `usage_odds`, as a number or as a
/// [`crate::weight::Weight`] block. A DLC check is
/// answered from `save`, and holds without one. Any other condition (a cluster, the
/// galaxy's setup, a neighbour) is taken as unmet, and so is the modifier it is part of.
pub fn odds(gd: &GameData, init: &Initializer, save: Option<&SaveFacts>) -> f64 {
    odds_with(init, &Dlc::of(gd, save))
}

/// A layout with no fixed system name and no `max_instances`: one a star-class pick may
/// give. A named or capped layout is placed only when it is asked for by name.
pub fn generic(init: &Initializer) -> bool {
    init.display_name.is_none() && init.max_instances.is_none()
}

fn odds_with(init: &Initializer, dlc: &Dlc<'_>) -> f64 {
    match (&init.usage_weight, init.usage_odds) {
        (Some(weight), _) => weight.evaluate(dlc),
        (None, odds) => odds.unwrap_or(0.0),
    }
}

/// An ordinary system of one star, drawn from a star list, with no effects, flags,
/// countries or special bodies. Its belts and fixed asteroids are kept.
fn plain(gd: &GameData, init: &Initializer) -> bool {
    let Some((star, rest)) = init.planets.split_first() else {
        return false;
    };
    init.usage.as_deref() == Some(USAGE)
        && init.usage_odds.is_some_and(|odds| odds > 0.0)
        && !init.init_effect
        && init.countries.is_empty()
        && init.asteroid_belts.iter().all(belt_measured)
        && init.flags.is_empty()
        && init.max_instances.is_none()
        && init.spawns.is_empty()
        && init.starbase.is_none()
        && single_star_list(gd, init)
        && star.class == BodyClass::Star
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

pub(crate) fn belt_measured(belt: &InitAsteroidBelt) -> bool {
    !belt.kind.is_empty() && belt.radius.is_some()
}

fn asteroid(gd: &GameData, class: &BodyClass) -> bool {
    class
        .named()
        .and_then(|key| gd.planet_classes.get(key))
        .is_some_and(|c| c.asteroid)
}

/// A star list whose every class has one star body.
fn single_star_list(gd: &GameData, init: &Initializer) -> bool {
    let StarSource::List(list) = star_source(gd, init) else {
        return false;
    };
    list.stars.iter().all(|key| {
        gd.star_classes
            .get(key)
            .is_some_and(|class| class.planet_keys.len() == 1)
    })
}

/// A random body, or one of a fixed class that is no star; an asteroid only when
/// `asteroids` allows it.
fn plain_body(gd: &GameData, body: &InitPlanet, asteroids: bool) -> bool {
    let class = match &body.class {
        BodyClass::Random(None) => true,
        BodyClass::Named(key) => gd
            .planet_classes
            .get(key)
            .is_some_and(|class| !class.star && (asteroids || !class.asteroid)),
        _ => false,
    };
    class && !body.colonised && !body.pre_ftl && body.sites.is_empty()
}

/// Whether `class`, as a layout writes it, is a star's planet class.
pub(crate) fn star_body(gd: &GameData, class: &BodyClass) -> bool {
    match class {
        BodyClass::Star => true,
        BodyClass::Named(key) => gd.planet_classes.get(key).is_some_and(|c| c.star),
        BodyClass::Random(_) => false,
    }
}

fn unsupported(gd: &GameData, init: &Initializer) -> Option<Unsupported> {
    if init.usage.as_deref() != Some(USAGE) {
        return Some(Unsupported::Usage);
    }
    if odds(gd, init, None) <= 0.0 {
        return Some(Unsupported::EventOnly);
    }
    if let Some(why) = star_unsupported(gd, init) {
        return Some(why);
    }
    if init.flags.iter().any(|flag| flag == "guardian") {
        return Some(Unsupported::Guardian);
    }
    if !init.spawns.is_empty() {
        return Some(Unsupported::Linked);
    }
    if !init.megastructures.is_empty() {
        return Some(Unsupported::Megastructure);
    }
    let bypasses = &init.bypasses;
    if !bypasses.own.is_empty()
        || bypasses.random_wormhole_pairs > 0
        || bypasses.random_gateways > 0
    {
        return Some(Unsupported::Bypass);
    }
    if init.starbase.is_some() {
        return Some(Unsupported::Starbase);
    }
    if !init.asteroid_belts.iter().all(belt_measured) {
        return Some(Unsupported::Belt);
    }
    if let Some(why) = init
        .planets
        .iter()
        .find_map(|planet| body_unsupported(gd, planet, false))
    {
        return Some(why);
    }
    if let Some(key) = init.planets.iter().find_map(|planet| unwritten(gd, planet)) {
        return Some(Unsupported::Effect(key));
    }
    let def = gd.initializers.def(&init.name)?;
    def.node
        .find_all("init_effect", &def.src)
        .find_map(|block| body_effects::undropped(block, def))
        .map(Unsupported::Effect)
}

/// The first effect of `body` or its moons the generator can neither write nor drop, or
/// an `if` it cannot decide from the DLC.
fn unwritten(gd: &GameData, body: &InitPlanet) -> Option<String> {
    body.unwritten
        .clone()
        .or_else(|| body_effects::undecided(&body.effects, &Dlc::of(gd, None)))
        .or_else(|| body.moons.iter().find_map(|moon| unwritten(gd, moon)))
}

fn star_unsupported(gd: &GameData, init: &Initializer) -> Option<Unsupported> {
    let stars: Vec<&str> = match star_source(gd, init) {
        StarSource::Fixed(class) => vec![class.key.as_str()],
        StarSource::List(list) => list.stars.iter().map(String::as_str).collect(),
        StarSource::Unknown => return Some(Unsupported::NoStar),
    };
    let mut counts = stars
        .iter()
        .map(|star| gd.star_classes.get(star).map(|c| c.planet_keys.len()));
    if counts.clone().any(|count| count.is_none_or(|n| n == 0)) {
        return Some(Unsupported::NoStar);
    }
    if counts.any(|count| count != Some(1)) {
        return Some(Unsupported::MultiStar);
    }
    let star_blocks = init
        .planets
        .iter()
        .filter(|p| p.class == BodyClass::Star)
        .count();
    let Some(star) = init.planets.iter().find(|p| star_body(gd, &p.class)) else {
        return Some(Unsupported::NoStar);
    };
    if star_blocks > 1 {
        return Some(Unsupported::MultiStar);
    }
    match layout_stars(gd, init).is_empty() {
        true => Some(Unsupported::StarMismatch(star.class.written().to_owned())),
        false => None,
    }
}

/// The star classes `init` can give a system: its fixed class, or those of its list. A
/// star written as a planet class (`class = pc_m_giant_star`) keeps only the classes whose
/// star is that class, and when the layout names none, takes the install's that are:
/// `oasis_system` writes `sc_m` with a red giant, and so gives `sc_m_giant`.
pub(crate) fn layout_stars<'g>(gd: &'g GameData, init: &Initializer) -> Vec<&'g StarClass> {
    let stars: Vec<&StarClass> = match star_source(gd, init) {
        StarSource::Fixed(fixed) => vec![fixed],
        StarSource::List(list) => list
            .stars
            .iter()
            .filter_map(|star| gd.star_classes.get(star))
            .collect(),
        StarSource::Unknown => Vec::new(),
    };
    let written = init
        .planets
        .iter()
        .find(|p| star_body(gd, &p.class))
        .and_then(|p| p.class.named());
    let Some(class) = written else {
        return stars;
    };
    let is = |star: &&StarClass| star.planet_keys == [class];
    let agreeing: Vec<&StarClass> = stars.into_iter().filter(is).collect();
    match agreeing.is_empty() {
        true => gd.star_classes.iter().filter(is).collect(),
        false => agreeing,
    }
}

/// What an initializer's `class` names.
pub(crate) enum StarSource<'g> {
    /// One star class.
    Fixed(&'g StarClass),
    /// A list the star class is drawn from.
    List(&'g StarList),
    /// Neither a star class nor a list of the install.
    Unknown,
}

/// What `init`'s `class` names; a star class wins over a list of the same key.
pub(crate) fn star_source<'g>(gd: &'g GameData, init: &Initializer) -> StarSource<'g> {
    let key = init.class.as_deref().unwrap_or_default();
    match (gd.star_classes.get(key), gd.star_lists.get(key)) {
        (Some(fixed), _) => StarSource::Fixed(fixed),
        (None, Some(list)) => StarSource::List(list),
        (None, None) => StarSource::Unknown,
    }
}

/// `home_planet = yes` alone makes no colony of a body in an unowned system; the effects
/// that would are caught with the rest of the script.
fn body_unsupported(gd: &GameData, body: &InitPlanet, moon: bool) -> Option<Unsupported> {
    if body.colony_owner.is_some() || (body.colonised && !body.home_planet) {
        return Some(Unsupported::Colonised);
    }
    if body.pre_ftl {
        return Some(Unsupported::PreFtl);
    }
    if !drawable(gd, &body.class) {
        return Some(Unsupported::Body(body.class.written().to_owned()));
    }
    if !body.moons.is_empty() && (moon || asteroid(gd, &body.class)) {
        return Some(Unsupported::Moons);
    }
    body.moons
        .iter()
        .find_map(|moon| body_unsupported(gd, moon, true))
}

/// A class the generator can give a body: the star, a class of the install, one of the
/// engine's random draws, or one of the install's planet lists.
fn drawable(gd: &GameData, class: &BodyClass) -> bool {
    let Some(key) = class.named() else {
        return true;
    };
    gd.planet_classes.get(key).is_some()
        || gd.planet_lists.get(key).is_some_and(|list| {
            list.iter()
                .any(|listed| gd.planet_classes.get(listed).is_some())
        })
}

/// A fixed class no random draw gives, asteroids aside: a broken world, a black hole.
pub(crate) fn notable(gd: &GameData, class: &str) -> bool {
    gd.planet_classes.get(class).is_some_and(|c| {
        !c.asteroid && (c.star || c.spawn_odds <= 0.0 || c.distance_from_sun.is_none())
    })
}

/// The DLC the layout's odds come to nothing without, every other DLC present: a
/// `factor = 0` on `has_distar = no` or `NOT = { host_has_dlc = … }`, or a base of 0 that
/// only `add = … host_has_dlc = …` raises.
pub(crate) fn required_dlc(gd: &GameData, init: &Initializer) -> Option<String> {
    let weight = init.usage_weight.as_ref()?;
    let mut named: Vec<String> = Vec::new();
    for modifier in &weight.modifiers {
        modifier.when.dlcs(&gd.scripted_triggers, &mut named);
    }
    named
        .into_iter()
        .find(|missing| odds_with(init, &Dlc::without(gd, missing)) <= 0.0)
}
