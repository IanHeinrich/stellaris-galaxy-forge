//! Paint a Galaxy's fallen empire zones: the star flags on an anchor system that tell
//! the mod where, how far off and which kind of fallen empire to seat.
//!
//! A zone is `set_star_flag = painted_galaxy_fe_spawn` and the flags beside it that
//! share the prefix, all inside the anchor's `effect` block. Reading folds them into a
//! [`FeZone`]; writing turns one back into the flags in the mod's order. A flag the mod
//! does not accept is passed over and the mod's own default stands in for it.

use std::f64::consts::SQRT_2;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cst::Node;

pub(crate) const SET_STAR_FLAG: &str = "set_star_flag";
const FLAG: &str = "painted_galaxy_fe_spawn";
const FLAG_PREFIX: &str = "painted_galaxy_fe_spawn_";
const DISTANCE_PREFIX: &str = "distance_";
const PREFERRED: &str = "preferred";
const FALLBACK: &str = "fallback";

/// How far from its centre a zone reaches.
pub const FE_ZONE_RADIUS: f64 = 30.0;
/// The distances the mod accepts between the anchor and the zone's centre.
pub const FE_ZONE_DISTANCES: [u16; 18] = [
    30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200,
];
const DEFAULT_DISTANCE: u16 = 40;

/// Which way from the anchor the zone's centre lies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum FeDirection {
    E,
    Se,
    S,
    Sw,
    W,
    Nw,
    N,
    Ne,
}

impl FeDirection {
    pub const ALL: [Self; 8] = [
        Self::E,
        Self::Se,
        Self::S,
        Self::Sw,
        Self::W,
        Self::Nw,
        Self::N,
        Self::Ne,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::E => "e",
            Self::Se => "se",
            Self::S => "s",
            Self::Sw => "sw",
            Self::W => "w",
            Self::Nw => "nw",
            Self::N => "n",
            Self::Ne => "ne",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|d| d.as_str() == text)
    }
}

/// Which fallen empire the mod seats in the zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum FeKind {
    Random,
    Materialist,
    Spiritualist,
    Xenophobe,
    Xenophile,
    Machine,
    Hive,
}

impl FeKind {
    pub const ALL: [Self; 7] = [
        Self::Random,
        Self::Materialist,
        Self::Spiritualist,
        Self::Xenophobe,
        Self::Xenophile,
        Self::Machine,
        Self::Hive,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Random => "random",
            Self::Materialist => "materialist",
            Self::Spiritualist => "spiritualist",
            Self::Xenophobe => "xenophobe",
            Self::Xenophile => "xenophile",
            Self::Machine => "machine",
            Self::Hive => "hive",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == text)
    }
}

/// The zone one system anchors: where its centre lies from the anchor, who is seated
/// there, and whether the map author placed it by hand (`preferred`) or offered it as a
/// `fallback`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FeZone {
    pub direction: FeDirection,
    pub kind: FeKind,
    pub distance: u16,
    pub preferred: bool,
    pub fallback: bool,
}

/// Every `set_star_flag` of an `effect` block, in file order.
pub(crate) fn star_flags<'a>(effect: &'a Node, src: &'a [u8]) -> impl Iterator<Item = &'a str> {
    effect
        .find_all(SET_STAR_FLAG, src)
        .filter_map(|flag| flag.scalar_str(src))
}

/// The zone the flags describe, `None` unless `painted_galaxy_fe_spawn` is among them.
/// A direction, kind or distance the mod does not accept is passed over, and the mod's
/// defaults stand in for whatever the flags leave unsaid.
pub fn parse<'a>(flags: impl Iterator<Item = &'a str>) -> Option<FeZone> {
    let mut anchored = false;
    let mut zone = FeZone {
        direction: FeDirection::E,
        kind: FeKind::Random,
        distance: DEFAULT_DISTANCE,
        preferred: false,
        fallback: false,
    };
    for flag in flags {
        if flag == FLAG {
            anchored = true;
            continue;
        }
        let Some(suffix) = flag.strip_prefix(FLAG_PREFIX) else {
            continue;
        };
        if let Some(direction) = FeDirection::parse(suffix) {
            zone.direction = direction;
        } else if let Some(kind) = FeKind::parse(suffix) {
            zone.kind = kind;
        } else if let Some(distance) = suffix.strip_prefix(DISTANCE_PREFIX) {
            if let Ok(distance) = distance.parse()
                && FE_ZONE_DISTANCES.contains(&distance)
            {
                zone.distance = distance;
            }
        } else if suffix == PREFERRED {
            zone.preferred = true;
        } else if suffix == FALLBACK {
            zone.fallback = true;
        }
    }
    anchored.then_some(zone)
}

/// The flags that state `zone`, in the order the mod writes them.
pub fn flags(zone: &FeZone) -> Vec<String> {
    let mut flags = vec![
        FLAG.to_owned(),
        format!("{FLAG_PREFIX}{}", zone.direction.as_str()),
        format!("{FLAG_PREFIX}{}", zone.kind.as_str()),
        format!("{FLAG_PREFIX}{DISTANCE_PREFIX}{}", zone.distance),
    ];
    if zone.preferred {
        flags.push(format!("{FLAG_PREFIX}{PREFERRED}"));
    }
    if zone.fallback {
        flags.push(format!("{FLAG_PREFIX}{FALLBACK}"));
    }
    flags
}

/// The zone's centre, `anchor` being the anchor's `position` as the file writes it.
/// East lies at negative x: the mod's canvas mirrors the game's x axis, and the flags
/// name the canvas side.
pub fn centre(anchor: (f64, f64), zone: &FeZone) -> (f64, f64) {
    let d = f64::from(zone.distance);
    let k = d / SQRT_2;
    let (dx, dy) = match zone.direction {
        FeDirection::E => (-d, 0.0),
        FeDirection::Se => (-k, k),
        FeDirection::S => (0.0, d),
        FeDirection::Sw => (k, k),
        FeDirection::W => (d, 0.0),
        FeDirection::Nw => (k, -k),
        FeDirection::N => (0.0, -d),
        FeDirection::Ne => (-k, -k),
    };
    (anchor.0 + dx, anchor.1 + dy)
}

/// Whether a star flag is part of a zone. The mod's custom connection flags share the
/// `painted_galaxy_fe_` start and are not.
pub fn is_zone_flag(flag: &str) -> bool {
    flag == FLAG || flag.starts_with(FLAG_PREFIX)
}
