//! The bypasses a scenario's systems carry before the player's first frame:
//! the wormholes and gateways each system's own initializer spawns, and the
//! ones the `on_game_start` events place on whichever systems their guards
//! pick out.
//!
//! A wormhole is written once per endpoint, both ends carrying the other's
//! system. What the game places wherever it likes is counted, never drawn.

use std::collections::{BTreeMap, HashMap};
use std::mem::{self, Discriminant};

use sgf_core::projections::galaxy::BypassLink;

use crate::GameData;
use crate::initializers::PartnerRef;
use crate::scripts::claims::PartnerExpr;
use crate::scripts::facts::{self, ScenarioFacts};
use crate::scripts::trigger::{Facts, Trigger};
use crate::scripts::view::{
    BypassKind, BypassSource, ScenarioBypass, ScenarioBypasses, ScenarioSystem,
};

/// The far end an endpoint is still waiting for, and the endpoint it may be
/// paired with: the other end of its own spawn, never a bypass that merely
/// happens to sit on the right system.
enum Pending {
    /// The endpoint the same event spawned where this guard holds.
    Guard { trigger: Trigger, event: String },
    /// The endpoint on the system whose chain saved this token.
    Token(String),
}

/// The group an endpoint can pair within: endpoints of a different shape, or
/// written by a different script, never join. [`BypassKind`] is a wire type
/// and carries no `Hash`, so the group holds its discriminant and the exact
/// kind is compared when a candidate is judged.
type PairGroup = (Discriminant<BypassKind>, Option<String>);

/// The group of the endpoints `bypass` may pair with, which is its own.
fn group_of(bypass: &ScenarioBypass) -> PairGroup {
    (
        mem::discriminant(&bypass.kind),
        match &bypass.source {
            BypassSource::DayOne { event } => Some(event.clone()),
            BypassSource::Initializer { .. } => None,
        },
    )
}

impl Pending {
    /// The group the far end of a `kind` endpoint this is waiting on sits in.
    fn group(&self, kind: &BypassKind) -> PairGroup {
        (
            mem::discriminant(kind),
            match self {
                Self::Guard { event, .. } => Some(event.clone()),
                Self::Token(_) => None,
            },
        )
    }

    /// Whether `system` is the far end, and whether saying so rests on a
    /// condition this editor cannot judge.
    fn holds(
        &self,
        facts: &ScenarioFacts,
        initializers: &HashMap<u32, &str>,
        system: u32,
    ) -> Option<bool> {
        match self {
            Self::Guard { trigger, .. } => {
                let verdict = trigger.evaluate(&Facts::from(facts.view(system)?));
                verdict.holds.then_some(verdict.assumed)
            }
            Self::Token(token) => facts
                .chain(initializers.get(&system)?)?
                .saved_targets
                .iter()
                .any(|(saved, _)| saved == token)
                .then_some(false),
        }
    }
}

pub fn scenario_bypasses(gd: &GameData, systems: &[ScenarioSystem<'_>]) -> ScenarioBypasses {
    let facts = facts::scenario_facts(gd, systems);
    let initializers: HashMap<u32, &str> = systems
        .iter()
        .filter_map(|s| Some((s.id, s.initializer?)))
        .collect();

    let mut found: Vec<ScenarioBypass> = Vec::new();
    let mut pending: Vec<(usize, Pending)> = Vec::new();
    // Endpoints with a far end somewhere, drawn or not.
    let mut linked: Vec<usize> = Vec::new();
    let mut random_wormhole_pairs = 0;
    let mut random_gateways = 0;

    for system in systems {
        let Some(init) = system.initializer.and_then(|key| gd.initializers.get(key)) else {
            continue;
        };
        random_wormhole_pairs += init.bypasses.random_wormhole_pairs;
        random_gateways += init.bypasses.random_gateways;
        for bypass in &init.bypasses.own {
            let source = BypassSource::Initializer {
                key: init.name.clone(),
            };
            let at = push(&mut found, system.id, bypass.kind.clone(), source, false);
            match &bypass.partner {
                PartnerRef::None => {}
                PartnerRef::Random => linked.push(at),
                PartnerRef::Saved(token) => {
                    linked.push(at);
                    pending.push((at, Pending::Token(token.clone())));
                }
            }
        }
    }

    // The day-one placements are gathered by placement, not by system: one
    // whose guard fits several systems says which loop wrote it.
    let placements = gd.scripts.claims().placements();
    let mut matched: BTreeMap<usize, Vec<(u32, bool)>> = BTreeMap::new();
    for system in systems {
        let Some(view) = facts.view(system.id) else {
            continue;
        };
        let judged = Facts::from(view);
        for placement in placements.for_flags(view.star_flags) {
            let verdict = placement.trigger.evaluate(&judged);
            if verdict.holds {
                matched
                    .entry(placement.order)
                    .or_default()
                    .push((system.id, verdict.assumed));
            }
        }
    }
    for (order, picks) in &matched {
        let placement = &placements.all()[*order];
        // A `random_system` spawns on one of the systems its guard fits and
        // this reader cannot say which, so every one of them is a guess.
        let guessing = picks.len() > 1 && !placement.every;
        for (system, assumed) in picks {
            let source = BypassSource::DayOne {
                event: placement.event.clone(),
            };
            let at = push(
                &mut found,
                *system,
                placement.kind.clone(),
                source,
                *assumed || guessing,
            );
            match &placement.partner {
                PartnerExpr::None => {}
                PartnerExpr::Random => linked.push(at),
                PartnerExpr::Guarded { trigger, .. } => {
                    linked.push(at);
                    pending.push((
                        at,
                        Pending::Guard {
                            trigger: trigger.clone(),
                            event: placement.event.clone(),
                        },
                    ));
                }
            }
        }
    }

    // An `every_system` spawns on each system of the galaxy, and the
    // scenario's own systems are the galaxy this can count. A spawn a scope
    // moved somewhere this reader cannot follow is one wherever it landed.
    let galaxy = u32::try_from(systems.len()).unwrap_or(u32::MAX);
    for placement in placements.random() {
        match placement.kind.is_wormhole() {
            false if placement.every && placement.sited => random_gateways += galaxy,
            false => random_gateways += 1,
            true if placement.partner == PartnerExpr::Random => random_wormhole_pairs += 1,
            true => {}
        }
    }

    let mut groups: HashMap<PairGroup, Vec<usize>> = HashMap::new();
    for (at, bypass) in found.iter().enumerate() {
        groups.entry(group_of(bypass)).or_default().push(at);
    }

    for (at, want) in &pending {
        if found[*at].partner.is_some() {
            continue;
        }
        let system = found[*at].system;
        let kind = found[*at].kind.clone();
        let candidates = groups
            .get(&want.group(&kind))
            .map_or(&[][..], Vec::as_slice);
        let far = candidates.iter().find_map(|&other| {
            let bypass = &found[other];
            let open = other != *at
                && bypass.system != system
                && bypass.partner.is_none()
                && bypass.kind == kind;
            open.then(|| want.holds(&facts, &initializers, bypass.system))
                .flatten()
                .map(|assumed| (other, assumed))
        });
        let Some((other, assumed)) = far else {
            continue;
        };
        found[*at].partner = Some(found[other].system);
        found[*at].assumed |= assumed;
        found[other].partner = Some(system);
        found[other].assumed |= assumed;
    }

    let open = linked.iter().filter(|at| found[**at].partner.is_none());
    let open_endpoints = u32::try_from(open.count()).unwrap_or(u32::MAX);
    found.sort_by_key(|bypass| bypass.system);
    ScenarioBypasses {
        bypasses: found,
        open_endpoints,
        random_wormhole_pairs,
        random_gateways,
        with_game_data: true,
    }
}

/// The event of Paint a Galaxy's companion mod that joins the pairs its star flags name.
const PAINTED_WORMHOLE_EVENT: &str = "painted_galaxy_wormhole.1";

/// Both ends of every flagged pair the scripts did not already draw, as day-one
/// endpoints of the mod's event, kept in system order.
pub fn add_flagged_pairs(bypasses: &mut ScenarioBypasses, links: &[BypassLink]) {
    for link in links {
        let BypassLink::Wormhole { a, b } = link else {
            continue;
        };
        let drawn = bypasses.bypasses.iter().any(|end| {
            end.kind == BypassKind::Wormhole && end.system == *a && end.partner == Some(*b)
        });
        if drawn {
            continue;
        }
        for (system, partner) in [(*a, *b), (*b, *a)] {
            bypasses.bypasses.push(ScenarioBypass {
                system,
                kind: BypassKind::Wormhole,
                partner: Some(partner),
                source: BypassSource::DayOne {
                    event: PAINTED_WORMHOLE_EVENT.to_owned(),
                },
                assumed: false,
            });
        }
    }
    bypasses.bypasses.sort_by_key(|end| end.system);
}

fn push(
    found: &mut Vec<ScenarioBypass>,
    system: u32,
    kind: BypassKind,
    source: BypassSource,
    assumed: bool,
) -> usize {
    found.push(ScenarioBypass {
        system,
        kind,
        partner: None,
        source,
        assumed,
    });
    found.len() - 1
}
