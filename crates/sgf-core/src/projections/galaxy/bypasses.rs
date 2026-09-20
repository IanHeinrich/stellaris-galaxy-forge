//! Wormholes, gateways and L-gates as the graph links them.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BypassLink {
    Wormhole { a: u32, b: u32 },
    Gateway { system: u32, active: bool },
    LGate { system: u32 },
    Other { system: u32, kind: String },
}
