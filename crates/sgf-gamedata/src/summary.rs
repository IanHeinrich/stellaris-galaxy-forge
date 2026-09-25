//! What a pick of the Add system menu can produce, for its hover card: a special layout, a
//! star class, or Random. Built from the layouts' own counts and ranges, not from rolls, and
//! merged across the layouts a pick draws from.

use serde::{Deserialize, Serialize};
use sgf_core::session::Session;
use ts_rs::TS;

use crate::GameData;
use crate::body_effects;
use crate::generate::{GenerateError, layouts_for, star_classes};
use crate::initializers::{BodyClass, InitPlanet, Initializer};
use crate::install::script::{Range, whole};
use crate::layouts::{
    DlcNeed, SaveFacts, layout_stars, notable, plain_initializers, special_initializers, star_body,
};
use crate::loc::localisation::Localisation;
use crate::menu::{SpecialLayout, special_layouts};

/// The smallest and largest number a pick can give.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Span {
    pub min: u32,
    pub max: u32,
}

/// Whether the layouts of a pick can give something.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum Presence {
    Never,
    /// Some of the pick's layouts can, the others never.
    SomeLayouts,
    /// Every layout of the pick can.
    Every,
}

/// A key the install defines, with its localised name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Named {
    pub key: String,
    pub name: String,
}

/// Something some or all of a pick's layouts give.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Feature {
    pub key: String,
    pub name: String,
    /// Every layout of the pick gives it; otherwise only some do.
    pub every: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PickSummary {
    pub star_classes: Vec<Named>,
    /// The star's own description, when the pick has one star class the install describes.
    pub star_description: Option<String>,
    /// Planets beside the star, asteroids aside.
    pub planets: Span,
    /// The most moons any one planet can have.
    pub max_moons: u32,
    pub moons: Presence,
    pub belts: Span,
    pub belt_kinds: Vec<Feature>,
    /// Asteroids on the belts, moons aside.
    pub asteroids: Span,
    /// Bodies the layouts name: `Vermilion`, `The Cabin`.
    pub named_bodies: Vec<Feature>,
    /// Classes no random draw gives: a broken world, a relic world, a black hole.
    pub notable_classes: Vec<Feature>,
    pub modifiers: Vec<Feature>,
    pub rings: Presence,
    /// A special layout's DLC, and whether the save has it.
    pub dlc: Option<DlcNeed>,
    /// A special layout's `max_instances`.
    pub max_instances: Option<u32>,
    /// Systems of the save from this layout, or of this star class for a star pick.
    pub in_galaxy: Option<u32>,
}

/// A star-class entry of the Add system menu, named as the game names the class.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StarPick {
    pub key: String,
    pub name: String,
    pub summary: PickSummary,
}

/// An entry of the Special menu with its card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SpecialPick {
    pub layout: SpecialLayout,
    pub summary: PickSummary,
}

/// Everything the Add system menu offers for a save, each with its card: Random, a star
/// class in the order [`star_classes`] gives them, and the Special menu's layouts by label.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AddSystemPicks {
    pub random: PickSummary,
    pub star_classes: Vec<StarPick>,
    pub special: Vec<SpecialPick>,
}

/// The Add system menu's picks for `session`'s save.
pub fn add_system_picks(gd: &GameData, session: &Session) -> AddSystemPicks {
    let save = SaveFacts::read(session);
    let star_classes = star_classes(gd)
        .into_iter()
        .filter_map(|key| {
            let summary = star_pick_summary(gd, &key, session).ok()?;
            let name = gd.loc.name_or_readable(&key);
            Some(StarPick { key, name, summary })
        })
        .collect();
    let special = special_layouts(gd, session)
        .into_iter()
        .filter_map(|layout| {
            let init = gd.initializers.get(&layout.key)?;
            let summary = special_summary(gd, init, &save);
            Some(SpecialPick { layout, summary })
        })
        .collect();
    AddSystemPicks {
        random: random_summary(gd),
        star_classes,
        special,
    }
}

/// The card for the Special entry `key`.
pub fn layout_summary(
    gd: &GameData,
    key: &str,
    session: &Session,
) -> Result<PickSummary, GenerateError> {
    let init = special_initializers(gd)
        .into_iter()
        .find(|init| init.name == key)
        .ok_or_else(|| GenerateError::UnknownLayout(key.to_owned()))?;
    Ok(special_summary(gd, init, &SaveFacts::read(session)))
}

fn special_summary(gd: &GameData, init: &Initializer, save: &SaveFacts) -> PickSummary {
    let mut summary = merge(gd, &[init]);
    summary.dlc = save.dlc_need(gd, init);
    summary.max_instances = init.max_instances;
    summary.in_galaxy = Some(save.in_galaxy(&init.name));
    summary
}

/// The card for a star-class pick: the layouts [`crate::generate::generate`] draws for
/// `class`, merged.
pub fn star_pick_summary(
    gd: &GameData,
    class: &str,
    session: &Session,
) -> Result<PickSummary, GenerateError> {
    let layouts: Vec<&Initializer> = layouts_for(gd, Some(class))
        .into_iter()
        .map(|(init, _)| init)
        .collect();
    if layouts.is_empty() {
        return Err(GenerateError::NoLayoutFor(class.to_owned()));
    }
    let mut summary = merge(gd, &layouts);
    summary.star_classes = vec![named(gd, class)];
    summary.star_description = description(gd, class);
    let systems = session.graph.systems.values();
    summary.in_galaxy = Some(systems.filter(|s| s.star_class == class).count() as u32);
    Ok(summary)
}

/// The card for Random: the plain layouts, merged.
pub fn random_summary(gd: &GameData) -> PickSummary {
    merge(gd, &plain_initializers(gd))
}

/// What one layout can give, before merging.
struct Reach {
    stars: Vec<String>,
    planets: Span,
    max_moons: u32,
    belts: u32,
    belt_kinds: Vec<String>,
    asteroids: Span,
    named: Vec<String>,
    notable: Vec<String>,
    modifiers: Vec<String>,
    rings: bool,
}

fn reach(gd: &GameData, init: &Initializer) -> Reach {
    let mut out = Reach {
        stars: layout_stars(gd, init)
            .iter()
            .map(|s| s.key.clone())
            .collect(),
        planets: Span { min: 0, max: 0 },
        max_moons: 0,
        belts: init.asteroid_belts.len() as u32,
        belt_kinds: Vec::new(),
        asteroids: Span { min: 0, max: 0 },
        named: Vec::new(),
        notable: Vec::new(),
        modifiers: Vec::new(),
        rings: false,
    };
    for belt in &init.asteroid_belts {
        push(&mut out.belt_kinds, &belt.kind);
    }
    let star = init.planets.iter().position(|p| star_body(gd, &p.class));
    for (i, block) in init.planets.iter().enumerate() {
        let count = span(block.count);
        let count = match Some(i) == star {
            true => Span { min: 0, max: 0 },
            false => count,
        };
        let total = match asteroids_only(gd, &block.class) {
            true => &mut out.asteroids,
            false => &mut out.planets,
        };
        total.min += count.min;
        total.max += count.max;
        if count.max > 0 {
            let moons: u32 = block.moons.iter().map(|m| span(m.count).max).sum();
            out.max_moons = out.max_moons.max(moons);
            out.rings |= can_ring(gd, block);
        }
        let bodies: Vec<&InitPlanet> = match Some(i) == star {
            true => block.moons.iter().collect(),
            false => std::iter::once(block).chain(&block.moons).collect(),
        };
        for body in bodies {
            if let Some(name) = &body.name {
                push(&mut out.named, name);
            }
            if let Some(class) = body.class.named()
                && gd.planet_classes.get(class).is_some()
                && notable(gd, class)
            {
                push(&mut out.notable, class);
            }
        }
        for body in std::iter::once(block).chain(&block.moons) {
            for modifier in body_effects::modifiers(&body.effects) {
                push(&mut out.modifiers, modifier);
            }
        }
    }
    out
}

fn push(list: &mut Vec<String>, item: &str) {
    if !list.iter().any(|held| held == item) {
        list.push(item.to_owned());
    }
}

fn span(count: Range) -> Span {
    Span {
        min: whole(count.min),
        max: whole(count.max),
    }
}

/// A class, or every class of a list, that is an asteroid.
fn asteroids_only(gd: &GameData, class: &BodyClass) -> bool {
    let Some(class) = class.named() else {
        return false;
    };
    let asteroid = |key: &str| gd.planet_classes.get(key).is_some_and(|c| c.asteroid);
    match gd.planet_lists.get(class) {
        Some(list) => !list.is_empty() && list.iter().all(|key| asteroid(key)),
        None => asteroid(class),
    }
}

/// The layout's `has_ring`, else whether any class the block can be has a chance of one.
fn can_ring(gd: &GameData, block: &InitPlanet) -> bool {
    if let Some(ring) = block.has_ring {
        return ring;
    }
    let chance = |key: &str| {
        gd.planet_classes
            .get(key)
            .is_some_and(|c| c.chance_of_ring > 0.0)
    };
    match &block.class {
        BodyClass::Random(colonizable) => gd
            .planet_classes
            .drawable(*colonizable)
            .any(|c| c.chance_of_ring > 0.0),
        BodyClass::Named(class) => match gd.planet_lists.get(class) {
            Some(list) => list.iter().any(|key| chance(key)),
            None => chance(class),
        },
        BodyClass::Star => false,
    }
}

fn merge(gd: &GameData, layouts: &[&Initializer]) -> PickSummary {
    let reaches: Vec<Reach> = layouts.iter().map(|init| reach(gd, init)).collect();
    let spanned = |pick: fn(&Reach) -> Span| Span {
        min: reaches.iter().map(|r| pick(r).min).min().unwrap_or(0),
        max: reaches.iter().map(|r| pick(r).max).max().unwrap_or(0),
    };
    let features = |pick: fn(&Reach) -> &Vec<String>, name: &dyn Fn(&str) -> String| {
        let mut keys: Vec<String> = Vec::new();
        for reach in &reaches {
            for key in pick(reach) {
                push(&mut keys, key);
            }
        }
        keys.into_iter()
            .map(|key| Feature {
                every: reaches.iter().all(|r| pick(r).contains(&key)),
                name: name(&key),
                key,
            })
            .collect::<Vec<Feature>>()
    };
    let presence = |has: fn(&Reach) -> bool| match reaches.iter().filter(|r| has(r)).count() {
        0 => Presence::Never,
        n if n == reaches.len() => Presence::Every,
        _ => Presence::SomeLayouts,
    };
    let loc = |key: &str| gd.loc.name_or_readable(key);
    let mut stars: Vec<String> = Vec::new();
    for reach in &reaches {
        for star in &reach.stars {
            push(&mut stars, star);
        }
    }
    let star_description = match stars.as_slice() {
        [only] => description(gd, only),
        _ => None,
    };
    PickSummary {
        star_classes: stars.iter().map(|key| named(gd, key)).collect(),
        star_description,
        planets: spanned(|r| r.planets),
        max_moons: reaches.iter().map(|r| r.max_moons).max().unwrap_or(0),
        moons: presence(|r| r.max_moons > 0),
        belts: spanned(|r| Span {
            min: r.belts,
            max: r.belts,
        }),
        belt_kinds: features(|r| &r.belt_kinds, &Localisation::readable),
        asteroids: spanned(|r| r.asteroids),
        named_bodies: features(|r| &r.named, &loc),
        notable_classes: features(|r| &r.notable, &loc),
        modifiers: features(|r| &r.modifiers, &loc),
        rings: presence(|r| r.rings),
        dlc: None,
        max_instances: None,
        in_galaxy: None,
    }
}

fn named(gd: &GameData, key: &str) -> Named {
    Named {
        key: key.to_owned(),
        name: gd.loc.name_or_readable(key),
    }
}

fn description(gd: &GameData, star_class: &str) -> Option<String> {
    gd.loc
        .get(&format!("{star_class}_desc"))
        .filter(|text| !text.is_empty())
}
