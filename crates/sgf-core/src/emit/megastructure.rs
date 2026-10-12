//! A `megastructures` row and the `bypasses` row it stands for, as the game writes a finished
//! structure. The game fills in a bypass's lock fields on load.

use crate::emit::{Lines, coord, quoted};
use crate::keys;
use crate::projections::name::NameTemplate;

/// `owner.type` of a bypass whose owner is a `megastructures` row.
const MEGASTRUCTURE_OWNER: &str = "6";
/// The date a row that is not being dismantled holds.
const NOT_DISMANTLED: &str = "\"0.01.01\"";

/// A new `megastructures` row.
#[derive(Debug, Clone, PartialEq)]
pub struct MegastructureRow<'a> {
    pub id: u32,
    /// Written first, as the game writes a name `set_name` gave the row.
    pub name: Option<&'a NameTemplate>,
    pub kind: &'a str,
    /// Relative to the system's centre.
    pub at: (f64, f64),
    pub system: u32,
    /// The owner and its `graphical_culture`, when it names one.
    pub owner: Option<(u32, Option<&'a str>)>,
    /// The body it stands on or around; the null id for none.
    pub planet: u32,
    pub bypass: Option<u32>,
}

pub fn megastructure_row(indent: &[u8], row: &MegastructureRow<'_>) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.open(0, &row.id.to_string());
    if let Some(name) = row.name {
        w.line(1, &format!("{}=", keys::NAME));
        w.name(1, name);
    }
    w.pair(1, keys::TYPE, &quoted(row.kind));
    w.open(1, keys::COORDINATE);
    w.pair(2, keys::X, &coord(row.at.0));
    w.pair(2, keys::Y, &coord(row.at.1));
    w.pair(2, keys::ORIGIN, &row.system.to_string());
    w.close(1);
    if let Some((owner, culture)) = row.owner {
        w.pair(1, keys::OWNER, &owner.to_string());
        if let Some(culture) = culture {
            w.pair(1, keys::GRAPHICAL_CULTURE, &quoted(culture));
        }
    }
    w.pair(1, keys::PLANET, &row.planet.to_string());
    if let Some(bypass) = row.bypass {
        w.pair(1, keys::BYPASS, &bypass.to_string());
    }
    w.open(1, keys::ORBITALS);
    w.close(1);
    w.pair(1, keys::BUILD_QUEUE, &crate::NULL_ID.to_string());
    w.pair(1, keys::DISMANTLE_PROGRESS, "0");
    w.pair(1, keys::DISMANTLE_FINISH_DATE, NOT_DISMANTLED);
    w.close(0);
    w.into_bytes()
}

/// A new `bypasses` row owned by a `megastructures` row.
#[derive(Debug, Clone, PartialEq)]
pub struct BypassRow<'a> {
    pub id: u32,
    pub kind: &'a str,
    pub active: bool,
    pub connections: &'a [u32],
    /// Written only when the row is active.
    pub active_connections: &'a [u32],
    /// The `megastructures` row.
    pub owner: u32,
}

pub fn bypass_row(indent: &[u8], row: &BypassRow<'_>) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.open(0, &row.id.to_string());
    w.pair(1, keys::TYPE, &quoted(row.kind));
    w.pair(1, keys::ACTIVE, if row.active { "yes" } else { "no" });
    if !row.connections.is_empty() {
        w.list(1, keys::CONNECTIONS, row.connections);
    }
    if row.active && !row.active_connections.is_empty() {
        w.list(1, keys::ACTIVE_CONNECTIONS, row.active_connections);
    }
    w.open(1, keys::OWNER);
    w.pair(2, keys::TYPE, MEGASTRUCTURE_OWNER);
    w.pair(2, keys::ID, &row.owner.to_string());
    w.close(1);
    w.close(0);
    w.into_bytes()
}
