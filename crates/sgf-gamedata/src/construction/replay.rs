//! A type's build chain replayed against a save system: what an added row of the type
//! should bring with it there.

use std::collections::{BTreeMap, BTreeSet};

use sgf_core::ops::{
    ConstructionDeposit, ConstructionModifier, MegastructureConstruction, ModifierHost,
    TimedModifier, VariableStep,
};
use sgf_core::views::details::{ConstructionSite, SiteBody};

use super::{Construction, Effect, OWNER_EXISTS, Target, lasting};
use crate::GameData;
use crate::condition::{Condition, Subject};
use crate::install::walk::once;
use crate::registries::scripted_triggers::ScriptedTriggers;

/// What an added row of a type brings with it in one save system, and what of its
/// construction is not written there.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Built {
    pub construction: MegastructureConstruction,
    /// Each effect the replay could not tell applies, or where.
    pub unsure: Vec<String>,
    /// Each effect that applies but that the editor does not write: a modifier or deposit
    /// the construction removes, a deposit on the system, an owner variable lowered.
    pub unwritten: Vec<String>,
}

/// One body as a step's condition judges it, as the replay has left it so far.
struct Body<'a> {
    site: &'a SiteBody,
    /// Its class key, and what the install says of that class.
    class_key: String,
    class: Option<&'a crate::registries::planet_classes::PlanetClassDef>,
    deposits: Vec<String>,
    modifiers: Vec<String>,
    flags: Vec<String>,
    gd: &'a GameData,
    /// The structure has an owner.
    owned: bool,
}

impl Subject for Body<'_> {
    fn leaf(&self, leaf: &Condition) -> Option<bool> {
        let class = self.class;
        match leaf {
            Condition::PlanetClass(key) => Some(&self.class_key == key),
            Condition::Star(want) => Some(self.site.star == *want),
            Condition::Moon(want) => Some(self.site.moon == *want),
            Condition::Asteroid(want) => Some(class?.asteroid == *want),
            Condition::Colonizable(want) => Some(class?.colonizable == *want),
            Condition::HasDeposit(key) => Some(self.deposits.contains(key)),
            Condition::HasModifier(key) => Some(self.modifiers.contains(key)),
            Condition::PlanetFlag(key) => Some(self.flags.contains(key)),
            Condition::DepositFor(station) => Some(self.deposits.iter().any(|kind| {
                self.gd
                    .deposits
                    .get(kind)
                    .is_some_and(|d| d.station.as_deref() == Some(station))
            })),
            Condition::Exists(scope) if scope == OWNER_EXISTS => Some(self.owned),
            Condition::Call(name, want) => {
                let holds = match name.as_str() {
                    "is_astral_scar" => class?.astral_scar,
                    "is_artificial" => class?.artificial,
                    "is_ringworld" => class?.ringworld,
                    "is_colony" | "has_owner" => self.site.colony,
                    _ => return None,
                };
                Some(holds == *want)
            }
            _ => None,
        }
    }

    fn triggers(&self) -> Option<&ScriptedTriggers> {
        Some(&self.gd.scripted_triggers)
    }
}

impl Construction {
    /// Replay the chain against `site`, the structure built at body `host` (none for one at
    /// a point of its own) and owned when `has_owner`: the timed modifiers, deposits and
    /// owner variables it leaves that the system did not have, and what else it would
    /// change that is not written. The class and size changes of its planet are not made.
    pub fn replay(
        &self,
        gd: &GameData,
        site: &ConstructionSite,
        host: Option<u32>,
        has_owner: bool,
    ) -> Built {
        self.replay_as(gd, site, host, has_owner, false)
    }

    /// Replay the chain as [`Self::replay`] does, with the class changes of the structure's
    /// own planet made, so that what follows them sees the planet as they leave it.
    pub fn replay_changing_planet(
        &self,
        gd: &GameData,
        site: &ConstructionSite,
        host: Option<u32>,
        has_owner: bool,
    ) -> Built {
        self.replay_as(gd, site, host, has_owner, true)
    }

    fn replay_as(
        &self,
        gd: &GameData,
        site: &ConstructionSite,
        host: Option<u32>,
        has_owner: bool,
        changes_planet: bool,
    ) -> Built {
        let mut unwritten: Vec<String> = Vec::new();
        let mut unsure: Vec<String> = self
            .unfollowed
            .iter()
            .filter(|unfollowed| has_owner || !unfollowed.owned)
            .map(|unfollowed| unfollowed.what.clone())
            .collect();
        let mut bodies: Vec<Body<'_>> = site
            .bodies
            .iter()
            .map(|body| Body {
                site: body,
                class_key: body.class.clone(),
                class: gd.planet_classes.get(&body.class),
                deposits: body.deposits.clone(),
                modifiers: body.modifiers.clone(),
                flags: body.flags.clone(),
                gd,
                owned: has_owner,
            })
            .collect();
        let mut system_modifiers = site.modifiers.clone();
        let mut variables: BTreeMap<String, f64> = BTreeMap::new();
        let mut days: BTreeMap<(ModifierHost, String), i32> = BTreeMap::new();

        for step in self.steps.iter().filter(|step| has_owner || !step.owned) {
            match &step.on {
                Target::Owner => {
                    if let Effect::ChangeVariable { variable, by } = &step.effect {
                        *variables.entry(variable.clone()).or_default() += by;
                    }
                }
                Target::System => {
                    apply_modifier(
                        &mut system_modifiers,
                        &step.effect,
                        ModifierHost::System,
                        &mut days,
                    );
                    if matches!(
                        step.effect,
                        Effect::AddDeposit(_) | Effect::RemoveDeposit(_)
                    ) {
                        once(&mut unwritten, format!("{:?} on the system", step.effect));
                    }
                }
                Target::Host(guard) | Target::Planets(guard) => {
                    let only = match &step.on {
                        Target::Host(_) => match host {
                            Some(host) => Some(host),
                            None => continue,
                        },
                        _ => None,
                    };
                    for body in &mut bodies {
                        if only.is_some_and(|host| host != body.site.id) {
                            continue;
                        }
                        match guard.evaluate(&*body) {
                            Some(true) => {
                                if let (Target::Host(_), Effect::ChangeClass(class), true) =
                                    (&step.on, &step.effect, changes_planet)
                                {
                                    body.class_key = class.clone();
                                    body.class = gd.planet_classes.get(class);
                                }
                                apply(body, &step.effect, &mut days);
                            }
                            Some(false) => {}
                            None => {
                                let mut keys = BTreeSet::new();
                                guard.unknown_keys(&*body, &mut keys);
                                once(
                                    &mut unsure,
                                    format!(
                                        "{:?} on planet {}: cannot judge {}",
                                        step.effect,
                                        body.site.id,
                                        keys.into_iter().collect::<Vec<_>>().join(", ")
                                    ),
                                );
                            }
                        }
                    }
                }
            }
        }

        let mut built = MegastructureConstruction::default();
        added_modifiers(
            &site.modifiers,
            &system_modifiers,
            ModifierHost::System,
            &days,
            &mut built,
            &mut unwritten,
        );
        for body in &bodies {
            let host = ModifierHost::Body { body: body.site.id };
            added_modifiers(
                &body.site.modifiers,
                &body.modifiers,
                host,
                &days,
                &mut built,
                &mut unwritten,
            );
            let (gained, lost) = multiset_diff(&body.site.deposits, &body.deposits);
            for kind in gained {
                built.deposits.push(ConstructionDeposit {
                    body: body.site.id,
                    kind,
                });
            }
            for kind in lost {
                once(
                    &mut unwritten,
                    format!("removes deposit {kind} from planet {}", body.site.id),
                );
            }
        }
        for (variable, by) in variables {
            if by > 0.0 && by.fract() == 0.0 && by <= f64::from(u32::MAX) {
                built.variables.push(VariableStep {
                    variable,
                    by: by as u32,
                });
            } else if by != 0.0 {
                once(
                    &mut unwritten,
                    format!("changes owner variable {variable} by {by}"),
                );
            }
        }
        Built {
            construction: built,
            unsure,
            unwritten,
        }
    }
}

fn apply(body: &mut Body<'_>, effect: &Effect, days: &mut BTreeMap<(ModifierHost, String), i32>) {
    let host = ModifierHost::Body { body: body.site.id };
    apply_modifier(&mut body.modifiers, effect, host, days);
    match effect {
        Effect::AddDeposit(kind) => body.deposits.push(kind.clone()),
        Effect::RemoveDeposit(kind) => {
            if let Some(at) = body.deposits.iter().position(|d| d == kind) {
                body.deposits.remove(at);
            }
        }
        Effect::SetFlag(flag) if !body.flags.contains(flag) => body.flags.push(flag.clone()),
        Effect::RemoveFlag(flag) => body.flags.retain(|f| f != flag),
        _ => {}
    }
}

fn apply_modifier(
    modifiers: &mut Vec<String>,
    effect: &Effect,
    host: ModifierHost,
    days: &mut BTreeMap<(ModifierHost, String), i32>,
) {
    match effect {
        Effect::AddModifier {
            modifier,
            days: lasts,
        } => {
            if !modifiers.contains(modifier) {
                modifiers.push(modifier.clone());
            }
            days.insert((host, modifier.clone()), *lasts);
        }
        Effect::RemoveModifier(modifier) => modifiers.retain(|m| m != modifier),
        _ => {}
    }
}

fn added_modifiers(
    before: &[String],
    after: &[String],
    host: ModifierHost,
    days: &BTreeMap<(ModifierHost, String), i32>,
    built: &mut MegastructureConstruction,
    unwritten: &mut Vec<String>,
) {
    let on = match host {
        ModifierHost::System => "the system".to_owned(),
        ModifierHost::Body { body } => format!("planet {body}"),
    };
    for modifier in after.iter().filter(|m| !before.contains(m)) {
        let given = days.get(&(host, modifier.clone())).copied().unwrap_or(-1);
        let Some(lasts) = lasting(given) else {
            once(
                unwritten,
                format!(
                    "adds modifier {modifier} to {on} for {given} days, which Galaxy Forge does not write"
                ),
            );
            continue;
        };
        built.modifiers.push(ConstructionModifier {
            on: host,
            timed: TimedModifier {
                modifier: modifier.clone(),
                days: lasts,
            },
        });
    }
    for modifier in before.iter().filter(|m| !after.contains(m)) {
        once(unwritten, format!("removes modifier {modifier} from {on}"));
    }
}

/// What `after` has that `before` has not, and the other way round, counting repeats.
fn multiset_diff(before: &[String], after: &[String]) -> (Vec<String>, Vec<String>) {
    let mut lost: Vec<String> = before.to_vec();
    let mut gained = Vec::new();
    for item in after {
        match lost.iter().position(|b| b == item) {
            Some(at) => {
                lost.remove(at);
            }
            None => gained.push(item.clone()),
        }
    }
    (gained, lost)
}
