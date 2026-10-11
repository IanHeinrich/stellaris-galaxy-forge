//! Scenario territories in two tiers: the systems whose initializer chains
//! hand the system to the same `event_target:` token at galaxy generation,
//! and the systems an `on_game_start` event claims for one before the
//! player's first frame.
//!
//! Generation wins: a system its chain already gave away is never claimed.
//! A fallen empire's home and the systems its chain spawns are given away at
//! generation too, to the country the game creates there.

use std::collections::{BTreeMap, HashMap, HashSet};

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

    let free: Vec<&ScenarioSystem<'_>> = systems
        .iter()
        .filter(|system| !generation_owner(&facts, system, &mut groups, &mut unresolved))
        .collect();
    let fallen = fallen_empires(gd, &facts, &free, &mut groups);
    unresolved.retain(|u| !(fallen.contains(&u.system) && names_root(&u.wrote)));
    for system in free.iter().filter(|s| !fallen.contains(&s.id)) {
        claim(gd, &facts, system.id, &mut groups, &mut unresolved);
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

/// How many spawns deep a fallen empire's chain is followed, as far as
/// [`Chain::spawned`] follows one.
const SPAWN_DEPTH: usize = 4;

/// How much farther than its spawns' distances allow a member may stand.
const REACH_SLACK: f64 = 1.25;

/// Give each fallen empire its home system, under a token of its own, and the
/// systems its chain spawns that plant a starbase or set an owner there: the
/// game creates the country in the home system, and `root` in its chain is
/// that country. A member stands within the distances the spawns write, and a
/// system two homes spawn goes to the nearer. Returns every system given away.
fn fallen_empires(
    gd: &GameData,
    facts: &ScenarioFacts,
    free: &[&ScenarioSystem<'_>],
    groups: &mut BTreeMap<String, Group>,
) -> HashSet<u32> {
    let capitals: Vec<(&ScenarioSystem<'_>, &str)> = free
        .iter()
        .filter_map(|system| {
            let key = system.initializer?;
            gd.scripts.fallen_empire(key)?;
            Some((*system, key))
        })
        .collect();
    let mut reaches: HashMap<&str, HashMap<&str, f64>> = HashMap::new();
    let mut taken = HashSet::new();
    for (capital, key) in &capitals {
        let group = groups.entry(fallen_token(key, capital.id)).or_default();
        group.members.push(generation_member(capital.id));
        group.capital = Some(capital.id);
        group.capital_initializer = Some((*key).to_owned());
        taken.insert(capital.id);
        reaches.entry(key).or_insert_with(|| spawn_reaches(gd, key));
    }
    for system in free {
        if taken.contains(&system.id) {
            continue;
        }
        let Some(key) = system.initializer else {
            continue;
        };
        if !facts.chain(key).is_some_and(builds_for_root) {
            continue;
        }
        let nearest = capitals
            .iter()
            .filter(|(capital, home)| {
                reaches[home]
                    .get(key)
                    .is_some_and(|reach| within(system, capital, reach * REACH_SLACK))
            })
            .min_by(|(a, _), (b, _)| {
                let far = |c| distance(system, c).unwrap_or(f64::INFINITY);
                far(a).total_cmp(&far(b)).then(a.id.cmp(&b.id))
            });
        if let Some((capital, home)) = nearest {
            let group = groups.entry(fallen_token(home, capital.id)).or_default();
            group.members.push(generation_member(system.id));
            taken.insert(system.id);
        }
    }
    taken
}

/// Every initializer `home` spawns within [`SPAWN_DEPTH`] spawns, with the
/// farthest it may land from the home system: the least sum of the spawns'
/// distances on the way, infinite where a spawn on it writes none.
fn spawn_reaches<'g>(gd: &'g GameData, home: &str) -> HashMap<&'g str, f64> {
    let mut best: HashMap<&str, f64> = HashMap::new();
    let mut frontier: Vec<(&str, f64)> = vec![(home, 0.0)];
    for _ in 0..SPAWN_DEPTH {
        let mut next = Vec::new();
        for (from, so_far) in frontier {
            let Some(init) = gd.initializers.get(from) else {
                continue;
            };
            for (child, step) in &init.spawn_reach {
                let total = so_far + step.unwrap_or(f64::INFINITY);
                if child != home && best.get(child.as_str()).is_none_or(|known| total < *known) {
                    best.insert(child, total);
                    next.push((child.as_str(), total));
                }
            }
        }
        frontier = next;
    }
    best
}

/// A fallen empire's territory key: its home's initializer and system, so two
/// fallen empires of one kind stay two.
fn fallen_token(initializer: &str, capital: u32) -> String {
    format!("root:{initializer}:{capital}")
}

fn generation_member(system: u32) -> Member {
    Member {
        system,
        tier: OwnerTier::Generation,
        claimed_by: None,
        assumed: false,
    }
}

/// The chain builds something in the system for whoever spawned it: a
/// starbase of no one else's, or an owner set through `root`.
fn builds_for_root(chain: &Chain) -> bool {
    chain.root_starbase || chain.unresolved.iter().any(|wrote| names_root(wrote))
}

fn names_root(wrote: &str) -> bool {
    wrote.eq_ignore_ascii_case("set_owner = root")
}

/// How far apart two systems stand; `None` when either has no place.
fn distance(a: &ScenarioSystem<'_>, b: &ScenarioSystem<'_>) -> Option<f64> {
    let ((ax, ay), (bx, by)) = (a.at?, b.at?);
    Some((ax - bx).hypot(ay - by))
}

/// Whether `a` stands within `reach` of `b`; a system with no place is taken at its word.
fn within(a: &ScenarioSystem<'_>, b: &ScenarioSystem<'_>, reach: f64) -> bool {
    distance(a, b).is_none_or(|d| d <= reach)
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
                    use_map_color: false,
                    painted_border: identity.colors.first().cloned(),
                    painted_fill: identity.colors.get(1).or(identity.colors.first()).cloned(),
                    has_map_colors: Some(false),
                    flag_icon: identity.icon.clone(),
                    flag_background: identity.background.clone(),
                    preftl_age: None,
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
