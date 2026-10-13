//! The planet features (`pm_*`) a new body can roll, by the install's own rules: each
//! feature's `potential` and `spawn_chance`, against the null feature's. How many times the
//! game draws for one body is the engine's to say, so only the first draw is weighed: the body
//! holds no feature yet.

use crate::GameData;
use crate::condition::{Condition, Subject};
use crate::deposit_roll::{NewBody, RollBody};
use crate::registries::planet_modifiers::PlanetModifierDef;
use crate::registries::scripted_triggers::ScriptedTriggers;

/// A new body as the first draw of its features judges it. Whether its deposits, and the
/// modifiers the game hands a new body such as a terraforming candidate's, are in place
/// before its features are drawn is the engine's to say, so `has_deposit` and
/// `has_modifier` stay unsettled. It holds no planet feature yet.
struct FirstDraw<'a>(NewBody<'a>);

impl Subject for FirstDraw<'_> {
    fn leaf(&self, leaf: &Condition) -> Option<bool> {
        match leaf {
            Condition::HasDeposit(_) | Condition::HasModifier(_) => None,
            _ => self.0.leaf(leaf),
        }
    }

    fn triggers(&self) -> Option<&ScriptedTriggers> {
        self.0.triggers()
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
    let subject = FirstDraw(NewBody::new(gd, body, &[]));
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
