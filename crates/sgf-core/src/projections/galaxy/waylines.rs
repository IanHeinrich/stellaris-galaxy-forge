//! Waystations and the waylines between them, as the graph holds them.
//!
//! A document stores no wayline: the game derives one for each pair of waystations of the
//! same network whose systems a hyperlane or a bypass connects, so the graph derives them
//! the same way and recomputes them whenever the lanes change.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::projections::galaxy::{BypassLink, Galaxy};

/// One waystation: the starbase carrying it, the system it stands in and the network it
/// joins.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Waystation {
    pub system: u32,
    pub starbase: u32,
    pub network: u32,
}

/// One leg of a network: two waystation systems the galaxy connects, `a < b`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Wayline {
    pub a: u32,
    pub b: u32,
    pub network: u32,
}

/// Every pair of waystation systems of one network that [`connected`] joins, ascending
/// by network, then by each end.
pub(super) fn compute(galaxy: &Galaxy) -> Vec<Wayline> {
    let mut networks: BTreeMap<u32, BTreeSet<u32>> = BTreeMap::new();
    for station in &galaxy.waystations {
        networks
            .entry(station.network)
            .or_default()
            .insert(station.system);
    }
    let mut waylines = Vec::new();
    for (network, systems) in networks {
        let systems: Vec<u32> = systems.into_iter().collect();
        for (i, &a) in systems.iter().enumerate() {
            for &b in &systems[i + 1..] {
                if connected(galaxy, a, b) {
                    waylines.push(Wayline { a, b, network });
                }
            }
        }
    }
    waylines
}

/// Whether the game would run a wayline between two waystation systems: a hyperlane
/// either end lists, or a bypass between them.
fn connected(galaxy: &Galaxy, a: u32, b: u32) -> bool {
    a != b && (lane_between(galaxy, a, b) || bypass_between(galaxy, a, b))
}

fn lane_between(galaxy: &Galaxy, a: u32, b: u32) -> bool {
    let lane = |from: u32, to: u32| {
        galaxy
            .systems
            .get(&from)
            .is_some_and(|s| s.lanes.iter().any(|l| l.to == to))
    };
    lane(a, b) || lane(b, a)
}

/// Whether a bypass joins the two systems: a wormhole pair, or a gateway or an L-Gate in
/// both, each of those two being one network the whole galaxy shares. A wayline over
/// such a pair outlives the hyperlane between them.
pub(crate) fn bypass_between(galaxy: &Galaxy, a: u32, b: u32) -> bool {
    let mut gateway = (false, false);
    let mut lgate = (false, false);
    for link in &galaxy.bypasses {
        match *link {
            BypassLink::Wormhole { a: x, b: y } => {
                if (x == a && y == b) || (x == b && y == a) {
                    return true;
                }
            }
            BypassLink::Gateway { system, active } if active => {
                gateway.0 |= system == a;
                gateway.1 |= system == b;
            }
            BypassLink::LGate { system } => {
                lgate.0 |= system == a;
                lgate.1 |= system == b;
            }
            BypassLink::Gateway { .. } | BypassLink::Other { .. } => {}
        }
    }
    (gateway.0 && gateway.1) || (lgate.0 && lgate.1)
}
