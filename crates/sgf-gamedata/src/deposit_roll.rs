//! The deposits a body the generator made would plausibly roll, by the install's own
//! rules: each deposit's `potential` and `drop_weight`, the draw counts in the defines,
//! and the galaxy's Resource Abundance.
//!
//! A star gets one draw that is never empty. Any other body the game cannot colonise gets
//! one draw, where `d_null_deposit` means none and every other weight is scaled by the
//! abundance. A habitable world draws as often as the `COLONY_DEPOSITS_*` defines say, is
//! topped up to their minimum, and then gets the minimum blockers and other deposits the
//! defines ask for, drawn only from the deposits flagged `use_for_min_max_adjustments`, as
//! the install's `99_README_DEPOSITS.txt` says. At abundance 0 nothing is rolled.

use crate::GameData;
use crate::condition::{Condition, Subject};
use crate::install::script::Def;
use crate::registries::deposits::DepositDef;
use crate::registries::planet_classes::PlanetClassDef;
use crate::registries::scripted_triggers::ScriptedTriggers;
use crate::rng::Rng;
use crate::weight::Weight;

/// What a habitable world's non-null weights are multiplied by, whatever the setting:
/// fitted to the saves, where habitable worlds roll the same from 0.25x to 5x.
const HABITABLE_FACTOR: f64 = 2.0;
/// What a new, unowned body in a new system has none of: flags, an origin, modifiers,
/// buildings, an owner, a `planet` or `solar_system` scope to ask, free districts.
const NEVER_ON_A_NEW_BODY: [&str; 9] = [
    "has_planet_flag",
    "has_origin",
    "has_modifier",
    "has_building",
    "exists",
    "owner",
    "planet",
    "solar_system",
    "num_free_districts",
];

/// A body the generator has made.
#[derive(Debug, Clone, Copy)]
pub struct RollBody<'a> {
    pub class: &'a str,
    pub size: u32,
    pub star: bool,
    pub moon: bool,
}

/// What the roll reads from a deposit definition.
#[derive(Debug, Clone, PartialEq)]
pub struct DepositRoll {
    /// `is_null = yes`: drawing it means the body gets nothing.
    pub is_null: bool,
    /// `use_for_min_max_adjustments = yes`: the top-ups to the minimum blockers and other
    /// deposits draw only these.
    pub for_minimums: bool,
    pub potential: Option<Condition>,
    pub drop_weight: Weight,
}

impl DepositRoll {
    pub(crate) fn read(def: &Def) -> Self {
        let src = &def.src;
        Self {
            is_null: def.flag("is_null"),
            for_minimums: def.flag("use_for_min_max_adjustments"),
            potential: def
                .node
                .find("potential", src)
                .map(|node| Condition::of_def(node, def)),
            drop_weight: def
                .node
                .find("drop_weight", src)
                .map_or_else(|| Weight::fixed(1.0), |node| Weight::read(node, def, 1.0)),
        }
    }
}

/// A body the generator has just made, as a deposit's `potential` and `drop_weight` judge
/// it: unowned, in no nebula, primary when it is a star.
pub struct NewBody<'a> {
    pub body: &'a RollBody<'a>,
    /// `None` for a class the install does not define.
    pub class_def: Option<&'a PlanetClassDef>,
    /// The deposits already drawn for it.
    pub deposits: &'a [String],
    pub triggers: &'a ScriptedTriggers,
}

impl<'a> NewBody<'a> {
    pub fn new(gd: &'a GameData, body: &'a RollBody<'a>, deposits: &'a [String]) -> Self {
        Self {
            body,
            class_def: gd.planet_classes.get(body.class),
            deposits,
            triggers: &gd.scripted_triggers,
        }
    }
}

impl Subject for NewBody<'_> {
    fn leaf(&self, leaf: &Condition) -> Option<bool> {
        let class = self.class_def;
        let body = self.body;
        match leaf {
            Condition::HostDlc(_) => Some(true),
            Condition::StarFlag(_) | Condition::Exists(_) => Some(false),
            Condition::InsideNebula(want) => Some(!want),
            Condition::PlanetClass(key) => Some(body.class == key),
            Condition::Climate(climate) => Some(class?.climate.as_deref() == Some(climate)),
            Condition::Star(want) | Condition::PrimaryStar(want) => Some(body.star == *want),
            Condition::Moon(want) => Some(body.moon == *want),
            Condition::Asteroid(want) => Some(class?.asteroid == *want),
            Condition::Colonizable(want) => Some(class?.colonizable == *want),
            Condition::Size(cmp, n) => Some(cmp.holds(f64::from(body.size), *n)),
            Condition::HasDeposit(key) => Some(self.deposits.iter().any(|d| d == key)),
            Condition::Unknown(key) if NEVER_ON_A_NEW_BODY.contains(&key.as_str()) => Some(false),
            _ => None,
        }
    }

    fn triggers(&self) -> Option<&ScriptedTriggers> {
        Some(self.triggers)
    }
}

/// The deposit keys `body` rolls at `abundance`, the save's `galaxy.resource_abundance`
/// ([`crate::registries::defines::DepositDefines::abundance`] gives the fallback).
/// The same stream gives the same deposits.
pub fn roll_deposits(
    gd: &GameData,
    body: &RollBody<'_>,
    abundance: f64,
    rng: &mut Rng,
) -> Vec<String> {
    roll(gd, body, abundance, rng, true)
}

/// As [`roll_deposits`], for a body its layout writes `deposit_blockers = none`: no
/// blocker is drawn, and the minimum blockers are not topped up.
pub(crate) fn roll_deposits_without_blockers(
    gd: &GameData,
    body: &RollBody<'_>,
    abundance: f64,
    rng: &mut Rng,
) -> Vec<String> {
    roll(gd, body, abundance, rng, false)
}

fn roll(
    gd: &GameData,
    body: &RollBody<'_>,
    abundance: f64,
    rng: &mut Rng,
    blockers: bool,
) -> Vec<String> {
    if abundance <= 0.0 {
        return Vec::new();
    }
    let class_def = gd.planet_classes.get(body.class);
    let colonizable = !body.star && class_def.is_some_and(|c| c.colonizable);
    let defines = &gd.deposit_defines;
    let size = f64::from(body.size);
    let mut roll = Roll {
        gd,
        body,
        class_def,
        colonizable,
        factor: if colonizable {
            HABITABLE_FACTOR
        } else {
            abundance
        },
        blockers,
        have: Vec::new(),
        rng,
    };

    if body.star {
        roll.draw(false, Part::Any);
    } else if colonizable {
        for _ in 0..defines.colony.draws(size) {
            roll.draw(true, Part::Any);
        }
        while roll.have.len() < defines.colony.minimum(size) && roll.draw(false, Part::Any) {}
        while (roll.count(true) as f64) < defines.min_blocked && roll.draw(false, Part::Blockers) {}
        while (roll.count(false) as f64) < defines.min_unblocked && roll.draw(false, Part::Others) {
        }
    } else {
        let null = abundance < defines.abundance_max;
        for _ in 0..defines.non_colony.draws(size) {
            roll.draw(null, Part::Any);
        }
    }
    roll.have
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Part {
    Any,
    Blockers,
    Others,
}

struct Roll<'a> {
    gd: &'a GameData,
    body: &'a RollBody<'a>,
    class_def: Option<&'a PlanetClassDef>,
    colonizable: bool,
    factor: f64,
    /// Blockers may be drawn.
    blockers: bool,
    have: Vec<String>,
    rng: &'a mut Rng,
}

impl<'a> Roll<'a> {
    /// Draw once from the pool; `false` when the pool was empty.
    fn draw(&mut self, null: bool, part: Part) -> bool {
        let pool = self.pool(null, part);
        let Some(deposit) = self.rng.weighted(&pool) else {
            return false;
        };
        if !deposit.roll.is_null {
            self.have.push(deposit.key.clone());
        }
        true
    }

    fn pool(&self, null: bool, part: Part) -> Vec<(&'a DepositDef, f64)> {
        let gd: &'a GameData = self.gd;
        let subject = NewBody {
            body: self.body,
            class_def: self.class_def,
            deposits: &self.have,
            triggers: &gd.scripted_triggers,
        };
        gd.deposits
            .iter()
            .filter(|d| match d.roll.is_null {
                true => null,
                false => d.is_for_colonizable == self.colonizable,
            })
            .filter(|d| self.blockers || !self.gd.is_blocker(&d.key))
            .filter(|d| match part {
                Part::Any => true,
                Part::Blockers => {
                    d.roll.for_minimums && !d.roll.is_null && self.gd.is_blocker(&d.key)
                }
                Part::Others => {
                    d.roll.for_minimums && !d.roll.is_null && !self.gd.is_blocker(&d.key)
                }
            })
            .filter(|d| {
                d.roll
                    .potential
                    .as_ref()
                    .is_none_or(|p| p.evaluate(&subject) == Some(true))
            })
            .filter_map(|d| {
                let weight = d.roll.drop_weight.evaluate(&subject);
                let weight = if d.roll.is_null {
                    weight
                } else {
                    weight * self.factor
                };
                (weight > 0.0).then_some((d, weight))
            })
            .collect()
    }

    /// The deposits drawn so far that are blockers, or that are not.
    fn count(&self, blockers: bool) -> usize {
        self.have
            .iter()
            .filter(|key| self.gd.deposits.get(key).is_some())
            .filter(|key| self.gd.is_blocker(key) == blockers)
            .count()
    }
}
