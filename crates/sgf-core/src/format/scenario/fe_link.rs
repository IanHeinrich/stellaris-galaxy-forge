//! Paint a Galaxy's custom connections: the star flags that tell the mod which systems
//! it lays hyperlanes from into a fallen empire zone.
//!
//! The zone's anchor carries `painted_galaxy_fe_custom_connections` and
//! `painted_galaxy_fe_custom_connection_id_<n>`; at game start every system carrying
//! `painted_galaxy_fe_custom_connection_to_<n>` gets a hyperlane to the nearest system
//! of the fallen empire built in the zone. Without the custom flag the mod links each
//! system of the fallen empire to its nearest neighbour within [`LINK_REACH`] by
//! itself; with the flag and nothing linked to it, it lays no hyperlane at all.
//!
//! An id is galaxy-wide, so one belongs to one anchor, and the mod stops at the first
//! id an anchor carries: an anchor takes one id.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::projections::galaxy::Galaxy;

pub const CUSTOM_CONNECTIONS: &str = "painted_galaxy_fe_custom_connections";
pub const ID_PREFIX: &str = "painted_galaxy_fe_custom_connection_id_";
pub const TO_PREFIX: &str = "painted_galaxy_fe_custom_connection_to_";
/// The ids the mod looks for: `0` up to but not including this.
pub const MOST_IDS: u8 = 100;
/// How far the mod's own rule reaches when it links a fallen empire to its neighbours.
pub const LINK_REACH: f64 = 100.0;

/// One system's custom connection flags, exactly as the file has them: whether it takes
/// custom connections for the zone it anchors, the id it takes them under, and the ids
/// it links to, ascending.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FeLinkFlags {
    pub custom: bool,
    pub id: Option<u8>,
    pub to: Vec<u8>,
}

/// The number after `prefix`, when the flag is one the mod reads: `0` to `99`, written
/// as the mod writes it.
fn number(flag: &str, prefix: &str) -> Option<u8> {
    let suffix = flag.strip_prefix(prefix)?;
    let n: u8 = suffix.parse().ok()?;
    (n < MOST_IDS && n.to_string() == suffix).then_some(n)
}

/// The connection flags among `flags`: the first id, every `to`, ascending and
/// deduplicated.
pub fn parse<'a>(flags: impl Iterator<Item = &'a str>) -> FeLinkFlags {
    let mut link = FeLinkFlags::default();
    for flag in flags {
        if flag == CUSTOM_CONNECTIONS {
            link.custom = true;
        } else if let Some(n) = number(flag, ID_PREFIX) {
            link.id.get_or_insert(n);
        } else if let Some(n) = number(flag, TO_PREFIX) {
            link.to.push(n);
        }
    }
    link.to.sort_unstable();
    link.to.dedup();
    link
}

/// The flags that state `link`: the custom flag, then the id, then the `to`s ascending.
pub fn flags(link: &FeLinkFlags) -> Vec<String> {
    let mut flags = Vec::new();
    if link.custom {
        flags.push(CUSTOM_CONNECTIONS.to_owned());
    }
    if let Some(n) = link.id {
        flags.push(format!("{ID_PREFIX}{n}"));
    }
    let mut to = link.to.clone();
    to.sort_unstable();
    to.dedup();
    flags.extend(to.into_iter().map(|n| format!("{TO_PREFIX}{n}")));
    flags
}

/// Whether a star flag is one of the three the mod reads a custom connection from.
pub fn is_link_flag(flag: &str) -> bool {
    flag == CUSTOM_CONNECTIONS
        || number(flag, ID_PREFIX).is_some()
        || number(flag, TO_PREFIX).is_some()
}

/// The smallest id no system of `galaxy` takes, `None` when every one is taken.
pub fn next_free_id(galaxy: &Galaxy) -> Option<u8> {
    let taken: HashSet<u8> = galaxy
        .systems
        .values()
        .filter_map(|system| system.fe_link.id)
        .collect();
    (0..MOST_IDS).find(|n| !taken.contains(n))
}
