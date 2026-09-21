//! Where the game itself puts things at galaxy generation, so a map author can keep
//! clear of them.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The circle the L-Cluster lands in: `(x, y, radius)`. `distar.11000` spawns the
/// first L-Cluster system 550–560 from the core at 44–46° for every galaxy size and
/// chains the rest up to about 90 away, so a system inside this circle sits where the
/// game builds one.
pub const L_CLUSTER: (f64, f64, f64) = (-392.4, -392.4, 90.0);

/// A circle on the map the game reserves: the L-Cluster's is [`L_CLUSTER`], at
/// x = -392.4, y = -392.4 with radius 90.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Guide {
    pub x: f64,
    pub y: f64,
    pub radius: f64,
}

impl Guide {
    pub const fn l_cluster() -> Self {
        let (x, y, radius) = L_CLUSTER;
        Self { x, y, radius }
    }

    /// Whether the point lies inside the circle.
    pub fn contains(&self, x: f64, y: f64) -> bool {
        (x - self.x).hypot(y - self.y) < self.radius
    }
}
