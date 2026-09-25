//! Scenario territories in two tiers: the systems whose initializer chains
//! hand the system to the same `event_target:` token at galaxy generation,
//! and the systems an `on_game_start` event claims for one before the
//! player's first frame.
//!
//! Generation wins: a system its chain already gave away is never claimed.

use std::collections::{BTreeMap, HashMap};

use sgf_core::projections::galaxy::CountryNode;
use sgf_core::projections::name::NameTemplate;

use crate::GameData;
use crate::initializers;
use crate::scripts::chain::Chain;
use crate::scripts::claims::{Claim, ClaimEffect, OwnerExpr};
use crate::scripts::facts::{self, FactsView, ScenarioFacts};
use crate::scripts::identity;
use crate::scripts::trigger::Facts;
use crate::scripts::view::{
    OwnerTier, ScenarioOwners, ScenarioSystem, ScriptRef, SystemColony, SystemOwner,
    TERRITORY_BASE, Territory, UnresolvedOwner,
};

impl<'a> From<FactsView<'a>> for Facts<'a> {
    fn from(view: FactsView<'a>) -> Self {
        Self {
            star_flags: view.star_flags,
            global_flags: view.global_flags,
            saved_targets: view.saved_targets,
            has_starbase: view.has_starbase,
        }
    }
}

/// One system of a territory, and how it came to be one.
#[derive(Debug)]
struct Member {
    system: u32,
    tier: OwnerTier,
    claimed_by: Option<String>,
    assumed: bool,
}

#[derive(Debug, Default)]
struct Group {
    members: Vec<Member>,
    capital: Option<u32>,
    capital_initializer: Option<String>,
    origin: Option<ScriptRef>,
}

impl Group {
    /// The earliest tier any member was claimed at.
    fn tier(&self) -> OwnerTier {
        if self.members.iter().any(|m| m.tier == OwnerTier::Generation) {
            OwnerTier::Generation
        } else {
            OwnerTier::DayOne
        }
    }

    /// The distinct day-one events that claimed members, in member order.
    fn claimed_by(&self) -> Vec<String> {
        let mut events: Vec<String> = Vec::new();
        for event in self.members.iter().filter_map(|m| m.claimed_by.as_ref()) {
            if !events.contains(event) {
                events.push(event.clone());
            }
        }
        events
    }
}

/// Every territory the scenario's systems describe, and which system belongs
/// to which.
pub fn scenario_owners(gd: &GameData, systems: &[ScenarioSystem<'_>]) -> ScenarioOwners {
    let facts = facts::scenario_facts(gd, systems);
    let mut groups: BTreeMap<String, Group> = BTreeMap::new();
    let mut unresolved = Vec::new();

    for system in systems {
        if !generation_owner(&facts, system, &mut groups, &mut unresolved) {
            claim(gd, &facts, system.id, &mut groups, &mut unresolved);
        }
    }

    let territories = territories(gd, &facts, &groups);
    let by_token: HashMap<&str, u32> = territories
        .iter()
        .map(|t| (t.token.as_str(), t.country.id))
        .collect();

    let mut owners: Vec<SystemOwner> = groups
        .values()
        .zip(&territories)
        .flat_map(|(group, territory)| {
            group.members.iter().map(|member| SystemOwner {
                system: member.system,
                territory: territory.country.id,
                tier: member.tier,
                claimed_by: member.claimed_by.clone(),
                assumed: member.assumed,
            })
        })
        .collect();
    owners.sort_by_key(|o| (o.system, o.territory));

    let count = |f: fn(&SystemOwner) -> bool| {
        u32::try_from(owners.iter().filter(|o| f(o)).count()).unwrap_or(u32::MAX)
    };
    ScenarioOwners {
        colonies: colonies(gd, systems, &by_token),
        day_one_systems: count(|o| o.tier == OwnerTier::DayOne),
        assumed_systems: count(|o| o.assumed),
        territories,
        owners,
        unresolved,
        with_game_data: true,
    }
}

/// The system's own chain and its statement's effect, in the order they run.
fn written<'f>(facts: &'f ScenarioFacts, system: &ScenarioSystem<'_>) -> Vec<&'f Chain> {
    system
        .initializer
        .and_then(|key| facts.chain(key))
        .into_iter()
        .chain(facts.effect(system.id))
        .collect()
}

/// Group the system under the token its chain gives it to, if any; `true`
/// when generation settled the matter and no claim may.
fn generation_owner(
    facts: &ScenarioFacts,
    system: &ScenarioSystem<'_>,
    groups: &mut BTreeMap<String, Group>,
    unresolved: &mut Vec<UnresolvedOwner>,
) -> bool {
    let chains = written(facts, system);
    for chain in &chains {
        for wrote in &chain.unresolved {
            unresolved.push(UnresolvedOwner {
                system: system.id,
                wrote: wrote.clone(),
            });
        }
    }
    // A system has one owner. A chain that names a second is a conflict
    // the user should see, not a system drawn in two territories.
    let mut tokens = chains.iter().flat_map(|c| c.owner_tokens.iter());
    let Some(token) = tokens.next() else {
        return false;
    };
    for extra in tokens {
        unresolved.push(UnresolvedOwner {
            system: system.id,
            wrote: format!("also set_owner = event_target:{extra}"),
        });
    }

    let group = groups.entry(token.clone()).or_default();
    group.members.push(Member {
        system: system.id,
        tier: OwnerTier::Generation,
        claimed_by: None,
        assumed: false,
    });
    if group.capital.is_none()
        && let Some(key) = system.initializer
        && let Some(chain) = facts.chain(key)
        && let Some((_, origin)) = chain.saved_targets.iter().find(|(t, _)| t == token)
    {
        group.capital = Some(system.id);
        group.capital_initializer = Some(key.to_owned());
        group.origin = Some(origin.clone());
    }
    true
}

/// The first day-one claim whose guard holds for this system takes it.
fn claim(
    gd: &GameData,
    facts: &ScenarioFacts,
    system: u32,
    groups: &mut BTreeMap<String, Group>,
    unresolved: &mut Vec<UnresolvedOwner>,
) {
    let Some(view) = facts.view(system) else {
        return;
    };
    let judged = Facts::from(view);
    for claim in gd.scripts.claims().for_flags(view.star_flags) {
        let verdict = claim.trigger.verdict(&judged);
        if !verdict.holds {
            continue;
        }
        match &claim.owner {
            OwnerExpr::Token(token) => {
                let group = groups.entry(token.clone()).or_default();
                group.members.push(Member {
                    system,
                    tier: OwnerTier::DayOne,
                    claimed_by: Some(claim.event.clone()),
                    assumed: verdict.assumed,
                });
            }
            OwnerExpr::Scope(text) | OwnerExpr::Unresolved(text) => {
                unresolved.push(UnresolvedOwner {
                    system,
                    wrote: wrote(claim, text),
                });
            }
        }
        return;
    }
}

/// The claim as the user would read it back in the event.
fn wrote(claim: &Claim, owner: &str) -> String {
    match claim.effect {
        ClaimEffect::SetOwner => format!("set_owner = {owner}"),
        ClaimEffect::Starbase => format!("create_starbase = {{ owner = {owner} }}"),
    }
}

fn territories(
    gd: &GameData,
    facts: &ScenarioFacts,
    groups: &BTreeMap<String, Group>,
) -> Vec<Territory> {
    groups
        .iter()
        .enumerate()
        .map(|(rank, (token, group))| {
            let capital_key = group.capital_initializer.as_deref();
            let identity = identity::resolve(
                gd,
                token,
                capital_key.and_then(|k| facts.chain(k)),
                capital_key,
            );
            Territory {
                token: token.clone(),
                identity: identity.kind,
                tier: group.tier(),
                assumed: group.members.iter().any(|m| m.assumed),
                claimed_by: group.claimed_by(),
                origin: group.origin.clone(),
                defined_at: identity.defined_at.clone(),
                country: CountryNode {
                    id: TERRITORY_BASE + u32::try_from(rank).unwrap_or(0),
                    name: NameTemplate::plain(&identity.name_key),
                    name_key: identity.name_key.clone(),
                    country_type: identity.country_type.clone(),
                    capital_system: group.capital,
                    system_count: u32::try_from(group.members.len()).unwrap_or(u32::MAX),
                    colors: identity.colors.clone(),
                    border_color: None,
                    fill_color: None,
                    flag_colors: Vec::new(),
                    use_map_color: false,
                    flag_icon: identity.icon.clone(),
                    flag_background: identity.background.clone(),
                    flags: Vec::new(),
                },
            }
        })
        .collect()
}

/// The bodies the scenario's initializers colonise, in the order
/// [`crate::details`] lists a system's planets.
fn colonies(
    gd: &GameData,
    systems: &[ScenarioSystem<'_>],
    by_token: &HashMap<&str, u32>,
) -> Vec<SystemColony> {
    let mut found = Vec::new();
    for system in systems {
        let Some(init) = system.initializer.and_then(|key| gd.initializers.get(key)) else {
            continue;
        };
        for (index, body) in initializers::expand(&init.planets).enumerate() {
            let Some(territory) = body
                .block
                .colony_owner
                .as_deref()
                .and_then(|token| by_token.get(token))
            else {
                continue;
            };
            found.push(SystemColony {
                system: system.id,
                planet_index: u32::try_from(index).unwrap_or(u32::MAX),
                territory: *territory,
            });
        }
    }
    found.sort_by_key(|c| (c.system, c.planet_index));
    found
}
