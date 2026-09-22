//! What the Open screen says about a scenario before it is opened: the header values the
//! game's setup screen offers, read from the statements the index lists.

use std::str::FromStr;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cst::{self, Node};
use crate::format::scenario::index::ScenarioHeader;
use crate::keys::scenario as keys;

/// A setup-screen number: the range the header allows and the value it starts at. A
/// plain number is both ends of the range.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Setting {
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// `<key>_default`.
    pub default: Option<f64>,
}

/// How many empires of one kind the setup screen starts at and allows.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EmpireCount {
    pub default: Option<u32>,
    pub max: Option<u32>,
}

/// A scenario's header as the Open screen shows it; a key the header lacks is `None`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ScenarioSummary {
    pub priority: Option<i32>,
    pub radius: Option<f64>,
    pub core_radius: Option<f64>,
    pub supports_shape: Vec<String>,
    /// `num_empire_default`, and the `max` of `num_empires`.
    pub empires: EmpireCount,
    /// `advanced_empire_default`; the header has no key for a maximum.
    pub advanced_empires: EmpireCount,
    pub fallen_empires: EmpireCount,
    pub marauder_empires: EmpireCount,
    pub nomad_empires: EmpireCount,
    pub colonizable_planet_odds: Option<f64>,
    pub primitive_odds: Option<f64>,
    pub num_gateways: Option<Setting>,
    pub num_wormhole_pairs: Option<Setting>,
    pub num_nebulas: Option<Setting>,
    pub num_hyperlanes: Option<Setting>,
    pub crisis_strength: Option<f64>,
    /// The choices `extra_crisis_strength` lists, in file order.
    pub extra_crisis_strength: Vec<f64>,
}

impl ScenarioSummary {
    pub fn of(header: &ScenarioHeader) -> Self {
        let value = |key: &'static str| Value::of(header, key);
        let number = |key: &'static str| value(key)?.scalar_as::<f64>();
        let count = |key: &'static str| value(key)?.scalar_as::<u32>();
        let setting = |key, default_key: Option<&'static str>| {
            let default = default_key.and_then(number);
            let (min, max) =
                value(key).map_or((None, None), |v| (v.end(keys::MIN), v.end(keys::MAX)));
            (min.is_some() || max.is_some() || default.is_some()).then_some(Setting {
                min,
                max,
                default,
            })
        };
        let empires = |default_key, max_key| EmpireCount {
            default: count(default_key),
            max: count(max_key),
        };
        Self {
            priority: value(keys::PRIORITY).and_then(|v| v.scalar_as()),
            radius: number(keys::RADIUS),
            core_radius: number(keys::CORE_RADIUS),
            supports_shape: header
                .all(keys::SUPPORTS_SHAPE)
                .filter_map(|stmt| Value::parse(&stmt.field.value)?.scalar().map(str::to_owned))
                .collect(),
            empires: EmpireCount {
                default: count(keys::NUM_EMPIRE_DEFAULT),
                max: value(keys::NUM_EMPIRES).and_then(|v| v.end(keys::MAX)),
            },
            advanced_empires: EmpireCount {
                default: count(keys::ADVANCED_EMPIRE_DEFAULT),
                max: None,
            },
            fallen_empires: empires(keys::FALLEN_EMPIRE_DEFAULT, keys::FALLEN_EMPIRE_MAX),
            marauder_empires: empires(keys::MARAUDER_EMPIRE_DEFAULT, keys::MARAUDER_EMPIRE_MAX),
            nomad_empires: empires(keys::NOMAD_EMPIRE_DEFAULT, keys::NOMAD_EMPIRE_MAX),
            colonizable_planet_odds: number(keys::COLONIZABLE_PLANET_ODDS),
            primitive_odds: number(keys::PRIMITIVE_ODDS),
            num_gateways: setting(keys::NUM_GATEWAYS, Some(keys::NUM_GATEWAYS_DEFAULT)),
            num_wormhole_pairs: setting(
                keys::NUM_WORMHOLE_PAIRS,
                Some(keys::NUM_WORMHOLE_PAIRS_DEFAULT),
            ),
            num_nebulas: setting(keys::NUM_NEBULAS, None),
            num_hyperlanes: setting(keys::NUM_HYPERLANES, Some(keys::NUM_HYPERLANES_DEFAULT)),
            crisis_strength: number(keys::CRISIS_STRENGTH),
            extra_crisis_strength: value(keys::EXTRA_CRISIS_STRENGTH)
                .map(|v| v.numbers())
                .unwrap_or_default(),
        }
    }
}

/// One header value, the raw text right of `=` parsed on its own.
struct Value {
    text: Vec<u8>,
    node: Node,
}

impl Value {
    /// The first `key`, which is the one the game reads.
    fn of(header: &ScenarioHeader, key: &str) -> Option<Self> {
        Self::parse(&header.get(key)?.field.value)
    }

    fn parse(value: &str) -> Option<Self> {
        let text = value.as_bytes().to_vec();
        let root = cst::parse_script(&text, 0).ok()?;
        let node = root.children().first()?.clone();
        Some(Self { text, node })
    }

    fn scalar(&self) -> Option<&str> {
        self.node.scalar_str(&self.text)
    }

    fn scalar_as<T: FromStr>(&self) -> Option<T> {
        self.scalar()?.parse().ok()
    }

    /// `bound` of `{ min = a max = b }`, or a plain number, which is both ends.
    fn end<T: FromStr>(&self, bound: &str) -> Option<T> {
        match self.scalar() {
            Some(text) => text.parse().ok(),
            None => self
                .node
                .find(bound, &self.text)?
                .scalar_str(&self.text)?
                .parse()
                .ok(),
        }
    }

    /// `{ 10 25 }`, or a plain number as the one entry.
    fn numbers(&self) -> Vec<f64> {
        if let Some(n) = self.scalar_as() {
            return vec![n];
        }
        self.node
            .children()
            .iter()
            .filter(|c| c.key.is_none())
            .filter_map(|c| c.scalar_str(&self.text)?.parse().ok())
            .collect()
    }
}
