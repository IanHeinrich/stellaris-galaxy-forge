//! The planet features (`pm_*`) a new body can roll, by the install's own rules: each
//! feature's `potential` and `spawn_chance`, against the null feature's. How many times the
//! game draws for one body is the engine's to say, so only the first draw is weighed: the body
//! holds no feature yet.

use crate::GameData;
use crate::condition::{Condition, Subject};
use crate::deposit_roll::{Kind, RollBody};
use crate::registries::planet_classes::PlanetClassDef;
use crate::registries::planet_modifiers::PlanetModifierDef;
use crate::registries::scripted_triggers::ScriptedTriggers;

/// A new body as the first draw of its features judges it.
struct NewBody<'a> {
    body: &'a RollBody<'a>,
    class_def: Option<&'a PlanetClassDef>,
    triggers: &'a ScriptedTriggers,
}

impl Subject for NewBody<'_> {
    fn leaf(&self, leaf: &Condition) -> Option<bool> {
        let class = self.class_def;
        let body = self.body;
        match leaf {
            Condition::HostDlc(_) => Some(true),
            Condition::StarFlag(_) | Condition::Exists(_) => Some(false),
            Condition::PlanetClass(key) => Some(body.class == key),
            Condition::Climate(climate) => Some(class?.climate.as_deref() == Some(climate)),
            Condition::Star(want) | Condition::PrimaryStar(want) => {
                Some((body.kind == Kind::Star) == *want)
            }
            Condition::Moon(want) => Some((body.kind == Kind::Moon) == *want),
            Condition::Asteroid(want) => Some(class?.asteroid == *want),
            Condition::Colonizable(want) => Some(class?.colonizable == *want),
            Condition::Size(cmp, n) => Some(cmp.holds(f64::from(body.size), *n)),
            Condition::Modifiers(cmp, n) => Some(cmp.holds(0.0, *n)),
            Condition::Unknown(key) if key == "has_planet_modifier" => Some(false),
            _ => None,
        }
    }

    fn triggers(&self) -> Option<&ScriptedTriggers> {
        Some(self.triggers)
    }
}

/// Each feature the first draw for `body` can give it, in the install's order, with the
/// chance of that draw giving it: `None` when a condition of the draw is one the body's
/// class, size and kind do not settle. A feature whose `potential` surely fails, or whose
/// `spawn_chance` cannot be above zero, is left out.
pub(crate) fn first_draw<'a>(
    gd: &'a GameData,
    body: &RollBody<'_>,
) -> Vec<(&'a PlanetModifierDef, Option<f64>)> {
    let subject = NewBody {
        body,
        class_def: gd.planet_classes.get(body.class),
        triggers: &gd.scripted_triggers,
    };
    let possible = |pm: &PlanetModifierDef| {
        pm.potential
            .as_ref()
            .is_none_or(|p| p.evaluate(&subject) != Some(false))
            && pm.spawn_chance.could_be_positive(&subject)
    };
    let pool: Vec<&PlanetModifierDef> = gd
        .planet_modifiers
        .iter()
        .filter(|pm| !pm.is_null && possible(pm))
        .collect();
    let settled = |pm: &PlanetModifierDef| {
        let potential = match &pm.potential {
            None => Some(true),
            Some(p) => p.evaluate(&subject),
        }?;
        match potential {
            true => pm.spawn_chance.settled(&subject),
            false => Some(0.0),
        }
    };
    let weights: Option<Vec<f64>> = gd
        .planet_modifiers
        .iter()
        .filter(|pm| pm.is_null)
        .chain(pool.iter().copied())
        .map(settled)
        .collect();
    let total: Option<f64> = weights
        .as_ref()
        .map(|w| w.iter().map(|w| w.max(0.0)).sum())
        .filter(|total: &f64| *total > 0.0);
    pool.into_iter()
        .map(|pm| {
            let chance = total.and_then(|total| Some(settled(pm)?.max(0.0) / total));
            (pm, chance)
        })
        .collect()
}
