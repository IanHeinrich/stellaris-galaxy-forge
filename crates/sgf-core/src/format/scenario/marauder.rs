//! The marauder clans a map places by initializer. A clan is one system carrying the
//! game's `marauder_N_1` initializer, whose `init_effect` creates the clan's country and
//! flags the system `marauder_capital_N`; its two raid bases carry `marauder_N_2` and
//! `marauder_N_3`. In a random galaxy the home spawns the bases beside itself; in a
//! static one Paint a Galaxy adds them on day one beside any home with no
//! `marauder_system` neighbour. The game knows three clans and no more.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::format::scenario::fe_zone;
use crate::projections::galaxy::{Galaxy, SystemNode};

/// How many clans the game's initializers name.
pub const CLANS: u8 = 3;
/// How close to a seat a clan's home may stand before its raids hit that empire first.
pub const SEAT_CLEARANCE: f64 = 30.0;

pub(crate) const MARAUDER_PREFIX: &str = "marauder_";
const HOME: &str = "1";
const BASES: [&str; 2] = ["2", "3"];

/// What a marauder initializer makes of its system: the clan's home, which spawns the
/// clan, or one of its raid bases.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum MarauderRole {
    Home(u8),
    Base(u8),
}

impl MarauderRole {
    pub const fn clan(self) -> u8 {
        match self {
            Self::Home(clan) | Self::Base(clan) => clan,
        }
    }
}

/// The role `initializer` gives a system: `marauder_N_1` is clan N's home and
/// `marauder_N_2` or `_3` one of its bases, for N up to [`CLANS`]. Anything else is no
/// marauder system this editor knows.
pub fn role(initializer: &str) -> Option<MarauderRole> {
    let rest = initializer.strip_prefix(MARAUDER_PREFIX)?;
    let (clan, site) = rest.split_once('_')?;
    let clan: u8 = clan.parse().ok()?;
    if clan == 0 || clan > CLANS {
        return None;
    }
    if site == HOME {
        Some(MarauderRole::Home(clan))
    } else if BASES.contains(&site) {
        Some(MarauderRole::Base(clan))
    } else {
        None
    }
}

/// The initializer that makes a system clan `clan`'s home.
pub fn home_initializer(clan: u8) -> String {
    format!("{MARAUDER_PREFIX}{clan}_{HOME}")
}

/// Clan → the systems carrying its home, ascending; a clan with none is absent.
pub fn homes(galaxy: &Galaxy) -> BTreeMap<u8, Vec<u32>> {
    let mut homes: BTreeMap<u8, Vec<u32>> = BTreeMap::new();
    for system in galaxy.systems.values() {
        if let Some(MarauderRole::Home(clan)) = system.marauder {
            homes.entry(clan).or_default().push(system.id);
        }
    }
    for ids in homes.values_mut() {
        ids.sort_unstable();
    }
    homes
}

/// The lowest clan with no home on the map, `None` once all three are placed.
pub fn next_free_clan(galaxy: &Galaxy) -> Option<u8> {
    let placed = homes(galaxy);
    (1..=CLANS).find(|clan| !placed.contains_key(clan))
}

/// How many clans have at least one home on the map.
pub fn clan_count(galaxy: &Galaxy) -> u32 {
    crate::as_u32(homes(galaxy).len())
}

/// Whether a home at `home` stands within [`SEAT_CLEARANCE`] of a seat at `seat`.
pub fn near_seat(home: (f64, f64), seat: (f64, f64)) -> bool {
    fe_zone::distance(home, seat) < SEAT_CLEARANCE
}

/// The systems hyperlaned to `system` that carry `role`, ascending by id.
pub fn neighbours_with_role(galaxy: &Galaxy, system: &SystemNode, role: MarauderRole) -> Vec<u32> {
    let mut ids: Vec<u32> = system
        .lanes
        .iter()
        .filter(|lane| {
            galaxy
                .systems
                .get(&lane.to)
                .is_some_and(|other| other.marauder == Some(role))
        })
        .map(|lane| lane.to)
        .collect();
    ids.sort_unstable();
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_role_is_read_from_the_games_initializers_and_from_nothing_else() {
        assert_eq!(role("marauder_1_1"), Some(MarauderRole::Home(1)));
        assert_eq!(role("marauder_2_1"), Some(MarauderRole::Home(2)));
        assert_eq!(role("marauder_3_1"), Some(MarauderRole::Home(3)));
        assert_eq!(role("marauder_1_2"), Some(MarauderRole::Base(1)));
        assert_eq!(role("marauder_3_3"), Some(MarauderRole::Base(3)));
        for other in [
            "",
            "marauder_0_1",
            "marauder_4_1",
            "marauder_1_4",
            "marauder_1",
            "marauder_1_1_1",
            "marauder_x_1",
            "marauder_11",
            "marauder_1_",
            "marauder_system",
            "basic_init_01",
        ] {
            assert_eq!(role(other), None, "{other}");
        }
        assert_eq!(home_initializer(2), "marauder_2_1");
        assert_eq!(role(&home_initializer(3)), Some(MarauderRole::Home(3)));
    }
}
