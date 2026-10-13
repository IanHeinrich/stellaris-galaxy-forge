//! The dialect a scenario is written in, and every question whose answer depends on it:
//! one method each, so a new dialect is one variant and one arm per method in this file.
//! Prepare matches on no dialect itself. The export keeps two matches, in `scenario_text`
//! and `new_scenario`, because each arm calls a writer only the export has: the plain home
//! system effect or Paint a Galaxy's decoration, and each dialect's header.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::format::scenario::paint::{
    RL_BASIC, SOL_INITIALIZER, is_painted, random_empire_start, random_empire_start_at,
};
use crate::format::scenario::{is_seat_initializer, seat_initializer, seat_initializer_at};
use crate::ops::Op;
use crate::projections::galaxy::{PaintSpawnKind, SpawnScript, SystemNode};
use crate::session::Session;

/// What the game's random empire starts are named with.
const RANDOM_EMPIRE_START_PREFIX: &str = "random_empire_init_";

/// Whose conventions a written scenario follows. `Plain` is the game's alone; the
/// other writes what a companion mod reads on top of it, and the map then needs
/// that mod.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ScenarioProfile {
    #[default]
    Plain,
    /// Spawn points in Paint a Galaxy's scripted shape and a header sized for its
    /// mod's fixes (Steam Workshop 3532904115).
    PaintAGalaxy,
}

/// The dialect an open scenario is written in: Paint a Galaxy's once the file carries its
/// names or Forge's header for it, as the app reads it on open.
pub fn of(session: &Session) -> ScenarioProfile {
    match is_painted(session.doc().original()) {
        true => ScenarioProfile::PaintAGalaxy,
        false => ScenarioProfile::Plain,
    }
}

impl ScenarioProfile {
    pub const ALL: [Self; 2] = [Self::Plain, Self::PaintAGalaxy];

    /// What the profile gives a seat whose home it replaces, in the player's words.
    pub const fn seat_start(self) -> &'static str {
        match self {
            Self::Plain => "an ordinary system",
            Self::PaintAGalaxy => "a generic start",
        }
    }

    /// The initializer Generic start, and an export, writes on seat `system`: one of the
    /// game's ordinary systems on a plain map, and one of its random empire starts for
    /// Paint a Galaxy, whose homeworld fix runs only on the flag such a start sets.
    pub fn generic_start(self, system: u32) -> &'static str {
        match self {
            Self::Plain => seat_initializer(system),
            Self::PaintAGalaxy => random_empire_start(system),
        }
    }

    /// One of the same starts, the one `unit`, in `[0, 1)`, falls on.
    pub(crate) fn generic_start_at(self, unit: f64) -> &'static str {
        match self {
            Self::Plain => seat_initializer_at(unit),
            Self::PaintAGalaxy => random_empire_start_at(unit),
        }
    }

    /// Whether `initializer` is one of the starts [`Self::generic_start`] writes, told by
    /// name.
    pub fn is_generic_start(self, initializer: &str) -> bool {
        match self {
            Self::Plain => is_seat_initializer(initializer),
            Self::PaintAGalaxy => is_random_empire_start(initializer),
        }
    }

    /// Whether the dialect fits any of the game's random empire starts to the empire that
    /// takes it, as Paint a Galaxy's homeworld fix does. Without that fix a random start
    /// builds the homeworld before the game knows the species, so it is a home to replace.
    pub const fn fixes_homeworlds(self) -> bool {
        match self {
            Self::Plain => false,
            Self::PaintAGalaxy => true,
        }
    }

    /// Whether the profile writes the home system effect on a seat it gives one of the
    /// game's ordinary systems: a plain map does, and Paint a Galaxy's random empire
    /// starts set what they need themselves.
    pub const fn writes_home_system(self) -> bool {
        match self {
            Self::Plain => true,
            Self::PaintAGalaxy => false,
        }
    }

    /// The layout Plain system writes without a draw: Paint a Galaxy's random list. A plain
    /// map has none and draws from the install's ordinary layouts.
    pub const fn plain_layout(self) -> Option<&'static str> {
        match self {
            Self::Plain => None,
            Self::PaintAGalaxy => Some(RL_BASIC),
        }
    }

    /// Whether the dialect states fallen empire zones.
    pub const fn states_zones(self) -> bool {
        match self {
            Self::Plain => false,
            Self::PaintAGalaxy => true,
        }
    }

    /// Whether the header's maxes equal what the map holds, as Paint a Galaxy sizes them
    /// and the Issues tab checks, rather than only staying within it.
    pub const fn exact_maxes(self) -> bool {
        match self {
            Self::Plain => false,
            Self::PaintAGalaxy => true,
        }
    }

    /// The seat UNE seat writes: Paint a Galaxy's Sol seat, which only the United Nations
    /// of Earth weighs above zero, with no player's marker. A plain file has none.
    pub fn sol_seat(self) -> Option<SpawnScript> {
        match self {
            Self::Plain => None,
            Self::PaintAGalaxy => Some(SpawnScript::PaintAGalaxy {
                kind: PaintSpawnKind::Sol,
                random_value: 0,
                player: false,
            }),
        }
    }

    /// The op that seats `system` as `old` was seated: a plain file states a weight, and
    /// Paint a Galaxy a script or a weight. The Sol seat is not carried: it means Sol, so it
    /// becomes an enabled seat.
    pub fn seated(self, system: u32, old: &SystemNode) -> Option<Op> {
        let weight = old.spawn_weight.map(|base| Op::SetSpawnWeight {
            system,
            base: Some(base),
        });
        match self {
            Self::Plain => weight,
            Self::PaintAGalaxy => match &old.spawn_script {
                Some(script) => Some(Op::SetSpawnScript {
                    system,
                    script: Some(without_sol(script)),
                }),
                None => weight,
            },
        }
    }

    /// The op that takes a seat away: a plain file states a weight, and Paint a Galaxy a
    /// script, taken whole, or a weight.
    pub fn unseated(self, node: &SystemNode) -> Option<Op> {
        let system = node.id;
        let weight = node
            .spawn_weight
            .map(|_| Op::SetSpawnWeight { system, base: None });
        match self {
            Self::Plain => weight,
            Self::PaintAGalaxy => match node.spawn_script {
                Some(_) => Some(Op::SetSpawnScript {
                    system,
                    script: None,
                }),
                None => weight,
            },
        }
    }

    /// The op that makes the Sol seat on `node` an enabled seat, once its Sol initializer
    /// goes; none when it holds no Sol seat. A plain file has none.
    pub fn without_sol_seat(self, node: &SystemNode) -> Option<Op> {
        match self {
            Self::Plain => None,
            Self::PaintAGalaxy => {
                let script = node.spawn_script.as_ref()?;
                let enabled = without_sol(script);
                (enabled != *script).then_some(Op::SetSpawnScript {
                    system: node.id,
                    script: Some(enabled),
                })
            }
        }
    }

    /// The ops that take the fallen empire zone on `node` away: the custom connections into
    /// it, then the zone. `None` where the dialect states a fallen empire by its initializer
    /// alone, as a plain file does and Paint a Galaxy does outside a zone.
    pub fn without_zone(self, node: &SystemNode) -> Option<Vec<Op>> {
        match self {
            Self::Plain => None,
            Self::PaintAGalaxy => {
                node.fe_zone.as_ref()?;
                let links = node.fe_link.custom || node.fe_link.id.is_some();
                let unlinked = links.then(|| Op::SetFeLinks {
                    anchor: node.id,
                    linked: Vec::new(),
                });
                let zone = Op::SetFeZone {
                    system: node.id,
                    zone: None,
                };
                Some(unlinked.into_iter().chain([zone]).collect())
            }
        }
    }

    /// One op per pair number the systems carry: both ends of a pair unpaired together, and
    /// a number on one system or on three taken off each. A plain file states no pairs.
    pub fn unpaired(self, nodes: &[&SystemNode]) -> Vec<Op> {
        match self {
            Self::Plain => Vec::new(),
            Self::PaintAGalaxy => {
                let mut ends: std::collections::BTreeMap<u32, Vec<u32>> =
                    std::collections::BTreeMap::new();
                for node in nodes {
                    if let Some(pair) = node.wormhole_pair {
                        ends.entry(pair).or_default().push(node.id);
                    }
                }
                ends.into_values()
                    .map(|ids| match ids[..] {
                        [a, b] => Op::SetWormholePair { a, b, pair: None },
                        _ => Op::SetWormholeEnds {
                            entries: ids.into_iter().map(|id| (id, None)).collect(),
                        },
                    })
                    .collect()
            }
        }
    }
}

/// `script` with a Sol seat made an enabled one, which carries no player's marker.
fn without_sol(script: &SpawnScript) -> SpawnScript {
    match script {
        SpawnScript::PaintAGalaxy {
            kind: PaintSpawnKind::Sol,
            random_value,
            ..
        } => SpawnScript::PaintAGalaxy {
            kind: PaintSpawnKind::Enabled,
            random_value: *random_value,
            player: false,
        },
        script => script.clone(),
    }
}

/// One of the game's random empire starts.
pub fn is_random_empire_start(initializer: &str) -> bool {
    initializer.starts_with(RANDOM_EMPIRE_START_PREFIX)
}

/// A seat's initializer that needs no look under `profile`: the start that profile writes
/// on a seat, or Sol. Any other home may only fit the empire that started there. On a
/// plain map a random empire start is a home to replace, because it builds the homeworld
/// before the game knows the species; Paint a Galaxy's homeworld fix puts that right.
pub fn is_generic_home(profile: ScenarioProfile, initializer: &str) -> bool {
    initializer.starts_with(SOL_INITIALIZER) || profile.is_generic_start(initializer)
}
